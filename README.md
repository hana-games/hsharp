# Uni

Uni is a small programming language with one shared semantic core, user-selected keyword syntax, and source generation for **C#, Go, Rust, and Java**.

This repository contains the executable proof of concept described in [`uni-ai-agent-execution-plan.md`](uni-ai-agent-execution-plan.md). A Uni program is parsed and checked once, then:

- the reference interpreter produces an outcome;
- four backends generate ordinary target projects;
- the target toolchains compile and execute those projects;
- the conformance runner compares every result with expectations written independently in the test manifest.

```text
fn calculate(x: i32, bonus: bool) -> i32 {
    let base: i32 = x * 3;

    if bonus {
        return base + 2;
    }

    return base;
}
```

The same program in a personal profile (`profiles/my-syntax.json`):

```text
function calculate(x: i32, bonus: bool) -> i32 {
    value base: i32 = x * 3;

    when bonus {
        give base + 2;
    }

    give base;
}
```

`calculate(10, true)` is `32` in every profile and on every target.

## Status

The POC is complete and verified on this machine:

- 29 positive conformance cases, each executed through **4 profiles × 4 targets** (464 target executions).
- 27 negative program/profile cases.
- 19 unit tests covering profiles, conversion, export/import, checked arithmetic, and diagnostics.
- Real compilation and execution with .NET 10, Rust, Go, and Java.
- Export/reimport with comment preservation, stale-base detection, and changed-profile detection.

See [`docs/verification.md`](docs/verification.md) and [`reports/conformance.md`](reports/conformance.md).

## Quick start

Prerequisites are pinned in [`docs/getting-started.md`](docs/getting-started.md). On Windows:

```powershell
npm install
npm run build

node dist/cli/index.js check examples/calculate.uni
node dist/cli/index.js demo
node dist/cli/index.js test --all-targets
```

`npm test` runs the unit suite and the full conformance suite.

To use the shorter `uni` command, run `npm link` once from the repository root.

## Commands

```text
uni check <file> [--profile <profile.json>] [--json]

uni build <file> --target <csharp|rust|go|java> [--out <dir>]
          [--entry <function>] [--profile <profile.json>] [--run] [--args a,b]

uni syntax export <canonical.uni> --profile <profile.json> --out <personal.uni>
                  [--manifest <file>]
uni syntax import <personal.uni> [--manifest <file>] [--dry-run]

uni test [--all-targets] [--targets csharp,rust,go,java] [--quick]
         [--report-dir <dir>] [--json]

uni doctor [--json]
uni demo
```

Canonical source is always interpreted with the standard profile. A personal profile is selected explicitly; there is no implicit local preference.

## Repository layout

| Location | Contents |
|---|---|
| `spec/` | Core rules, grammar, profiles, execution protocol, code generation |
| `src/contracts/` | AST, diagnostics, tokens, outcomes, shared interfaces |
| `src/frontend/` | Lexer, parser, profile validation, keyword conversion |
| `src/semantic/` | Scopes, types, return analysis, call-graph checks, entry selection |
| `src/reference/` | BigInt-based reference interpreter |
| `src/backends/` | C#, Rust, Go, and Java generators |
| `src/harness/` | Toolchain detection, generated-project build/run |
| `src/testing/` | Unit tests and conformance runner |
| `src/cli/` | `uni` command line |
| `profiles/` | Standard, supplied personal, and user-created profiles |
| `examples/` | Demonstration programs |
| `tests/conformance/` | Positive and negative cases with independent expectations |
| `tests/negative/` | Profiles that must be rejected |
| `reports/` | Generated environment and conformance reports |
| `docs/` | Getting started, decisions, verification, acceptance, limitations |

## Design in one paragraph

Uni source is parsed with a profile-driven lexer into a located source AST, checked into a typed AST with stable symbol IDs, and interpreted by a BigInt reference implementation. Each backend lowers the typed AST to an imperative form where every arithmetic operation is checked and every function returns an internal success/failure record. Booleans are represented as `0`/`1` internally; source-level types are enforced statically. Names in generated code come only from compiler-assigned IDs (`f1`, `v2`, `t0`), so program identifiers can never collide with host-language reserved words. Generated programs do not call the TypeScript interpreter.

## Documentation

- [Getting started](docs/getting-started.md)
- [Core semantics](spec/core.md)
- [Grammar](spec/grammar.md)
- [Profiles](spec/profiles.md)
- [Execution protocol](spec/execution-protocol.md)
- [Code generation](spec/code-generation.md)
- [Design decisions](docs/decisions.md)
- [Verification evidence](docs/verification.md)
- [POC acceptance](docs/acceptance.md)
- [Limitations and next steps](docs/limitations.md)
- [Agent handoffs and reviews](docs/handoffs.md)
