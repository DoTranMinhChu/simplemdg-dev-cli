import { useEffect, useMemo, useRef, useState } from "react";
import { hljs } from "./code-highlight";

const EXTENSIONS: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  tsx: "tsx",
  jsx: "jsx",
  python: "py",
  bash: "sh",
  shell: "sh",
  powershell: "ps1",
  csharp: "cs",
  markdown: "md",
  yaml: "yml",
};

function downloadFileName(language: string | undefined): string {
  const ext = (language && EXTENSIONS[language]) || language || "txt";
  return `snippet.${ext}`;
}

/**
 * Renders one fenced code block: language label, copy/wrap/download actions, and syntax
 * highlighting done manually via highlight.js (not a rehype plugin) so the raw text stays
 * available for copy/download and highlighting can be deferred until the block scrolls into view.
 */
export function CodeBlock({ code, language }: { code: string; language?: string }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  const highlighted = useMemo(() => {
    if (!visible) return undefined;
    try {
      if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      return hljs.highlightAuto(code).value;
    } catch {
      return undefined;
    }
  }, [visible, code, language]);

  const lines = useMemo(() => code.split("\n"), [code]);

  const copy = (): void => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = (): void => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadFileName(language);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="codeblock" ref={containerRef}>
      <div className="codeblock-head">
        <span className="codeblock-lang">{language || "text"}</span>
        <div className="codeblock-actions">
          <button type="button" className={showLineNumbers ? "active" : ""} disabled={wrap} onClick={() => setShowLineNumbers((prev) => !prev)}>
            #
          </button>
          <button type="button" className={wrap ? "active" : ""} onClick={() => setWrap((prev) => !prev)}>
            {wrap ? "Unwrap" : "Wrap"}
          </button>
          <button type="button" onClick={download}>
            Download
          </button>
          <button type="button" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className={`codeblock-body${wrap ? " wrap" : ""}`}>
        {showLineNumbers && !wrap ? (
          <div className="codeblock-linenos" aria-hidden="true">
            {lines.map((_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
        ) : null}
        <pre className="codeblock-scroll">
          <code className="hljs">
            {highlighted !== undefined ? <span dangerouslySetInnerHTML={{ __html: highlighted }} /> : code}
          </code>
        </pre>
      </div>
    </div>
  );
}
