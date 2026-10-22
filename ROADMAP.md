# h# Roadmap

This roadmap describes how the h# proof of concept becomes a useful portable language without weakening its central promise: **one semantic core, personal notation, verified output for C#, Go, Rust, and Java.**

It is dependency-driven, not calendar-driven. A phase starts when its prerequisites are stable and ends when its exit evidence exists in the repository.

## Status

**0.1 POC — complete and verified.**

- Core: `i32`, `bool`, functions, calls, immutable locals, `if`/`else`, returns, checked arithmetic, short-circuit Boolean operators, acyclic call graphs.
- Profiles: keyword-only, declarative, validated, token-aware conversion with comment preservation.
- Workflow: export, edit, reimport, stale-base and changed-profile rejection, manifest refresh.
- Targets: C#, Go, Rust, Java — generated, compiled, and executed.
- Verification: 29 positive cases × 4 profiles × 4 targets (464 executions), 27 negative cases, 19 unit tests.
- CLI: `hs`, with aliases `hsharp` and `hcharp`; source files use `.hs`.

Known limits are listed in [`docs/limitations.md`](docs/limitations.md). The original design rationale is in [`hsharp-execution-plan.md`](hsharp-execution-plan.md).

### Landed ahead of 0.2

- Persistent `hs bridge` analyzer with profile caching and line-delimited JSON.
- Measured latency budgets (`npm run bench`, `reports/benchmark.json`): 0.05 ms warm analysis + four-target generation, 0.44 ms bridge round-trip.
- Initial Visual Studio Code extension: syntax highlighting, live diagnostics, generated-code preview.
- The full editor workflow still needs validation in a running VS Code window and remains part of phases 0.2 and 0.6.

## Guiding principles

1. **Specify before implementing.** Every language feature gets semantics, examples, expected outcomes, and failure rules before backend work begins.
2. **All advertised targets or none.** A feature is portable only when it passes on every advertised target. Target-specific extensions are explicit and excluded from portable mode.
3. **Verification is evidence.** Expected results are written independently of generated code. A missing toolchain is `blocked`, never a pass.
4. **Syntax is data.** Profiles cannot introduce hidden semantic differences. A cosmetic profile must preserve the normalized AST.
5. **Start immutable.** Data features add values and transformations before mutation, aliasing, or shared-memory semantics.
6. **Measure before optimizing.** Performance work begins with a benchmark and ends with a measured improvement at unchanged behavior.

## Roadmap overview

| Phase | Theme | Exit evidence |
|---|---|---|
| 0.2 | Verification hardening | Seeded property tests and cross-platform CI run in one command |
| 0.3 | Data and memory semantics | Records, strings, lists, `Option`, `Result` pass on all four targets |
| 0.4 | Control flow and abstraction | Loops, recursion, controlled mutation, generics pass on all targets |
| 0.5 | Modules and host embedding | Multi-file programs; libraries/packages callable from each ecosystem |
| 0.6 | Syntax families and editor support | A second syntax family and LSP diagnostics over a shared CST |
| 0.7 | Async and concurrency | Specified cancellation, ordering, sharing, and lifetimes |
| 1.0 | Stable core and measured performance | Versioned core, compatibility policy, reproducible benchmark results |

## Phase 0.2 — Verification hardening

**Goal:** make the 0.1 correctness claim reproducible on any supported machine, not just the current one.

Work:

- Commit a seeded, reproducible property-based program generator.
- Compare the reference interpreter and all four targets, including failure codes and node IDs.
- Implement automatic failure reduction to minimal programs.
- Add a benchmark corpus separate from correctness cases.
- Add CI for Windows, Linux, and macOS with all four toolchains.
- Verify from a clean checkout: install, build, test, report.
- Add a diagnostics golden test that checks line/column mapping in personal files.

Exit evidence:

