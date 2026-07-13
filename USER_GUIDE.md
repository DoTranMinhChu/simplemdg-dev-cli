# SimpleMDG CLI User Guide

## Smart cache

The CLI caches slow BTP/Cloud Foundry/GitLab lookups under `~/.simplemdg/cache/` and serves them **cache-first, then refreshes in the background** (stale-while-revalidate). You see the last known result instantly; fresh data replaces it quietly when the refresh finishes.

What it means in practice:

- `smdg cf apps`, `smdg gitlab groups`, `smdg gitlab projects` show cached results immediately with a note like *"Using cached apps … from 4 minutes ago. Refreshing in background…"*, then update the cache.
- Add `--refresh` to any of those to force a live fetch and skip the cache.
- If a refresh fails (e.g. expired CF session, no network), the **old cache is kept** and you get a warning — you can keep working.
- Concurrent requests for the same data share a single network call (deduplication).

Manage the cache:

```powershell
smdg cache             # interactive menu
smdg cache status      # what is cached and how old it is
smdg cache clear cf    # clear a scope: all | cf | gitlab | db | target
smdg cache refresh cf  # invalidate so the next command refetches
```

Default freshness windows (configurable later): CF apps 10 min, CF env 5 min, CF orgs/spaces 6 h, CF regions 7 days, GitLab groups 6 h, GitLab projects 30 min. **Secrets are never stored in plain cache files** — passwords/tokens/DB credentials stay in the existing encrypted stores.

### CF target switcher (`smdg cf org`)

When you work across many regions/orgs, `smdg cf org` is a fast target switcher:

```txt
CF Target Switcher
Favorites
  ★ eu20 / arthrex-qas-simplemdg / app
Recent
  ◷ br10 / single-npi-laidon / app
  ◷ us21 / par-pacific-qas-simplemdg / app
All Targets (243)
  ...
```

- Browsing is **instant** — it reads cached targets and doesn't need a CF login.
- Type to search; favorites (★) appear first, recent (◷) second, then all cached targets.
- Switching sets the API endpoint, **auto re-logs-in from your saved credentials** (no repeated password prompts), targets the org and space, and saves the target to *recent*. You're offered to mark it a **favorite**.
- *Refresh all regions* rescans live; *Manage favorites* removes saved favorites.
- Favorites/recent are stored under `~/.simplemdg/cache/` and show up in `smdg cache status`; clear them with `smdg cache clear target`.

## GitLab

Login once:

```powershell
smdg gitlab login
```

The CLI opens the GitLab token page, tries to detect the copied token from clipboard, validates it, caches it, and approves it for Git Credential Manager.

Clone or pull:

```powershell
smdg gitlab clone
smdg gitlab pull
```

The flow is split clearly:

1. Pull/clone a GitLab group
2. Pull/clone a single repository

Then select root group, destination folder, sync action, and parallel jobs.

## CF DB Studio

A local database explorer for SAP HANA and PostgreSQL, with one-click import of credentials from BTP apps. The studio runs a web server bound to `127.0.0.1` only and opens your browser. The UI is a React + Vite frontend (`studio/`) served as static assets by the local backend; the browser only ever sees connection/target ids, never passwords or tokens.

### Recommended flow

1. Run `smdg cf login` (once; you can save the password for auto re-login)
2. Run `smdg cf db studio`
3. Open the **BTP Import** tab → **Load CF apps**
4. Select an app → its `cf env` is read and database services are detected
5. Click **Save+Use** on a detected service → the connection is tested and activated
6. Pick the connection in the left sidebar, choose a schema
7. Browse tables/views in the Object Explorer, or write SQL in the **SQL Console**
8. Run with **Ctrl+Enter**, export to CSV/JSON, save the query, or open table **Data**

The studio never deploys anything to BTP and never shows the database password.

### Layout

The Studio opens on a **Welcome page**. The left side has three collapsible sections — **Connections** (cards with color/environment/favorite, right-click for actions), **Object Explorer** (a lazy DBeaver-style tree), and **Saved Queries**. Work opens as **tabs** in the main area only when you act on something.

