#!/usr/bin/env python3
"""The session board: one page of what is being worked, what landed and what is
next, derived from the tools that already coordinate the work, so no session
writes it.

Sources, all read and none written: the git refs (main against origin, topic
and parked branches, worktrees, the version against its tag), the landing
lease (`<git dir>/acks-lease/landing.json`), the edit ledger
(`<git dir>/acks-ledger/<session>.jsonl`), the walk runner's results
(`aia-tmp/live/walk-results.json`), the bug-intake ledger (LOCAL-ONLY, read
where it exists; ids, statuses and counts only reach the page), and each
session's own task list, which the `feed` command records from a PostToolUse
hook on the plan tools (`.claude/settings.json`).

Commands:
  ensure  start the daemon where none is alive; returns at once (SessionStart)
  feed    record a plan-tool call read from the hook's stdin, then ensure
  run     the daemon: rebuild on any source change and serve the page on
          127.0.0.1 (port: ACKS_BOARD_PORT, else the one it last held, else
          any free one)
  once    render the page once and print its path
  stop    stop the daemon
  status  print the daemon's pid, url and page path

State lives in `<git common dir>/acks-board/`; the page is written to
`aia-tmp/session-board.html` in the main checkout, self-contained, so one
Artifact publish carries it whole.
"""
from __future__ import annotations

import csv
import datetime as dt
import html
import http.server
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "board.html"

#: Plan tools whose calls the feed records.
PLAN_TOOLS = {"mcp__ccd_turn__update_plan", "mcp__ccd_turn__wrap_up", "TodoWrite", "TaskCreate", "TaskUpdate"}
#: Seconds between source checks, between forced rebuilds (ages move), and between remote reads.
POLL_S, REFRESH_S, REMOTE_S = 3, 60, 300
#: A daemon with no source change for this long exits; the next session start brings it back.
IDLE_EXIT_S = 8 * 3600
#: A session whose task list has not moved for this long is shown as quiet, and dropped after a day.
QUIET_S, DROP_S = 2 * 3600, 24 * 3600
#: Bounds on any git call the daemon makes.
GIT_TIMEOUT_S = 20


# --------------------------------------------------------------------- paths

def git(args: list[str], cwd: Path, timeout: float = GIT_TIMEOUT_S) -> str:
    """Run git with no prompt and a timeout; an error or a timeout answers ""."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"}
    try:
        out = subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True,
                             timeout=timeout, stdin=subprocess.DEVNULL,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def locate(start: Path | None = None) -> dict:
    """The main checkout, its git common dir and the board's state dir, from any checkout of the repo."""
    start = Path(start or os.environ.get("CLAUDE_PROJECT_DIR") or Path.cwd())
    common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], start)
    if not common:
        raise SystemExit("session-board: not inside a git checkout")
    common_dir = Path(common)
    root = common_dir.parent
    state = common_dir / "acks-board"
    return {"root": root, "common": common_dir, "state": state, "sessions": state / "sessions",
            "page": root / "aia-tmp" / "session-board.html", "daemon": state / "daemon.json",
            "lock": state / "daemon.lock", "stop": state / "stop", "log": state / "daemon.log"}


def write_json(path: Path, data) -> None:
    """Write through a temporary file, so a reader never sees half a document."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


# ---------------------------------------------------------------- processes

def pid_alive(pid: int) -> bool:
    """Whether a process with this id is running. Never signals it: on Windows `os.kill(pid, 0)` sends CTRL_C."""
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.restype = wintypes.HANDLE
        handle = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            return bool(k32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
        finally:
            k32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def kill(pid: int) -> None:
    if os.name == "nt":
        import ctypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = k32.OpenProcess(0x0001, False, pid)  # PROCESS_TERMINATE
        if handle:
            k32.TerminateProcess(handle, 1)
            k32.CloseHandle(handle)
    else:
        import signal
        os.kill(pid, signal.SIGTERM)


def daemon_alive(p: dict) -> dict | None:
    info = read_json(p["daemon"])
    return info if info and pid_alive(info.get("pid", 0)) else None


def ensure(p: dict) -> dict | None:
    """Start the daemon detached where none is alive, and return at once; a race between two starts is settled by the daemon's lock."""
    alive = daemon_alive(p)
    if alive:
        return alive
    exe = Path(sys.executable)
    windowless = exe.with_name("pythonw.exe")
    runner = str(windowless if os.name == "nt" and windowless.exists() else exe)
    kwargs = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
              "cwd": str(p["root"]), "close_fds": True}
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED_PROCESS | NEW_PROCESS_GROUP | NO_WINDOW
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([runner, str(Path(__file__).resolve()), "run"], **kwargs)
    return None


