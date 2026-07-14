import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import fs from "fs-extra";
import chalk from "chalk";
import prompts from "prompts";
import { getDirname } from "./esm-paths";

const GUIDE_FILE_NAME = "USER_GUIDE.md";

type TGuideMode = "terminal" | "web" | "commander-help";

const __dirname = getDirname(import.meta.url);

function getPackageRootPath(): string {
  return path.resolve(__dirname, "..", "..");
}

async function readGuideMarkdown(): Promise<string> {
  const packageRootPath = getPackageRootPath();
  const guidePath = path.join(packageRootPath, GUIDE_FILE_NAME);

  if (await fs.pathExists(guidePath)) {
    return fs.readFile(guidePath, "utf8");
  }

  const readmePath = path.join(packageRootPath, "README.md");

  if (await fs.pathExists(readmePath)) {
    return fs.readFile(readmePath, "utf8");
  }

  return `# SimpleMDG Dev CLI\n\nGuide file was not found. Run smdg --help to see command help.`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const htmlLines: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inList = false;

  function closeList(): void {
    if (inList) {
      htmlLines.push("</ul>");
      inList = false;
    }
  }

  function closeCodeBlock(): void {
    if (inCodeBlock) {
      htmlLines.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      codeLines = [];
      inCodeBlock = false;
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        closeCodeBlock();
      } else {
        closeList();
        inCodeBlock = true;
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmedLine = line.trim();

    if (!trimmedLine) {
      closeList();
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmedLine);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      htmlLines.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(trimmedLine);
    if (bulletMatch) {
      if (!inList) {
        htmlLines.push("<ul>");
        inList = true;
      }
      htmlLines.push(`<li>${inlineMarkdown(bulletMatch[1])}</li>`);
      continue;
    }

    closeList();
    htmlLines.push(`<p>${inlineMarkdown(trimmedLine)}</p>`);
  }

  closeCodeBlock();
  closeList();

  return htmlLines.join("\n");
}

function buildGuideHtml(markdown: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SimpleMDG Dev CLI Guide</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a;
      color: #e5e7eb;
      line-height: 1.65;
    }
    .layout {
      max-width: 980px;
      margin: 0 auto;
      padding: 40px 24px 80px;
    }
    .card {
      background: #111827;
      border: 1px solid #334155;
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
    }
    h1 { margin-top: 0; font-size: 34px; color: #ffffff; }
    h2 { margin-top: 36px; padding-top: 22px; border-top: 1px solid #334155; color: #93c5fd; }
    h3 { color: #bfdbfe; }
    p, li { color: #d1d5db; }
    code {
      background: #1f2937;
      color: #fbbf24;
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 0.92em;
    }
    pre {
      background: #020617;
      color: #e5e7eb;
      padding: 16px;
      border-radius: 12px;
      overflow-x: auto;
      border: 1px solid #1e293b;
    }
    pre code { background: transparent; color: inherit; padding: 0; }
    ul { padding-left: 24px; }
    .hint {
      margin-bottom: 18px;
      padding: 12px 14px;
      border-radius: 12px;
      background: #172554;
      color: #dbeafe;
      border: 1px solid #1d4ed8;
    }
  </style>
</head>
<body>
  <main class="layout">
    <div class="hint">Local visual guide. Keep this terminal open. Press Ctrl + C to stop the guide server.</div>
    <article class="card">
      ${markdownToHtml(markdown)}
    </article>
  </main>
</body>
</html>`;
}

function openBrowser(url: string): void {
  const platform = process.platform;

  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

export async function printUserGuide(): Promise<void> {
  const markdown = await readGuideMarkdown();
  console.log(markdown);
}

export async function openUserGuideInBrowser(port?: string): Promise<void> {
  const markdown = await readGuideMarkdown();
  const html = buildGuideHtml(markdown);
  const requestedPort = port?.trim() ? Number(port.trim()) : 0;

  if (port?.trim() && (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535)) {
    throw new Error("Guide port must be a number from 1 to 65535");
  }

  const server = http.createServer((request, response) => {
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://127.0.0.1:${actualPort}`;

  console.log(chalk.green(`SimpleMDG Dev CLI guide: ${url}`));
  console.log(chalk.gray("Press Ctrl + C to stop the guide server."));
  openBrowser(url);
}

export async function askRootHelpMode(): Promise<TGuideMode> {
  const response = await prompts({
    type: "select",
    name: "mode",
    message: "How do you want to view SimpleMDG CLI help?",
    choices: [
      { title: "View quick guide in terminal", value: "terminal" },
      { title: "Open visual guide in browser", value: "web" },
      { title: "Show command help", value: "commander-help" },
    ],
    initial: 0,
  });

  return (response.mode ?? "commander-help") as TGuideMode;
}