- **Object Explorer** — expand a connection → Catalog → Schemas → a schema → folders (Tables, Views, Procedures, Functions, Synonyms). Children load only when expanded; each folder has its own search and a count badge. Double-click a table to open its data; right-click for Open Data / Open Structure / Generate SELECT / Generate COUNT / Copy Full Name.
- **SQL tabs** — open from the Welcome page, a table's Structure → DDL tab, or a saved query/history entry. Run with **Ctrl+Enter** or the Run button, format, pick a row limit, export the result as CSV/JSON, save as a named query. Dangerous statements (DROP/TRUNCATE/ALTER/GRANT/REVOKE) require confirmation; read-only mode blocks writes.
- **Data tabs** — a compact, icon-based toolbar gives the **WHERE filter** most of the width (Enter applies); next to it are small icon buttons: Apply ▶, Refresh ⟳, Insert ＋, Delete 🗑 (danger), Structure ▦, and Export (current page as CSV). Click a column header to **sort** (click again to flip direction). **Pagination sits in a footer** below the table showing the range, duration, page-size and ◀/▶ buttons. Click a row number to select it (used by Delete). For tables with a primary key you can **edit inline** (double-click a cell), **Insert** (a blank editable row), and **mark rows for delete** — nothing is applied until **Save Changes**. A pending-changes bar (edit/insert/delete counts) offers Save / Revert; if some rows fail to save, only the successful ones clear and the rest stay pending with an error marker.
- **Structure tabs** — Columns (name, type, length, scale, nullable, key, default, comment), Indexes + primary key, generated **DDL**, and table Info (row count).
- **BTP Import wizard** — a modal (Target → App → Services → Save) that reads `cf env`, detects HANA/PostgreSQL services, and saves a connection with a display name, color, environment, and favorite.

The bottom status bar shows connection state, last query duration, row count, and pending-change count.

### Productivity features

- **Workspace restore** — your open tabs (including unsaved SQL content) are auto-saved and restored next time you open the Studio, unless you turn this off in Settings.
- **Tabs** — pin, close, right-click for Close / Close Others / Close Tabs to the Right / Rename / Duplicate / Pin. Closing and reopening preserves scroll/edit state while the app is running (all open tabs stay mounted, just hidden).
- **SQL editor** — `Ctrl+Enter` or the Run button executes the editor content, server-side **Format** pretty-prints, **Save** writes to a named saved query (or Save As for a new one).
- **Grid editing** — click a column header to sort, double-click a cell to edit inline, **Insert row** / **mark rows for delete**, a pending-changes bar shows edit/insert/delete counts with **Save** / **Revert**. If a save partially fails, only the successful rows clear — failed rows stay pending with an error marker so you don't lose the edit.
- **Object tree context menu** — Open Data, Open Structure, Generate SELECT (opens a SQL tab), Generate COUNT, Copy SELECT/INSERT/UPDATE, Copy Name/Full Name.
- **Search** — connections, object tree, saved queries, and history all have a search box with Esc-to-clear.
- **Cell Value Inspector** — double-click a non-editable cell (or use the inspector from an editable one) to see Preview/Formatted/Raw/Edit/Metadata views, with copy-raw, copy-formatted, and copy-as-SQL-literal.

Not yet ported from the previous (pre-React) build: tab drag-to-reorder and tab groups, the command palette (`Ctrl+Shift+P`), per-cell undo/redo history, the SQL Run ▾ dropdown (Run Selected/Current Statement/Explain — Run currently always executes the whole editor), the per-cell right-click menu with active-cell keyboard navigation, the data grid's "Show generated SQL" preview popover, the pending-changes "Show Changes" diff modal, and the connection sidebar's group-by selector.

Settings, the workspace, saved queries, and history live under `~/.simplemdg/` (`db-studio-settings.json`, `db-studio-workspace.json`, `db-queries/`, `db-query-history.json`).

### Read-only and dangerous SQL

