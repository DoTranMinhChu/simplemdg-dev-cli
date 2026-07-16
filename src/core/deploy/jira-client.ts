export type TJiraAuth = { baseUrl: string; email: string; apiToken: string };

function authHeader(auth: TJiraAuth): string {
  return `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`).toString("base64")}`;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

async function jiraFetch<T>(auth: TJiraAuth, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(auth.baseUrl)}/rest/api/3${path}`, {
    ...init,
    headers: { authorization: authHeader(auth), accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T & { errorMessages?: string[] }) : ({} as T & { errorMessages?: string[] });
  if (!response.ok) {
    throw new Error(json?.errorMessages?.join("; ") || `Jira API failed (HTTP ${response.status}): ${path}`);
  }
  return json;
}

type TAdfNode = { type?: string; text?: string; content?: TAdfNode[] };

/**
 * Jira Cloud's v3 API returns `description` as Atlassian Document Format (structured JSON), not
 * plain text — flatten it back into lines (reconstructing `|`-joined table rows) so the legacy
 * tool's pipe-delimited-table convention for "tickets to deploy" lists still applies. Best-effort:
 * verify against a real deploy ticket's description shape before relying on this in production.
 */
export function flattenAdfToLines(node: TAdfNode | undefined): string[] {
  if (!node) return [];
  const lines: string[] = [];

  function walk(current: TAdfNode, currentLine: string[]): string[] {
    if (current.type === "text" && current.text) {
      currentLine.push(current.text);
      return currentLine;
    }
    if (current.type === "tableRow") {
      const cells = (current.content ?? []).map((cell) => flattenAdfToLines(cell).join(" ").trim());
      lines.push(cells.join("|"));
      return currentLine;
    }
    for (const child of current.content ?? []) {
      const result = walk(child, currentLine);
      if (child.type === "paragraph" || child.type === "hardBreak") {
        lines.push(result.join(""));
        currentLine.length = 0;
      }
    }
    return currentLine;
  }

  const remainder = walk(node, []);
  if (remainder.length) lines.push(remainder.join(""));
  return lines.filter((line) => line.trim().length > 0);
}

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

/** Same convention the legacy tool used: a pipe-delimited table row whose 3rd cell is a Jira issue key. */
export function parseDeployTicketKeys(descriptionLines: string[]): string[] {
  const keys: string[] = [];
  for (const line of descriptionLines) {
    const cells = line.split("|").map((cell) => cell.trim());
    const candidate = cells[2];
    if (candidate && ISSUE_KEY_PATTERN.test(candidate)) keys.push(candidate);
  }
  return [...new Set(keys)];
}

export type TJiraIssueSummary = {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  subtasks: Array<{ key: string; summary: string; status: string }>;
};

async function getIssueSummary(auth: TJiraAuth, issueKey: string): Promise<TJiraIssueSummary> {
  const issue = await jiraFetch<{
    key: string;
    fields: { summary: string; status?: { name?: string }; assignee?: { displayName?: string }; subtasks?: Array<{ key: string; fields: { summary: string; status?: { name?: string } } }> };
  }>(auth, `/issue/${encodeURIComponent(issueKey)}?fields=summary,status,assignee,subtasks`);

  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? "",
    assignee: issue.fields.assignee?.displayName,
    subtasks: (issue.fields.subtasks ?? []).map((subtask) => ({ key: subtask.key, summary: subtask.fields.summary, status: subtask.fields.status?.name ?? "" })),
  };
}

/**
 * Reads a "deploy ticket" issue's description for referenced ticket keys (per the legacy tool's
 * pipe-table convention), then fetches each referenced ticket + its subtasks.
 */
export async function getJiraInfoToDeploy(auth: TJiraAuth, issueKey: string): Promise<{ source: TJiraIssueSummary; referenced: TJiraIssueSummary[] }> {
  const issue = await jiraFetch<{ fields: { description?: TAdfNode } }>(auth, `/issue/${encodeURIComponent(issueKey)}?fields=description`);
  const descriptionLines = flattenAdfToLines(issue.fields.description);
  const referencedKeys = parseDeployTicketKeys(descriptionLines);

  const source = await getIssueSummary(auth, issueKey);
  const referenced = await Promise.all(referencedKeys.map((key) => getIssueSummary(auth, key)));

  return { source, referenced };
}

const DAILY_HOURS_CAP = 8;

/** Enforces the legacy tool's 8-hours-per-day cap for worklogs on a single issue. */
export async function postJiraWorkLog(auth: TJiraAuth, issueKey: string, options: { started: string; timeSpentSeconds: number; comment?: string }): Promise<{ ok: boolean; error?: string }> {
  const day = options.started.slice(0, 10);
  const existing = await jiraFetch<{ worklogs: Array<{ started: string; timeSpentSeconds: number }> }>(auth, `/issue/${encodeURIComponent(issueKey)}/worklog`);
  const alreadyLoggedSeconds = existing.worklogs.filter((entry) => entry.started.slice(0, 10) === day).reduce((total, entry) => total + entry.timeSpentSeconds, 0);

  if (alreadyLoggedSeconds + options.timeSpentSeconds > DAILY_HOURS_CAP * 3600) {
    return { ok: false, error: `Logging this would exceed the ${DAILY_HOURS_CAP}h/day cap for ${issueKey} on ${day} (already logged ${(alreadyLoggedSeconds / 3600).toFixed(1)}h).` };
  }

  await jiraFetch(auth, `/issue/${encodeURIComponent(issueKey)}/worklog`, {
    method: "POST",
    body: JSON.stringify({
      started: options.started,
      timeSpentSeconds: options.timeSpentSeconds,
      comment: options.comment
        ? { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: options.comment }] }] }
        : undefined,
    }),
  });

  return { ok: true };
}
