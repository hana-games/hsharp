# h# 0.3 — Data and memory semantics

Status: **partially implemented (0.3 record, string, list, variant, and focused Option/Result slices)**. A data feature is advertised only after it has a
conformance corpus entry and executes on every advertised target. The current slice covers immutable
records with `i32`/`bool` fields, nested non-recursive records, record literals, field access, records
as locals and internal parameters, record returns from internal functions, entry function parameters
whose record leaves are `i32`/`bool` (flattened to scalar command-line arguments), structural
equality, update-as-new-value, strings with literals, escapes, equality, locals, internal parameters,
and internal returns, `list<i32>`/`list<bool>` with non-empty literals, indexing, `length`, locals,
internal parameters, internal returns, and structural equality, and nominal variants with scalar
payloads, constructors, exhaustive `match`, wildcard arms, locals, internal parameters, internal
returns, and structural equality. A focused `Option<T>`/`Result<T>` slice (T is `i32` or `bool`)
adds `some`/`none`/`ok`/`err`, exhaustive `match`, structural equality, locals, internal parameters,
and internal returns; it is covered by `examples/option-result.hs` and unit tests but is not yet a
conformance corpus entry. String length/indexing, empty list literals, list mutation/concatenation,
record fields of string/list/variant type, lists of variants, and Option/Result in records, lists,
variants, or entry signatures remain specification-only.

This document defines the portable data model for phase 0.3. It is normative for profiles,
generated code, the reference interpreter, and the conformance suite.

## Goals

- Add useful immutable values without importing target-specific behavior.
- Keep one typed semantic core while allowing each backend to use its own native representation.
- Specify copying, equality, and ownership before implementation.
- Make every failure observable and portable: no null, no hidden exception, no target-specific
  wrapping.

## Non-goals

- Mutation, shared references, cycles, and concurrent access.
- A standard library of dates, files, networking, or serialization.
- User-defined generics; `Option<T>` and `Result<T>` are built-in types with monomorphized
  implementations.
- A garbage-collection or ownership model visible in source semantics.

## Types

New portable types:

```text
string
list<T>
record Name { field: T, ... }
variant Name { alternative(T), ... }
Option<T>   // some(T) | none
Result<T>   // ok(T) | err(string)
```

Primitive types remain `i32` and `bool`. A type is portable only if every field, element, and
alternative is portable.

## Strings

A `string` is an immutable sequence of Unicode scalar values.

- Literals use double quotes and support `\"`, `\\`, `\n`, `\r`, `\t`, and `\u{...}` with a
  hexadecimal Unicode scalar value. Surrogate code points are rejected.
- `length(s)` counts Unicode scalar values, not UTF-8 bytes, UTF-16 code units, or grapheme clusters.
- `s[i]` is rejected for strings in 0.3. Indexing by code point is deferred until slice semantics are
  specified.
- Equality is scalar-sequence equality. No normalization is performed: canonically equivalent
  strings remain unequal.
- Backends may store UTF-8, UTF-16, or another internal encoding, but every observable operation
  must expose the scalar-value model.
- No implicit conversion exists between `string` and `list<i32>` or any numeric type.

**Implemented slice (0.3):** double-quoted literals with the listed escapes, equality, locals,
internal parameters, and internal returns. Entry functions cannot take or return strings because the
CLI argument/outcome boundary is still scalar. `length`, indexing, concatenation, and string fields in
records remain unimplemented.

## Lists

A `list<T>` is an immutable, ordered sequence of portable values.

- Literal: `[a, b, c]`; empty list: `[]` with the expected element type supplied by the context.
- `length(xs)` returns the number of elements.
- `xs[i]` requires `i: i32` and fails with `E_INDEX` when `i < 0` or `i >= length(xs)`.
- `xs[i]` is O(1). Bounds are checked before reading.
- Equality is element-wise equality. Lists of different lengths are unequal.
- Concatenation is not part of 0.3.
- Backends may share storage when the value is immutable; copying must be unobservable.

