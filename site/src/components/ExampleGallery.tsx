import { useEffect, useMemo, useState } from "react";
import type { Example, Outcome } from "../data/types";
import { useT } from "../i18n/runtime";
import { CodeBlock } from "./CodeBlock";

interface Props {
  examples: Example[];
}

function prettyId(id: string): string {
  return id
    .split("-")
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function outcomeLabel(outcome: Outcome): string {
  if (outcome.status === "ok") {
    return `ok · ${outcome.type} ${String(outcome.value)}`;
  }
  return `error · ${outcome.code ?? "failure"}`;
}

export function ExampleGallery({ examples }: Props) {
  const t = useT();
  const [feature, setFeature] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Example | null>(null);
  const [profileId, setProfileId] = useState("standard");

  const features = useMemo(() => {
    const counts = new Map<string, number>();
    for (const example of examples) counts.set(example.feature, (counts.get(example.feature) ?? 0) + 1);
    return ["All", ...Array.from(counts.keys()).sort()];
  }, [examples]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return examples.filter((example) => {
      if (feature !== "All" && example.feature !== feature) return false;
      if (!needle) return true;
      return (
        example.id.toLowerCase().includes(needle) ||
        example.notes.toLowerCase().includes(needle) ||
        example.feature.toLowerCase().includes(needle)
      );
    });
  }, [examples, feature, query]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("example");
    if (!id) return;
    const found = examples.find((example) => example.id === id);
    if (found) {
      setSelected(found);
      setProfileId("standard");
    }
  }, [examples]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelected(null);
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openExample(example: Example) {
    setSelected(example);
    setProfileId("standard");
    window.history.replaceState(null, "", `${window.location.pathname}?example=${example.id}`);
  }

  function closeExample() {
    setSelected(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  return (
    <>
      <div className="gallery-toolbar">
        <div className="gallery-filters" aria-label="Filter examples">
          {features.map((item) => (
            <button
              key={item}
              type="button"
              className={`tab ${feature === item ? "active" : ""}`}
              onClick={() => setFeature(item)}
            >
              {item === "All" ? t("All") : item}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder={t("Search examples…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search examples"
          style={{
            minWidth: "210px",
            minHeight: "34px",
            padding: "0.35rem 0.65rem",
            border: "1px solid var(--line-strong)",
            borderRadius: "6px",
            background: "var(--white)",
            fontFamily: "var(--mono)",
            fontSize: "0.72rem",
          }}
        />
      </div>

      <div className="row" style={{ marginBottom: "1rem" }}>
        <span className="chip chip-lime">{filtered.length} {t("examples")}</span>
        <span className="small">{t("Every case comes from the repository’s real conformance corpus.")}</span>
      </div>

      <div className="gallery-grid">
        {filtered.map((example) => {
          const code = example.profiles.standard?.code ?? example.source;
          const preview = code.split("\n").slice(0, 8).join("\n");
          return (
            <button
              key={example.id}
              type="button"
              className="example-card"
              onClick={() => {
                openExample(example);
              }}
            >
              <div className="example-meta">
                <span>{example.feature}</span>
                <span className={example.expected.status === "error" ? "error-text" : "success-text"}>
                  {outcomeLabel(example.expected)}
                </span>
              </div>
              <h3>{prettyId(example.id)}</h3>
              <p>{example.notes || `Entry: ${example.entry ?? "inferred"} · ${example.program}`}</p>
              <pre className="example-preview">{preview}</pre>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && <p className="hint">{t("No example matches this filter.")}</p>}

      {selected && (
        <div
          className="example-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeExample();
          }}
        >
          <div className="example-drawer" role="dialog" aria-modal="true" aria-labelledby="example-title">
            <div className="example-drawer-head">
              <div>
                <div className="eyebrow">{selected.feature}</div>
                <h2 className="h3" id="example-title">{prettyId(selected.id)}</h2>
                <p className="small" style={{ marginTop: "0.25rem" }}>
                  {selected.notes || `Entry: ${selected.entry ?? "inferred"} · ${selected.program}`}
                </p>
              </div>
              <div className="row">
                <div className="tabs">
                  {Object.values(selected.profiles).map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={`tab ${profile.id === profileId ? "active" : ""}`}
                      onClick={() => setProfileId(profile.id)}
                    >
                      {profile.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="close-button" aria-label="Close" onClick={closeExample}>
                  ×
                </button>
              </div>
            </div>

            <div className="example-drawer-body">
              <div className="grid grid-2">
                <div>
                  <CodeBlock
                    code={selected.profiles[profileId]?.code ?? selected.source}
                    language="hsharp"
                    keywords={profileId === "my-syntax" ? {
                      fn: "function", let: "value", if: "when", else: "otherwise",
                      return: "give", true: "yes", false: "no",
                    } : undefined}
                    title={profileId === "my-syntax" ? "example.personal.hs" : "example.hs"}
                    meta={selected.profiles[profileId]?.label ?? profileId}
                    maxHeight="420px"
                  />
                </div>
                <div className="stack">
                  <div className="card">
                    <div className="eyebrow">{t("Expected outcome")}</div>
                    <div className={`output-badge ${selected.expected.status === "ok" ? "ok" : "error"}`} style={{ marginTop: "0.6rem" }}>
                      <span className="status-dot" />
                      {outcomeLabel(selected.expected)}
                    </div>
                    <div className="manifest">
                      <div><span>entry</span><span>{selected.entry ?? "inferred"}</span></div>
                      <div><span>arguments</span><span>{selected.args.length ? JSON.stringify(selected.args) : "none"}</span></div>
                      <div><span>program</span><span>{selected.program}</span></div>
                    </div>
                  </div>
                  <div className="card">
                    <div className="eyebrow">{t("Verified targets")}</div>
                    <div className="row" style={{ marginTop: "0.6rem" }}>
                      <span className="chip chip-csharp">C#</span>
                      <span className="chip chip-rust">Rust</span>
                      <span className="chip chip-go">Go</span>
                      <span className="chip chip-java">Java</span>
                    </div>
                    <p className="hint" style={{ marginTop: "0.8rem" }}>
                      {t("Same source, same expected outcome, four compilers. The full matrix is available in the conformance explorer.")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
