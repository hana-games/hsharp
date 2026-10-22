import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";

const pages = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "fr" || entry.name === "ja") continue;
      walk(full);
    } else if (full.endsWith(".html")) pages.push(full);
  }
}
walk("site/dist");

const skip = new Set(["script", "style", "pre", "code", "textarea"]);
const strings = new Set();
for (const page of pages) {
  const $ = cheerio.load(readFileSync(page, "utf8"), { decodeEntities: false });
  function walkNode(node) {
    if (node.type === "text") {
      const text = node.data.trim();
      if (text.length > 1 && /[A-Za-z\u00C0-\u024F]/.test(text)) strings.add(text);
      return;
    }
    if (!node.children) return;
    if (node.name && skip.has(node.name)) return;
    if (node.attribs?.["data-i18n-skip"]) return;
    for (const child of node.children) walkNode(child);
  }
  walkNode($("body")[0]);
  $("title").each((_, el) => {
    const text = $(el).text().trim();
    if (text) strings.add(text);
  });
  for (const attr of ["placeholder", "aria-label", "title", "alt"]) {
    $(`[${attr}]`).each((_, el) => {
      const text = $(el).attr(attr)?.trim();
      if (text) strings.add(text);
    });
  }
}
const entries = [...strings].sort();
const current = JSON.parse(readFileSync("site/src/i18n/strings.en.json", "utf8"));
const added = entries.filter((entry) => !(entry in current));
console.log("leaf entries", entries.length, "chars", entries.reduce((a, b) => a + b.length, 0));
console.log("new vs current", added.length, "chars", added.reduce((a, b) => a + b.length, 0));
console.log(added.slice(0, 25));

const missing = Object.fromEntries(added.map((text) => [text, text]));
const fs = await import("node:fs");
fs.writeFileSync("site/src/i18n/strings.missing.json", `${JSON.stringify(missing, null, 2)}\n`, "utf8");