**Implemented slice (0.3):** `list<i32>` and `list<bool>` only, with non-empty literals `[a, b, c]`,
`xs[i]` indexing, and the `length(xs)` built-in returning `i32`. Lists are immutable values usable as
locals, internal function parameters, and internal return values. Structural `==`/`!=` is
implemented. Out-of-range indexing fails at runtime with `E_INDEX` on the indexing source node and
propagates through the same result mechanism as `E_OVERFLOW`.

**Deliberately rejected in this slice:** empty list literals (`E_EMPTY_LIST_UNSUPPORTED`), element
types other than `i32`/`bool` (`E_LIST_ELEMENT_UNSUPPORTED`), mixed element types
(`E_LIST_ELEMENT_TYPE`), non-`i32` indices (`E_LIST_INDEX_TYPE`), indexing non-lists
(`E_INDEX_ON_NON_LIST`), list fields in records (`E_LIST_FIELD_UNSUPPORTED`), and list parameters or
returns on entry functions (`E_LIST_ENTRY_PARAMETER_UNSUPPORTED`,
`E_LIST_ENTRY_RETURN_UNSUPPORTED`). Concatenation, slicing, mutation, and empty literals are not
implemented.

## Records

Records are nominal, immutable product values.

```text
record Point {
    x: i32,
    y: i32,
}
```

- Record declarations are top-level and unique by name.
- Fields are unique within a record, ordered in source order, and immutable.
- Constructor: `Point { x: 1, y: 2 }`; every field is required.
- Field access: `p.x`.
- Update-as-new-value: `Point { ...p, x: 3 }` creates a new value. The original is unchanged.
- Nested records are allowed. Recursive records are rejected because they would require
  indirection/ownership semantics not yet specified.
- Equality is field-wise equality.
- Field order is not observable in equality or construction.
- A record value is a value, not an identity. Backends may copy it or share immutable storage.

**Implemented slice (0.3):** top-level record declarations with unique `i32`/`bool` fields, nested
non-recursive record fields, record literals, field access, records as locals and internal
parameters, record returns from internal functions, entry function record parameters whose leaves
are `i32`/`bool`, structural `==`/`!=`, and `Point { ...p, x: 3 }` update-as-new-value. Record names
and field names are nominal; field order is preserved in the AST but not observable in equality.
Internal record returns use the generated result payload.

**Entry argument convention:** a record parameter contributes one command-line argument per leaf
field, flattened depth-first in declaration field order. `Point { x: i32, y: i32 }` consumes `x`
then `y`; `Line { a: Point, b: Point }` consumes `a.x`, `a.y`, `b.x`, `b.y`. Multiple parameters
flatten left to right in function parameter order. Generated entry code parses those scalar
arguments with the same `i32`/`bool` validation as before and reconstructs the records before the
entry call.

**Deliberately rejected in this slice:** recursive record types (`E_RECURSIVE_RECORD`), entry
functions returning records (`E_RECORD_ENTRY_RETURN_UNSUPPORTED`), and entry record parameters with
a string, list, variant, Option, Result, or unknown leaf
(`E_RECORD_ENTRY_PARAMETER_UNSUPPORTED`, alongside the corresponding record-field diagnostic).
Unknown records, fields, and types have dedicated diagnostics; duplicate record and field
declarations are rejected.

## Variants, Option, and Result

Variants are nominal tagged unions.

```text
variant Shape {
    circle(i32),
    rectangle(i32, i32),
}
```

- Alternatives are unique within a variant; payload arity and types are fixed.
- Constructors: `circle(3)`, `rectangle(2, 4)`.
- `Option<T>` is the built-in variant `some(T) | none`.
- `Result<T>` is the built-in variant `ok(T) | err(string)`.
- `none` is a nullary constructor and requires an expected `Option<T>` type.
- A variant value carries its alternative and payload only; no target exception or null is exposed.

