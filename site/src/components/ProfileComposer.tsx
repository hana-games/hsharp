import { useEffect, useMemo, useState } from "react";
import type { ProfileKeywords } from "../data/types";
import { profiles, roleLabels } from "../lib/site";
import { useT } from "../i18n/runtime";
import { CodeBlock } from "./CodeBlock";

const STORAGE_KEY = "hsharp.profile-composer.v1";

const sample = `// One program, a different surface.
fn calculate(x: i32, bonus: bool) -> i32 {
    let base: i32 = x * 3;

    if bonus {
        return base + 2;
    }

    return base;
}
`;

const canonical: Record<keyof ProfileKeywords, string> = {
  fn: "fn",
  let: "let",
  if: "if",
  else: "else",
  return: "return",
  true: "true",
  false: "false",
};

type ErrorCode = "empty" | "letters" | "reserved" | "duplicate" | "canonical";
type Errors = Partial<Record<keyof ProfileKeywords, ErrorCode>>;
type OutputTab = "preview" | "json";

function validate(keywords: ProfileKeywords): { errors: Errors; valid: boolean; rules: {
  letters: boolean;
  unique: boolean;
  reserved: boolean;
  complete: boolean;
} } {
  const errors: Errors = {};
  const seen = new Map<string, keyof ProfileKeywords>();
  let letters = true;
  let unique = true;
  let reserved = true;
  let complete = true;

  for (const { role } of roleLabels) {
    const word = keywords[role].trim();
    if (word.length === 0) {
      errors[role] = "empty";
      complete = false;
      letters = false;
      continue;
    }
    if (!/^[A-Za-z]+$/.test(word)) {
      errors[role] = "letters";
      letters = false;
      continue;
    }
    if (word === "i32" || word === "bool") {
      errors[role] = "reserved";
      reserved = false;
      continue;
    }
    for (const other of roleLabels) {
      if (other.role !== role && canonical[other.role] === word) {
        errors[role] = "canonical";
        reserved = false;
        break;
      }
    }
    const previous = seen.get(word);
    if (previous) {
      errors[role] = "duplicate";
      errors[previous] = "duplicate";
      unique = false;
    } else {
      seen.set(word, role);
    }
  }

  return {
    errors,
    valid: Object.keys(errors).length === 0,
    rules: { letters, unique, reserved, complete },
  };
}

function applyKeywords(code: string, keywords: ProfileKeywords): string {
  const roleOf = new Map<string, keyof ProfileKeywords>();
  for (const { role } of roleLabels) roleOf.set(canonical[role], role);

  let output = "";
  let i = 0;
  while (i < code.length) {
    if (code[i] === "/" && code[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < code.length && code[i] !== "\n") i++;
      output += code.slice(start, i);
      continue;
    }

    if (/[A-Za-z_]/.test(code[i])) {
      const start = i;
      i++;
      while (i < code.length && /[A-Za-z0-9_]/.test(code[i])) i++;
      const word = code.slice(start, i);
      const role = roleOf.get(word);
      output += role ? keywords[role] : word;
      continue;
    }

    output += code[i];
    i++;
  }
  return output;
}

