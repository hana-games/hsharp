import { useMemo, useState } from "react";
import { tokenize } from "../lib/highlight";
import { useT } from "../i18n/runtime";

interface CodeBlockProps {
  code: string;
  language: string;
  keywords?: string[] | Record<string, string>;
  title?: string;
  meta?: string;
  className?: string;
  maxHeight?: string;
  showCopy?: boolean;
}

export function CodeBlock({
  code,
  language,
  keywords,
  title,
  meta,
  className = "",
  maxHeight,
  showCopy = true,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const t = useT();
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
          {showCopy && (
            <button type="button" className="copy-button" onClick={copy}>
              {copied ? t("Copied") : t("Copy")}
            </button>
          )}
        </div>
      )}
      {!title && !meta && showCopy && (
        <button type="button" className="copy-button copy-button-float" onClick={copy}>
          {copied ? t("Copied") : t("Copy")}
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
