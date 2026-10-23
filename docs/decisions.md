# Design Decisions

## D1. Hand-written lexer and parser instead of Chevrotain

The execution plan proposed Chevrotain. The implementation uses a small hand-written lexer and recursive-descent parser instead.

Reasons:

- Keywords are profile data and change the token classification on every invocation. A table-driven lexer keeps this direct and deterministic.
- Syntax conversion must preserve **all** whitespace and comments exactly. Keeping trivia in one token stream and re-printing it is simpler and easier to verify than reconstructing text from a parser toolkit's hidden-channel tokens.
- The grammar is small, fixed, and fully specified. A recursive-descent parser gives explicit control over chained-comparison rejection, the special minimum literal, and source spans.
- Zero runtime dependencies reduces setup risk and makes the toolchain story reproducible.
- Profile-driven keyword classification is tested by four profiles and 29 programs; parser behavior is unit-tested and conformance-tested.

This is a deliberate deviation from a proposed implementation choice, not from the required behavior. If the language grows syntax families and incremental editing, a parser toolkit becomes more attractive; the current frontend is isolated behind `parse(text, profile)`.

## D2. Typed AST as the common representation

The POC uses a typed AST rather than a separate optimization IR. It carries resolved symbol IDs, target names, and types, which is everything the four backends need. This avoids maintaining two representations before there is an optimization to justify one.

## D3. Stable internal names for target code

Functions and locals receive `fN`/`vN` names from compiler-assigned IDs. Source identifiers never become target identifiers. This makes collisions with host reserved words impossible by construction, including names such as `class`, `int`, `string`, and `func`.

## D4. Boolean representation in generated code

All runtime values in generated functions are `i32` (or the target's `int`/`int32`). Booleans are normalized to `0`/`1` at creation. This gives every target one uniform internal result type and simplifies propagation. Source-level typing ensures arithmetic is never applied to Booleans.

## D5. Result records instead of exceptions

Every generated function returns `Res { ok, value, code, node }`. A failing checked operation returns immediately, and callers propagate the record. This matches the plan's shared failure protocol, avoids target-specific exception behavior, and lets Rust use a `Result`-style shape without user-facing `Result` syntax.

## D6. Widening arithmetic

Checked helpers widen to signed 64-bit, compute, then range-check. This is portable across all four targets and directly matches the specification. Platform checked primitives were considered but would require more normalization per backend. Multiplication of two `i32` values is guaranteed to fit in `i64`.

## D7. Token-aware keyword conversion, not text replacement

Conversion re-prints tokens. Only keyword-role tokens change spelling. Comments, identifiers, whitespace, types, and punctuation are copied byte-for-byte. Export re-parses the result and compares normalized ASTs; reimport converts back and checks the canonical program. This gives strong preservation guarantees for keyword-only profiles.

## D8. Canonical keywords remain reserved

Under every profile, all canonical keywords and type names are reserved tokens. This prevents the same text from being an identifier under one profile and a keyword under another, and makes profile switching predictable. It also makes reverse conversion unambiguous.

## D9. Manifest fingerprints and refresh

Export records SHA-256 fingerprints for the canonical file, profile file, and personal file. Reimport validates the canonical base and profile before applying anything. After a successful import, the manifest's canonical and personal fingerprints are refreshed so the collaboration cycle can continue. Automatic merging is intentionally absent.

The manifest's personal path is cross-checked against the file being imported, so a manifest cannot silently apply one personal file's content to another base.

## D10. Unreachable statements are omitted from generated code

The checker still checks all statements, including unreachable ones (consistent with "all branches are checked statically"). Code generation stops after a statement that definitely returns. Java rejects unreachable statements at compile time; omitting them makes all four targets accept the same valid programs without changing behavior.

## D11. C# and Go version gates

Generated C# projects target `net10.0`; generated Go projects declare `go 1.22`. Toolchain detection checks these minimums and reports an older/missing toolchain as **blocked**, not as a generated-code failure. This keeps infrastructure failures separate from program failures.

## D12. One compiled artifact per program, multiple profile executions

Generated code depends on the typed AST, not on source spelling. The conformance runner compiles one artifact per program/entry/target and executes it once per profile, recording separate rows. Structural equivalence and round-trip preservation are verified per profile. The report states this explicitly rather than implying four independent compilations.

## D13. Import applies edits immediately unless `--dry-run`

The plan requires export, edit, and reimport, and requires conflict detection. The CLI prints a line diff. `--dry-run` shows the diff without writing. There is no interactive prompt; scripting and CI need deterministic behavior.

## D14. Name and command aliases

The language is **h#**. Because `#` begins a comment in many shells and is awkward in package and URL contexts, the CLI is installed as `hs` with equivalent aliases `hsharp` and `hcharp`. Source files use `.hs`. The repository and npm package are named `hsharp`. No user-facing command or generated artifact uses the old provisional name.

## D15. UTF-8 BOM handling

A leading BOM is ignored when reading source and profile files. It is an editor artifact on Windows and must not turn into a syntax error or a different fingerprint.

## D16. Data values require a tagged result payload

The 0.1/0.2 runtime deliberately stores every generated value as `i32`, with booleans normalized to
`0`/`1`. That is sufficient for the scalar core but not for strings, lists, records, variants,
`Option`, or `Result`.

Phase 0.3 therefore changes the generated result record to carry a typed payload instead of only an
integer. The reference interpreter uses a tagged value union; each backend uses a private tagged
representation or monomorphized result type. The source language still exposes one typed contract.
Target representations remain private to generated projects, and no target exception, null, or
mutable alias may become observable.

This is a value-model change, not a keyword-profile change. The specification in
[`spec/data.md`](../spec/data.md) is normative and must precede backend work.
