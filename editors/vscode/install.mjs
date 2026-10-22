import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const vsix = resolve(root, "build", "vscode", "hsharp-vscode.vsix");

if (!existsSync(vsix)) {
  console.error(`VSIX not found: ${vsix}`);
  console.error("Run npm run vscode:package first.");
  process.exit(1);
}

const env = { ...process.env };
// VS Code 1.143's CLI uses url.parse() while refreshing extension metadata.
// The warning is upstream and harmless; suppress only the deprecation output.
env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --no-deprecation`.trim();

const result = spawnSync(`code --install-extension "${vsix}" --force`, {
  shell: true,
  stdio: "inherit",
  env,
});

process.exit(result.status ?? 1);
