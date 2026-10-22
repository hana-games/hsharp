import { useMemo, useState } from "react";
import { useT } from "../i18n/runtime";

type Mode = "arithmetic" | "short-circuit";
type Op = "+" | "-" | "*" | "neg";

const I32_MIN = -2147483648n;
const I32_MAX = 2147483647n;

function clampI32(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-2147483648, Math.min(2147483647, Math.trunc(value)));
}

function RangeGauge({
  value,
  overflow,
  t,
}: {
  value: bigint;
  overflow: boolean;
  t: (text: string) => string;
}) {
  const clamped = value < I32_MIN ? I32_MIN : value > I32_MAX ? I32_MAX : value;
  const percent = Number(((clamped - I32_MIN) * 10000n) / (I32_MAX - I32_MIN)) / 100;

  return (
    <div className={`range-gauge ${overflow ? "is-overflow" : ""}`}>
      <div className="range-labels">
        <span>−2,147,483,648</span>
        <span>0</span>
        <span>2,147,483,647</span>
      </div>
      <div className="range-track" aria-hidden="true">
        <span className="range-zero" />
        <span className="range-marker" style={{ left: `${percent}%` }} />
      </div>
      <div className="range-caption">
        {overflow ? t("Outside the i32 range") : t("Inside the i32 range")}
      </div>
    </div>
  );
}

