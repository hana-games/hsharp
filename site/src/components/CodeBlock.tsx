import { useMemo, useState } from "react";
import { tokenize } from "../lib/highlight";

interface CodeBlockProps {
  code: string;
  language: string;
  keywords?: string[] | Record<string, string>;
  title?: string;
  meta?: string;
  className?: string;
  maxHeight?: string;
}

export function CodeBlock({
  code,
  language,
  keywords,
  title,
  meta,
  className = "",
  maxHeight,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => tokenize(code, language, keywords), [code, language, keywords]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`code-frame ${className}`}>
      {(title || meta) && (
        <div className="code-frame-head">
          <span className="code-frame-title">{title}</span>
          <span className="code-frame-meta">{meta}</span>
          <button type="button" className="copy-button" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {!title && !meta && (
        <button type="button" className="copy-button copy-button-float" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      <pre className="code-pre" style={maxHeight ? { maxHeight } : undefined}>
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
    </div>
  );
}
