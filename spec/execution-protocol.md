# Execution Protocol (0.1)

The protocol is shared by the reference interpreter, generated programs, and the conformance harness. It is internal; user-facing `Result<T, E>` is future language work.

## 1. Outcome

```text
Outcome =
    Success(type, value)
  | Failure(code, sourceNode)
```

JSON on a single line:

```json
{"status":"ok","type":"i32","value":32}
{"status":"ok","type":"bool","value":false}
{"status":"error","code":"E_OVERFLOW","node":17}
```

Rules:

- `type` is `i32` or `bool`.
- A Boolean success carries a JSON Boolean, not `0`/`1`.
- Every failure carries `code` and the numeric source-node ID of the failing operation.
- `node` is compiler-internal. It is stable for a given source text and is used to map failures back to source.
- Generated programs print exactly one outcome line on stdout. Build logs and diagnostics do not go to stdout.
- `badargs` is a harness/host error, not a program outcome:

```json
{"status":"badargs"}
```

## 2. Process exit status

| Situation | Exit status |
|---|---|
| Success outcome | 0 |
| Program failure (`E_OVERFLOW`) | non-zero (generated programs use 1) |
| Invalid harness arguments | 2 |
| Build failure | non-zero from the target toolchain |
| Missing toolchain | verification is `blocked`, never pass |

The conformance harness checks both the outcome and the process status: a success must exit 0, a program failure must exit non-zero, and a missing `node` field is not accepted as a valid failure outcome.

## 3. Verification states

| State | Meaning |
|---|---|
| `passed` | The check ran and matched the independently specified expectation |
| `failed` | The check ran and disagreed, or a generated project did not compile/run |
| `blocked` | The required toolchain is unavailable or cannot target the generated project |

Blocked checks make `uni test` exit 2 and prevent a full PASS. `uni test --quick` is explicitly labelled **interpreter-only** and does not claim target verification.

## 4. Generated function convention

Every generated function returns an internal result structure:

```text
Res = { ok, value, code, node }
```

- `ok` is a Boolean.
- `value` holds the integer value (`0`/`1` for Booleans).
- `code` is `1` for `E_OVERFLOW` and `0` otherwise.
- `node` is the failing source node ID.

A failing operation returns `Res.fail(1, node)`; callers check `ok` and immediately return the same result. This propagates failures to the execution boundary without exceptions. The reference interpreter uses the same outcome semantics but is implemented independently with BigInt.

## 5. Toolchain outcomes

`uni doctor` records command names and versions. `uni test` resolves each command, checks the minimum version required by the generated project, and marks unavailable targets as blocked. In particular:

- C# generated projects require .NET SDK 10 or later (`net10.0`);
- Go generated projects declare `go 1.22`;
- Rust uses edition 2021;
- Java is compiled with `javac` and run with `java`.

Toolchain detection is separate from program verification. A missing compiler never produces a passing test row.
