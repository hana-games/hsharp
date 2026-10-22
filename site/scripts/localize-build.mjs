import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { loadLocale } from "./i18n-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const dist = join(site, "dist");
const dictionaries = {
  fr: loadLocale("fr"),
  ja: loadLocale("ja"),
};

const skipTags = new Set(["script", "style", "pre", "code", "textarea", "astro-island"]);
const attrs = ["placeholder", "aria-label", "title", "alt"];

const pages = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "fr" || entry.name === "ja") continue;
      walk(full);
    } else if (full.endsWith(".html")) {
      pages.push(full);
    }
  }
}
walk(dist);

function translateTextNode(node, dict) {
  if (!node.data) return;
  const raw = node.data;
  const core = raw.trim();
  if (!core) return;
  const translated = dict[core];
  if (!translated || translated === core) return;
  const leading = raw.match(/^\s*/)?.[0] ?? "";
  const trailing = raw.match(/\s*$/)?.[0] ?? "";
  node.data = `${leading}${translated}${trailing}`;
}

function translateNode(node, dict) {
  if (node.type === "text") {
    translateTextNode(node, dict);
    return;
  }
  if (!node.children) return;
  if (node.name && skipTags.has(node.name)) return;
  if (node.attribs && "data-i18n-skip" in node.attribs) return;
  for (const child of node.children) translateNode(child, dict);
}

function translateAttributes($, dict) {
  for (const attr of attrs) {
    $(`[${attr}]`).each((_, element) => {
      if ($(element).closest("astro-island").length > 0) return;
      const value = $(element).attr(attr);
      const translated = value ? dict[value] : undefined;
      if (translated && translated !== value) $(element).attr(attr, translated);
    });
  }
  $('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]').each((_, element) => {
    const value = $(element).attr("content");
    const translated = value ? dict[value] : undefined;
    if (translated && translated !== value) $(element).attr("content", translated);
  });
}

function prefixPath(href, locale) {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  if (/^\/(_astro|brands|i18n|favicon\.svg|robots\.txt)/.test(href)) return href;
  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(href);
  if (!match) return href;
  const [, pathname, query = "", hash = ""] = match;
  if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) return href;
  const prefixed = pathname === "/" ? `/${locale}/` : `/${locale}${pathname}`;
  return `${prefixed}${query}${hash}`;
}

function pagePath(file) {
  const rel = relative(dist, file).split("\\").join("/");
  if (rel === "index.html") return "/";
  if (rel === "404.html") return "/404.html";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"/index.html".length)}`;
  return `/${rel.replace(/\.html$/, "")}`;
}

for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const basePath = pagePath(file);

  for (const [locale, dict] of Object.entries(dictionaries)) {
    const islands = [];
    const withoutIslands = html.replace(/<astro-island\b[\s\S]*?<\/astro-island>/g, (block) => {
      const index = islands.push(block) - 1;
      return `<div data-island-placeholder="${index}"></div>`;
    });

    const $ = cheerio.load(withoutIslands, { decodeEntities: false });
    $("html").attr("lang", locale);
    translateNode($("html")[0], dict);
    translateAttributes($, dict);

    $("a[href]").each((_, element) => {
      if ($(element).attr("data-locale")) return;
      const href = $(element).attr("href");
      if (href) $(element).attr("href", prefixPath(href, locale));
    });

    $("a[data-locale]").each((_, element) => {
      const target = $(element).attr("data-locale");
      const href = target === "en" ? basePath : `/${target}${basePath === "/" ? "/" : basePath}`;
      $(element).attr("href", href);
      $(element).toggleClass("active", target === locale);
    });

    let outputHtml = $.html();
    outputHtml = outputHtml.replace(
      /<div data-island-placeholder="(\d+)"><\/div>/g,
      (_, index) => islands[Number(index)] ?? "",
    );

    const relativePath = relative(dist, file);
    const output = join(dist, locale, relativePath);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, outputHtml, "utf8");
  }
}

console.log(`i18n: localized ${pages.length} pages into fr/ and ja/`);
