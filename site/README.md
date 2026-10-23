# h# website

The showcase site for h#. Static Astro output with React islands for interactive demos.

## Languages

The site is fully rendered in three locales:

| Locale | Routes |
|---|---|
| English | `/`, `/docs/...`, `/examples`, `/playground`, `/vscode`, `/roadmap`, `/why` |
| French | `/fr/`, `/fr/docs/...`, `/fr/examples`, ... |
| Japanese | `/ja/`, `/ja/docs/...`, `/ja/examples`, ... |

Translations are split by page and concern:

```text
site/src/i18n/en/common.json
site/src/i18n/en/home.json
site/src/i18n/en/why.json
site/src/i18n/en/examples.json
site/src/i18n/en/playground.json
site/src/i18n/en/vscode.json
site/src/i18n/en/roadmap.json
site/src/i18n/en/docs-intro.json
site/src/i18n/en/docs-language.json
site/src/i18n/en/docs-profiles.json
site/src/i18n/en/docs-cli.json
site/src/i18n/en/docs-targets.json
site/src/i18n/en/docs-verification.json
site/src/i18n/en/docs-extra.json
site/src/i18n/en/seo.json
site/src/i18n/en/not-found.json
...
```

The same namespace set exists for `fr/` and `ja/`. `i18n-loader.mjs` merges them for the build; `prepare-i18n.mjs` emits the runtime dictionaries into `public/i18n/`. The build:

1. renders the English static pages with Astro;
2. copies the runtime dictionaries to `public/i18n/`;
3. generates `/fr/` and `/ja/` pages with translated text, attributes, and internal links;
4. injects a client-side observer that keeps React islands translated after hydration.

The language switcher in the header preserves the current page and opens the corresponding localized route.

## Search and AI discovery

- `public/llms.txt`, `public/fr/llms.txt`, and `public/ja/llms.txt` provide concise, citable project guidance for language models and answer engines.
- `scripts/generate-seo.mjs` writes `sitemap.xml` after localization, with all 42 localized URLs and `xhtml:link` alternates.
- `robots.txt` allows normal crawlers plus the main AI crawlers and points to the sitemap.
- `BaseLayout.astro` emits canonical, `hreflang`, Open Graph, Twitter, and JSON-LD metadata for every page.
- `localize-build.mjs` rewrites canonical URLs, `og:url`, locale metadata, and structured data for `/fr/` and `/ja/`.

## Direction

- **Canonical ↔ personal notation** is bidirectional: export and reimport share the normalized AST, with fingerprints protecting both ends.
- **h# → C#, Rust, Go, Java** is one-way by design: generated target source is output, not a second source of truth.
- **JavaScript** is a candidate fifth backend. Importing JavaScript back into h# is a separate, lossy frontend problem (parsing, type inference, library semantics), not a reverse code generator.

## Run

From the repository root:

```powershell
npm install
npm --prefix site install
npm run site:dev
```

`site:dev` regenerates `site/src/data/generated.json` from the real compiler and conformance report, then starts Astro at `http://localhost:4321`. Localized routes are produced by the production build; use `npm run site:preview` to review them.

Build the static site:

```powershell
npm run site:build
# output: site/dist/
```

`site:build` regenerates data, prepares dictionaries, builds Astro, and localizes the output.

Check internal links across all three locales:

```powershell
npm run site:check
```

Preview the production output:

```powershell
npm run site:preview
```

## What is generated

`site/scripts/generate-data.mjs` imports the compiled TypeScript compiler and reads the conformance report:

- the demonstration source under all four profiles;
- exact generated projects for C#, Rust, Go, and Java;
- normalized AST for the standard demo;
- all positive example programs and expected outcomes;
- the compact conformance matrix.

No h# code executes in the browser. Interactive modules use precomputed data and client-side transformations for illustration only.

## Pages

| Route | Purpose |
|---|---|
| `/` | Overview, interactive syntax and target demos, proof strip |
| `/why` | Universality thesis, scope boundary, what h# does not claim |
| `/examples` | Filterable real conformance programs with profile switching |
| `/playground` | Profile composer, target prism, boundary lab, export stepper, conformance explorer |
| `/docs` | Precise documentation: semantics, grammar, profiles, CLI, targets, verification |
| `/roadmap` | Dependency-driven phases and non-goals |
| `/404` | Static fallback |

## Design

- **Theme**: Prism Foundry — one core, four native outputs.
- **Typography**: Instrument Serif, Inter, JetBrains Mono.
- **Palette**: ink `#0A0C10`, paper `#F3EFE4`, signal lime `#D8FF3E`, plus target accents for C#, Rust, Go, and Java.
- **Motion**: subtle reveal and code-swap transitions, disabled under `prefers-reduced-motion`.
- **Responsive**: mobile navigation, scrollable code frames, single-column layouts under 700 px.

Target logos are sourced from Devicon and Simple Icons. The marks remain trademarks of their respective owners and are used only to identify the generated targets.

## Deploy

The output is fully static. Deploy `site/dist/` to GitHub Pages, Netlify, Cloudflare Pages, or any static host. Update `site` in `astro.config.mjs` if the production domain differs from `https://hsharp.dev`.

Interactive examples are client-side only and require no backend.
