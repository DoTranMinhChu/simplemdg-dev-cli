# SimpleMDG Dev CLI

SimpleMDG local development helper for npm install workflows, SAP CAP, Cloud Foundry/BTP, request tracing, GitLab sync, and BTP database exploration.

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