**Implemented slice (0.3):** top-level `variant Name { alternative(i32, bool, ...), nullary }`
declarations with unique names. Alternative names are nominal and unique within a variant; a bare
call such as `circle(3)` resolves to a constructor when the callee names exactly one alternative and
is not also a function name. Variants are immutable values usable as locals, internal parameters, and
internal returns, and support structural `==`/`!=`. Variant names and alternative names do not appear
in generated identifiers.

**Implemented focused slice (0.3):** built-in `Option<T>` and `Result<T>` for `T` in `{i32, bool}`.
`some(value)` and `ok(value)` infer `T` from the payload; `none()` and `err("message")` require an
expected `Option<T>` or `Result<T>` from a let annotation, return type, function or constructor
argument, equality operand, or match arm result. Values lower to compiler-generated private tagged
types (`X1`, `X2`, ...) and use exhaustive `match` with `some(x)`, `none()`, `ok(x)`, and
`err(message)` patterns. Values are immutable, structural for `==`/`!=`, and usable as locals,
internal parameters, and internal returns. The `Result` error payload preserves its string value.
The constructor names `some`, `none`, `ok`, and `err` are reserved for these built-ins in this slice.
Missing or wrong expected types produce `E_MISSING_EXPECTED_TYPE` or `E_CONSTRUCTOR_EXPECTED_TYPE`;
nested Option/Result values produce `E_NESTED_OPTION_RESULT`. Entry functions cannot take or return
these types, including as leaves of entry record parameters. A `none()` or `err()` used directly as a
match scrutinee still needs an expected type from an enclosing context; pattern-only inference is not
implemented.

**Deliberately rejected in this slice:** payload types other than `i32`/`bool`
(`E_VARIANT_PAYLOAD_UNSUPPORTED`), variants in record fields (`E_VARIANT_FIELD_UNSUPPORTED`), lists
of variants (`E_VARIANT_IN_LIST`), variant parameters or returns on entry functions
(`E_VARIANT_ENTRY_PARAMETER_UNSUPPORTED`, `E_VARIANT_ENTRY_RETURN_UNSUPPORTED`), ambiguous
constructor/function calls (`E_AMBIGUOUS_CONSTRUCTOR`), duplicate variants, alternatives, and match
arms, and empty variant declarations. Option/Result are rejected in record fields
(`E_OPTION_FIELD_UNSUPPORTED`, `E_RESULT_FIELD_UNSUPPORTED`), list element positions
(`E_OPTION_IN_LIST`, `E_RESULT_IN_LIST`), variant payloads, entry parameters, and entry returns
(`E_OPTION_ENTRY_*`, `E_RESULT_ENTRY_*`). Unwrap/expect helpers, nested Option/Result, and
user-defined generics are not implemented.

## Pattern matching

Minimal `match` is introduced for variants:

```text
match shape {
    circle(r) => r * r,
    rectangle(w, h) => w * h,
}
```

- Patterns are exhaustive; a missing alternative is a compile error.
- A wildcard `_` is allowed as the final arm.
- No guards, nested patterns, or binding modes in 0.3.
- Matching is ordered only for diagnostics; exhaustive alternatives are disjoint.
- Record destructuring is deferred; field access plus equality is sufficient for the first slice.

**Implemented slice (0.3):** `match` expressions over variants, alternatives matched by name,
positional payload bindings, and an optional final `_` arm. The scrutinee is evaluated once and only
the selected arm runs. Non-exhaustive matches without `_` (`E_NON_EXHAUSTIVE_MATCH`), a non-final `_`
(`E_WILDCARD_NOT_FINAL`), unknown alternatives, duplicate arms, pattern arity mismatches, and
non-variant scrutinees are rejected. Guards, nested patterns, and binding modes are not implemented.

## Equality and copying

