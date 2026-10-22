import { useMemo, useState } from "react";
import type { ConformanceData, TargetId } from "../data/types";
import { useT } from "../i18n/runtime";

interface Props {
  conformance: ConformanceData;
}

const targetShort: Record<TargetId, string> = {
  csharp: "C#",
  rust: "Rs",
  go: "Go",
  java: "Jv",
};

const targetIds: TargetId[] = ["csharp", "rust", "go", "java"];

export function ConformanceExplorer({ conformance }: Props) {
  const t = useT();
  const [target, setTarget] = useState<"all" | TargetId>("all");
  const [status, setStatus] = useState<"all" | "passed" | "failed">("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return conformance.cases
      .map((item) => {
        const statuses = targetIds.map((id) => item.targets[id] ?? "missing");
        const overall = statuses.some((value) => value === "failed")
          ? "failed"
          : statuses.some((value) => value === "blocked")
            ? "blocked"
            : statuses.every((value) => value === "passed")
              ? "passed"
              : "missing";
        return { item, statuses, overall };
      })
      .filter((row) => {
        if (target !== "all" && row.item.targets[target] !== "passed") return false;
        if (status !== "all" && row.overall !== status) return false;
        if (needle && !row.item.id.toLowerCase().includes(needle) && !row.item.notes.toLowerCase().includes(needle)) {
          return false;
        }
        return true;
      });
  }, [conformance, query, status, target]);

  return (
    <div className="lab">
      <div className="lab-head">
        <div className="lab-title">{t("Conformance explorer")}</div>
        <div className="row">
          <span className="chip chip-lime">{conformance.mode}</span>
          <span className="index">{conformance.generatedAt.slice(0, 10)}</span>
        </div>
      </div>

      <div className="lab-body">
        <div className="conformance-summary">
          <div className="conformance-stat">
            <strong>{conformance.summary.cases}</strong>
            <span>{t("positive cases")}</span>
          </div>
          <div className="conformance-stat">
            <strong>{conformance.summary.targets}</strong>
            <span>{t("target executions")}</span>
          </div>
          <div className="conformance-stat">
            <strong>{conformance.summary.failed}</strong>
            <span>{t("failed")}</span>
          </div>
          <div className="conformance-stat">
            <strong>{conformance.summary.blocked}</strong>
            <span>{t("blocked")}</span>
          </div>
        </div>

        <div className="conformance-filters">
          <input
            type="search"
            placeholder={t("Filter cases…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter conformance cases"
          />
          <div className="tabs">
            <button type="button" className={`tab ${target === "all" ? "active" : ""}`} onClick={() => setTarget("all")}>
              {t("All targets")}
            </button>
            {targetIds.map((id) => (
              <button key={id} type="button" className={`tab ${target === id ? "active" : ""}`} onClick={() => setTarget(id)}>
                {targetShort[id]}
              </button>
            ))}
          </div>
          <div className="tabs">
            {(["all", "passed", "failed"] as const).map((value) => (
              <button key={value} type="button" className={`tab ${status === value ? "active" : ""}`} onClick={() => setStatus(value)}>
                {value === "all" ? t("Any status") : t(value)}
              </button>
            ))}
          </div>
        </div>

        <div className="case-list">
          {rows.map(({ item, statuses, overall }) => (
            <div className="case-row" key={item.id} title={item.notes}>
              <div>
                <div className="case-id">{item.id}</div>
                <div className="case-feature">{item.notes || `reference: ${item.reference.status}`}</div>
              </div>
              <div className={`target-mark ${overall}`}>{overall === "passed" ? "all pass" : overall}</div>
              {statuses.map((value, index) => (
                <div key={targetIds[index]} className={`target-mark ${value}`} title={`${targetIds[index]}: ${value}`}>
                  {targetShort[targetIds[index]]}
                </div>
              ))}
            </div>
          ))}
          {rows.length === 0 && <p className="hint">No case matches these filters.</p>}
        </div>

        <p className="hint" style={{ marginTop: "0.8rem" }}>
          Data from the real conformance report: {conformance.summary.cases} cases across {conformance.summary.targets} target executions.
          A blocked target is never counted as a pass.
        </p>
      </div>
    </div>
  );
}
