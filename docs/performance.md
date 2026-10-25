# Performance and Real-Time Analysis

h# is designed so an edit can be checked and translated within an editor frame, not by launching a CLI process per keystroke.

## Architecture

```text
VS Code extension host
  bundled HSharpAnalyzer
    parse -> check -> choose entry -> emit targets
    -> diagnostics + generated files + timings

External editors / automation (optional)
  hs bridge  (Node, line-delimited JSON)
    -> the same HSharpAnalyzer
```

The VS Code extension imports the compiler directly, so each edit is handled in the extension host without a subprocess or IPC. `hs bridge` remains available for other editors and automation; it keeps one Node process alive and caches the active profile.

The editor sends the full current document. Parsing is context-free and single-pass, so a full reparse currently costs less than an incremental index for normal files. There is no background compiler state that can become stale.

## Measured results

Environment: Node 24.21.0, Windows x64, h# 0.1.0. Reproduce with `npm run bench`; the raw report is [`reports/benchmark.json`](../reports/benchmark.json).

| Measurement | Observed | Budget |
|---|---:|---:|
| Analyze 212-character document | 0.086 ms | 2 ms |
| Analyze 300 functions (34,693 chars) | 17.321 ms | 150 ms |
| Generate all six targets, small document | 0.122 ms | 8 ms |
| Generate all six targets, 300 functions | 31.007 ms | 150 ms |
| Analyze + generate all six targets | 0.130 ms | 25 ms |
| Persistent bridge: analyze + C# over stdio | 0.808 ms | 30 ms |

The typical edit path (`analyze + generate all six targets`) is well below a 16.7 ms 60 fps frame. The bridge round-trip, including JSON serialization and IPC, is a few milliseconds at most after warm-up. Values vary with CPU load; the committed report records one exact run.

A 35 KB / 300-function file takes roughly 17 ms to analyze and 31 ms to generate all six targets. That is still interactive and remains well below the enforced budgets.

## Budgets

`src/testing/benchmark.ts` enforces budgets and exits non-zero if one is exceeded:

- small analysis: 2 ms;
- 500-function analysis: 150 ms;
- six-target generation on a small file: 8 ms;
- six-target generation on 300 functions: 150 ms;
- analyze + six-target generation: 25 ms;
- bridge round-trip: 30 ms.

Budgets are intentionally much looser than current measurements to avoid false failures on slower CI machines while still catching algorithmic regressions.

## Why it is fast

1. **Single pass lexer and recursive-descent parser.** No parser toolkit, no regex per character in identifier/number scanning, and trivia is retained without rescanning.
2. **Typed AST only.** There is no separate optimization IR or tree-to-tree lowering for the POC.
3. **String-based code generation.** Backends emit directly from typed nodes; no external formatter or process is involved.
4. **No process per edit.** VS Code runs the analyzer in the extension host; the optional bridge removes Node startup for external editors.
5. **Profile cache.** Profile validation/parsing is skipped until the profile file changes.
6. **Six targets in one request.** Generation is cheap enough that the preview fetches all six and switches targets without another round-trip.
7. **Debounce.** Editor integrations wait for a configurable idle period, so bursts of typing produce one analysis.

## Warm vs. cold

In VS Code, module loading happens once when the extension activates; subsequent analyses use the measured path. The first bridge request for external editors includes process start and CLI module loading (roughly 50–100 ms); the benchmark warms the bridge before measuring.

## Large files

The 500-function benchmark is a synthetic file with one function per 100 bytes. Analysis and generation are linear in source size. Files substantially larger than this will exceed a frame budget, but VS Code stays responsive because analysis runs in the extension-host process, not the renderer/UI process. Further work:

- Incremental reparse keyed by edit ranges.
- A cached typed AST for unchanged functions.
- Streaming emission of only the visible target.
- Background cancellation when an edit supersedes a request.

## What is not measured

- VS Code rendering time for semantic tokens, diagnostics, and the preview webview.
- End-to-end latency on a machine without a warm file system cache.
- Memory consumption for very large documents.
- Generated project compilation time (this is target toolchain work, not editor latency).

## Running the benchmark

```powershell
npm run bench
# JSON only:
node dist/testing/benchmark.js --json
```

The benchmark writes `reports/benchmark.json`. CI should treat a failed budget as a regression.

The real-time integration is described in [`editors/vscode/README.md`](../editors/vscode/README.md).
