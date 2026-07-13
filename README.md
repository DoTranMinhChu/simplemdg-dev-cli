# SimpleMDG Dev CLI

SimpleMDG local development helper for npm install workflows, SAP CAP, Cloud Foundry/BTP, request tracing, GitLab sync, BTP database exploration, and local AI coding session observability.

## Install local package

```powershell
npm install -g .\simplemdg-dev-cli-2.4.0.tgz --force
smdg -V
```

## Building from source

The CLI backend (`src/`) and the CF DB Studio frontend (`studio/`, a standalone React + Vite + TypeScript project) build separately but are wired together by the root scripts:

```powershell
npm run build          # builds studio/ (Vite -> dist/core/db/studio-dist) then the CLI (tsc -> dist/)
npm run build:studio   # studio only
npm run build:cli      # CLI only
npm run dev:cli        # run the CLI from source with tsx (no build step)
npm run dev:studio     # Vite dev server for the Studio UI (hot reload)
```

`npm pack` / `npm install -g` run `prepack`, which runs the full `build`, so the packaged CLI always ships with a built Studio UI. See `smdg cf db studio --dev-ui` below for the frontend dev workflow.

## Prerequisites & auto-install

Some commands rely on external CLIs: `cf` (Cloud Foundry), `cds` (SAP CAP), and `git`. The CLI checks for these **before** running an interactive flow — so you are not asked for credentials only to fail at the end. If a tool is missing, it offers to install it via a detected package manager (`choco`/`brew` for `cf`, `winget`/`choco`/`scoop`/`brew`/`apt-get` for `git`, `npm -g` for `@sap/cds-dk`), or prints the official install link when no manager is available. After installing a tool, open a new terminal so PATH refreshes.

## Smart cache (instant, stale-while-revalidate)

Slow BTP/CF/GitLab lookups are cached under `~/.simplemdg/cache/` and served **cache-first**: the CLI shows the last known result immediately, then refreshes in the background and updates the cache for next time. These resources rarely change second-to-second, so this makes the CLI feel instant.

- `smdg cf apps` prints cached apps right away (e.g. *"Using cached apps for br10 / single-npi-laidon / app from 4 minutes ago."*) and refreshes in the background; `--refresh` forces a live fetch.
- `smdg gitlab groups` / `smdg gitlab projects` work the same way.
- `smdg cf org` is a **CF target switcher**: it lists **★ favorites** first, then **◷ recent** targets, then all cached targets — searchable, switchable, and instant (cached-first, no login needed to browse). Switching auto re-logs-in from saved credentials (no repeated password prompts), targets the org/space, and records the target as recent. Choose *Refresh all regions* to rescan. `--list`, `--switch`, `--org`, `--space`, `--api`, `--refresh` still work.
- A **failed background refresh never wipes the cache** — you keep working from the last good data with a warning.
- Background refreshes are **deduplicated**: concurrent requests for the same key share one network call.
- Default TTLs: CF apps 10m, CF env 5m, CF orgs/spaces 6h, CF regions 7d, GitLab groups 6h, GitLab projects 30m. Secrets are never written to plain cache files.

Manage the cache with:

```powershell
smdg cache             # interactive: status / clear / refresh / open folder
smdg cache status      # counts + "last updated" per namespace
smdg cache clear cf    # scopes: all | cf | gitlab | db | target | <namespace>
smdg cache refresh cf  # invalidate so the next command fetches fresh
```

DB Studio streams background-refresh events over `GET /api/events` (SSE) so its lists can update silently.

## Main commands

```powershell
smdg i
smdg cf login
smdg cf apps
smdg cache
smdg cf bind
smdg cf env
smdg cf logs
smdg cf request-trace
smdg gitlab login
smdg gitlab clone
smdg gitlab pull
smdg cf db studio
smdg git move-code
```

## Git move-code (release dependency tracing)