# ---------------------------------------------------------------------- feed

def _apply_advance(items: list[dict]) -> None:
    for i, it in enumerate(items):
        if it.get("status") == "in_progress":
            it["status"] = "completed"
            nxt = next((j for j in range(i + 1, len(items)) if items[j].get("status") == "pending"), None)
            if nxt is not None:
                items[nxt]["status"] = "in_progress"
            return
    nxt = next((j for j, it in enumerate(items) if it.get("status") == "pending"), None)
    if nxt is not None:
        items[nxt]["status"] = "in_progress"


def _response_text(resp) -> str:
    if isinstance(resp, str):
        return resp
    if isinstance(resp, list):
        return " ".join(_response_text(x) for x in resp)
    if isinstance(resp, dict):
        return str(resp.get("text") or resp.get("content") or "")
    return ""


def apply_feed(state: dict | None, event: dict, now: float | None = None) -> dict:
    """Fold one plan-tool call into a session's recorded task list. A call carrying no list moves the list it has; with none stored, the step the tool reported is kept."""
    now = time.time() if now is None else now
    st = dict(state or {})
    st.setdefault("items", [])
    st["session"] = event.get("session_id") or st.get("session")
    st["cwd"] = event.get("cwd") or st.get("cwd")
    if event.get("agent_id"):
        st["agent"] = event.get("agent_type") or "agent"
    st["updated"] = now
    tool, inp = event.get("tool_name"), event.get("tool_input") or {}
    items = [dict(x) for x in st["items"]]
    if tool == "mcp__ccd_turn__update_plan":
        if isinstance(inp.get("items"), list):
            items = [{"content": str(x.get("content", "")), "status": x.get("status", "pending")} for x in inp["items"] if isinstance(x, dict)]
            st.pop("wrapped", None)
            st.pop("recap", None)
            if inp.get("scope"):
                st["scope"] = inp["scope"]
        if inp.get("advance"):
            _apply_advance(items)
        for n in inp.get("done") or []:
            if isinstance(n, int) and 0 < n <= len(items):
                items[n - 1]["status"] = "completed"
        start = inp.get("start")
        if isinstance(start, int) and 0 < start <= len(items):
            for it in items:
                if it.get("status") == "in_progress":
                    it["status"] = "pending"
            items[start - 1]["status"] = "in_progress"
        m = re.search(r"step (\d+) of (\d+)", _response_text(event.get("tool_response")))
        st["step"] = [int(m.group(1)), int(m.group(2))] if m else st.get("step")
    elif tool == "mcp__ccd_turn__wrap_up":
        for it in items:
            if it.get("status") != "completed":
                it["status"] = "completed"
        st["wrapped"] = now
        st["recap"] = str(inp.get("recap") or "")[:400]
        st["ask"] = str(inp.get("ask") or "")[:200] or None
    elif tool == "TodoWrite" and isinstance(inp.get("todos"), list):
        items = [{"content": str(x.get("content", "")), "status": x.get("status", "pending")} for x in inp["todos"] if isinstance(x, dict)]
        st.pop("wrapped", None)
    elif tool == "TaskCreate":
        text = inp.get("subject") or inp.get("title") or inp.get("content") or inp.get("description") or ""
        m = re.search(r"#?(\d+)", _response_text(event.get("tool_response")))
        items.append({"content": str(text)[:200], "status": inp.get("status", "pending"), "id": m.group(1) if m else None})
    elif tool == "TaskUpdate":
        tid = str(inp.get("taskId") or inp.get("id") or "")
        for it in items:
            if tid and str(it.get("id")) == tid and inp.get("status"):
                it["status"] = inp["status"]
    st["items"] = items
    return st


