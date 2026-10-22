# Getting Started

## 1. Pinned environment

The POC was built and verified with these versions. Pin them for reproducible results.

| Tool | Version used | Requirement |
|---|---|---|
| Node.js | 24.21.0 | 22 or later |
| npm | 12.0.2 | ships with Node |
| TypeScript | 7.0.2 | dev dependency, pinned in `package.json` |
| @types/node | 24.10.1 | dev dependency, pinned |
| .NET SDK | 10.0.401 | 10 or later (`net10.0`) |
| Cargo / rustc | 1.98.1 / 1.98.1 | edition 2021 support |
| Go | 1.27.0 | 1.22 or later |
| Java | Microsoft OpenJDK 21.0.12.1 | `javac` and `java` on PATH |

For the Visual Studio Code extension: VS Code 1.85 or later. Building the extension uses the repository's Node dependencies; no external `hs` process is required at runtime.

`npm install` uses the committed `package-lock.json`. Runtime dependencies: none.

`hs doctor --json` writes `reports/environment.json` with the versions actually detected on the current machine.

### Installing missing toolchains on Windows

```powershell
winget install --id GoLang.Go -e
winget install --id Microsoft.OpenJDK.21 -e
```

.NET and Rust were already present in the verified environment. Restart the shell after installation if a command is not found.

## 2. Build

```powershell
cd D:\Github\hsharp
npm install
npm run build
```

The compiled CLI is `dist/cli/index.js`. Run it with `node dist/cli/index.js ...`, or install the commands once:

```powershell
npm link
hs --help
hsharp --help
hcharp --help
```

All three names invoke the same CLI.

## 3. Verify the environment

```powershell
hs doctor
```

Every required toolchain must show `available`. If one is missing, conformance marks that target **blocked** and exits 2; it never reports a pass.

## 4. Check and run the demonstration

```powershell
hs check examples/calculate.hs
hs demo
```

`hs demo` performs the complete workflow in `local/demo/`:

1. copies the canonical example;
2. exports it to the `my-syntax` profile;
3. edits personal notation (`base + 2` → `base + 3`);
4. reimports the edit;
5. runs the reference interpreter and all four targets;
6. expects `33` everywhere.

## 5. Basic commands

### Check

```powershell
hs check examples/calculate.hs
hs check local/calculate.hs --profile profiles/my-syntax.json
```

### Build a target

```powershell
hs build examples/calculate.hs --target rust --entry calculate
hs build examples/calculate.hs --target csharp --entry calculate --run --args 10,true
```

Generated projects are written under `build/<program>/<target>/` by default. They are ordinary projects; the target's own tools compile and run them.

### Run the full conformance suite

```powershell
hs test --all-targets
```

Reports are written to `reports/conformance.json` and `reports/conformance.md`.

- exit 0: all executed checks passed;
- exit 1: a case, build, run, or negative check failed;
- exit 2: at least one target was blocked.

`hs test --quick` checks the reference interpreter and profile structure only. Its report is explicitly labelled **interpreter-only**.

## 6. Personal syntax workflow

### Export

```powershell
hs syntax export examples/calculate.hs `
  --profile profiles/my-syntax.json `
  --out local/calculate.hs
```

This writes `local/calculate.hs` plus `local/calculate.hs.manifest.json`. The manifest records the canonical and profile fingerprints.

### Edit

Edit `local/calculate.hs` in the personal notation, for example:

```text
function calculate(x: i32, bonus: bool) -> i32 {
    value base: i32 = x * 3;

    when bonus {
        give base + 3;
    }

    give base;
}
```

### Check the personal file

```powershell
hs check local/calculate.hs --profile profiles/my-syntax.json
```

Diagnostics point to the personal file's line and column.

### Reimport

```powershell
hs syntax import local/calculate.hs
```

Preview first with `--dry-run`. Reimport rejects:

- a canonical file that changed since export (`E_IMPORT_STALE_BASE`);
- a profile whose contents changed since export (`E_IMPORT_PROFILE_CHANGED`);
- a manifest belonging to another personal file;
- a personal file that no longer parses or checks.

After a successful import the manifest is refreshed, so the next edit/import cycle can proceed without re-exporting.

## 7. Create your own profile without touching the compiler

Copy a profile and change its `id` and seven `keywords` values:

```powershell
Copy-Item profiles/casual.json profiles/my-profile.json
```

Keep `"version": "1"`, `"core": "0.1"`, and `"family": "braces"`. Choose distinct words that do not collide with `i32` or `bool`, and do not reassign a canonical keyword to a different role. Then export canonical source into that notation before checking or editing it:

```powershell
hs syntax export examples/calculate.hs --profile profiles/my-profile.json --out local/my.hs
hs check local/my.hs --profile profiles/my-profile.json
hs build local/my.hs --profile profiles/my-profile.json --target rust --entry calculate
```

Profile validation errors identify the exact problem. Checking canonical source directly with a personal profile is rejected because canonical source uses the standard keyword spellings.

## 8. Visual Studio Code extension

Build and install the extension from the repository root:

```powershell
npm install
npm run vscode:install
```

This packages the VSIX and installs it. The installer suppresses an upstream VS Code 1.143 CLI deprecation warning from `url.parse()`; the h# extension bundle does not use that API.

Restart VS Code, open any `.hs` file, then run **h#: Show Generated Code** from the command palette or use the editor-title button. The preview updates as you type and switches between C#, Rust, Go, and Java.

The extension bundles the compiler into the extension host. No `hs` command or Node subprocess is needed at runtime.

For development, build with `npm run vscode:build`, open `editors/vscode` in VS Code, and press F5.

Full details: [`editors/vscode/README.md`](../editors/vscode/README.md).

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| `E_RESERVED_WORD` | A canonical keyword such as `let` was used as an identifier under a remapped profile |
| `E_PROFILE_RESERVED_KEYWORD` | A profile reassigns a canonical keyword or uses `i32`/`bool` |
| `E_PROFILE_IDENTIFIER_COLLISION` | A program identifier equals a target profile's keyword word |
| `E_IMPORT_STALE_BASE` | Canonical source changed after export; re-export or rebase manually |
| `E_IMPORT_PROFILE_CHANGED` | Profile file changed after export |
| Target blocked | Toolchain missing or too old; run `hs doctor` |
| Java unreachable-code error | Should not occur; report as a compiler defect (dead code is omitted) |
