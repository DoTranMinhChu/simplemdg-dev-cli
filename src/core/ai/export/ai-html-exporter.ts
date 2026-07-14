import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { classifyForExport, formatDuration, groupObservationsByTurn, statusIcon } from "./ai-export-content";
import type { IAiSessionExporter, TAiExportBundle, TAiExportContext } from "./ai-export-types";

// Same extension the frontend's Markdown.tsx makes to rehype-sanitize's default (github-flavored)
// schema: keep fenced-code language classes and GFM task-list checkboxes, block everything else
// rehype-sanitize already blocks by default (script tags, event handlers, javascript: URLs).
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "input"],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
    input: ["type", "checked", "disabled"],
  },
};

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeHighlight).use(rehypeSanitize, SANITIZE_SCHEMA).use(rehypeStringify);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(text: string): string {
  if (!text.trim()) return "";
  try {
    return String(processor.processSync(text));
  } catch {
    return `<pre>${escapeHtml(text)}</pre>`;
  }
}

function labelOutcome(outcome: TAiExportBundle["analysis"]["outcome"]): string {
  const labels: Record<TAiExportBundle["analysis"]["outcome"], string> = {
    successful: "Successful",
    "partially-successful": "Partially successful",
    failed: "Failed",
    cancelled: "Cancelled",
    unverified: "Unverified",
    unknown: "Unknown",
  };
  return labels[outcome];
}

function renderTurnBody(bundle: TAiExportBundle, include: TAiExportContext["include"]): string {
  const { turns, observations } = bundle;
  const grouped = groupObservationsByTurn(turns, observations);
  const sections: string[] = [];

  for (const turn of turns) {
    if (turn.isContext) continue;
    const parts: string[] = [];
    let activityBuffer: string[] = [];

    const flushActivity = (): void => {
      if (!activityBuffer.length) return;
      parts.push(
        `<details class="activity"><summary>AI ACTIVITY — ${activityBuffer.length} item${activityBuffer.length === 1 ? "" : "s"}</summary><div class="activity-body">${activityBuffer.join("")}</div></details>`,
      );
      activityBuffer = [];
    };

    for (const observation of grouped.get(turn.index) ?? []) {
      const kind = classifyForExport(observation);
      if (kind === "user") {
        if (!include.conversation) continue;
        flushActivity();
        parts.push(`<div class="msg msg-user"><div class="msg-head"><span class="msg-role">USER</span></div><div class="msg-body">${renderMarkdown(observation.input || observation.output)}</div></div>`);
      } else if (kind === "assistant") {
        if (!include.conversation) continue;
        flushActivity();
        parts.push(`<div class="msg msg-assistant"><div class="msg-head"><span class="msg-role">AI</span></div><div class="msg-body">${renderMarkdown(observation.output)}</div></div>`);
      } else if (kind === "reasoning") {
        if (!include.reasoning) continue;
        activityBuffer.push(`<details class="reasoning"><summary>INTERNAL REASONING</summary><div class="msg-body">${renderMarkdown(observation.output)}</div></details>`);
      } else if (include.toolOutputs) {
        activityBuffer.push(
          `<details class="tool"><summary>${escapeHtml(observation.name)} — ${formatDuration(observation.durationMs)}${observation.isError ? " · failed" : ""}</summary>` +
            (observation.input ? `<div class="tool-label">Input</div><pre>${escapeHtml(observation.input)}</pre>` : "") +
            (observation.output ? `<div class="tool-label">Output</div><pre>${escapeHtml(observation.output)}</pre>` : "") +
            `</details>`,
        );
      } else if (include.toolCalls) {
        activityBuffer.push(`<div class="tool-row">${escapeHtml(observation.name)} — ${formatDuration(observation.durationMs)}${observation.isError ? " · failed" : ""}</div>`);
      }
    }
    flushActivity();

    if (!parts.length) continue;
    sections.push(`<section id="turn-${turn.index}" class="turn"><h2>Turn ${turn.index}${turn.errorCount ? ` <span class="badge-err">${turn.errorCount} error${turn.errorCount === 1 ? "" : "s"}</span>` : ""}</h2>${parts.join("")}</section>`);
  }

  return sections.join("\n");
}