def feed(p: dict, raw: str) -> None:
    """The hook's half: record the call and make sure the daemon runs. Never raises, so a hook failure cannot touch the tool call."""
    try:
        event = json.loads(raw or "{}")
        if event.get("tool_name") not in PLAN_TOOLS or not event.get("session_id"):
            return
        sid = re.sub(r"[^A-Za-z0-9_-]", "", str(event["session_id"]))
        path = p["sessions"] / f"{sid}.json"
        write_json(path, apply_feed(read_json(path), event))
        ensure(p)
    except Exception:  # noqa: BLE001 - the hook must exit cleanly whatever happens
        pass


# ------------------------------------------------------------------- sources

def local_midnight(now: float) -> float:
    d = dt.datetime.fromtimestamp(now)
    return d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def iso_ts(text: str | None) -> float | None:
    if not text:
        return None
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def bug_ledger_path(p: dict) -> Path:
    env = os.environ.get("ACKS_BUG_LEDGER")
    return Path(env) if env else p["root"].parent / "acks-rules" / "bug-intake" / "ledger.csv"


def read_bug_ledger(path: Path, today: str) -> dict | None:
    """Counts and ids from the intake ledger; its titles and notes never leave this function."""
    try:
        with path.open(encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
    except OSError:
        return None
    by_status: dict[str, list[str]] = {}
    claims: dict[str, list[str]] = {}
    opened_today, touched_today = [], []
    for r in rows:
        rid, status = (r.get("id") or "").strip(), (r.get("status") or "").strip()
        if not rid:
            continue
        by_status.setdefault(status, []).append(rid)
        if status == "claimed" and r.get("claim"):
            claims.setdefault(r["claim"].strip(), []).append(rid)
        if (r.get("opened") or "").strip() == today:
            opened_today.append(rid)
        if f"[{today}" in (r.get("notes") or "") and status in ("fixed-unreleased", "released", "docs-only", "false-report", "duplicate", "wontfix"):
            touched_today.append(rid)
    return {"by_status": by_status, "claims": claims, "opened_today": opened_today, "closed_today": touched_today}


def read_walks(path: Path, since: float) -> list[dict]:
    data = read_json(path, {}) or {}
    out = []
    for name, w in (data.get("walks") or {}).items():
        ended = iso_ts(w.get("endedAt"))
        started = iso_ts(w.get("startedAt"))
        if ended is None and w.get("state") != "running":
            continue
        if (ended or started or 0) < since:
            continue
        tally = w.get("tally") or {}
        out.append({"walk": name, "state": w.get("state") or "?", "pass": tally.get("pass"), "fail": tally.get("fail"),
                    "gap": tally.get("gap"), "partial": w.get("partial") or False, "ended": ended,
                    "secs": round(ended - started) if ended and started else None})
    out.sort(key=lambda w: w["ended"] or 0, reverse=True)
    return out


def read_edits(common: Path, since: float) -> dict[str, dict]:
    """Per session: its last recorded edit and the files it touched since `since`."""
    out: dict[str, dict] = {}
    d = common / "acks-ledger"
    if not d.is_dir():
        return out
    for f in d.glob("*.jsonl"):
        try:
            if f.stat().st_mtime < since:
                continue
            files, last = set(), 0.0
            with f.open(encoding="utf-8") as fh:
                for line in fh:
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    ts = (rec.get("ts") or 0) / 1000
                    if ts >= since:
                        files.add(rec.get("file"))
                        last = max(last, ts)
            if files:
                out[f.stem] = {"files": sorted(x for x in files if x), "last": last}
        except OSError:
            continue
    return out


def read_branches(root: Path) -> dict:
    refs = git(["for-each-ref", "--format=%(refname:short)", "refs/heads/topic", "refs/heads/parked"], root).splitlines()
    worktrees = {}
    cur = None
    for line in git(["worktree", "list", "--porcelain"], root).splitlines():
        if line.startswith("worktree "):
            cur = line[9:]
        elif line.startswith("branch refs/heads/") and cur:
            worktrees[line[18:]] = cur
    topics = []
    for ref in refs:
        if not ref:
            continue
        ahead = git(["rev-list", "--count", f"main..{ref}"], root)
        topics.append({"ref": ref, "ahead": int(ahead or 0), "worktree": worktrees.get(ref)})
    return {"topics": topics}


def read_release(root: Path) -> dict:
    try:
        version = json.loads((root / "module.json").read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError):
        version = None
    tagged = bool(version and git(["tag", "--list", f"v{version}"], root))
    return {"version": version, "tagged": tagged, "last_tag": git(["describe", "--tags", "--abbrev=0", "main"], root)}


class Remote:
    """The remote main's sha, read with ls-remote at most every REMOTE_S, so a stale tracking ref never miscounts what is pushed."""

    def __init__(self, root: Path):
        self.root, self.sha, self.at = root, None, 0.0

    def get(self, now: float) -> str | None:
        if now - self.at >= REMOTE_S:
            self.at = now
            line = git(["ls-remote", "origin", "refs/heads/main"], self.root, timeout=GIT_TIMEOUT_S)
            self.sha = line.split()[0] if line else (git(["rev-parse", "origin/main"], self.root) or self.sha)
        return self.sha


# --------------------------------------------------------------------- build

def short(sid: str | None) -> str:
    return (sid or "?")[:8]


def age(now: float, ts: float | None) -> str:
    if not ts:
        return "?"
    s = max(0, int(now - ts))
    return f"{s}s" if s < 90 else f"{s // 60}m" if s < 5400 else f"{s // 3600}h"


def build(p: dict, now: float, remote_sha: str | None) -> dict:
    """The board's data: strip, three lanes and the walk table, from the sources alone."""
    root, common = p["root"], p["common"]
    midnight = local_midnight(now)
    today = dt.date.fromtimestamp(now).isoformat()
    main_sha = git(["rev-parse", "main"], root)
    ahead = []
    if remote_sha and main_sha:
        ahead = [l for l in git(["log", "--format=%h", f"{remote_sha}..main"], root).splitlines() if l]
    log_today = []
    for line in git(["log", "main", f"--since=@{int(midnight)}", "--format=%h%x09%ct%x09%s"], root).splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3:
            log_today.append({"sha": parts[0], "ts": int(parts[1]), "subject": parts[2]})
    lease = read_json(common / "acks-lease" / "landing.json")
    edits = read_edits(common, now - 3600)
    walks = read_walks(root / "aia-tmp" / "live" / "walk-results.json", midnight)
    bugs = read_bug_ledger(bug_ledger_path(p), today)
    branches = read_branches(root)
    release = read_release(root)

    sessions = []
    if p["sessions"].is_dir():
        for f in p["sessions"].glob("*.json"):
            st = read_json(f)
            if not st:
                continue
            idle = now - (st.get("updated") or 0)
            if idle > DROP_S:
                try:
                    f.unlink()
                except OSError:
                    pass
                continue
            sessions.append(st)
    sessions.sort(key=lambda s: s.get("updated") or 0, reverse=True)

    working, done, deck = [], [], []
    mark = {"completed": "✓ ", "in_progress": "▶ ", "pending": "· "}
    for st in sessions:
        sid = st.get("session")
        items = st.get("items") or []
        if st.get("wrapped"):
            if st["wrapped"] >= midnight:
                done.append({"title": f"Session {short(sid)} wrapped up", "body": st.get("recap") or "",
                             "list": [i["content"] for i in items][:12],
                             "chips": [[short(sid), "sha"], [f"{age(now, st['wrapped'])} ago", ""]] + ([["asks the owner", "warn"]] if st.get("ask") else [])})
            continue
        idle = now - (st.get("updated") or 0)
        current = next((i["content"] for i in items if i.get("status") == "in_progress"), None)
        step = st.get("step")
        title = current or (f"Step {step[0]} of {step[1]}" if step else "Task list unknown")
        e = edits.get(sid or "", {})
        chips = [[short(sid), "sha"], [Path(st.get("cwd") or "").name or "?", ""],
                 [f"moved {age(now, st.get('updated'))} ago", "warn" if idle > QUIET_S else "ok"]]
        if e.get("files"):
            chips.append([f"{len(e['files'])} file(s) edited in the hour", ""])
        if st.get("agent"):
            chips.append([st["agent"], ""])
        working.append({"title": title, "body": None if items else "Its task list has not been seen yet.",
                        "list": [mark.get(i.get("status"), "· ") + i["content"] for i in items][:14], "chips": chips,
                        "quiet": idle > QUIET_S})
    seen = {s.get("session") for s in sessions}
    for sid, e in edits.items():
        if sid not in seen:
            working.append({"title": f"Session {short(sid)}: edits, no task list seen", "list": e["files"][:8],
                            "chips": [[short(sid), "sha"], [f"last edit {age(now, e['last'])} ago", ""]]})
    if lease:
        since = (lease.get("since") or 0) / 1000 if (lease.get("since") or 0) > 1e11 else lease.get("since")
        working.insert(0, {"title": "Landing lease held: a gate or a walk is running",
                           "body": f"Change: {Path(str(lease.get('change') or '')).name or '?'}",
                           "chips": [[short(lease.get("session")), "sha"], [f"since {age(now, since)}", "warn"]]})
    stale_claims = []
    if bugs:
        for claim, ids in sorted(bugs["claims"].items()):
            # A claim opens with its date; one older than today is listed on deck as possibly abandoned.
            dated = re.match(r"(\d{4}-\d{2}-\d{2})", claim)
            if dated and dated.group(1) < today:
                stale_claims.append((claim, ids))
                continue
            working.append({"title": f"Ledger rows claimed: {claim}", "list": [", ".join(ids)], "chips": [[f"{len(ids)} row(s)", ""]]})
    for t in branches["topics"]:
        if t["ref"].startswith("topic/") and t["ahead"] > 0:
            working.append({"title": f"{t['ref']}: {t['ahead']} commit(s) not on main", "body": t["worktree"] or "no worktree",
                            "chips": [["topic", "warn"]]})

    if log_today:
        pushed = set()
        if remote_sha:
            pushed = {c["sha"] for c in log_today if c["sha"] not in ahead}
        done.insert(0, {"title": f"Landed on main today: {len(log_today)} commit(s)",
                        "list": [f"{c['sha']} {c['subject'][:140]}" for c in log_today][:25],
                        "chips": [[f"{len(ahead)} not pushed", "warn" if ahead else "ok"], [f"{len(pushed)} pushed", "ok"]]})
    if bugs and bugs["closed_today"]:
        done.append({"title": f"Ledger rows fixed or closed, with a note dated today: {len(bugs['closed_today'])}",
                     "list": [", ".join(bugs["closed_today"][:60]) + (" …" if len(bugs["closed_today"]) > 60 else "")]})
    passed = [w for w in walks if w["state"] == "passed"]
    if walks:
        done.append({"title": f"Walks today: {len(passed)} of {len(walks)} passed",
                     "list": [f"{w['walk']}: {w['state']} {w['pass']}/{w['fail']}" for w in walks if w["state"] != "passed"][:10] or None,
                     "chips": [[f"{len(passed)} passed", "ok"], [f"{len(walks) - len(passed)} not passed", "bad" if len(walks) > len(passed) else "ok"]]})

    for t in branches["topics"]:
        if t["ref"].startswith("topic/") and t["ahead"] == 0:
            deck.append({"title": f"{t['ref']}: landed and open", "body": "Walk what it changed, then acks-branch close.", "chips": [["close", "warn"]]})
        elif t["ref"].startswith("parked/"):
            deck.append({"title": f"{t['ref']}: parked", "chips": [["parked", ""]]})
    if bugs:
        new = bugs["by_status"].get("new", [])
        deferred = bugs["by_status"].get("deferred", [])
        if new:
            deck.append({"title": f"Open ledger rows: {len(new)} new", "list": [", ".join(new[:40]) + (" …" if len(new) > 40 else "")],
                         "chips": [[f"{len(deferred)} deferred", ""]]})
        fixed = bugs["by_status"].get("fixed-unreleased", [])
        if fixed:
            deck.append({"title": f"Fixed, waiting on a release: {len(fixed)} row(s)", "list": [", ".join(fixed[:40]) + (" …" if len(fixed) > 40 else "")]})
        for claim, ids in stale_claims:
            deck.append({"title": f"Claim from an earlier day: {claim}", "body": "Claimed rows with no fix yet; the claiming session may be gone.",
                         "list": [", ".join(ids)], "chips": [[f"{len(ids)} row(s)", "warn"]]})
    if release["version"] and not release["tagged"]:
        deck.insert(0, {"title": f"Release window open: v{release['version']} has no tag", "body": "Only the release's own session lands runtime changes until it is tagged.", "chips": [["release", "warn"]]})

    strip = [
        [str(len(ahead)) if remote_sha else "?", "commits on main, not pushed"],
        [str(len(log_today)), "landed today"],
        [str(sum(1 for s in sessions if not s.get("wrapped") and now - (s.get("updated") or 0) <= QUIET_S)), "sessions moving"],
        [f"{len(passed)} / {len(walks)}", "walks passed today"],
        [str(len([t for t in branches['topics'] if t['ref'].startswith('topic/')])), "open topics"],
        ["held" if lease else "free", "landing lease"],
    ]
    if bugs:
        strip.append([str(len(bugs["by_status"].get("new", []))), "new ledger rows"])
        strip.append([str(len(bugs["opened_today"])), "rows opened today"])
    strip.append([release["last_tag"] or "?", "last tag"])

    walk_rows = [[w["walk"], "partial" if w["partial"] else "full", w["state"],
                  f"{w['pass']} / {w['fail']}" + (f" / {w['gap']} gap" if w.get("gap") else ""),
                  f"{w['secs']} s" if w["secs"] is not None else "",
                  dt.datetime.fromtimestamp(w["ended"]).strftime("%H:%M") if w["ended"] else ""] for w in walks]
    for w in working:
        w.pop("quiet", None)
    return {"asof": dt.datetime.fromtimestamp(now).strftime("%Y-%m-%d %H:%M:%S"), "repo": root.name,
            "strip": strip, "working": working, "done": done, "deck": deck, "walks": walk_rows}


def render(board: dict) -> str:
    """The page with the board's data inside it: one file, nothing fetched but the fonts."""
    data = json.dumps(board, ensure_ascii=False).replace("</", "<\\/")
    return TEMPLATE.read_text(encoding="utf-8").replace("/*BOARD*/null", data).replace("{{REPO}}", html.escape(board["repo"]))


def fingerprint(p: dict) -> tuple:
    root, common = p["root"], p["common"]
    def mt(path: Path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0
    ledger_dir = common / "acks-ledger"
    newest_edit = max((mt(f) for f in ledger_dir.glob("*.jsonl")), default=0.0) if ledger_dir.is_dir() else 0.0
    newest_session = max((mt(f) for f in p["sessions"].glob("*.json")), default=0.0) if p["sessions"].is_dir() else 0.0
    return (mt(common / "refs" / "heads"), mt(common / "refs" / "heads" / "main"), mt(common / "packed-refs"),
            mt(common / "HEAD"), mt(common / "acks-lease" / "landing.json"), mt(common / "acks-lease"),
            newest_edit, newest_session, mt(root / "aia-tmp" / "live" / "walk-results.json"),
            mt(bug_ledger_path(p)), mt(root / "module.json"), mt(common / "refs" / "tags"))


# -------------------------------------------------------------------- daemon

class Holder:
    def __init__(self):
        self.page, self.json, self.lock = b"", b"{}", threading.Lock()


def serve(holder: Holder, port: int) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - the stdlib's name
            with holder.lock:
                body, kind = (holder.json, "application/json") if self.path.startswith("/board.json") else (holder.page, "text/html; charset=utf-8")
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def log(p: dict, text: str) -> None:
    try:
        if p["log"].exists() and p["log"].stat().st_size > 1_000_000:
            p["log"].unlink()
        with p["log"].open("a", encoding="utf-8") as fh:
            fh.write(f"{dt.datetime.now().isoformat(timespec='seconds')} {text}\n")
    except OSError:
        pass


def take_lock(p: dict) -> bool:
    """One daemon per repository: the lock file is made exclusively, and a lock whose holder is gone is taken over."""
    p["state"].mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(p["lock"], os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                holder = int(p["lock"].read_text().strip() or 0)
            except (OSError, ValueError):
                holder = 0
            if pid_alive(holder):
                return False
            try:
                p["lock"].unlink()
            except OSError:
                return False
    return False


def run(p: dict) -> None:
    if not take_lock(p):
        return
    try:
        p["stop"].unlink(missing_ok=True)
        prior = read_json(p["daemon"], {}) or {}
        port = int(os.environ.get("ACKS_BOARD_PORT") or prior.get("port") or 0)
        holder = Holder()
        server = serve(holder, port)
        url = f"http://127.0.0.1:{server.server_address[1]}/"
        write_json(p["daemon"], {"pid": os.getpid(), "port": server.server_address[1], "url": url,
                                 "page": str(p["page"]), "started": time.time()})
        log(p, f"started at {url}")
        remote = Remote(p["root"])
        last_fp, last_build, last_change = None, 0.0, time.time()
        while not p["stop"].exists():
            now = time.time()
            fp = fingerprint(p)
            if fp != last_fp:
                last_change = now
            if fp != last_fp or now - last_build >= REFRESH_S:
                try:
                    board = build(p, now, remote.get(now))
                    page = render(board)
                    with holder.lock:
                        holder.page, holder.json = page.encode("utf-8"), json.dumps(board, ensure_ascii=False).encode("utf-8")
                    p["page"].parent.mkdir(parents=True, exist_ok=True)
                    tmp = p["page"].with_name(".session-board.html.tmp")
                    tmp.write_text(page, encoding="utf-8")
                    os.replace(tmp, p["page"])
                except Exception as err:  # noqa: BLE001 - a bad source must not end the daemon
                    log(p, f"build failed: {err!r}")
                last_fp, last_build = fp, now
            if now - last_change > IDLE_EXIT_S:
                log(p, "idle; exiting")
                break
            time.sleep(POLL_S)
        server.shutdown()
    finally:
        try:
            p["lock"].unlink()
        except OSError:
            pass
        info = read_json(p["daemon"], {}) or {}
        if info.get("pid") == os.getpid():
            write_json(p["daemon"], {**info, "pid": None, "stopped": time.time()})


def stop(p: dict) -> str:
    info = daemon_alive(p)
    if not info:
        return "no daemon running"
    p["state"].mkdir(parents=True, exist_ok=True)
    p["stop"].write_text("stop")
    for _ in range(20):
        if not pid_alive(info["pid"]):
            return f"stopped {info['pid']}"
        time.sleep(0.5)
    kill(info["pid"])
    return f"terminated {info['pid']}"


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "status"
    p = locate()
    if cmd == "feed":
        feed(p, sys.stdin.read())
        return 0
    if cmd == "ensure":
        ensure(p)
        return 0
    if cmd == "run":
        run(p)
        return 0
    if cmd == "once":
        now = time.time()
        page = render(build(p, now, Remote(p["root"]).get(now)))
        p["page"].parent.mkdir(parents=True, exist_ok=True)
        p["page"].write_text(page, encoding="utf-8")
        print(p["page"])
        return 0
    if cmd == "stop":
        print(stop(p))
        return 0
    if cmd == "status":
        info = daemon_alive(p)
        print(json.dumps(info or {"running": False, "page": str(p["page"])}, indent=1))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
