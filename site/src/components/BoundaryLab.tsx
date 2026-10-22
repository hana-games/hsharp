import { useMemo, useState } from "react";

type Mode = "arithmetic" | "short-circuit";
type Op = "+" | "-" | "*" | "neg";

const I32_MIN = -2147483648n;
const I32_MAX = 2147483647n;

function clampI32(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-2147483648, Math.min(2147483647, Math.trunc(value)));
}

function formatValue(value: bigint): string {
  return value.toString();
}

export function BoundaryLab() {
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
    return { value, overflow, source: op === "neg" ? `-${left}` : `${left} ${op} ${right}` };
  }, [a, b, op]);

  return (
    <div className="lab">
      <div className="lab-head">
        <div className="lab-title">Boundary lab</div>
        <div className="tabs">
          <button
            type="button"
            className={`tab ${mode === "arithmetic" ? "active" : ""}`}
            onClick={() => setMode("arithmetic")}
          >
            Checked arithmetic
          </button>
          <button
            type="button"
            className={`tab ${mode === "short-circuit" ? "active" : ""}`}
            onClick={() => setMode("short-circuit")}
          >
            Short-circuit
          </button>
        </div>
      </div>

      <div className="lab-body">
        {mode === "arithmetic" ? (
          <div className="boundary-grid">
            <div className="boundary-controls">
              <div className="tabs">
                {(["+", "-", "*", "neg"] as Op[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`tab ${op === item ? "active" : ""}`}
                    onClick={() => setOp(item)}
                  >
                    {item === "neg" ? "unary -" : item}
                  </button>
                ))}
              </div>

              <div className="field">
                <label htmlFor="boundary-a">x (i32)</label>
                <input
                  id="boundary-a"
                  type="number"
                  min={-2147483648}
                  max={2147483647}
                  value={a}
                  onChange={(event) => setA(clampI32(Number(event.target.value)))}
                />
              </div>

              {op !== "neg" && (
                <div className="field">
                  <label htmlFor="boundary-b">y (i32)</label>
                  <input
                    id="boundary-b"
                    type="number"
                    min={-2147483648}
                    max={2147483647}
                    value={b}
                    onChange={(event) => setB(clampI32(Number(event.target.value)))}
                  />
                </div>
              )}

              <div className="quick-values">
                <button type="button" onClick={() => setA(2147483647)}>x = max</button>
                <button type="button" onClick={() => setA(-2147483648)}>x = min</button>
                <button type="button" onClick={() => setA(0)}>x = 0</button>
                <button type="button" onClick={() => setB(1)}>y = 1</button>
                <button type="button" onClick={() => setB(-1)}>y = -1</button>
              </div>
            </div>

            <div className="boundary-readout">
              <div className="boundary-result">
                <div className="label">Source operation</div>
                <div className="value" style={{ fontSize: "clamp(1.4rem, 3vw, 2rem)" }}>
                  {arithmetic.source}
                </div>
              </div>
              <div className="boundary-result">
                <div className="label">Outcome</div>
                <div className={`value ${arithmetic.overflow ? "error" : ""}`}>
                  {arithmetic.overflow ? "E_OVERFLOW" : formatValue(arithmetic.value)}
                </div>
                <p className="hint" style={{ marginTop: "0.5rem" }}>
                  {arithmetic.overflow
                    ? "The operation exceeds i32 and stops at the execution boundary. Illustration uses node 5."
                    : "The result fits in i32 and is narrowed to the declared type."}
                </p>
              </div>
              <div className={`output-badge ${arithmetic.overflow ? "error" : "ok"}`}>
                <span className="status-dot" />
                {arithmetic.overflow ? "Failure(code, sourceNode)" : "Success(i32, value)"}
              </div>
            </div>
          </div>
        ) : (
          <div className="boundary-grid">
            <div className="boundary-controls">
              <div className="field">
                <label htmlFor="boundary-x">x (i32)</label>
                <input
                  id="boundary-x"
                  type="number"
                  min={-2147483648}
                  max={2147483647}
                  value={x}
                  onChange={(event) => setX(clampI32(Number(event.target.value)))}
                />
              </div>
              <div className="quick-values">
                <button type="button" onClick={() => setX(2147483647)}>x = max</button>
                <button type="button" onClick={() => setX(-2147483648)}>x = min</button>
                <button type="button" onClick={() => setX(0)}>x = 0</button>
              </div>
              <p className="hint">
                The right operand would overflow when x is the maximum value. Because the left side is
                already false, it is never evaluated.
              </p>
            </div>

            <div className="boundary-readout">
              <div className="boundary-expr">
                false &amp;&amp; ((x + 1) &gt; 0)
              </div>
              <div className="short-circuit">
                <div className="path-step">
                  <span className="step-dot" />
                  evaluate left → false
                </div>
                <div className="path-step skipped">
                  <span className="step-dot" />
                  evaluate (x + 1) &gt; 0
                </div>
                <div className="path-step">
                  <span className="step-dot" />
                  return false
                </div>
              </div>
              <div className="output-badge ok">
                <span className="status-dot" />
                {"{ status: \"ok\", type: \"bool\", value: false }"}
              </div>
            </div>
          </div>
        )}

        <p className="hint" style={{ marginTop: "1rem" }}>
          Visual simulation only. No h# program is executed in the browser; the values illustrate the
          specified semantics.
        </p>
      </div>
    </div>
  );
}