function renderToc(bundle: TAiExportBundle): string {
  const items = bundle.turns
    .filter((turn) => !turn.isContext)
    .map((turn) => `<li><a href="#turn-${turn.index}">Turn ${turn.index} — ${escapeHtml(firstLine(turn.userRequest))}</a></li>`)
    .join("");
  return `<nav class="toc"><h2>Contents</h2><ol>${items}</ol></nav>`;
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim()) ?? text;
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

function renderAnalysisSections(bundle: TAiExportBundle, include: TAiExportContext["include"]): string {
  const { analysis } = bundle;
  const blocks: string[] = [];

  blocks.push(`<section class="meta-section"><h2>Outcome</h2><p><strong>${labelOutcome(analysis.outcome)}</strong></p><ul>${analysis.outcomeEvidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></section>`);

  if (include.verification && analysis.verification.length) {
    blocks.push(
      `<section class="meta-section"><h2>Verification</h2><ul>${analysis.verification
        .map((check) => `<li>${statusIcon(check.status)} ${escapeHtml(check.label)}${check.durationMs ? ` (${formatDuration(check.durationMs)})` : ""}</li>`)
        .join("")}</ul></section>`,
    );
  }
  if (include.errors && analysis.errorGroups.length) {
    blocks.push(
      `<section class="meta-section"><h2>Errors</h2><ul>${analysis.errorGroups.map((group) => `<li><strong>${group.category}</strong> (${group.count}x): ${escapeHtml(group.message)}</li>`).join("")}</ul></section>`,
    );
  }
  if (include.files && analysis.fileImpact.length) {
    blocks.push(
      `<section class="meta-section"><h2>Files changed</h2><table><thead><tr><th>Path</th><th>Reads</th><th>Edits</th></tr></thead><tbody>${analysis.fileImpact
        .slice(0, 200)
        .map((file) => `<tr><td><code>${escapeHtml(file.path)}</code></td><td>${file.reads}</td><td>${file.edits}</td></tr>`)
        .join("")}</tbody></table></section>`,
    );
  }
  if (include.commands && analysis.commandsRun.length) {
    blocks.push(`<section class="meta-section"><h2>Commands run</h2><ul>${analysis.commandsRun.map((command) => `<li><code>${escapeHtml(command)}</code></li>`).join("")}</ul></section>`);
  }

  return blocks.join("\n");
}

const STYLE = `
:root {
  --bg: #0b0f17; --bg-2: #0e1420; --bg-3: #121a28; --border: #1f2c44; --text: #dce6f5;
  --muted: #8295b5; --accent: #3b82f6; --red: #ef4444; --chip: #1a2840;
}
:root[data-theme="light"] {
  --bg: #f7f9fc; --bg-2: #ffffff; --bg-3: #eef2f8; --border: #d6dee8; --text: #1b2434;
  --muted: #5b6c8a; --accent: #2563eb; --red: #dc2626; --chip: #e7edf7;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: #f7f9fc; --bg-2: #ffffff; --bg-3: #eef2f8; --border: #d6dee8; --text: #1b2434;
    --muted: #5b6c8a; --accent: #2563eb; --red: #dc2626; --chip: #e7edf7;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.65 "Segoe UI", Roboto, Arial, sans-serif; }
.page { max-width: 1040px; margin: 0 auto; padding: 24px; }
.masthead { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.masthead h1 { margin: 0 0 4px; font-size: 22px; }
.masthead .meta { color: var(--muted); font-size: 13px; }
.controls { display: flex; gap: 8px; align-items: center; flex: 0 0 auto; }
.controls input, .controls button { background: var(--bg-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 6px 10px; font: inherit; }
.controls button { cursor: pointer; }
.toc { background: var(--bg-2); border: 1px solid var(--border); border-radius: 10px; padding: 14px 18px; margin-bottom: 20px; }
.toc h2 { margin-top: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); }
.toc ol { margin: 0; padding-left: 20px; }
.toc a { color: var(--accent); text-decoration: none; }
.toc a:hover { text-decoration: underline; }
.turn { margin-bottom: 28px; }
.turn h2 { font-size: 15px; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.badge-err { color: #fff; background: #7f1d1d; border-radius: 999px; padding: 2px 8px; font-size: 11px; }
.msg { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; background: var(--bg-2); }
.msg-user { background: var(--bg-3); }
.msg-head { margin-bottom: 6px; }
.msg-role { font-size: 11px; font-weight: 700; letter-spacing: .5px; color: var(--accent); text-transform: uppercase; }
.msg-body :first-child { margin-top: 0; } .msg-body :last-child { margin-bottom: 0; }
.msg-body pre { background: #0a1018; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; overflow-x: auto; }
.msg-body code { font-family: Consolas, "Cascadia Code", monospace; font-size: 13px; }
.msg-body table { border-collapse: collapse; width: 100%; }
.msg-body th, .msg-body td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
details.activity, details.tool, details.reasoning { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 10px; padding: 8px 12px; background: var(--bg-3); }
details.activity summary, details.tool summary, details.reasoning summary { cursor: pointer; font-size: 12px; color: var(--muted); font-weight: 600; }
.activity-body { margin-top: 8px; }
.tool-row { font-size: 13px; padding: 3px 0; color: var(--muted); }
.tool-label { font-size: 11px; text-transform: uppercase; color: var(--muted); margin: 8px 0 2px; }
.meta-section { border: 1px solid var(--border); border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; background: var(--bg-2); }
.meta-section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-top: 0; }
mark { background: #fbbf24; color: #1b2434; }
footer { color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); padding-top: 14px; margin-top: 24px; }
`;

