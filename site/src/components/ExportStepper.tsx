import { useMemo, useState } from "react";
import type { DemoData } from "../data/types";
import { CodeBlock } from "./CodeBlock";
import { useT } from "../i18n/runtime";

type Scenario = "clean" | "stale" | "profile";

interface Props {
  demo: DemoData;
}

const steps = [
  { label: "Canonical base", note: "Shared source in the repository" },
  { label: "Export", note: "Personal notation + manifest" },
  { label: "Edit", note: "Change base + 2 → base + 3" },
  { label: "Reimport", note: "Validate profile and base" },
  { label: "Applied", note: "Canonical diff + refreshed manifest" },
];

export function ExportStepper({ demo }: Props) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [scenario, setScenario] = useState<Scenario>("clean");

  const standard = demo.sources.standard.code;
  const personal = demo.sources["my-syntax"].code;
  const canonicalEdited = standard.replace("return base + 2;", "return base + 3;");
  const diff = useMemo(
    () => [
      { type: "ctx", text: "fn calculate(x: i32, bonus: bool) -> i32 {" },
      { type: "ctx", text: "    let base: i32 = x * 3;" },
      { type: "ctx", text: "" },
      { type: "ctx", text: "    if bonus {" },
      { type: "del", text: "        return base + 2;" },
      { type: "add", text: "        return base + 3;" },
      { type: "ctx", text: "    }" },
      { type: "ctx", text: "" },
      { type: "ctx", text: "    return base;" },
      { type: "ctx", text: "}" },
    ],
    [],
  );

  const result =
    scenario === "clean"
      ? { ok: true, title: "Reimport accepted", body: "The personal edit is converted back to standard notation and applied." }
      : scenario === "stale"
        ? {
            ok: false,
            title: "E_IMPORT_STALE_BASE",
            body: "The canonical source changed after export. h# refuses to overwrite it; rebase or re-export.",
          }
        : {
            ok: false,
            title: "E_IMPORT_PROFILE_CHANGED",
            body: "The profile file no longer matches the manifest fingerprint. Re-export with the current profile.",
          };

  return (
    <div className="lab">
      <div className="lab-head">
        <div className="lab-title">{t("Export · edit · reimport")}</div>
        <div className="row">
          <span className="chip chip-lime">{t("manifest + fingerprints")}</span>
          <span className="index">{t("no code execution")}</span>
        </div>
      </div>

      <div className="lab-body">
        <div className="stepper">
          <div className="step-list">
            {steps.map((item, index) => (
              <button
                key={item.label}
                type="button"
                className={`step-button ${index === step ? "active" : ""}`}
                onClick={() => setStep(index)}
              >
                <span className="step-index">{index + 1}</span>
                <span>
                  <strong>{t(item.label)}</strong>
                  <span>{t(item.note)}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="step-panel">
            <div className="step-panel-head">
              <div>
                <div className="eyebrow">Step {step + 1} of 5</div>
                <h3 className="h3">{t(steps[step].label)}</h3>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={step === 0}
                  onClick={() => setStep((current) => Math.max(0, current - 1))}
                >{t("Back")}</button>
                <button
                  type="button"
                  className="btn btn-sm btn-solid"
                  disabled={step === steps.length - 1 || (step === 3 && !result.ok)}
                  onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}
                >{t("Continue")}</button>
              </div>
            </div>

            {step === 0 && (
              <>
                <CodeBlock code={standard} language="hsharp" keywords={demo.sources.standard.keywords} title="calculate.hs" meta="canonical · standard profile" maxHeight="300px" />
                <div className="manifest">
                  <div><span>schema</span><span>hs-export/1</span></div>
                  <div><span>canonical</span><span>sha256:7a3f…c91e</span></div>
                  <div><span>profile</span><span>standard · sha256:0d2b…4aa1</span></div>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <CodeBlock code={personal} language="hsharp" keywords={demo.sources["my-syntax"].keywords} title="calculate.personal.hs" meta="my-syntax · personal" maxHeight="300px" />
                <div className="manifest">
                  <div><span>canonical base</span><span>sha256:7a3f…c91e</span></div>
                  <div><span>profile</span><span>my-syntax · sha256:8f10…a73c</span></div>
                  <div><span>personal</span><span>sha256:3e8c…b2d0</span></div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <p className="lede" style={{ fontSize: "0.95rem" }}>
                  The developer edits only the personal file. Comments and identifiers survive; the
                  canonical source is untouched.
                </p>
                <div className="diff">
                  {diff.map((line, index) => (
                    <div key={index} className={line.type}>
                      {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
                      {line.text}
                    </div>
                  ))}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div className="row" style={{ marginBottom: "0.8rem" }}>
                  <button type="button" className={`tab ${scenario === "clean" ? "active" : ""}`} onClick={() => setScenario("clean")}>{t("Clean reimport")}</button>
                  <button type="button" className={`tab ${scenario === "stale" ? "active" : ""}`} onClick={() => setScenario("stale")}>{t("Simulate canonical edit")}</button>
                  <button type="button" className={`tab ${scenario === "profile" ? "active" : ""}`} onClick={() => setScenario("profile")}>{t("Simulate profile edit")}</button>
                </div>
                <div className={`output-badge ${result.ok ? "ok" : "error"}`} style={{ padding: "0.9rem 1rem" }}>
                  <span className="status-dot" />
                  <div>
                    <strong>{result.title}</strong>
                    <div style={{ marginTop: "0.2rem", fontFamily: "var(--sans)", fontSize: "0.8rem" }}>
                      {result.body}
                    </div>
                  </div>
                </div>
                <div className="manifest">
                  <div><span>base check</span><span>{scenario === "stale" ? "failed" : "passed"}</span></div>
                  <div><span>profile check</span><span>{scenario === "profile" ? "failed" : "passed"}</span></div>
                  <div><span>apply</span><span>{result.ok ? "performed" : "rejected"}</span></div>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <CodeBlock code={canonicalEdited} language="hsharp" keywords={demo.sources.standard.keywords} title="calculate.hs" meta="canonical · after import" maxHeight="300px" />
                <div className="manifest">
                  <div><span>canonical</span><span>sha256:bf02…11d8 (refreshed)</span></div>
                  <div><span>personal</span><span>sha256:913a…08c4 (refreshed)</span></div>
                  <div><span>next import</span><span>ready</span></div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
