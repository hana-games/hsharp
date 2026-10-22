# h# Conformance Report

- Generated: 2026-10-22T13:56:26.654Z
- Compiler: 0.1.0 (core 0.1)
- Node: v24.21.0
- Mode: full (all configured targets executed)
- Profiles: standard, my-syntax, terse, casual
- Cases: 29; target executions: 464
- Result: PASS (0 failed, 0 blocked)

## Toolchains

| Target | Tool | Version | Status |
|---|---|---|---|
| csharp | .NET SDK | 10.0.401 | available |
| rust | Rust (cargo) | cargo 1.98.1 (797e8a9bc 2026-08-05); rustc 1.98.1 (48a229cea 2026-09-01) | available |
| go | Go | go version go1.27.0 windows/amd64 | available |
| java | Java (javac) | javac 21.0.12.1; openjdk version "21.0.12.1" 2026-08-18 LTS | available |

## Cases

| Case | Reference | Profiles | C# | Rust | Go | Java |
|---|---|---|---|---|---|---|
| demo-bonus-true | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| demo-bonus-false | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| function-call | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| precedence | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| parentheses | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| left-associativity | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| subtraction-grouping | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| i32-minimum | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| i32-maximum | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| overflow-add-max | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| add-at-max-boundary | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| overflow-subtract-min | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| overflow-multiply-min | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| multiply-negative-one | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| overflow-negate-min | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| negate-positive | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| short-circuit-and | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| short-circuit-or | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| comparison-true | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| comparison-false | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| bool-logic | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| if-else-negative | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| if-else-zero | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| if-else-positive | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| target-reserved-names | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| comments-preserved | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| dead-code-after-return | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| dead-code-after-if | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |
| grouped-comparison-equality | passed | standard:ok my-syntax:ok terse:ok casual:ok | pass | pass | pass | pass |

Each target artifact is compiled once per program and entry function; the same profile-independent artifact is then executed for every profile. Structural equivalence and round-trip preservation are verified separately for each profile.

## Negative cases

| Case | Expected diagnostic | Status |
|---|---|---|
| argument-type | E_ARGUMENT_TYPE | passed |
| argument-count | E_ARITY | passed |
| unknown-local-name | E_UNKNOWN_NAME | passed |
| unknown-function | E_UNKNOWN_FUNCTION | passed |
| missing-return | E_MISSING_RETURN | passed |
| direct-recursion | E_RECURSION | passed |
| indirect-recursion | E_RECURSION | passed |
| positive-min-literal | E_INT_RANGE | passed |
| chained-comparison | E_CHAINED_COMPARISON | passed |
| mixed-chained-comparison | E_CHAINED_COMPARISON | passed |
| non-boolean-condition | E_CONDITION_TYPE | passed |
| let-type-mismatch | E_TYPE_MISMATCH | passed |
| operator-operand-type | E_OPERATOR_TYPE | passed |
| redeclared-local | E_REDECLARED_NAME | passed |
| duplicate-function | E_DUPLICATE_FUNCTION | passed |
| return-type | E_RETURN_TYPE | passed |
| syntax-error | E_SYNTAX | passed |
| integer-range | E_INT_RANGE | passed |
| shadow-function | E_NAME_SHADOWS_FUNCTION | passed |
| duplicate-parameter | E_DUPLICATE_PARAMETER | passed |
| profile-duplicate-keyword | E_PROFILE_DUPLICATE_KEYWORD | passed |
| profile-unknown-option | E_PROFILE_UNKNOWN_OPTION | passed |
| profile-reassigned-canonical-word | E_PROFILE_RESERVED_KEYWORD | passed |
| profile-missing-role | E_PROFILE_MISSING_ROLE | passed |
| profile-incompatible-core | E_PROFILE_CORE_VERSION | passed |
| profile-keyword-form | E_PROFILE_KEYWORD_FORM | passed |
| profile-type-name-collision | E_PROFILE_RESERVED_KEYWORD | passed |