const SCRIPT = `
(function () {
  var root = document.documentElement;
  var stored = localStorage.getItem("ai-export-theme");
  if (stored) root.setAttribute("data-theme", stored);
  document.getElementById("theme-toggle").addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    localStorage.setItem("ai-export-theme", next);
  });

  var marks = [];
  function clearMarks() {
    marks.forEach(function (mark) {
      var parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
      parent.normalize();
    });
    marks = [];
  }
  function highlight(root, query) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(function (textNode) {
      var text = textNode.textContent || "";
      var lower = text.toLowerCase();
      var at = lower.indexOf(query);
      if (at < 0) return;
      var span = document.createElement("span");
      var cursor = 0;
      var idx = at;
      while (idx >= 0) {
        span.appendChild(document.createTextNode(text.slice(cursor, idx)));
        var mark = document.createElement("mark");
        mark.textContent = text.slice(idx, idx + query.length);
        span.appendChild(mark);
        marks.push(mark);
        cursor = idx + query.length;
        idx = lower.indexOf(query, cursor);
      }
      span.appendChild(document.createTextNode(text.slice(cursor)));
      textNode.parentNode.replaceChild(span, textNode);
    });
  }
  document.getElementById("search-input").addEventListener("input", function (event) {
    clearMarks();
    var query = event.target.value.trim().toLowerCase();
    var count = document.getElementById("search-count");
    if (!query) { count.textContent = ""; return; }
    highlight(document.querySelector(".page"), query);
    count.textContent = marks.length + " match" + (marks.length === 1 ? "" : "es");
    if (marks.length) marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
  });
})();
`;

function toHtmlDocument(bundle: TAiExportBundle, context: TAiExportContext): string {
  const { session } = bundle;
  const body = `
    <div class="page">
      <div class="masthead">
        <div>
          <h1>${escapeHtml(session.title)}</h1>
          <div class="meta">${session.provider} · ${escapeHtml(session.project)} · ${session.model || "unknown model"} · ${new Date(session.startedAt).toLocaleString()} · ${formatDuration(session.durationMs)}</div>
        </div>
        <div class="controls">
          <input id="search-input" type="search" placeholder="Search this export..." />
          <span id="search-count" class="meta"></span>
          <button id="theme-toggle" type="button">Toggle theme</button>
        </div>
      </div>
      ${renderToc(bundle)}
      ${renderAnalysisSections(bundle, context.include)}
      ${context.include.conversation || context.include.toolCalls || context.include.toolOutputs || context.include.reasoning ? renderTurnBody(bundle, context.include) : ""}
      <footer>
        Generated by SimpleMDG AI Studio · ${new Date().toISOString()} · Secrets ${context.redaction.enabled ? `redacted (${context.redaction.redactedFieldCount} value${context.redaction.redactedFieldCount === 1 ? "" : "s"})` : "NOT redacted"}
      </footer>
    </div>`;

  return `<!doctype html>
<html lang="en" data-theme="${context.theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(session.title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
<script>${SCRIPT}</script>
</body>
</html>`;
}

export const htmlExporter: IAiSessionExporter = {
  format: "html",
  export(bundle, context) {
    return { content: toHtmlDocument(bundle, context), mimeType: "text/html", extension: "html" };
  },
};
