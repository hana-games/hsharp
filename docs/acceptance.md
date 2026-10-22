# POC Acceptance

This checklist maps Section 10.1 of the execution plan to evidence in the repository. All items are satisfied for the documented core on the verified Windows environment.

| Criterion | Status | Evidence |
|---|---|---|
| A program uses functions, calls, immutable locals, conditions, and returns | Met | `tests/conformance/programs/calls.hs`, `demo.hs`, `if_else.hs`; 29 passing cases |
| Standard and alternative syntaxes express the same program | Met | `profiles/standard.json`, `my-syntax.json`, `terse.json`, `casual.json`; normalized-AST equivalence for every case/profile |
| A user creates a third profile without changing compiler code | Met | `profiles/casual.json` is a user-created profile; profile schema is data-only and validated generically; `hs syntax export` works with it |
| All four target projects are generated | Met | `src/backends/{csharp,rust,go,java}.ts`; `hs build --target ...`; generated projects under `build/` |
| All four projects actually compile and execute | Met | 464 target executions; `reports/conformance.md`; `hs demo` |
| Values and error codes satisfy the common contract | Met | Independent expectations in `tests/conformance/cases.json`; pinned `E_OVERFLOW` node IDs; reference + four targets compared |
| Export/reimport preserves meaning and comments | Met | Unit tests, `hs demo`, structured AST comparison, exact round-trip text check |
| Concurrent changes to canonical source are detected | Met | `E_IMPORT_STALE_BASE` unit test; profile changes produce `E_IMPORT_PROFILE_CHANGED` |
| Static diagnostics identify locations in user source | Met | Diagnostics carry `file:line:column`; `hs check local/... --profile my-syntax` points into the personal file |
| One command reproduces verification and writes a report | Met | `hs test --all-targets` (or `npm test`); writes `reports/conformance.{json,md}` |
| Real-time analysis and generated-code preview backend | Met | Bundled `HSharpAnalyzer`; 100-request bridge protocol test; benchmark budgets in `reports/benchmark.json` |
| Visual Studio Code extension | Met (package/install) | `editors/vscode` packages and installs a VSIX with semantic tokens, diagnostics, and preview; interactive UI verification pending |
| Tool and dependency versions are recorded | Met | `docs/getting-started.md`, `reports/environment.json`, pinned `package.json`/`package-lock.json` |
| Generated files require no manual corrections | Met | All generated projects build from a clean directory without edits; conformance fails on any build error |

## End-to-end workflow evidence

1. **Write** the canonical program: `examples/calculate.hs`.
2. **Create** a personal profile: `profiles/my-syntax.json` (or user-created `profiles/casual.json`).
3. **Export** to personal notation: `hs syntax export ...`.
4. **Edit** the personal file: `hs demo` changes `give base + 2` to `give base + 3`.
5. **Reimport**: `hs syntax import ...` updates canonical source and comments survive.
6. **Generate and execute**: reference plus C#, Rust, Go, Java all return `33`.
7. **Locate diagnostics**: personal-file check reports positions in the personal file.

## Definition of done caveats

- The POC validates a small core and lexical customization only. It does not establish correctness for shared-memory concurrency, broad ecosystem interoperability, or application-level performance.
- Verification is on Windows x64. Cross-platform execution is expected but not evidenced here.
- Automatic merging of concurrent edits is explicitly out of scope; conflicts are detected and rejected.

## Blocked-toolchain policy

If a target toolchain is missing or below the required version:

- the target's rows are `blocked` in the report;
- `hs test` exits 2;
- the report does not say PASS.

`hs test --quick` is labelled **interpreter-only** and does not claim target verification.
