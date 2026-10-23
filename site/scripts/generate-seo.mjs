import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const dist = join(site, "dist");
const SITE_URL = "https://hsharp.dev";
const lastmod = new Date().toISOString().slice(0, 10);

const pages = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "fr" || entry.name === "ja") continue;
      walk(full);
    } else if (entry.name === "index.html") {
      pages.push(full);
    }
  }
}
walk(dist);

function routeFor(file) {
  const rel = relative(dist, file).split("\\").join("/");
  if (rel === "index.html") return "/";
  return `/${rel.slice(0, -"index.html".length)}`;
}

function localized(route, locale) {
  return locale === "en" ? route : `/${locale}${route}`;
}

const urls = pages
  .map((file) => routeFor(file))
  .filter((route) => route !== "/404/")
  .sort((a, b) => a.localeCompare(b));

const entries = urls
  .flatMap((route) =>
    ["en", "fr", "ja"].map((locale) => {
      const alternates = ["en", "fr", "ja"]
        .map((alternate) => `    <xhtml:link rel="alternate" hreflang="${alternate}" href="${SITE_URL}${localized(route, alternate)}" />`)
        .join("\n");
      return `  <url>
    <loc>${SITE_URL}${localized(route, locale)}</loc>
    <lastmod>${lastmod}</lastmod>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${route}" />
  </url>`;
    }),
  )
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>
`;

writeFileSync(join(dist, "sitemap.xml"), xml, "utf8");
console.log(`seo: ${urls.length} routes, ${urls.length * 3} localized URLs, sitemap written`);
