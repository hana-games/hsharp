# h# for Visual Studio

Visual Studio extension for **h#** (`.hs`) files:

- syntax highlighting driven by the active profile;
- live compiler diagnostics as editor squiggles;
- a **real-time generated-code preview** for C#, Rust, Go, and Java;
- target switching without recompiling the source;
- live updates while typing, with a configurable debounce.

The extension does not embed a second compiler. It starts one persistent `hs bridge` process and sends the current document over line-delimited JSON. The bridge performs parsing, checking, and all four code-generation steps in-process.

## Requirements

| Requirement | Version / notes |
|---|---|
| Visual Studio | 2022 or 2026, x64 |
| .NET Framework | 4.7.2 targeting pack (restored by NuGet reference assemblies) |
| .NET SDK | 10 or later, for building the VSIX with `dotnet build` |
| Node.js | 22 or later |
| h# CLI | Build and link the repository first |
| VS workload | Visual Studio extension development (for IDE debugging) |

Set up the compiler from the repository root:

```powershell
npm install
npm run build
npm link
hs doctor
```

`npm link` installs the `hs`, `hsharp`, and `hcharp` commands.

## Build

```powershell
# from the repository root
npm run vsix
```

Equivalent:

```powershell
dotnet build editors/visual-studio/HSharp.VisualStudio.csproj -c Release
```

Output:

```text
editors/visual-studio/bin/Release/net472/HSharp.VisualStudio.vsix
```

The build was verified with Visual Studio 18 Build Tools and the VS SDK 17.14 packages. It produces a VSIX containing the extension assembly, its pkgdef, the manifest, and `Newtonsoft.Json.dll`.

## Install

Double-click the `.vsix` file, or:

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\VSIXInstaller.exe" `
  "editors\visual-studio\bin\Release\net472\HSharp.VisualStudio.vsix"
```

Select the Visual Studio instance to install into. Restart Visual Studio.

## Configure

Open **Tools > Options > h# > General**.

| Setting | Default | Meaning |
|---|---|---|
| h# command | `hs` | Command that starts the CLI |
| Command arguments | `bridge` | Arguments after the command |
| Working directory | empty | Optional bridge process working directory |
| Profile path | empty | Optional profile JSON; empty uses standard syntax |
| Debounce (ms) | `150` | Delay after the last edit before analysis/preview |

Settings are stored in `%LOCALAPPDATA%\hsharp\editor.json`, so MEF components can read them without forcing the package to load at startup.

If `hs` is not on `PATH`, set the command to the absolute path of `hs.cmd`, or use:

```text
Command:  node
Arguments: C:\path\to\hsharp\dist\cli\index.js bridge
```

The command is launched through `cmd.exe` on Windows, so `.cmd` shims work normally.

## Use

1. Open a `.hs` file. Visual Studio maps the extension to the `hsharp` content type.
2. Choose **View > Other Windows > h# Generated Code**.
3. Edit the file. Diagnostics refresh after the debounce; the preview regenerates all four targets.
4. Switch the **Target** dropdown between C#, Rust, Go, and Java.
5. Use **Copy** to copy the displayed generated project files.
6. Uncheck **Live** to freeze updates; **Refresh** updates on demand.

The status line shows the entry function, function count, total analysis + generation time, and diagnostic count.

## What each component does

| Component | Responsibility |
|---|---|
| `Editor/HSharpContentType.cs` | Defines the `hsharp` content type and `.hs` extension |
| `Editor/HSharpClassifier.cs` | Tokenizes visible lines for keyword, comment, and number highlighting; reads the profile keyword map |
| `Editor/HSharpErrorTagger.cs` | Debounces buffer changes, calls the bridge, and publishes error tags at source spans |
| `Editor/ActiveDocumentTracker.cs` | Tracks the focused h# document for the preview window |
| `Bridge/BridgeClient.cs` | Supervises one persistent `hs bridge` process and correlates JSON responses |
| `Preview/PreviewControl.cs` | Tool-window UI, target selection, status, and generated-code rendering |
| `HSharpPackage.cs` | VS package, tool-window registration, and options page |

## Bridge protocol

The extension sends one JSON object per line on stdin and receives one per line on stdout.

Request:

```json
{"id":1,"command":"analyze","text":"fn main() -> i32 { return 1; }","file":"a.hs","profilePath":null,"entry":null,"targets":["csharp","rust","go","java"]}
```

Response:

```json
{
  "id": 1,
  "ok": true,
  "command": "analyze",
  "diagnostics": [],
  "functions": ["main"],
  "entry": "main",
  "timings": {"parseMs":0.1,"checkMs":0.05,"entryMs":0.01,"emitMs":0.2,"totalMs":0.36},
  "generated": [{"target":"csharp","files":[{"path":"HsProgram.csproj","content":"..."}]}]
}
```

A diagnostics-only request omits `targets` (or sends an empty array).

## Performance

The bridge avoids Node startup cost per keystroke. Measured on the development machine (Node 24.21.0, Windows x64):

| Operation | Observed |
|---|---:|
| Analyze 246-char document | 0.03–0.09 ms |
| Analyze 500 functions (57 KB) | 15–35 ms |
| Generate all four targets, small document | 0.04–0.27 ms |
| Analyze + generate all four, small document | 0.05–0.27 ms |
| Bridge round-trip including C# generation | 0.4–3 ms |

The first request after process start includes Node startup (~50–100 ms). Reproduce with `npm run bench`; results are written to `reports/benchmark.json`. The compiler currently reparses the whole document; that is already within a 60 fps frame budget for normal files, and a context-free parser makes later incremental parsing straightforward.

## Limitations

- **Runtime integration was not executed here**: the machine has Visual Studio Build Tools but no Visual Studio IDE. The VSIX builds cleanly and contains the correct package/MEF assets, but editor interaction must be verified in a full Visual Studio installation.
- VSIX targets Visual Studio 2022–2026 x64. ARM64 is not packaged.
- `.hs` is also used by Haskell. If another extension claims the extension, set the file association manually or use an h#-specific extension in a future release.
- Preview updates require the h# CLI to be reachable. If the bridge cannot start, diagnostics show the startup error.
- No completion, go-to-definition, code actions, debugging, or project-system integration yet.
- The preview is read-only and shows generated files concatenated with path headers.
- Build/run commands from inside Visual Studio are not implemented; use `hs build` in a terminal.

## Troubleshooting

| Symptom | Check |
|---|---|
| No squiggles | Open a `.hs` file and confirm the extension is installed; check **Tools > Options > h#** |
| "bridge unavailable" | Run `hs bridge` manually; verify `hs`/`node` path in options |
| Preview stays empty | Ensure the program has an inferable entry (`main` or a single function) or resolve diagnostics |
| Wrong keywords highlighted | Check the profile path; click Refresh after changing profiles |
| VSIX build fails | Install the .NET SDK 10 and Visual Studio extension development workload |