export function BoundaryLab() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("arithmetic");
  const [op, setOp] = useState<Op>("+");
  const [a, setA] = useState(2147483647);
  const [b, setB] = useState(1);
  const [x, setX] = useState(2147483647);

  const arithmetic = useMemo(() => {
    const left = BigInt(clampI32(a));
    const right = BigInt(clampI32(b));
    let value: bigint;
    switch (op) {
      case "+":
        value = left + right;
        break;
      case "-":
        value = left - right;
        break;
      case "*":
        value = left * right;
        break;
      case "neg":
        value = -left;
        break;
    }
    const overflow = value < I32_MIN || value > I32_MAX;
    return {
      value,
      overflow,
      source: op === "neg" ? `-${left}` : `${left} ${op === "*" ? "×" : op} ${right}`,
    };
  }, [a, b, op]);

  return (
    <div className="lab boundary-lab">
      <div className="lab-head">
        <div className="lab-title">{t("Boundary lab")}</div>
        <div className="tabs">
          <button
            type="button"
            className={`tab ${mode === "arithmetic" ? "active" : ""}`}
            onClick={() => setMode("arithmetic")}
          >
            {t("Checked arithmetic")}
          </button>
          <button
            type="button"
            className={`tab ${mode === "short-circuit" ? "active" : ""}`}
            onClick={() => setMode("short-circuit")}
          >
            {t("Short-circuit")}
          </button>
        </div>
      </div>

      <div className="lab-body">
        {mode === "arithmetic" ? (
          <div className="boundary-layout">
            <div className="boundary-controls-panel">
              <div className="boundary-section-label">{t("Operation")}</div>
              <div className="op-selector">
                {([
                  ["+", "Add"],
                  ["-", "Subtract"],
                  ["*", "Multiply"],
                  ["neg", "Negate"],
                ] as const).map(([item, label]) => (
                  <button
                    key={item}
                    type="button"
                    className={`op-button ${op === item ? "active" : ""}`}
                    onClick={() => setOp(item)}
                    aria-label={t(label)}
                  >
                    <strong>{item === "neg" ? "±" : item === "*" ? "×" : item === "-" ? "−" : "+"}</strong>
                    <span>{t(label)}</span>
                  </button>
                ))}
              </div>

              <div className={`operand-grid ${op === "neg" ? "single" : ""}`}>
                <div className="operand-card">
                  <div className="operand-head">
                    <code>x</code>
                    <span>i32</span>
                  </div>
                  <input
                    id="boundary-a"
                    aria-label={t("Left operand")}
                    type="number"
                    min={-2147483648}
                    max={2147483647}
                    value={a}
                    onChange={(event) => setA(clampI32(Number(event.target.value)))}
                  />
                  <div className="operand-presets">
                    <button type="button" onClick={() => setA(2147483647)}>max</button>
                    <button type="button" onClick={() => setA(-2147483648)}>min</button>
                    <button type="button" onClick={() => setA(0)}>0</button>
                  </div>
                </div>

                {op !== "neg" && (
                  <div className="operand-card">
                    <div className="operand-head">
                      <code>y</code>
                      <span>i32</span>
                    </div>
                    <input
                      id="boundary-b"
                      aria-label={t("Right operand")}
                      type="number"
                      min={-2147483648}
                      max={2147483647}
                      value={b}
                      onChange={(event) => setB(clampI32(Number(event.target.value)))}
                    />
                    <div className="operand-presets">
                      <button type="button" onClick={() => setB(1)}>1</button>
                      <button type="button" onClick={() => setB(-1)}>−1</button>
                      <button type="button" onClick={() => setB(2147483647)}>max</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="boundary-range-note">
                <span className="status-dot" />
                {t("i32 range")} · −2,147,483,648 → 2,147,483,647
              </div>
            </div>

            <div className="boundary-result-panel">
              <div className="boundary-result-head">
                <span className={`result-symbol ${arithmetic.overflow ? "error" : "ok"}`}>
                  {arithmetic.overflow ? "!" : "✓"}
                </span>
                <div>
                  <div className="boundary-section-label">{t("Outcome")}</div>
                  <div className={`boundary-outcome ${arithmetic.overflow ? "error" : ""}`}>
                    {arithmetic.overflow ? "E_OVERFLOW" : arithmetic.value.toLocaleString()}
                  </div>
                </div>
                <span className={`result-code ${arithmetic.overflow ? "error" : "ok"}`}>
                  {arithmetic.overflow ? t("Failure") : t("Success")}
                </span>
              </div>

              <div className="boundary-expression">
                <span>{t("Expression")}</span>
                <code>{arithmetic.source}</code>
              </div>

              <RangeGauge value={arithmetic.value} overflow={arithmetic.overflow} t={t} />

              <p className="boundary-note">
                {arithmetic.overflow
                  ? t("The operation exceeds i32 and stops at the execution boundary. Illustration uses node 5.")
                  : t("The result fits in i32 and is narrowed to the declared type.")}
              </p>

              <div className={`output-badge ${arithmetic.overflow ? "error" : "ok"}`}>
                <span className="status-dot" />
                {arithmetic.overflow ? t("Failure(code, sourceNode)") : t("Success(i32, value)")}
              </div>
            </div>
          </div>
        ) : (
          <div className="boundary-layout">
            <div className="boundary-controls-panel">
              <div className="boundary-section-label">{t("Operand")}</div>
              <div className="operand-grid single">
                <div className="operand-card">
                  <div className="operand-head">
                    <code>x</code>
                    <span>i32</span>
                  </div>
                  <input
                    id="boundary-x"
                    aria-label="x"
                    type="number"
                    min={-2147483648}
                    max={2147483647}
                    value={x}
                    onChange={(event) => setX(clampI32(Number(event.target.value)))}
                  />
                  <div className="operand-presets">
                    <button type="button" onClick={() => setX(2147483647)}>max</button>
                    <button type="button" onClick={() => setX(-2147483648)}>min</button>
                    <button type="button" onClick={() => setX(0)}>0</button>
                  </div>
                </div>
              </div>
              <p className="boundary-note">
                {t("The right operand would overflow when x is the maximum value. Because the left side is already false, it is never evaluated.")}
              </p>
            </div>

            <div className="boundary-result-panel">
              <div className="boundary-expression accent">
                <span>{t("Expression")}</span>
                <code>false &amp;&amp; ((x + 1) &gt; 0)</code>
              </div>

              <div className="short-circuit-flow">
                <div className="sc-step done">
                  <span>01</span>
                  <div><strong>{t("Evaluate left")}</strong><small>{t("Result: false")}</small></div>
                </div>
                <div className="sc-connector" aria-hidden="true">↓</div>
                <div className="sc-step skipped">
                  <span>02</span>
                  <div><strong>{t("Right operand")}</strong><small>{t("Skipped")}</small></div>
                </div>
                <div className="sc-connector" aria-hidden="true">↓</div>
                <div className="sc-step done">
                  <span>03</span>
                  <div><strong>{t("Return")}</strong><small>false</small></div>
                </div>
              </div>

              <div className="output-badge ok">
                <span className="status-dot" />
                {"{ status: \"ok\", type: \"bool\", value: false }"}
              </div>
            </div>
          </div>
        )}

        <p className="hint boundary-disclaimer">
          {t("Visual simulation only. No h# program is executed in the browser; the values illustrate the specified semantics.")}
        </p>
      </div>
    </div>
  );
}
