# h# 0.3 — Data and memory semantics

Status: **specification draft**. No data feature is advertised until it has a conformance corpus entry
and executes on every advertised target.

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

## Lists

A `list<T>` is an immutable, ordered sequence of portable values.

- Literal: `[a, b, c]`; empty list: `[]` with the expected element type supplied by the context.
- `length(xs)` returns the number of elements.
- `xs[i]` requires `i: i32` and fails with `E_INDEX` when `i < 0` or `i >= length(xs)`.
- `xs[i]` is O(1). Bounds are checked before reading.
- Equality is element-wise equality. Lists of different lengths are unequal.
- Concatenation is not part of 0.3.
- Backends may share storage when the value is immutable; copying must be unobservable.

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

## Pattern matching

Minimal `match` is introduced only for variants and records:

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
- Variants become enums with payloads.
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
