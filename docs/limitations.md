# POC Limitations and Next Work

The POC intentionally covers a small language core. The following limits are known and are not leaks in the current guarantees.

## Language core

- Scalars are `i32` and `bool`. The 0.3 slice adds immutable records; there are no strings,
  collections, variants, `Option`, or `Result`.
- Records are top-level and nominal. They support literals, nested non-recursive fields, field
  access, locals, internal function parameters, structural equality, and update-as-new-value.
- Recursive record types are rejected with `E_RECURSIVE_RECORD`.
- Functions cannot return records (`E_RECORD_RETURN_UNSUPPORTED`), and entry functions cannot take
  records because command-line arguments remain scalar (`E_RECORD_ENTRY_PARAMETER_UNSUPPORTED`).
- Generated record and field names are compiler-generated, so source names that collide with target
  keywords never appear in generated type declarations.
- No loops, recursion, mutation, modules, generics, exceptions, I/O, or concurrency.
- No division or modulo.
- No floating-point values.
- No string literals or block comments.
- No user-defined operators or macros.
- Functions are not first-class values.

## Syntax profiles

- Only the seven keyword roles are customizable. Type names, operators, braces, parentheses, semicolons, and precedence are fixed.
- The `.hs` extension is also used by Haskell, so editors may associate h# files with Haskell unless configured otherwise.
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
- Editor latency is measured and budgeted (`reports/benchmark.json`), but the compiler makes no broad performance claims. The checked-operation and result-record strategy prioritizes portability and explicit failure behavior.

## Editor integration

- The Visual Studio Code extension is packaged and installed, but interactive editor behavior (semantic colors, live preview webview, status bar) was not verified in a running VS Code window.
- The extension is a workspace extension for desktop VS Code; it is not a web extension.
- `.hs` is shared with Haskell; another extension may claim the file association.
- No completion, go-to-definition, code actions, debugging, or project-system integration yet.
- The preview is read-only and concatenates generated files with path headers.
- No in-IDE build/run command; use `hs build` in a terminal.
- Analysis reparses the whole document on each edit. This is fast for normal files but is not yet incremental.

## Verification

- The committed corpus is small (30 positive cases, 29 negative program/profile cases, 31 unit tests, one bridge protocol test). It covers the specified rules and boundaries but is not a proof of correctness.
- Seeded property tests, automatic line reduction, a separate benchmark corpus, and manual Ubuntu CI are part of the 0.2 command. Windows/macOS CI is explicitly deferred.
- Target artifacts are compiled once per program/entry and executed per profile; independent compilation per profile is unnecessary because generated code is profile-independent.
- Semantics of concurrency, shared memory, ecosystem interoperability, and large applications are completely out of scope.

## Prioritized next work

1. **Data and memory semantics.** The normative specification is in [`spec/data.md`](../spec/data.md). Immutable records with nested fields and update-as-new-value are implemented across the reference interpreter and all four targets. Next: record returns via a tagged payload, strings, lists, variants, `Option`, and `Result`. Evaluate Rust ownership early.
2. **Re-enable CI hardening.** Validate the manual Ubuntu workflow, then restore automatic runs and the deferred Windows/macOS matrix.
3. **Loops and controlled recursion.** Add specified termination/overflow behavior and update call-graph checks.
4. **Syntax families and a printer.** Explicit-block and indentation families require a concrete syntax tree that preserves comments reliably.
5. **Editor integration.** LSP diagnostics, navigation, completion, and renaming; handle invalid drafts and cursor positions.
6. **Host embedding.** Libraries/packages for .NET, Rust, Go, and Java with a controlled exported signature set.
7. **Reusable modules and imports.** Multi-file programs and explicit module boundaries.
8. **Concurrency/async.** Define start, cancellation, ordering, sharing, and lifetimes before generating any target code.
9. **Performance measurement.** Measure compilation time, output size, allocations, and runtime on representative workloads before optimizing.
10. **Checked-primitive optimization.** Replace widening helpers with platform checked operations where behavior can be proven identical.

See [`ROADMAP.md`](../ROADMAP.md) for phase dependencies, exit evidence, and cross-cutting workstreams.
