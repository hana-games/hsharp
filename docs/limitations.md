# POC Limitations and Next Work

The POC intentionally covers a small language core. The following limits are known and are not leaks in the current guarantees.

## Language core

- Only `i32` and `bool`; no strings, collections, records, variants, `Option`, or `Result`.
- No loops, recursion, mutation, modules, generics, exceptions, I/O, or concurrency.
- No division or modulo.
- No floating-point values.
- No string literals or block comments.
- No user-defined operators or macros.
- Functions are not first-class values.

## Syntax profiles

- Only the seven keyword roles are customizable. Type names, operators, braces, parentheses, semicolons, and precedence are fixed.
- Only the `braces` family exists. Explicit block markers and indentation families are future work.
- A keyword-only profile cannot change call syntax or introduce declarative constructs.
- Conversion is not continuous editing: there is no editor integration, live preview, cursor mapping, or incomplete-draft handling.
- Reimport detects stale bases and changed profiles but does not merge concurrent edits.

## Compiler

- Single-file programs only.
- First-error reporting for syntax; semantic diagnostics can be multiple.
- No incremental compilation, caching, optimization, or constant folding.
- The AST is not printed or exposed as a stable library API.
- Target names are deterministic but not human-readable.
- Runtime failure `node` IDs are compiler-internal and change if the source structure changes.
- Error recovery is minimal; one syntax error stops parsing.

## Targets

- Generated code is portable over the documented core only. Target-specific libraries are not accessible.
- Generated projects are standalone executables, not reusable libraries or packages.
- C# requires .NET SDK 10 or later because the project targets `net10.0`.
- Go requires 1.22 or later because of the generated `go.mod`.
- Rust builds with `--offline` and no external crates.
- Generated programs accept entry arguments from the command line; there is no richer FFI or host embedding.
- No performance claims are made. The checked-operation and result-record strategy prioritizes portability and explicit failure behavior.

## Verification

- The committed corpus is small (29 positive cases, 27 negative program/profile cases, 19 unit tests). It covers the specified rules and boundaries but is not a proof of correctness.
- Fuzzing was performed during review but is not part of the committed test command. A reproducible generator with recorded seeds is a next step.
- Target artifacts are compiled once per program/entry and executed per profile; independent compilation per profile is unnecessary because generated code is profile-independent.
- Semantics of concurrency, shared memory, ecosystem interoperability, and large applications are completely out of scope.

## Prioritized next work

1. **Reproducible property testing.** Generate well-typed programs with recorded seeds, compare the reference interpreter and all targets, reduce failures to minimal cases.
2. **Data and memory semantics.** Immutable records, strings, lists, variants, `Option`, and `Result`, with ownership/copying rules specified before implementation. Evaluate Rust ownership early.
3. **Loops and controlled recursion.** Add specified termination/overflow behavior and update call-graph checks.
4. **Syntax families and a printer.** Explicit-block and indentation families require a concrete syntax tree that preserves comments reliably.
5. **Editor integration.** LSP diagnostics, navigation, completion, and renaming; handle invalid drafts and cursor positions.
6. **Host embedding.** Libraries/packages for .NET, Rust, Go, and Java with a controlled exported signature set.
7. **Reusable modules and imports.** Multi-file programs and explicit module boundaries.
8. **Concurrency/async.** Define start, cancellation, ordering, sharing, and lifetimes before generating any target code.
9. **Performance measurement.** Measure compilation time, output size, allocations, and runtime on representative workloads before optimizing.
10. **Checked-primitive optimization.** Replace widening helpers with platform checked operations where behavior can be proven identical.