- `==` and `!=` are structural for strings, lists, records, variants, `Option`, and `Result`.
- Equality requires identical portable types; there is no coercion.
- Values are immutable. Assignment and argument passing are conceptually copies.
- Backends may share immutable storage, but no source operation can observe aliasing.
- Recursive values are rejected, so equality terminates.

## Failure semantics

New runtime failures:

| Code | Meaning |
|---|---|
| `E_INDEX` | List index is negative or not less than the list length |
| `E_DATA_RANGE` | A future built-in data operation left its specified range |

`E_INDEX` carries the source node of the indexing expression. A failed operation propagates through
the same result mechanism as `E_OVERFLOW`. No target exception may escape the generated program.

## Target representation

The current generated runtime stores only `i32` (and booleans normalized to `0`/`1`). Data values
require a tagged representation in every backend.

### Rust (proving target)

- Records become `#[derive(Clone, PartialEq, Eq)]` structs.
- Variants become generated `#[derive(Clone, Copy, PartialEq, Eq)]` tagged structs carried through
  the runtime `Payload` enum. The generated shape is private to the target; source semantics are
  nominal.
- Lists become `Vec<T>`.
- Strings become `String` with scalar-value helpers.
- Values are moved by default; `Clone` is used only when source semantics require another binding.
- The first implementation must demonstrate explicit ownership, not incidental cloning.

### C#

- Records become `readonly record struct` for scalar-only records and immutable classes for nested
  reference-bearing records.
- Variants become a sealed hierarchy or a readonly struct with a tag.
- Lists use arrays or `IReadOnlyList<T>`.
- No null is produced by the compiler.

### Go

- Records become structs.
- Variants use a tag plus payload fields, with generated constructors.
- Lists use slices; generated code must not expose mutable aliasing.
- Equality uses generated deep helpers, not `==` on slices.

### Java

- Records become `record` classes.
- Variants become sealed interfaces or a tagged class.
- Lists use immutable wrappers or defensive copies.
- Equality uses generated `equals`/hash code only where values are used as map keys; source-level
  equality uses generated helpers.

Each backend receives generated equality helpers for structural types. Target-specific
representations are private to the generated project.

## Conformance acceptance

A data feature is complete only when:

1. Its semantics are in this specification.
2. Positive and negative examples exist independently of generated code.
3. The reference interpreter and all four targets agree on values, failures, and failure nodes.
4. Round-trip and normalized-AST checks cover every profile.
5. Copying/ownership behavior is documented and measured for the initial model.
6. The limitations file is updated.

Initial corpus must cover:

- empty and non-empty strings;
- Unicode scalar values above the BMP and surrogate rejection;
- list literals, lengths, indexing, and `E_INDEX`;
- nested records, field access, update-as-new-value, and equality;
- variant construction and exhaustive/non-exhaustive matching;
- `Option`, `Result`, and equality;
- zero-copy observation tests where a backend shares immutable storage.

The committed 0.3 corpus currently covers the record slice, a focused list example
(`examples/list.hs`), and a focused variant example (`examples/variants.hs`): scalar records, field
access, internal record parameters, structural equality, list literals/length/indexing/equality,
variant constructors, internal variant parameters and returns, exhaustive matching, and structural
variant equality. `examples/option-result.hs` and its unit tests cover the focused Option/Result
slice on all four backends, but it is not yet a conformance corpus case. `examples/entry-records.hs`
and unit tests cover flattened entry record parameters on all four backends, also without a corpus
entry. The other bullets remain acceptance work for future slices.

## Migration

- New type names are reserved in every profile.
- Profiles remain keyword-only; data syntax is fixed.
- Existing 0.1/0.2 programs remain valid.
- The 0.3 corpus is additive; it does not replace the 29 core cases.

## Open implementation issues

- The generated result record must carry a typed payload instead of only `int value`.
- Each backend needs a tagged value or monomorphized result type.
- A CST/printer is not required for 0.3, but data conversion must remain comment-preserving.
- List element storage must not expose mutation through a generated API.
