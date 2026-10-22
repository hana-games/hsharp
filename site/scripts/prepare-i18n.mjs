import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const source = join(site, "src", "i18n");
const target = join(site, "public", "i18n");

mkdirSync(target, { recursive: true });
for (const locale of ["fr", "ja"]) {
  copyFileSync(join(source, `strings.${locale}.json`), join(target, `${locale}.json`));
}
console.log("i18n: runtime dictionaries copied to public/i18n");
