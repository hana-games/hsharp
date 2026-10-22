import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const output = resolve(root, "build", "vscode", "hsharp-vscode.vsix");
mkdirSync(dirname(output), { recursive: true });

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
void npx;
execFileSync(
  process.execPath,
  [
    resolve(root, "node_modules", "@vscode", "vsce", "vsce"),
    "package",
    "--no-dependencies",
    "--allow-missing-repository",
    "--skip-license",
    "--out",
    output,
  ],
  { cwd: here, stdio: "inherit" },
);

console.log(`VSIX written to ${output}`);