`smdg git move-code` guides moving a scoped set of commits from one branch to another (typically `staging` → `uat`/`qas`) across a microservice repo, without ever merging the whole source branch. See [USER_GUIDE.md](USER_GUIDE.md#git-move-code-release-dependency-tracing) for the full walkthrough (scope search, normal vs. merge commits, conflict resolution, build/dependency tracing, and push).

```powershell
smdg git move-code --source staging --target uat --scope SJS-2158
smdg git move-code --dry-run
```

Related subcommands: `smdg git pick`, `smdg git trace`, `smdg git conflict`, `smdg git summary`.

## GitLab sync

`gitlab` commands are implemented in the same source-code style as the existing CLI: command registration stays in `src/commands`, reusable logic stays close to the command, and cache files are stored under `~/.simplemdg`.

```powershell
smdg gitlab login
smdg gitlab groups
smdg gitlab clone
```

The clone/pull flow separates:

- pull/clone a root group
- pull/clone a single repository

It uses GitLab API and native `git`, so `ghorg` is not required. Pulling can run multiple repositories in parallel and skips invalid branch refs such as `origin` and `origin/HEAD`.

## CF DB Studio

A local, browser-based database explorer (HANA / PostgreSQL) styled after SAP HANA Database Explorer and DBeaver, with deep BTP/Cloud Foundry integration.

```powershell
smdg cf login
smdg cf db studio
```

Studio starts a local web server bound to `127.0.0.1` only (auto-selects a free port), serves a React + Vite frontend (`studio/`) as static assets, and opens your browser. The backend is a plain Node HTTP server exposing a local JSON/SSE API (`src/core/db/db-studio-server.ts`); the React app never receives database/CF/GitLab passwords or tokens — only connection/target/tab ids, with the backend decrypting secrets internally. It is a DBeaver / SAP HANA Database Explorer–style IDE:

- opens on a **Welcome page**; SQL / Data / Structure tabs open only on demand (closable, with dirty indicators)
- **DBeaver-style lazy object tree**: connection → Catalog → Schemas → schema → Tables/Views/Procedures/Functions/Synonyms, loaded only when expanded, with per-folder search and count badges
- **right-click context menus** on tables/views (Open Data, Open Structure, Generate SELECT/COUNT, Copy Full Name) and connections (Connect, Test, Edit, Favorite, Refresh from BTP, Duplicate, Remove)
- **connection cards** with custom name, color, environment tag (DEV/QAS/PROD/SANDBOX), favorite star, and a production-like warning
- import credentials from a BTP app's `cf env` via a **guided modal wizard** (target → app → service → save), or **add direct connections** (host/port/user/password) for non-CF databases like Neon
- passwords are **encrypted** locally and never sent to the browser (the UI only uses a connection id)
- inspect metadata (columns incl. comments, indexes, primary key, row count, generated DDL)
- data grid with pagination, quick `WHERE` filter, click-to-sort headers, and **inline editing with pending changes** — edited cells highlight yellow, inserts green, deletes red; review then **Save** (batch, per-row results) or **Revert**; conflicts/failures stay pending with error markers
- editing requires a detected **primary key** (read-only grid otherwise)
- run any SQL across multiple tabs, with row-limit, timing, CSV/JSON export, save to `.sql`, history
- **read-only** mode blocks all writes/DDL; dangerous SQL (DROP/TRUNCATE/ALTER/DELETE-or-UPDATE-without-WHERE) asks for confirmation
- clear loading states (skeletons, spinners, status bar) for every async action

IDE-grade workflow:

- **workspace tabs** (pin, close, close others/close to the right, rename, duplicate, restore on next launch — auto-saved to `~/.simplemdg/db-studio-workspace.json`); unsaved SQL survives a refresh/restart
- **search** on every list (connections, object tree, saved queries, history) with debounce and Esc-to-clear
- **SQL editor** with `Ctrl+Enter`/Run button, server-side **Format**, save to a named query (updates the linked saved query or Save As)
- **grid editing**: click a column header to sort, double-click a cell to edit, insert/delete rows, a sticky **pending-changes bar** (edits/inserts/deletes counts) with **Save** / **Revert** — failed rows in a partial save stay pending with an error marker instead of being silently dropped
- **object tree context menu**: Open Data/Structure, Generate SELECT/COUNT (opens in a SQL tab), Copy SELECT/INSERT/UPDATE, Copy Name/Full Name
- a **Settings** panel (restore-workspace, default row limit/schema, read-only default, query timeout, auto-save delay, max history items, auto-format, production warning) stored in `~/.simplemdg/db-studio-settings.json` — read-only-by-default and restore-workspace are applied on launch
- **Cell Value Inspector** (double-click a non-editable cell): detects JSON/HTML/date/number/url/base64/text, with formatted/raw views and copy helpers (raw / formatted / SQL literal)
- **BTP import wizard** ends on a review step (display name, environment, color, favorite) before saving and testing the connection
- Welcome page shows recent connections and recent saved queries, and a **Disconnect** link when a CF session is active

Not yet ported from the previous build (tracked as follow-up, not lost — just deferred out of the first React milestone): tab drag-to-reorder and tab groups, the command palette, per-cell undo/redo history, the SQL "Run ▾" selection-aware dropdown (Run Selected/Current/Explain — Run currently executes the whole editor), per-cell right-click menu with active-cell keyboard navigation, the "Show generated SQL" filter preview popover, the pending-changes "Show Changes" diff review modal, and the connection sidebar's group-by selector.

### Commands

```powershell
smdg cf db studio        # open the local browser studio
smdg cf db add           # add a direct connection manually (host/port/user/password)
smdg cf db import        # import a connection from a BTP app's cf env
smdg cf db connections   # list/test/rename/duplicate/remove cached connections
smdg cf db query         # run one SQL query against a cached connection
smdg cf db console        # interactive terminal SQL console (/help for commands)
```

In the Studio, click **+ New** in the Connections sidebar to add a direct connection without leaving the browser.

`smdg cf db studio` options: `--port <port>` (preferred port), `--read-only`, `--timeout <ms>`, `--debug-cf`.

Frontend development: `--dev-ui` starts the backend in API-only mode and prints instructions to run the Vite dev server (`cd studio && npm run dev`) separately, which proxies `/api/*` to the backend so hot reload works without CORS. `--api-only` starts just the JSON/SSE API with no UI and no browser — useful for scripting or when working on `studio/` against an already-running backend.

### Local cache files

```text
~/.simplemdg/db-connections.json     # connection profiles (passwords encrypted)
~/.simplemdg/db-query-history.json   # query history
~/.simplemdg/db-queries/             # saved .sql query files
```

Passwords are encrypted with a key derived from the current machine + user, so a copied cache file cannot be decrypted elsewhere.

### Database drivers

HANA and PostgreSQL drivers are optional dependencies. If a driver is missing, the studio reports it clearly. Install:

```powershell
npm i -g pg @sap/hana-client
```

## AI Studio

A local, private observability Studio for your Claude Code and Codex sessions — not just a transcript viewer, but analysis: what the agent did, what it verified, where it made errors, and what to improve next time.

```powershell
smdg ai studio
```

Reads sessions read-only from `~/.claude/projects/**/*.jsonl` (Claude Code) and `~/.codex/sessions/**/rollout-*.jsonl` (Codex), parses them into sessions → turns → observations, and stores them in a local SQLite database (`~/.simplemdg/ai-studio/traces.db`, via Node's built-in `node:sqlite` — **requires Node.js 22.5+**; other `smdg` commands keep working on older Node, only `ai studio` needs the newer runtime). Ingestion is incremental (only new/changed files are re-parsed) and a malformed session file is skipped with a diagnostic, never stopping ingestion of the rest.

- **Session list** — provider/project/error filters, free-text search, cursor pagination
- **Session Overview** — duration, tokens (incl. cache-read), tool/error counts, an **outcome** (successful / partially-successful / failed / unverified) computed only from observed verification commands (typecheck/build/test/lint) — never from the assistant's own "done" claim — plus grouped errors, file read/edit impact, and tool-usage stats
- **Turns** — the session grouped into human-prompt → agent-response turns (expand a turn to see its tool calls/reasoning/output)
- **Timeline** — chronological observations with filters (hide reasoning, only errors, only tool/shell activity)
- **Export** — Markdown or JSON, secrets redacted by default
- Manual **good/bad** rating per session, kept separate from the derived outcome

Secrets (Bearer/JWT tokens, API keys, GitLab/GitHub tokens, AWS keys, private key blocks, and plain-text "password:"/"pin:"/"token:" mentions) are redacted by default everywhere — CLI, API, and exports. A per-tab "Show sensitive content" toggle reveals the original text for that session only, as an explicit local action.

### Resume & launch

Find an old session and get back to work in one or two clicks — from the session workspace header, a session row's hover icon/right-click menu, or the "Continue working" widget on the welcome screen:

- **Resume in Claude Code** — opens a new terminal window running `claude --resume <sessionId>` in the session's project folder. Always resumes by the real session ID (verified against the installed `claude` CLI: `--resume <name>` only pre-filters Claude's own picker, it does not silently resume a named session — so Studio never offers that as a distinct action)
- **Continue latest session in project** — `claude --continue`, clearly labeled as resuming the most recent session in that project, which may not be the exact one you picked
- **Copy command** (with or without the `cd`/`Set-Location` prefix) — copies the exact, shell-appropriate command instead of running it; the app always shows what was copied
- **Open project folder** / **Open project in VS Code** — graceful, non-crashing errors if the folder is gone or `code` isn't on PATH
- **Copy suggested continuation prompt** — a "resume with context" prompt built only from that session's observed outcome, verification results, errors, and files touched (never from the assistant's own claims)
- **Pin** / **Favorite** — Studio-only metadata; never modifies the underlying Claude/Codex session file
- A confirmation dialog previews the exact command before any terminal is opened, with an opt-out ("don't ask again") for people who resume often
- Provider-gated: Codex sessions currently show no resume action at all rather than a guessed/incorrect command — only Claude Code has a verified resume flow today