- One command generates, checks, compiles, executes, and reports from a clean environment.
- Any divergence produces a minimal reproducer.
- CI publishes the conformance report as an artifact.
- Blocked toolchains still fail the job as "not verified" rather than passing.

Dependencies: none beyond 0.1.

## Phase 0.3 — Data and memory semantics

**Goal:** add the first useful data types without importing target-specific behavior.

Scope:

- Immutable records and tuple-like values.
- Strings with explicitly specified Unicode behavior (code points vs. UTF-16 units, indexing, length, comparison).
- Lists and indexing, including out-of-range failure semantics.
- Variants and pattern matching in a minimal form.
- `Option` and `Result` as language-level values.
- Equality, copying, and aliasing rules stated before implementation.
- Update-as-new-value semantics; backends may share storage only when unobservable.

Backend work:

- Rust ownership evaluation first: explicit transfers, borrows, or copies.
- C#/Java/Go representations chosen only after Rust proves the model.
- New runtime failure codes and propagation rules.
- Strings and collections in the conformance corpus.

Exit evidence:

- Identical nested-data operations on all four targets.
- Copying/allocation measurements for the initial model.
- Rust compilation demonstrates an explicit ownership strategy, not incidental cloning.

Dependencies: 0.2; a written data-semantics specification.

## Phase 0.4 — Control flow and abstraction

**Goal:** move beyond straight-line core programs while keeping termination and failure behavior explicit.

Scope:

- `while`/`for` with specified scoping and mutation.
- Controlled local mutation.
- Recursion with an explicit policy (allowed, bounded, or rejected) and stack behavior.
- Generics over the portable core.
- Early exit/break/continue if justified by real programs.
- Updated call-graph and return analysis.

Exit evidence:

- Each control-flow construct has expected examples and passes on all targets.
- Recursion behavior is identical across targets, including failure modes.
- Generic code expands or compiles without target-specific semantics.

Dependencies: 0.3; data representation stable enough to instantiate generics.

## Phase 0.5 — Modules and host embedding

**Goal:** make h# usable inside real projects, not only as standalone executables.

Scope:

- Multi-file programs with explicit imports and a canonical module layout.
- Visibility rules and versioned module interfaces.
- A candidate fifth target: JavaScript/TypeScript, with a Node project and normalized outcomes.
- Reverse import from target languages is **not** symmetric. A JavaScript-to-h# importer is a separate, lossy frontend problem requiring parsing, type inference, and library semantics.
- Generated libraries/packages for .NET, Rust, Go, and Java.
- A controlled exported signature set with normalized failures.
- Selected adapters (serialization, dates, files, networking) only when driven by a concrete use case.
- Capability declarations for adapters.

Exit evidence:

- A small application in each ecosystem calls the same generated business rule.
- Multi-file export/reimport preserves meaning across files.
- Host failures are distinguishable from program failures.

Dependencies: 0.3 and 0.4; a stable portable data model.

## Phase 0.6 — Syntax families and editor support

**Goal:** deliver the central product promise beyond keyword substitution.

An initial Visual Studio Code integration (highlighting, diagnostics, generated-code preview over the bundled compiler) exists. This phase extends it into a general editor platform:

Scope:

- A concrete syntax tree (CST) and printer that preserve comments and formatting.
- A second family: explicit block markers; then optionally indentation-based syntax.
- Versioned grammar/family compatibility rules.
- Language Server Protocol: diagnostics, navigation, completion, rename.
- Continuous personalized editing:
  - temporarily invalid drafts;
  - cursor and selection mapping;
  - search and rename;
  - conflict handling against canonical source.
- Profile migration when a user changes notation.

Exit evidence:

- Two developers use different notations for the same program and produce a clear canonical diff.
- Comments survive continuous editing, not only batch export.
- Editor diagnostics point into the user's notation.
- Invalid drafts do not corrupt canonical source.

Dependencies: 0.5 module layout; a printer/CST design reviewed before implementation.

## Phase 0.7 — Async and concurrency

