# Syntax Profiles (0.1)

Profiles are declarative JSON data. They contain no executable code and cannot introduce grammar or semantic changes in the POC.

## 1. Format

```json
{
  "id": "my-syntax",
  "version": "1",
  "core": "0.1",
  "family": "braces",
  "keywords": {
    "fn": "function",
    "let": "value",
    "if": "when",
    "else": "otherwise",
    "return": "give",
    "true": "yes",
    "false": "no"
  }
}
```

| Field | Rule |
|---|---|
| `id` | Non-empty; letters, digits, `.`, `_`, `-` |
| `version` | Must be `"1"` |
| `core` | Must be `"0.1"` |
| `family` | Must be `"braces"` |
| `keywords` | Exactly the seven roles `fn`, `let`, `if`, `else`, `return`, `true`, `false` |

Unknown top-level options or keyword roles are rejected. Every keyword word must match `[A-Za-z_][A-Za-z0-9_]*`.

## 2. Validation rules

A profile is accepted only when:

1. Every keyword role is present.
2. Different roles use different words.
3. Every word has the allowed lexical form.
4. `version`, `core`, and `family` are compatible.
5. A word does not collide with the reserved type names `i32` or `bool`.
6. A canonical keyword is used only for its own role. For example, `"fn": "let"` is rejected, while `"fn": "fn"` is allowed.
7. No unknown configuration options are present.

Additionally, the active aliases and **all canonical keywords** are reserved within a profile. A canonical keyword that has been remapped cannot be reused as an identifier. This prevents the same text from being interpreted differently depending on which profile is active.

Examples of rejected profiles are under `tests/negative/profiles/`.

## 3. What profiles may and may not change

A profile may change the spelling of the seven keyword roles.

A profile may **not** change:

- type names (`i32`, `bool`);
- operators, precedence, associativity, or meaning;
- braces, parentheses, colons, semicolons, or commas;
- function or variable names in the program;
- comments or whitespace.

A profile is selected explicitly on every command. Canonical source in the repository is interpreted with the standard profile (`profiles/standard.json`). There is no implicit user preference.

## 4. Token-aware conversion

Conversion re-prints the complete token stream:

- a keyword token is replaced by the target profile's word for the same role;
- whitespace, comments, identifiers, type names, numbers, and punctuation are copied verbatim.

Conversion is not a global string replacement. Changing `return` to `give` does not alter `return_value`, `returning`, or a comment containing the word.

If a program identifier equals a word used by the target profile, conversion is rejected with `E_PROFILE_IDENTIFIER_COLLISION`. Otherwise the exported file would not parse back unambiguously.

Export performs an additional structural check: the converted text is parsed and checked under the target profile, and its normalized AST must equal the canonical AST. The normalized AST ignores locations, node IDs, comments, and annotations.

## 5. Export

```sh
uni syntax export examples/calculate.uni \
  --profile profiles/my-syntax.json \
  --out local/calculate.uni
```

The output file and manifest must be distinct from the canonical source and the profile; export refuses paths that would overwrite either.

The manifest is written next to the personal file as `<personal>.manifest.json` unless `--manifest` is given:

```json
{
  "schema": "uni-export/1",
  "coreVersion": "0.1",
  "compilerVersion": "0.1.0",
  "canonical": { "path": "../../examples/calculate.uni", "fingerprint": "sha256:..." },
  "profile": {
    "id": "my-syntax",
    "version": "1",
    "path": "../../profiles/my-syntax.json",
    "fingerprint": "sha256:..."
  },
  "personal": { "path": "calculate.uni", "fingerprint": "sha256:..." }
}
```

Paths are relative to the manifest directory. Fingerprints are SHA-256 over the exact UTF-8 text (a leading BOM is ignored).

## 6. Reimport

```sh
uni syntax import local/calculate.uni
uni syntax import local/calculate.uni --dry-run
```

Reimport:

1. Reads the manifest associated with the personal file (or `--manifest`).
2. Confirms the manifest belongs to that personal file.
3. Confirms the profile still has the recorded fingerprint.
4. Confirms the canonical source still has the recorded fingerprint.
5. Parses and checks the personal source under the recorded profile.
6. Converts it back to the standard profile and checks the canonical result.
7. Shows a line diff and applies the change.

On success the manifest's canonical and personal fingerprints are refreshed, so the export/edit/import cycle can continue without re-exporting.

A stale canonical base is rejected with `E_IMPORT_STALE_BASE`. A changed profile is rejected with `E_IMPORT_PROFILE_CHANGED`. Automatic merging is out of scope for the POC.

## 7. Creating a profile without changing the compiler

Copy any file in `profiles/`, change `id` and the seven `keywords` values, keep `version`, `core`, and `family` unchanged, and use it with `--profile`. No compiler code changes are required. `profiles/casual.json` is an example of a user-created profile.
