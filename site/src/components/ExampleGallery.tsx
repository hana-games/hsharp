import { useEffect, useMemo, useState } from "react";
import type { Example, Outcome } from "../data/types";
import { useT } from "../i18n/runtime";
import { tokenize } from "../lib/highlight";
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

function FeatureIcon({ feature, size = 13 }: { feature: string; size?: number }) {
  let shape;
  switch (feature) {
    case "All":
      shape = (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1.2" />
          <rect x="14" y="3" width="7" height="7" rx="1.2" />
          <rect x="3" y="14" width="7" height="7" rx="1.2" />
          <rect x="14" y="14" width="7" height="7" rx="1.2" />
        </>
      );
      break;
    case "Showcase":
      shape = <path d="M12 3l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.9L12 3z" />;
      break;
    case "Functions":
      shape = (
        <>
          <path d="M8 8l-4 4 4 4" />
          <path d="M16 8l4 4-4 4" />
        </>
      );
      break;
    case "Expressions":
      shape = (
        <>
          <path d="M6 5h12" />
          <path d="M6 5l6 7-6 7h12" />
        </>
      );
      break;
    case "Core":
      shape = (
        <>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
        </>
      );
      break;
    case "Checked arithmetic":
      shape = (
        <>
          <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </>
      );
      break;
    case "Short-circuit":
      shape = <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />;
      break;
    case "Control flow":
      shape = (
        <>
          <path d="M6 4v8a4 4 0 004 4h8" />
          <path d="M15 13l3 3-3 3" />
          <circle cx="6" cy="4" r="1" />
        </>
      );
      break;
    case "Portable names":
      shape = (
        <>
          <path d="M4 4h8l8 8-8 8-8-8V4z" />
          <circle cx="8" cy="8" r="1" />
        </>
      );
      break;
    default:
      shape = (
        <>
          <path d="M8 9l-3 3 3 3" />
          <path d="M16 9l3 3-3 3" />
        </>
      );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

function OutcomeIcon({ status }: { status: "ok" | "error" }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      {status === "ok" ? <path d="M8 12l3 3 5-6" /> : <path d="M12 7v6M12 17h.01" />}
    </svg>
  );
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
      <div className="gallery-head">
        <div>
          <h1 className="gallery-title">{t("Examples")}</h1>
          <p className="gallery-subtitle">
            {t("Every case comes from the repository’s real conformance corpus.")}
          </p>
        </div>
        <span className="chip chip-lime">{filtered.length} {t("examples")}</span>
      </div>

      <div className="gallery-toolbar">
        <div className="gallery-search">
          <SearchIcon />
          <input
            type="search"
            placeholder={t("Search examples…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("Search examples")}
          />
        </div>
        <div className="gallery-filters" role="group" aria-label={t("Filter examples")}>
          {features.map((item) => (
            <button
              key={item}
              type="button"
              className={`tab ${feature === item ? "active" : ""}`}
              onClick={() => setFeature(item)}
            >
              <FeatureIcon feature={item} />
              <span>{item === "All" ? t("All") : t(item)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="gallery-grid">
        {filtered.map((example) => {
          const code = example.profiles.standard?.code ?? example.source;
          const preview = code.split("\n").slice(0, 8).join("\n");
          const tokens = tokenize(preview, "hsharp", example.profiles.standard?.keywords);
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
                <span className="example-feature">
                  <FeatureIcon feature={example.feature} />
                  {t(example.feature)}
                </span>
                <span className={example.expected.status === "error" ? "error-text" : "success-text"}>
                  <OutcomeIcon status={example.expected.status} />
                  {outcomeLabel(example.expected)}
                </span>
              </div>
              <h3>{prettyId(example.id)}</h3>
              <p>{example.notes || `Entry: ${example.entry ?? "inferred"} · ${example.program}`}</p>
              <pre className="example-preview">
                <code>
                  {tokens.map((token, index) =>
                    token.type === "plain" ? (
                      token.text
                    ) : (
                      <span key={index} className={`tok-${token.type}`}>
                        {token.text}
                      </span>
                    ),
                  )}
                </code>
              </pre>
              <span className="example-card-open">{t("Open example")} <span>→</span></span>
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
                <div className="example-feature">
                  <FeatureIcon feature={selected.feature} />
                  {t(selected.feature)}
                </div>
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
                    keywords={selected.profiles[profileId]?.keywords}
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
                      <span className="chip chip-cpp">C++</span>
                      <span className="chip chip-javascript">JavaScript</span>
                    </div>
                    <p className="hint" style={{ marginTop: "0.8rem" }}>
                      {t("Same source, same expected outcome, six compilers. The full matrix is available in the conformance explorer.")}
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