**Goal:** support asynchronous work only after data, lifetimes, and failure propagation are stable.

Specify before generating code:

- when a task starts;
- cancellation propagation;
- error propagation and aggregation;
- observable ordering;
- data-sharing and mutation rules;
- resource and task lifetimes.

Exit evidence:

- A simple asynchronous operation obeys the same cancellation and failure rules on every supported environment.
- No target silently changes ordering or sharing semantics.

Dependencies: 0.3, 0.4, and 0.5. Do not start with four independent implementations.

## Phase 1.0 — Extensions, performance, stability

Scope:

- Macros or grammar modules with inspectable expansion, explicit name handling, and diagnostics mapped to source.
- Versioned grammar extensions with ambiguity checks.
- Performance measurement on representative workloads: compile time, output size, allocations, execution time.
- Checked-primitive optimization where behavior is provably unchanged.
- A compatibility policy for core, profile schema, and generated project formats.
- A stable CLI and machine-readable report schema.

Exit evidence:

- A measured improvement on a useful workload with unchanged specified behavior.
- Extension expansion is inspectable and versioned.
- Breaking changes follow an announced migration path.

Dependencies: all prior phases for the features they extend.

## Cross-cutting workstreams

### Verification

- Grow the corpus with every feature; never let it regress.
- Keep expectations independent of implementations.
- Add differential tests between targets, not only against the reference.
- Track blocked checks separately from failures.

### Toolchains

- Pin Node, TypeScript, .NET, Rust, Go, and Java versions used by CI.
- Probe version requirements instead of assuming a command exists.
- Keep generated projects dependency-free where possible.

### Documentation

- Every feature lands with a spec update, examples, and limitations entry.
- Release notes record verified behavior and known divergences.
- Public acceptance criteria stay executable.

### Performance

- Measure before optimizing; retain baseline results with versions and hardware.
- Optimize only after conformance passes.
- Prefer eliminating copies over target-specific tricks.

### Security and trust

- Profiles remain data; reject grammar or code injection.
- Generated code contains only compiler-selected constructs.
- Manifests and fingerprints protect the canonical/personal workflow.

## Immediate next actions

1. Implement the seeded property-test generator and reducer.
2. Add cross-platform CI with all four toolchains and report artifacts.
3. Write the data semantics specification (records, strings, lists, variants, `Option`, `Result`).
4. Build a small benchmark harness for compile time, output size, and runtime.
5. Prototype Rust ownership for immutable records and lists.
6. Draft the CST/printer design before adding syntax families.

## Non-goals for now

- Matching hand-optimized performance in every ecosystem.
- Access to all target-specific libraries through one portable API.
- Continuous collaborative editing before a CST/printer exists.
- Async or shared-memory concurrency before data and lifetime semantics.
- Macros before grammar versioning and diagnostic mapping.
- A large standard library before the data model is stable.

## Risks and responses

| Risk | Response |
|---|---|
| Semantic drift across targets | Independent expectations, differential tests, minimal reproducers |
| Rust ownership under nested data | Specify immutability first; prove the model in Rust before porting |
| Syntax families create ambiguous parses | Versioned families, explicit ambiguity rules, CST/printer tests |
| Editor drafts are temporarily invalid | Separate draft analysis from canonical verification |
| Toolchain and dependency drift | Pin versions; probe capabilities; blocked never passes |
| Scope creep in the portable core | Every feature needs a spec and four-target acceptance evidence |
| Performance work hides behavior changes | Benchmark at unchanged conformance; compare results by version |
| Personal notation hides semantic differences | Normalized-AST equality and round-trip preservation are mandatory |

## Definition of done for every phase

A phase is complete only when:

1. Its behavior is specified and documented.
2. Expected results exist independently of the implementation.
3. The reference interpreter and all advertised targets pass.
4. The CLI and generated artifacts are reproducible from a clean environment.
5. Limitations and migration notes are updated.
6. Verification evidence is committed, including what did **not** run.
