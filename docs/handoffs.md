# Agent Handoffs

The execution plan asks every handoff to state what works, what verification ran, what remains limited, and what blocks progress. This file records the state at POC delivery.

## Orchestrator handoff — complete POC

**Behavior that works**

- Profile-driven lexing, parsing, checked typed AST, and a BigInt reference interpreter.
- Checked `i32` arithmetic with `E_OVERFLOW` after every operation, left-to-right evaluation, short-circuit Boolean operators, and explicit minimum-literal rules.
- Function calls, immutable typed locals, `if`/`else`, returns, missing-return analysis, duplicate-name rejection, and acyclic call-graph enforcement.
- Four source generators that produce ordinary C#, Rust, Go, and Java projects.
- Export to personal keyword notation, reimport with canonical/profile fingerprint checks, comment preservation, and manifest refresh after apply.
- CLI: `check`, `build` (with `--run`), `syntax export`, `syntax import`, `test`, `doctor`, `demo`.

**Verification that actually ran**

- `npm run build` (TypeScript 7.0.2).
- 19/19 unit tests.
- 29 positive conformance cases × 4 profiles × 4 targets = 464 target executions, all passed with 0 blocked.
- 27 negative cases, all produced the expected diagnostic.
- `hs demo` produced `33` through the reference interpreter and all four compiled targets.
- Two independent code reviews with differential fuzzing; 16 confirmed defects were fixed and the suite re-run.

**Limitations remaining**

See `docs/limitations.md`. The main ones are the small core, keyword-only profiles, single-file programs, no editor integration, no automatic merging, and no performance evidence.

**Blockers**

None for the documented POC. Cross-platform execution and a repeatable fuzz generator are next work, not blockers to acceptance.

## Review handoff A — frontend, semantics, transfer

**Findings fixed**

- stale manifest after reimport;
- out-of-range interpreter arguments;
- malformed manifest crashes;
- export self-overwrite;
- mixed-precedence comparison chains;
- leading-zero minimum literal;
- BOM handling;
- cascading unknown-name diagnostics after rejected declarations;
- parenthesized diagnostic spans;
- personal-file/manifest cross-check;
- profile core-version message.

**Verified correct without change**

- precedence and associativity across all levels;
- special minimum literal in all positions;
- overflow boundaries and per-operation checks;
- short-circuit and argument evaluation order;
- scope, redeclaration, use-before-declaration;
- missing-return analysis;
- direct, indirect, and diamond call graphs;
- profile validation and token-aware conversion;
- manifest fingerprints and conflict detection.

## Review handoff B — backends, harness, conformance

**Findings fixed**

- Java unreachable code after returns;
- conformance false PASS with zero target rows;
- interpreter-only runs labelled honestly;
- error `node` required and compared with reference/pinned expectations;
- process exit status validated against outcome status;
- .NET and Go version gates produce blocked, not failed;
- report summary counts and report path;
- explicit note that profile rows reuse one artifact.

**Verified correct without change**

- differential execution of 28 additional programs across all four targets, including nested short-circuit, calls in conditions, failing call arguments, Booleans, minimum literals, unused locals/params, zero-argument functions, and mixed argument order;
- overflow node equality between reference and targets;
- generated target names avoid host reserved words;
- build/run commands and paths for all four targets;
- blocked-toolchain handling and `hs doctor` exit status;
- corpus expectations match the specification.

## Suggested next assignment

Add a committed, seeded property-based generator that produces well-typed programs, compares the reference and all four targets, and reduces failures to minimal cases. It should treat the current conformance corpus as the regression baseline.
