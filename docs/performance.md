# Performance and Real-Time Analysis

h# is designed so an edit can be checked and translated within an editor frame, not by launching a CLI process per keystroke.

## Architecture

```text
Visual Studio
  |  one persistent process
  v
hs bridge  (Node)
  |  line-delimited JSON
  v
HSharpAnalyzer (in-process)
  |  parse -> check -> choose entry -> emit targets
  v
diagnostics + generated files + timings
```

`hs bridge` starts once. It keeps the active profile cached (validated by file mtime and size) and handles each edit in the same Node process. Node startup is paid on the first request, not on every change.

The editor sends the full current document. Parsing is context-free and single-pass, so a full reparse currently costs less than an incremental index for normal files. There is no background compiler state that can become stale.

## Measured results

Environment: Node 24.21.0, Windows x64, h# 0.1.0. Reproduce with `npm run bench`; the raw report is [`reports/benchmark.json`](../reports/benchmark.json).

| Measurement | Observed | Budget |
|---|---:|---:|
| Analyze 246-character document | 0.03–0.09 ms | 2 ms |
| Analyze 500 functions (57,819 chars) | 15–34 ms | 150 ms |
| Generate all four targets, small document | 0.04–0.27 ms | 8 ms |
| Generate all four targets, 500 functions | 22–68 ms | 150 ms |
| Analyze + generate all four targets | 0.05–0.27 ms | 25 ms |
| Persistent bridge: analyze + C# over stdio | 0.4–3.0 ms | 30 ms |

The typical edit path (`analyze + generate all four targets`) is well below a 16.7 ms 60 fps frame. The bridge round-trip, including JSON serialization and IPC, is a few milliseconds at most after warm-up. Values vary with CPU load; the committed report records one exact run.

A 57 KB / 500-function file takes roughly 15–35 ms to analyze and 22–70 ms to generate all four targets. That is still interactive and remains well below the enforced budgets.

## Budgets

`src/testing/benchmark.ts` enforces budgets and exits non-zero if one is exceeded:

- small analysis: 2 ms;
- 500-function analysis: 150 ms;
- four-target generation on a small file: 8 ms;
- four-target generation on 500 functions: 150 ms;
- analyze + four-target generation: 25 ms;
- bridge round-trip: 30 ms.

Budgets are intentionally much looser than current measurements to avoid false failures on slower CI machines while still catching algorithmic regressions.

## Why it is fast

1. **Single pass lexer and recursive-descent parser.** No parser toolkit, no regex per character in identifier/number scanning, and trivia is retained without rescanning.
2. **Typed AST only.** There is no separate optimization IR or tree-to-tree lowering for the POC.
3. **String-based code generation.** Backends emit directly from typed nodes; no external formatter or process is involved.
4. **Persistent process.** The editor bridge removes 50–100 ms Node startup from every edit.
5. **Profile cache.** Profile validation/parsing is skipped until the profile file changes.
6. **Four targets in one request.** Generation is cheap enough that the preview fetches all four and switches targets without another round-trip.
7. **Debounce.** Editor taggers wait for a configurable idle period, so bursts of typing produce one request.

## Warm vs. cold

The first bridge request includes process start and CLI module loading. On the development machine that is roughly 50–100 ms. Subsequent requests use the measured sub-millisecond path. The benchmark sends a `ping` before measuring so it reports warm latency.

## Large files

The 500-function benchmark is a synthetic file with one function per 100 bytes. Analysis and generation are linear in source size. Files substantially larger than this will exceed a frame budget, but the editor remains responsive because analysis runs in the bridge process, not on the Visual Studio UI thread. Further work:

- Incremental reparse keyed by edit ranges.
- A cached typed AST for unchanged functions.
- Streaming emission of only the visible target.
- Background cancellation when an edit supersedes a request.

## What is not measured

- Visual Studio UI rendering time for classification and tag updates.
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

The real-time integration is described in [`editors/visual-studio/README.md`](../editors/visual-studio/README.md).