### Commands

```powershell
smdg ai studio                  # open the local browser Studio
smdg ai sessions                 # list recent sessions in the terminal
smdg ai inspect <sessionId>      # detailed summary of one session (prompts if omitted)
smdg ai doctor                   # ingestion status, parser diagnostics, storage location
smdg ai scan                     # re-scan ~/.claude and ~/.codex for new/changed sessions
smdg ai export <sessionId>       # export one session as Markdown or JSON (prompts if omitted)
smdg ai resume [sessionId]       # resume a Claude Code session (prompts if omitted)
smdg ai continue [sessionId]     # continue the latest session in that project (claude --continue)
smdg ai open [sessionId]         # open the session's project folder (--vscode to open in VS Code)
smdg ai copy-command [sessionId] # print the resume command without running it
```

`smdg ai studio` options: `--port <port>`, `--dev-ui` (API-only + Vite dev server instructions), `--api-only`.
`smdg ai resume`/`continue` options: `--new-terminal` (open a new terminal window instead of resuming in the current one), `--copy` (print the command instead of running it, `resume` only).

Not yet built (tracked as follow-up — this is a first, Phase 1 milestone, not the full spec): the Graph view, loop/dead-end detection, context-quality and instruction-compliance analyzers, session comparison, project-level analytics, prompt-quality analysis, rule/skill recommendations, the global quick-launch picker (Ctrl+K) and command palette (Ctrl+Shift+P), session aliases, and renaming a Claude session from within Studio. The session list, turns, timeline, tool/error/file/verification analysis, redaction, incremental ingestion, exports, and the resume/launch actions above are all real and working today, including against real session history.
