# h# website

The showcase site for h#. Static Astro output with React islands for interactive demos.

## Languages

The site is fully rendered in three locales:

| Locale | Routes |
|---|---|
| English | `/`, `/docs/...`, `/examples`, `/playground`, `/roadmap`, `/why` |
| French | `/fr/`, `/fr/docs/...`, `/fr/examples`, ... |
| Japanese | `/ja/`, `/ja/docs/...`, `/ja/examples`, ... |

Translations live in `site/src/i18n/strings.{en,fr,ja}.json`. The build:

1. renders the English static pages with Astro;
2. copies the runtime dictionaries to `public/i18n/`;
3. generates `/fr/` and `/ja/` pages with translated text, attributes, and internal links;
4. injects a client-side observer that keeps React islands translated after hydration.

The language switcher in the header preserves the current page and opens the corresponding localized route.

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
