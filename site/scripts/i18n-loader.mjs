import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
export const i18nRoot = join(root, "src", "i18n");
export const sourceLocales = ["en", "fr", "ja"];

/** Loads and merges every namespace file for one locale. */
export function loadLocale(locale) {
  const dir = join(i18nRoot, locale);
  const merged = {};
  let files = [];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return merged;
  }
  for (const file of files) {
    Object.assign(merged, JSON.parse(readFileSync(join(dir, file), "utf8")));
  }
  return merged;
}

export function namespaceFiles(locale) {
  try {
    return readdirSync(join(i18nRoot, locale))
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}
