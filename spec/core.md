# h# Core Semantics (0.1)

This document is normative for the POC. If an implementation and this document disagree, the implementation is defective (or this document is explicitly amended first).

## 1. Types

| Type | Meaning |
|---|---|
| `i32` | Signed 32-bit integer from −2,147,483,648 through 2,147,483,647 |
| `bool` | `true` or `false` |

There is no implicit conversion between `i32` and `bool`.

## 2. Declarations

- A program is a sequence of named function declarations.
- Function and parameter names are explicitly typed.
- Every function declares its return type with `->`.
- Local bindings are immutable and require a type annotation: `let name: i32 = expr;`.
- A local, parameter, or function name may not redeclare a name visible in the current scope.
- Function names must be unique.
- A local declaration may not shadow a function name.
- Names are case-sensitive and use ASCII letters, digits, and underscore, with no leading digit.
- Function names are not values; a function name may appear only as the callee of a call.

## 3. Expressions

Available forms:

- integer literals, `true`, `false`;
- variable references;
- calls to functions in the same program;
- unary `-` and `!`;
- binary `+`, `-`, `*`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`;
- parentheses for grouping.

No other operators, literals, or expression forms exist in the POC.

### 3.1 Integer literals

- Positive literals must be in `0..2147483647`.
- The special literal `-2147483648` is accepted and denotes the minimum `i32`.
- Positive `2147483648` is rejected as an out-of-range literal.
- Negative values other than the special minimum are formed with unary `-`, e.g. `-7`.
- Leading zeros are accepted (`007` is `7`; `-02147483648` is the special minimum).
- Negating a *variable* whose value is the minimum throws `E_OVERFLOW` at execution time.

### 3.2 Precedence and associativity

From highest to lowest:

| Level | Operators | Associativity |
|---|---|---|
| 1 | calls `f(...)` | — |
| 2 | unary `-`, `!` | right |
| 3 | `*` | left |
| 4 | `+`, `-` | left |
| 5 | `<`, `<=`, `>`, `>=` | rejected when chained |
| 6 | `==`, `!=` | rejected when chained |
| 7 | `&&` | left |
| 8 | `\|\|` | left |

Parentheses change grouping. Chained comparisons are rejected, including mixed forms such as `1 < 2 == 3`. A comparison result may be compared with a Boolean only when each comparison is explicitly parenthesized, e.g. `(1 < 2) == (3 < 4)`.

## 4. Conditions and returns

- An `if` condition must have type `bool`.
- `else` is optional; `else if` is equivalent to an `else` block containing an `if`.
- Every reachable path through a function must return a value of the declared return type.
- The checker rejects missing returns and wrong return types.
- All branches are checked statically, including branches that will never execute.

## 5. Calls and recursion

- A call must name a function in the same program.
- The argument count must match the parameter count.
- Every argument must have the parameter's declared type.
- The call graph must be acyclic. Direct and indirect recursion are rejected before generation.

## 6. Evaluation order

1. Function arguments are evaluated left to right.
2. Binary operands are evaluated left to right.
3. `false && right` does not evaluate `right`.
4. `true || right` does not evaluate `right`.
5. Each arithmetic operation is checked independently, including operations whose operands are literals.
6. There is no constant folding in the POC.

Examples:

```text
2 + 3 * 4                  => 14
(2 + 3) * 4                => 20
10 - 4 - 1                 => 5
10 - (4 - 1)               => 7
false && ((x + 1) > 0)     => false without overflow when x = 2147483647
```

## 7. Checked arithmetic

`+`, `-`, `*`, and unary `-` are checked. The exact result is computed as an integer outside the `i32` range; if it is below −2,147,483,648 or above 2,147,483,647, execution stops with `E_OVERFLOW` at that operation.

The failure is attached to the operation's source node and propagates to the execution boundary. An operation is never silently wrapped, clamped, or skipped.

## 8. Comparisons and Boolean operations

- `==` and `!=` require both operands to have the same type (`i32` with `i32`, or `bool` with `bool`).
- `<`, `<=`, `>`, `>=` require `i32` operands.
- `!`, `&&`, and `||` require `bool` operands.
- All Boolean operators produce `bool`.

## 9. Entry function

The execution harness selects an entry function explicitly. If no entry is supplied, `main` is used when present; otherwise a program with exactly one function uses that function. Ambiguity is an error before generation.

Entry arguments are supplied by the harness. An `i32` argument must be an integer in the `i32` range. A `bool` argument must be `true` or `false`.

## 10. Program failures versus infrastructure failures

Program outcomes are:

- `Success(type, value)`;
- `Failure(code, sourceNode)`.

The only program failure code in the POC is `E_OVERFLOW`.

Syntax, profile, type, name-resolution, missing-return, recursion, and entry-selection errors stop compilation before any target project is generated.

A missing or unusable target toolchain is a **blocked** verification result. It is never reported as a pass.

## 11. Diagnostics

Every static diagnostic includes a code, severity, message, and source span (`file:line:column`). Key codes:

| Code | Meaning |
|---|---|
| `E_SYNTAX` | Malformed syntax |
| `E_RESERVED_WORD` | Canonical keyword used as an identifier under a remapped profile |
| `E_INT_RANGE` | Integer literal outside the accepted range |
| `E_CHAINED_COMPARISON` | More than one comparison without grouping |
| `E_UNKNOWN_NAME` | Unbound variable |
| `E_UNKNOWN_FUNCTION` | Unresolved call |
| `E_DUPLICATE_FUNCTION` | Repeated function name |
| `E_DUPLICATE_PARAMETER` | Repeated parameter name |
| `E_REDECLARED_NAME` | Local name already visible |
| `E_NAME_SHADOWS_FUNCTION` | Local name equals a function name |
| `E_ARITY` | Wrong argument count |
| `E_ARGUMENT_TYPE` | Wrong argument type |
| `E_TYPE_MISMATCH` | Initializer type differs from annotation |
| `E_RETURN_TYPE` | Returned value differs from declared type |
| `E_CONDITION_TYPE` | Non-Boolean condition |
| `E_OPERATOR_TYPE` | Invalid operand types |
| `E_MISSING_RETURN` | A reachable path does not return |
| `E_RECURSION` | Cycle in the call graph |
| `E_ENTRY_NOT_FOUND` / `E_ENTRY_AMBIGUOUS` | Entry selection failed |
| `E_OVERFLOW` | Runtime checked-arithmetic failure |
