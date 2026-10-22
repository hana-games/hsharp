import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "dist");

if (!existsSync(root)) {
  console.error("site/dist is missing; run npm run site:build first.");
  process.exit(1);
}

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.endsWith(".html")) files.push(full);
  }
}
walk(root);

const broken = [];
for (const file of files) {
  const html = readFileSync(file, "utf8");
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    let href = match[1];
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    href = href.split("#")[0].split("?")[0];
    if (!href) continue;
    let target = join(root, href);
    if (href.endsWith("/")) target = join(target, "index.html");
    if (!existsSync(target)) broken.push([file, href]);
  }
}

if (broken.length > 0) {
  console.error(`broken internal links: ${broken.length}`);
  for (const [file, href] of broken) console.error(`  ${file} -> ${href}`);
  process.exit(1);
}

console.log(`site links: ${files.length} HTML pages, 0 broken internal links`);
