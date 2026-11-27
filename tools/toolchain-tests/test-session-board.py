"""Checks `tools/session-board/board.py` on what it exists to guarantee:

- the feed folds every plan-tool call into a session's task list, including a
  call that carries no list (an advance, a done/start, a wrap-up) and one that
  arrives before any list was seen;
- a malformed or foreign hook payload is ignored and never raises;
- the intake ledger reaches the board as ids, statuses and counts only: no
  title or note text is in the page, and a claim from an earlier day is listed
  on deck, not as work;
- the walk table keeps today's walks, newest first;
- one daemon holds the lock, and a lock whose holder is gone is taken over;
- `pid_alive` tells a live process from a gone one without signalling it.

Usage:  python tools/toolchain-tests/test-session-board.py [<board.py>]
        (defaults to the copy in this repository; pass a modified copy to
        confirm a case fails when the behaviour it guards is broken)
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
TARGET = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "session-board" / "board.py"
spec = importlib.util.spec_from_file_location("board", TARGET)
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)

PLAN = "mcp__ccd_turn__update_plan"


def ev(tool, inp, response=None, sid="s-1"):
    return {"session_id": sid, "cwd": "C:/repo", "tool_name": tool, "tool_input": inp, "tool_response": response}


def statuses(st):
    return [i["status"] for i in st["items"]]


class Feed(unittest.TestCase):
    def test_list_then_advance_done_start(self):
        st = board.apply_feed(None, ev(PLAN, {"items": [{"content": "a", "status": "in_progress"}, {"content": "b", "status": "pending"}, {"content": "c", "status": "pending"}], "scope": "first_task"}))
        self.assertEqual(statuses(st), ["in_progress", "pending", "pending"])
        st = board.apply_feed(st, ev(PLAN, {"advance": True}, [{"type": "text", "text": "Plan updated: step 2 of 3 is in progress."}]))
        self.assertEqual(statuses(st), ["completed", "in_progress", "pending"])
        self.assertEqual(st["step"], [2, 3])
        st = board.apply_feed(st, ev(PLAN, {"done": [2], "start": 3}))
        self.assertEqual(statuses(st), ["completed", "completed", "in_progress"])

    def test_advance_before_any_list_keeps_the_reported_step(self):
        st = board.apply_feed(None, ev(PLAN, {"advance": True}, [{"type": "text", "text": "Plan updated: step 3 of 7 is in progress."}]))
        self.assertEqual(st["items"], [])
        self.assertEqual(st["step"], [3, 7])

    def test_wrap_up_completes_and_a_new_list_reopens(self):
        st = board.apply_feed(None, ev(PLAN, {"items": [{"content": "a", "status": "in_progress"}]}))
        st = board.apply_feed(st, ev("mcp__ccd_turn__wrap_up", {"recap": "Done.", "ask": "Ship it?"}))
        self.assertTrue(st["wrapped"])
        self.assertEqual(statuses(st), ["completed"])
        self.assertEqual(st["ask"], "Ship it?")
        st = board.apply_feed(st, ev(PLAN, {"items": [{"content": "z", "status": "in_progress"}]}))
        self.assertNotIn("wrapped", st)

    def test_cli_task_tools(self):
        st = board.apply_feed(None, ev("TodoWrite", {"todos": [{"content": "x", "status": "pending", "activeForm": "X"}]}))
        self.assertEqual(statuses(st), ["pending"])
        st = board.apply_feed(st, ev("TaskCreate", {"subject": "y"}, "Task #4 created"))
        self.assertEqual(st["items"][-1], {"content": "y", "status": "pending", "id": "4"})
        st = board.apply_feed(st, ev("TaskUpdate", {"taskId": "4", "status": "completed"}))
        self.assertEqual(st["items"][-1]["status"], "completed")

    def test_feed_ignores_foreign_and_broken_payloads(self):
        with tempfile.TemporaryDirectory() as d:
            p = {"sessions": Path(d) / "sessions"}
            calls = []
            saved = board.ensure
            board.ensure = lambda p: calls.append(1)
            try:
                board.feed(p, "not json")
                board.feed(p, json.dumps(ev("Bash", {"command": "ls"})))
                self.assertFalse(p["sessions"].exists())
                board.feed(p, json.dumps(ev(PLAN, {"items": [{"content": "a", "status": "in_progress"}]}, sid="../x y")))
                files = list(p["sessions"].glob("*.json"))
                self.assertEqual([f.name for f in files], ["xy.json"])
                self.assertEqual(calls, [1])
            finally:
                board.ensure = saved


LEDGER = """id,opened,source,repo,title,status,fixed_in,dup_of,claim,notes
T-0001,2026-11-20,paste,extras,SECRET TITLE ONE,new,,,,"[2026-11-20] SECRET NOTE, with a comma"
T-0002,{today},walk,extras,SECRET TITLE TWO,fixed-unreleased,,,,"[{today} batch] fixed abc1234"
T-0003,2026-11-25,paste,extras,SECRET TITLE THREE,claimed,,,2026-11-25 old-batch,"[2026-11-25] claimed"
T-0004,{today},paste,extras,SECRET TITLE FOUR,claimed,,,{today} new-batch,"[{today}] claimed"
"""


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, stdin=subprocess.DEVNULL)


class Build(unittest.TestCase):
    def test_ledger_reaches_the_page_as_ids_only(self):
        today = time.strftime("%Y-%m-%d")
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "repo"
            root.mkdir()
            git(root, "init", "-q", "-b", "main")
            git(root, "config", "user.email", "t@example.invalid")
            git(root, "config", "user.name", "t")
            (root / "module.json").write_text(json.dumps({"version": "1.0.0"}))
            git(root, "add", "module.json")
            git(root, "commit", "-q", "-m", "first")
            ledger = Path(d) / "ledger.csv"
            ledger.write_text(LEDGER.format(today=today), encoding="utf-8")
            os.environ["ACKS_BUG_LEDGER"] = str(ledger)
            try:
                p = board.locate(root)
                b = board.build(p, time.time(), None)
                page = board.render(b)
            finally:
                del os.environ["ACKS_BUG_LEDGER"]
            self.assertNotIn("SECRET", page)
            self.assertIn("T-0001", page)
            titles = [i["title"] for i in b["working"]]
            self.assertIn(f"Ledger rows claimed: {today} new-batch", titles)
            self.assertNotIn("Ledger rows claimed: 2026-11-25 old-batch", titles)
            self.assertIn("Claim from an earlier day: 2026-11-25 old-batch", [i["title"] for i in b["deck"]])
            self.assertIn(["?", "commits on main, not pushed"], b["strip"])
            self.assertIn("Release window open: v1.0.0 has no tag", [i["title"] for i in b["deck"]])

    def test_render_escapes_a_closing_script_tag(self):
        page = board.render({"repo": "r", "asof": "x", "strip": [], "working": [{"title": "</script><b>"}], "done": [], "deck": [], "walks": []})
        self.assertNotIn("</script><b>", page)


class Walks(unittest.TestCase):
    def test_today_only_newest_first(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "walk-results.json"
            now = time.time()
            iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
            f.write_text(json.dumps({"schema": 1, "walks": {
                "old": {"state": "passed", "tally": {"pass": 1, "fail": 0}, "startedAt": iso(now - 90000), "endedAt": iso(now - 89000)},
                "a": {"state": "failed", "tally": {"pass": 3, "fail": 1}, "startedAt": iso(now - 600), "endedAt": iso(now - 500), "partial": "restricted"},
                "b": {"state": "passed", "tally": {"pass": 5, "fail": 0}, "startedAt": iso(now - 300), "endedAt": iso(now - 200)},
            }}))
            rows = board.read_walks(f, now - 3600)
            self.assertEqual([r["walk"] for r in rows], ["b", "a"])
            self.assertEqual(rows[1]["secs"], 100)


class Daemon(unittest.TestCase):
    def test_lock_is_single_and_a_dead_holder_is_taken_over(self):
        with tempfile.TemporaryDirectory() as d:
            p = {"state": Path(d), "lock": Path(d) / "daemon.lock"}
            p["lock"].write_text(str(os.getpid()))
            self.assertFalse(board.take_lock(p))
            p["lock"].write_text("999999")
            self.assertTrue(board.take_lock(p))
            self.assertEqual(p["lock"].read_text(), str(os.getpid()))

    def test_pid_alive(self):
        self.assertTrue(board.pid_alive(os.getpid()))
        self.assertFalse(board.pid_alive(999999))
        self.assertFalse(board.pid_alive(0))


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=1)
