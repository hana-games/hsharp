import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocale, sourceLocales } from "./i18n-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const target = join(site, "public", "i18n");

mkdirSync(target, { recursive: true });
for (const locale of sourceLocales) {
  writeFileSync(join(target, `${locale}.json`), `${JSON.stringify(loadLocale(locale), null, 2)}\n`, "utf8");
}
console.log("i18n: namespace files merged into public/i18n runtime dictionaries");
