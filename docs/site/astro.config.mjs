// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const REPO = "https://github.com/NocTempre/foundryvtt-acks-extras";

// Project page, not a user page: everything is served under the repo name, so
// `base` must be set or every internal link 404s once deployed. Astro prefixes
// `base` onto its own generated links; hand-written absolute hrefs in markdown
// do not get it, so those go through the `link` helper or stay relative.
export default defineConfig({
  site: "https://noctempre.github.io",
  base: "/foundryvtt-acks-extras",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "ACKS II — Extras",
      description:
        "Tutorials and a feature gallery for ACKS II — Extras, a Foundry VTT module automating the Adventurer Conqueror King System II: proficiencies, equipment, formations, henchmen, influence, locations and the Monstrous Manual stat block.",
      logo: {
        src: "./src/assets/mark.svg",
        alt: "ACKS II — Extras",
        replacesTitle: false,
      },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: REPO }],
      // Resolves against this Astro project, which is where the hand-authored
      // pages live. Every STAGED page overrides `editUrl` in its own
      // frontmatter to point at the real source instead — the staged copy is
      // generated and gitignored, so editing it would be undone by the next sync.
      editLink: { baseUrl: `${REPO}/edit/main/docs/site/` },
      lastUpdated: true,
      customCss: [
        // Order matters and mirrors the design system's own entry point: fonts,
        // then tokens, then the bridge that maps them onto Starlight's --sl-*.
        // Both vendored files are staged by tools/sync.mjs from
        // vendor/acks-design/ — never hand-edited here.
        "./src/styles/vendor/fonts/fonts.css",
        "./src/styles/vendor/tokens.css",
        "./src/styles/starlight-acks.css",
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "What this is", slug: "start/what-this-is" },
            { label: "Install", slug: "start/install" },
            { label: "Getting started", slug: "start/getting-started" },
            { label: "Where to buy ACKS II", slug: "start/buying" },
            { label: "Report a bug", slug: "start/report-a-bug" },
          ],
        },
        {
          label: "Feature gallery",
          link: "/gallery/",
        },
        {
          // Explicit order, not `autogenerate`: these are staged copies of
          // docs/guides/*.md and the reading order is the README's feature
          // order, which alphabetical would scramble.
          label: "Guides",
          items: [
            { label: "Proficiencies & class powers", slug: "guides/abilities" },
            { label: "Equipment & fighting styles", slug: "guides/equipment" },
            { label: "Exploration formations", slug: "guides/formation" },
            { label: "Henchmen & hirelings", slug: "guides/henchmen" },
            { label: "Influence & reactions", slug: "guides/influence" },
            { label: "Places, storage & markets", slug: "guides/location" },
            { label: "The Monstrous Manual stat block", slug: "guides/monsters" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Settings", slug: "reference/settings" },
            { label: "Compendia", slug: "reference/compendia" },
          ],
        },
      ],
    }),
  ],
});