export function ProfileComposer() {
  const t = useT();
  const [keywords, setKeywords] = useState<ProfileKeywords>({ ...profiles[1].keywords });
  const [presetId, setPresetId] = useState("my-syntax");
  const [outputTab, setOutputTab] = useState<OutputTab>("preview");
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { keywords?: ProfileKeywords; presetId?: string };
        if (parsed.keywords) {
          setKeywords(parsed.keywords);
          setPresetId(parsed.presetId ?? "custom");
        }
      }
    } catch {
      // Ignore malformed local drafts.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ keywords, presetId }));
    } catch {
      // Storage can be disabled; the composer still works for this session.
    }
  }, [keywords, presetId, ready]);

  const validation = useMemo(() => validate(keywords), [keywords]);
  const code = useMemo(
    () => (validation.valid ? applyKeywords(sample, keywords) : ""),
    [keywords, validation.valid],
  );
  const profileJson = useMemo(
    () =>
      JSON.stringify(
        {
          id: "custom",
          version: "1",
          core: "0.1",
          family: "braces",
          keywords,
        },
        null,
        2,
      ),
    [keywords],
  );

  function selectPreset(id: string) {
    const preset = profiles.find((profile) => profile.id === id);
    if (!preset) return;
    setKeywords({ ...preset.keywords });
    setPresetId(preset.id);
  }

  async function copyProfile() {
    try {
      await navigator.clipboard.writeText(profileJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  function reset() {
    setKeywords({ ...profiles[0].keywords });
    setPresetId(profiles[0].id);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  function setWord(role: keyof ProfileKeywords, value: string) {
    setKeywords((current) => ({ ...current, [role]: value }));
    setPresetId("custom");
  }

  const activePreset = profiles.find((profile) => profile.id === presetId);

  return (
    <div className="lab">
      <div className="lab-head">
        <div className="lab-title">{t("Profile composer")}</div>
        <div className="row">
          <span className={`config-save ${validation.valid ? "ok" : "warn"}`}>
            <span className="status-dot" />
            {validation.valid ? t("Saved in this browser") : t("Profile invalid")}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>
            {t("Reset")}
          </button>
        </div>
      </div>

      <div className="profile-config">
        <aside className="profile-presets">
          <div className="config-kicker">{t("Presets")}</div>
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`preset-button ${presetId === profile.id ? "active" : ""}`}
              onClick={() => selectPreset(profile.id)}
            >
              <span className="preset-dot" />
              <span>
                <strong>{profile.label}</strong>
                <small>{t(profile.note)}</small>
              </span>
            </button>
          ))}
          <button
            type="button"
            className={`preset-button custom ${presetId === "custom" ? "active" : ""}`}
            onClick={() => setPresetId("custom")}
          >
            <span className="preset-dot" />
            <span>
              <strong>{t("Your profile")}</strong>
              <small>{activePreset ? t("Edited from") + " " + activePreset.label : t("Local draft")}</small>
            </span>
          </button>
        </aside>

        <div className="config-workbench">
          <div className="config-workbench-head">
            <div>
              <div className="config-kicker">{t("Configuration")}</div>
              <h3>{t("Seven keyword roles")}</h3>
              <p>{t("Only the seven keyword roles change. Types, operators, grammar, and meaning stay fixed.")}</p>
            </div>
            <button type="button" className="btn btn-sm btn-lime" onClick={copyProfile} disabled={!validation.valid}>
              {copied ? t("Copied") : t("Copy profile")}
            </button>
          </div>

          <div className="config-table" role="table" aria-label={t("Keyword roles")}>
            <div className="config-row config-row-head" role="row">
              <span>{t("Role")}</span>
              <span>{t("Canonical")}</span>
              <span>{t("Your word")}</span>
              <span>{t("Status")}</span>
            </div>
            {roleLabels.map(({ role, description }) => {
              const error = validation.errors[role];
              return (
                <div className={`config-row ${error ? "has-error" : ""}`} role="row" key={role}>
                  <span className="config-role">
                    <code>{role}</code>
                    <small>{t(description)}</small>
                  </span>
                  <code className="config-canonical">{canonical[role]}</code>
                  <input
                    aria-label={`${role} ${t("Your word")}`}
                    className="config-input"
                    value={keywords[role]}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => setWord(role, event.target.value)}
                  />
                  <span className={`config-status ${error ? "error" : "ok"}`}>
                    <span className="status-dot" />
                    {error ? t(errorMessage(error)) : t("valid")}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="config-rules">
            <Rule ok={validation.rules.complete} label={t("All seven roles are present")} />
            <Rule ok={validation.rules.letters} label={t("Letters only")} />
            <Rule ok={validation.rules.unique} label={t("Words are unique")} />
            <Rule ok={validation.rules.reserved} label={t("No reserved word or type name")} />
          </div>

          <div className="config-output">
            <div className="config-output-head">
              <div className="tabs">
                <button
                  type="button"
                  className={`tab ${outputTab === "preview" ? "active" : ""}`}
                  onClick={() => setOutputTab("preview")}
                >
                  {t("Preview")}
                </button>
                <button
                  type="button"
                  className={`tab ${outputTab === "json" ? "active" : ""}`}
                  onClick={() => setOutputTab("json")}
                >
                  {t("Profile JSON")}
                </button>
              </div>
              <span className="config-save-note">{t("Stored locally in this browser")}</span>
            </div>

            {outputTab === "preview" ? (
              validation.valid ? (
                <CodeBlock
                  code={code}
                  language="hsharp"
                  keywords={keywords}
                  title="custom.hs"
                  meta="profile custom"
                  showCopy={false}
                  maxHeight="330px"
                />
              ) : (
                <div className="config-empty">
                  {t("Fix the profile errors to see the transformed source.")}
                </div>
              )
            ) : (
              <pre className="config-json">{profileJson}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`config-rule ${ok ? "ok" : "error"}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

function errorMessage(code: ErrorCode): string {
  switch (code) {
    case "empty":
      return "Keyword cannot be empty.";
    case "letters":
      return "Only letters are allowed.";
    case "reserved":
      return "Type names i32 and bool are reserved.";
    case "duplicate":
      return "This word is already used for another role.";
    case "canonical":
      return "This is a canonical keyword for another role.";
  }
}
