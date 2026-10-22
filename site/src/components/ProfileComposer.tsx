import { useMemo, useState } from "react";
import type { ProfileKeywords } from "../data/types";
import { profiles, roleLabels } from "../lib/site";
import { CodeBlock } from "./CodeBlock";

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

type Errors = Partial<Record<keyof ProfileKeywords, string>>;

function validate(keywords: ProfileKeywords): Errors {
  const errors: Errors = {};
  const seen = new Map<string, keyof ProfileKeywords>();

  for (const { role } of roleLabels) {
    const word = keywords[role].trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) {
      errors[role] = "Use letters, digits, or underscore; no leading digit.";
      continue;
    }
    if (word === "i32" || word === "bool") {
      errors[role] = "Type names are reserved by the core.";
      continue;
    }
    for (const other of roleLabels) {
      if (other.role !== role && canonical[other.role] === word) {
        errors[role] = `"${word}" is the canonical keyword for ${other.role}.`;
        break;
      }
    }
    const previous = seen.get(word);
    if (previous) {
      errors[role] = `"${word}" is already used for ${previous}.`;
      errors[previous] = `"${word}" is already used for ${role}.`;
    } else {
      seen.set(word, role);
    }
  }

  return errors;
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
  const [keywords, setKeywords] = useState<ProfileKeywords>({ ...profiles[1].keywords });
  const [copied, setCopied] = useState(false);

  const errors = useMemo(() => validate(keywords), [keywords]);
  const valid = Object.keys(errors).length === 0;
  const code = useMemo(() => (valid ? applyKeywords(sample, keywords) : ""), [keywords, valid]);

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

  async function copyProfile() {
    try {
      await navigator.clipboard.writeText(profileJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="lab">
      <div className="lab-head">
        <div className="lab-title">Profile composer</div>
        <div className="tabs">
          {profiles.map((profile) => {
            const active = roleLabels.every(({ role }) => keywords[role] === profile.keywords[role]);
            return (
              <button
                key={profile.id}
                type="button"
                className={`tab ${active ? "active" : ""}`}
                onClick={() => setKeywords({ ...profile.keywords })}
              >
                {profile.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="lab-body">
        <div className="composer">
          <div>
            <div className="composer-controls">
              {roleLabels.map(({ role, description }) => (
                <div className="field" key={role}>
                  <label htmlFor={`kw-${role}`}>
                    {role} <span className="muted">— {description}</span>
                  </label>
                  <input
                    id={`kw-${role}`}
                    className={errors[role] ? "invalid" : ""}
                    value={keywords[role]}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) =>
                      setKeywords((current) => ({ ...current, [role]: event.target.value }))
                    }
                  />
                  {errors[role] && <span className="error-text">{errors[role]}</span>}
                </div>
              ))}
            </div>

            <div className="composer-actions">
              <button type="button" className="btn btn-sm btn-solid" onClick={copyProfile} disabled={!valid}>
                {copied ? "Copied JSON" : "Copy profile JSON"}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setKeywords({ ...profiles[0].keywords })}
              >
                Reset
              </button>
            </div>

            <p className="composer-note">
              <span className={`status-dot ${valid ? "success-text" : "error-text"}`} aria-hidden="true" />
              {valid
                ? "Valid profile. Only keyword tokens change; the AST and generated targets do not."
                : "Fix the profile errors to see the transformed source."}
            </p>
          </div>

          <div className="composer-preview">
            {valid ? (
              <CodeBlock
                code={code}
                language="hsharp"
                keywords={keywords}
                title="custom.hs"
                meta="profile custom"
                maxHeight="420px"
              />
            ) : (
              <div className="code-frame">
                <div className="code-frame-head">
                  <span className="code-frame-title">custom.hs</span>
                  <span className="code-frame-meta">invalid profile</span>
                </div>
                <div className="code-pre" style={{ color: "var(--muted-dark)" }}>
                  The source preview is paused until every role has a unique, legal word.
                </div>
              </div>
            )}

            <details className="profile-json">
              <summary>Profile JSON</summary>
              <CodeBlock code={profileJson} language="json" title="custom.json" />
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
