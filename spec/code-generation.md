# Code Generation (0.1)

## 1. Pipeline

```text
source text + explicit profile
  -> tokens (including trivia) + source AST
  -> typed AST with stable symbol IDs
  -> reference outcome
  -> one of four generated projects
  -> target compiler and runtime
  -> normalized outcome
```

The typed AST is the common representation. There is no optimization stage and no constant folding.

## 2. Names

Every function and local receives a compiler-assigned ID in source order:

| Entity | Internal ID | Target name |
|---|---|---|
| Function | `function:N` | `fN` |
| Parameter or local | `local:N` | `vN` |
| Temporary in generated code | — | `tN` or `rN` |

Target identifiers never come from source spelling. An h# function named `int` or a local named `class` therefore produces `f1`/`v1` and cannot collide with a host-language reserved word.

Locals in sibling scopes get distinct IDs, so reuse of a source name in a separate block cannot collide after generation.

## 3. Lowering

Expressions are lowered to integer-valued temporaries. Booleans are stored as `0` or `1`; their source type is enforced statically.

- Integer literals are emitted directly; `-2147483648` becomes each target's minimum constant.
- Variables and calls produce values read from the internal result record.
- Calls evaluate every argument left to right before the call and propagate a failing result immediately.
- `&&` and `||` generate conditional control flow, so the right operand is only lowered/executed when required.
- Comparisons generate conditionals that set a temporary to `0` or `1`.
- `let` declares a typed local; immutability is a source-language rule, so generated assignments only initialize.
- `if`/`else` generate native conditional blocks.
- `return` wraps the value with the success constructor.

Statements after a definitely-returning statement are unreachable and are omitted from generated code. Input that reaches code generation has already passed the checker, so this never changes behavior; it keeps Java (which rejects unreachable statements) consistent with the other targets.

## 4. Checked arithmetic

Each target implements the same helper strategy:

1. widen `i32` operands to signed 64-bit;
2. perform the operation;
3. compare against −2,147,483,648 and 2,147,483,647;
4. return a failure result or narrow the value.

This applies separately to addition, subtraction, multiplication, and negation. Multiplication of two `i32` values fits in signed 64-bit. Negating the minimum value is detected because `-(−2147483648)` is `2147483648`.

| Target | Integer type | Intermediate | Failure representation |
|---|---|---|---|
| C# | `int` | `long` | `Res` readonly struct |
| Rust | `i32` | `i64` | `Res` struct, `Result`-style methods |
| Go | `int32` | `int64` | `Res` struct |
| Java | `int` | `long` | nested `Res` class |

## 5. Generated projects

| Target | Files | Build | Run |
|---|---|---|---|
| C# | `HsProgram.csproj`, `Program.cs` | `dotnet build -c Release -nologo -o bin` | `dotnet bin/HsProgram.dll` |
| Rust | `Cargo.toml`, `src/main.rs` | `cargo build --release --offline` | `target/release/hs_program(.exe)` |
| Go | `go.mod`, `main.go` | `go build -o bin/hs_program(.exe) .` | the built binary |
| Java | `HsProgram.java` | `javac -encoding UTF-8 -d bin HsProgram.java` | `java -cp bin HsProgram` |

C# targets `net10.0`. Go declares `go 1.22`. Rust uses edition 2021 and no external crates. Java uses no external libraries.

Generated `main` functions parse command-line arguments according to the entry parameter types, call the entry function, print one JSON outcome line, and exit with the status described in [`execution-protocol.md`](execution-protocol.md).

## 6. Profile independence

Generated code depends on the typed AST, not on source spelling. All profiles for a program therefore produce byte-identical target projects. Conformance verifies structural equivalence for each profile, compiles one artifact per program/entry/target, then executes it once per profile and records a separate result row.

## 7. Diagnostics mapping

Static diagnostics use source spans from the profile-specific lexer/parser, so locations point into the file the user actually wrote. Runtime failures carry the failing expression's AST node ID; the interpreter and all four targets report the same node for the same program.
