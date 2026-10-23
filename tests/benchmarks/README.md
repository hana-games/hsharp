# Benchmark corpus

These programs are intentionally separate from `tests/conformance/cases.json`.

They measure analyzer and generator scale only. They are not correctness cases, are not executed by
the conformance runner, and are not part of the advertised portable feature evidence.

| File | Shape | Used for |
|---|---|---|
| `small.hs` | one function, one local, one condition | warm analysis, preview, bridge |
| `medium.hs` | 40 generated functions | medium analyzer scale |
| `large.hs` | 300 generated functions | large analyzer and generator scale |

Run `npm run bench` from the repository root. The report is written to
`reports/benchmark.json`.