Toggle **Read-only** in the top bar to block INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE. Even in read/write mode, dangerous statements (DROP, TRUNCATE, ALTER, DELETE/UPDATE without WHERE) require confirmation. A "Production-like" badge appears for prod-looking orgs/apps.

### Terminal alternatives

```powershell
smdg cf db add           # add a direct connection manually (host/port/user/password)
smdg cf db import        # interactive import from a BTP app
smdg cf db connections   # manage cached connections
smdg cf db query         # run one SQL query and print/export the result
smdg cf db console        # interactive SQL REPL
```

### Direct connections (no CF app)

Not every database is behind a Cloud Foundry app (for example a Neon PostgreSQL or a standalone HANA Cloud). Add those directly:

- In the Studio: click **+ New** in the Connections sidebar, fill in type/host/port/database/schema/user/password, click **Test**, then **Save & use**.
- In the terminal: `smdg cf db add`.

Direct connections are cached and encrypted exactly like imported ones, so they reappear next time you open the Studio.

Console slash commands: `/connect`, `/schemas`, `/tables`, `/desc TABLE`, `/top TABLE`, `/count TABLE`, `/save NAME`, `/history`, `/export csv|json`, `/full`, `/clear`, `/help`, `/exit`.

## DB cache

Connections are cached under:

```text
~/.simplemdg/db-connections.json
```

Saved queries live in `~/.simplemdg/db-queries/` and history in `~/.simplemdg/db-query-history.json`.

Passwords are encrypted with a key derived from the current Windows user + machine. A cache file copied to another machine cannot be decrypted, and the password is never sent to the browser.

## AI Studio

`smdg ai studio` opens a local, private browser UI for analyzing your own Claude Code and Codex history — what an agent actually did across a session, whether it was verified, and where it wasted time.

### Recommended flow

1. Run `smdg ai studio` — it scans `~/.claude/projects` and `~/.codex/sessions`, ingests anything new, and opens the browser.
2. Pick a session in the left sidebar (search or filter by provider/project/errors).
3. Read the **Overview** tab first: duration, tokens, the derived **outcome**, and *why* — it's built from observed typecheck/build/test/lint commands, never from the assistant just saying "done".
4. Open **Turns** to see the session broken into human-prompt → agent-response turns; expand a turn to see its tool calls and output.
5. Open **Timeline** for a straight chronological view, with filters to hide reasoning or show only errors/tool activity.
6. Click **Export Markdown** on the Overview tab to save a shareable summary (secrets redacted).

### Privacy

Everything stays on your machine. The server binds to `127.0.0.1` only, session files are opened read-only and never modified, and data lives in `~/.simplemdg/ai-studio/traces.db`. Session titles, error messages, commands, and observation text are redacted by default (Bearer/JWT tokens, API keys, GitLab/GitHub tokens, AWS keys, private key blocks, plain-text "password:"/"pin:"/"token:" mentions). Each session workspace has a **"Show sensitive content"** checkbox to reveal the original text for that session only — an explicit, local, per-view action, not a default.

### Terminal alternatives

```powershell
smdg ai sessions              # table of recent sessions
smdg ai inspect <sessionId>   # one session's summary (prompts you to pick one if omitted)
smdg ai doctor                # ingestion status + parser diagnostics + storage location
smdg ai scan                  # re-scan for new/changed session files
smdg ai export <sessionId>    # Markdown/JSON export to stdout
```

`smdg ai studio` requires Node.js 22.5+ (for the built-in `node:sqlite` module used for local storage); every other `smdg` command keeps working on older Node versions. If you're on an older Node, `smdg ai doctor`/`studio` will tell you clearly instead of crashing.

Not yet built: the Graph view, loop/dead-end detection, context-quality and instruction-compliance checks, session comparison, project-level analytics, and rule/skill recommendations from repeated findings. These are tracked as follow-up phases, not abandoned.

## Git move-code (release dependency tracing)

