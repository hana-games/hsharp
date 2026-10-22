# h# for Visual Studio Code

Language support for **h#** (`.hs`) files:

- profile-aware syntax highlighting;
- live compiler diagnostics with source locations;
- **real-time generated-code preview** for C#, Rust, Go, and Java;
- target switching without recompiling;
- status-bar timing and error count.

The extension **bundles the h# compiler into the extension host**. No `hs` process, Node startup, or external command is needed at runtime.

## Install

Build the bundled extension and install it from the repository root:

```powershell
npm install
npm run vscode:install
```

The installer packages the extension, installs `build/vscode/hsharp-vscode.vsix`, and suppresses an upstream VS Code 1.143 CLI deprecation warning (`url.parse()` in `cliProcessMain.js`). The h# bundle does not use `url.parse`.

You can also install manually:

```powershell
npm run vscode:package
code --install-extension build/vscode/hsharp-vscode.vsix --force
```

Restart VS Code, then open any `.hs` file.

For development, build once and press **F5** in VS Code:

```powershell
npm run vscode:build
```

Then open `editors/vscode` and run the **h# Extension** launch configuration.

## Use

1. Open a `.hs` file.
2. Edit normally; diagnostics refresh after the debounce.
3. Run **h#: Show Generated Code** from the command palette, or use the editor-title button.
4. The preview opens beside the editor and updates as you type.
5. Switch **Target** between C#, Rust, Go, and Java.

The status line shows the entry function, function count, total analysis + four-target generation time, and diagnostic count.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `hsharp.profilePath` | empty | Profile JSON for diagnostics, highlighting, and preview. Relative paths resolve against the first workspace folder. Empty means standard syntax. |
| `hsharp.entry` | empty | Entry function for preview. Empty infers `main` or a single function. |
| `hsharp.debounceMs` | `120` | Idle delay after the last edit. Range 30–2000 ms. |
| `hsharp.diagnostics` | `true` | Show compiler diagnostics. |
| `hsharp.previewTarget` | `csharp` | Target shown when the preview opens. |

Changing a setting reanalyzes open h# documents immediately.

## What is included

| Path | Purpose |
|---|---|
| `src/extension.ts` | Activation and registration |
| `src/analysis.ts` | Single analysis pipeline for diagnostics, status, and four targets |
| `src/profile.ts` | Cached profile loading and workspace-relative resolution |
| `src/semanticTokens.ts` | Profile-aware keyword/type semantic tokens |
| `src/preview.ts` | Generated-code webview panel |
| `syntaxes/hsharp.tmLanguage.json` | Comments, numbers, operators, fallback keyword colors |
| `snippets/hsharp.json` | Function, local, and conditional snippets |
| `build.mjs` | esbuild bundle |
| `package-vsix.mjs` | VSIX packaging |

## How analysis works

The extension imports the same TypeScript compiler used by the CLI. `HSharpAnalyzer` runs in the extension host and performs:

```text
parse -> check -> choose entry -> emit C#, Rust, Go, Java
```

One edit produces diagnostics, status-bar data, and all four generated targets. The measured warm path is sub-millisecond for normal files; see `docs/performance.md` in the repository.

Profile keywords are highlighted by a document semantic-tokens provider. The TextMate grammar provides fallback coloring for comments, numbers, operators, and canonical keywords, so highlighting is useful even before semantic tokens are applied.

## Commands

| Command | Purpose |
|---|---|
| `hsharp.showPreview` | Open or reveal the generated-code panel |

## Limitations

- `.hs` is also used by Haskell. If another extension claims the extension, VS Code may associate the file differently; use **Change Language Mode** and select **h#**.
- The extension is a workspace extension and requires a Node-based extension host (desktop VS Code). It is not a web extension.
- No completion, go-to-definition, rename, code actions, or debugging yet.
- The preview is read-only and concatenates generated files with path headers.
- No in-editor build/run command; use `hs build` in a terminal.
- Analysis reparses the whole document on each edit. This is fast for normal files but not yet incremental.
- The extension was packaged and typechecked on this machine, but interactive UI behavior still needs verification in a running VS Code window.

## Troubleshooting

| Symptom | Check |
|---|---|
| No diagnostics | Confirm the file language is **h#**; check `hsharp.diagnostics` |
| No keyword colors | Ensure the semantic-tokens provider is active; check `hsharp.profilePath` |
| Preview is empty | Resolve diagnostics and ensure an entry function exists (`main` or a single function) |
| Wrong keywords highlighted | Verify the profile file and that it is valid JSON |
| Extension does not load | Run `npm run vscode:build` and reinstall the VSIX |
