(() => {
  const locale = document.documentElement.lang || "en";
  const basePath = location.pathname.replace(/^\/(fr|ja)(?=\/|$)/, "") || "/";

  const localeHref = (target) =>
    target === "en" ? basePath : `/${target}${basePath === "/" ? "/" : basePath}`;

  document.querySelectorAll("[data-locale]").forEach((link) => {
    const target = link.getAttribute("data-locale");
    if (!target) return;
    link.setAttribute("href", localeHref(target));
    link.classList.toggle("active", target === locale);
  });

  if (locale === "en") return;

  const skipTags = new Set(["SCRIPT", "STYLE", "PRE", "CODE", "TEXTAREA", "ASTRO-ISLAND"]);
  let dictionary = null;
  let applying = false;
  let scheduled = false;
  let observer = null;

  const inSkipped = (element) =>
    element &&
    (skipTags.has(element.tagName) ||
      element.hasAttribute("data-i18n-skip") ||
      element.closest?.("pre, code, script, style, textarea, astro-island, [data-i18n-skip]"));

  function translateText(node) {
    if (!node.data || inSkipped(node.parentElement)) return;
    const raw = node.data;
    const core = raw.trim();
    if (!core) return;
    const translated = dictionary[core];
    if (!translated || translated === core) return;
    const leading = raw.match(/^\s*/)?.[0] ?? "";
    const trailing = raw.match(/\s*$/)?.[0] ?? "";
    node.data = leading + translated + trailing;
  }

  function translateAttributes(root) {
    for (const attr of ["placeholder", "aria-label", "title", "alt"]) {
      root.querySelectorAll(`[${attr}]`).forEach((element) => {
        if (inSkipped(element)) return;
        const value = element.getAttribute(attr);
        const translated = value ? dictionary[value] : null;
        if (translated && translated !== value) element.setAttribute(attr, translated);
      });
    }
    root
      .querySelectorAll('meta[name="description"], meta[property="og:description"]')
      .forEach((element) => {
        const value = element.getAttribute("content");
        const translated = value ? dictionary[value] : null;
        if (translated && translated !== value) element.setAttribute("content", translated);
      });
  }

  function apply() {
    if (!dictionary || applying) return;
    applying = true;
    observer?.disconnect();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (inSkipped(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) translateText(node);
    translateAttributes(document.body);

    observer?.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "aria-label", "title", "alt"],
    });
    applying = false;
  }

  fetch(`/i18n/${locale}.json`)
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!data) return;
      dictionary = data;
      apply();
      if ("MutationObserver" in window) {
        observer = new MutationObserver(() => {
          if (scheduled || applying) return;
          scheduled = true;
          window.setTimeout(() => {
            scheduled = false;
            apply();
          }, 40);
        });
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["placeholder", "aria-label", "title", "alt"],
        });
      }
    })
    .catch(() => {
      // Static localization already covers the server-rendered text.
    });
})();