`smdg git move-code` is a release dependency tracing assistant: it moves a **scoped** set of commits from one branch to another across a microservice repository — typically `staging` → `uat` or `qas` — without ever merging the whole source branch and without blindly cherry-picking unrelated commits.

```powershell
smdg git move-code
smdg git move-code --source staging --target uat --scope SJS-2158
smdg git move-code --source staging --target qas --scope ParallelChange
smdg git move-code --path srv/functions/ParallelChange
smdg git move-code --symbol ActionValidateParallelChangeHandler
smdg git move-code --build "cds build"
smdg git move-code --dry-run
```

### What "scope" means

A scope is whatever identifies the code you want to move — it does not have to be a Jira ticket:

- Jira ticket key (`SJS-2158`)
- Feature name (`ParallelChange`)
- Branch name (`feature/FOM-2683`)
- File or folder path (`--path`)
- Class/function/type/API/entity name (`--symbol`)
- A specific commit hash (`--commit`)

If no flag is given, the CLI asks interactively how you want to search, and lets you combine multiple search methods before moving on.

### The guided flow

1. **Fetch branches** — `git fetch --all --prune`, then validates both branches exist on `origin`.
2. **Search commits** — searches `origin/<target>..origin/<source>` by keyword/ticket (`--grep`), by path (`git log -- <path>`), by symbol (`git grep` on the source branch, then logs the matching files), or a manual commit hash.
3. **Select commits** — candidates are shown tagged `[NORMAL]` or `[MERGE]`. You can pick the recommended set, normal commits only, inspect merge commits before including them, hand-pick commits, or search again. Merge commits always show their parents and the `diff --name-status <merge>^1 <merge>` before you decide.
4. **Create the release branch** — always branched **from the target**, never from the source: `git checkout <target> && git pull && git checkout -b release/<scope>-to-<target>`. If that branch already exists you're asked to reuse it, recreate it, rename it, or abort.
5. **Cherry-pick** — normal commits use `git cherry-pick <hash>`; merge commits always use `git cherry-pick -m 1 <hash>` (the mainline parent). Every command is printed before it runs.
6. **Resolve conflicts** — conflicts are explained per file (e.g. "modify/delete: the file was deleted in the target branch but modified by the cherry-picked commit") with explicit choices: keep the deletion, keep the incoming file, check remaining usages first, or abort. Nothing is auto-resolved.
7. **Build** — runs a configurable build/test command (`cds build`, `npm run build`, `npm test`, or a custom one); your choice is remembered per repository.
8. **Trace dependencies** — if the build fails, the CLI parses `Cannot find module '...'` and TypeScript type-mismatch errors, resolves the likely missing file(s) **on the source branch**, and shows which source commit introduced them. The recommended action is to check out only the missing files from that specific commit (`git checkout <commit> -- <files>`) — not to cherry-pick the whole dependency commit, and never to check out the latest file from `origin/<source>`.
9. **Summary and push** — shows `git log origin/<target>..HEAD`, `git diff --name-status`, and `git status` before asking to push. Nothing is pushed without confirmation.

### Dry-run

`smdg git move-code --dry-run` searches and prints the plan (candidate commits, the release branch that would be created) without creating a branch, cherry-picking, or touching any files.

### Related commands

- `smdg git pick` — search + cherry-pick only, for when you already have a release branch checked out.
- `smdg git trace` — re-run the build command and dependency tracing on the current branch state.
- `smdg git conflict` — guided resolution for a cherry-pick that's currently stopped on a conflict.
- `smdg git summary` — show the commit/diff summary against a target branch and optionally push.

### Multi-repository

Pass `--repos <path...>` to run the same scope search + cherry-pick + build across several repository checkouts in one pass; a final `Repo / Status` table is printed at the end.

### Safety rules

- Never merges the whole source branch into the target.
- Never cherry-picks the parent commits of a merge commit automatically.
- Never checks out a file from `origin/<source>` latest — dependency fixes always check out from the *specific* commit that introduced the file.
- Always shows the diff before pushing, and always asks for confirmation before `git push`.
- Never continues a cherry-pick past a conflict without an explicit choice.
