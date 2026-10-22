import { useEffect, useState } from "react";

export type Locale = "en" | "fr" | "ja";

let cache: Record<string, string> | null = null;
let cacheLocale: string | null = null;

/**
 * Locale for client islands. The first render is always English to match the
 * server-rendered island markup; after hydration the locale dictionary is
 * fetched and the component re-renders in the active language.
 */
export function useT(): (text: string) => string {
  const [locale, setLocale] = useState<Locale>("en");
  const [dictionary, setDictionary] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    const active = document.documentElement.lang;
    if (active !== "fr" && active !== "ja") return;
    setLocale(active);
    if (cacheLocale === active && cache) {
      setDictionary(cache);
      return;
    }
    fetch(`/i18n/${active}.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        cache = data;
        cacheLocale = active;
        setDictionary(data);
      })
      .catch(() => {
        // Keep English labels if the dictionary is unavailable.
      });
  }, []);

  return (text: string) => {
    if (locale === "en" || !dictionary) return text;
    return dictionary[text] ?? text;
  };
}
