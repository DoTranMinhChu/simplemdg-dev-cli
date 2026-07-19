# SimpleMDG CLI User Guide

## Interactive shell — SimpleMDG Developer Console

Run `smdg` with no arguments, or `smdg shell`, to open a persistent interactive console instead of the plain command list. It is purely additive: every command in this guide still works exactly as documented when typed directly (`smdg cf apps`, `smdg git move-code --source staging --target uat`, scripts, CI), whether or not you ever open the shell.

The shell falls back to today's plain output automatically whenever it can't safely take over the terminal — piped/redirected output, `CI=true`, or any non-interactive invocation — so nothing breaks in automation.

### Layout

```text
╭──────────────────────────────────────────────────────────────────╮
│ SimpleMDG Developer Console                              v3.0.0 │
│ simplemdg-dev-cli  ·  Branch: staging                           │
╰──────────────────────────────────────────────────────────────────╯

Ready

Type a command, ask for help, or press / to browse actions.

Environment
✓ Git
✓ SAP CDS CLI
✓ Cloud Foundry CLI

Recent actions
1. git move-code
2. cf apps

Quick actions
❯ /git move-code
❯ /ai resume
❯ /cf apps
❯ /cf db studio

❯
/ Commands   Ctrl+K Palette   Ctrl+R History   Ctrl+P Recent   Ctrl+C Exit
```

The header only ever shows facts it actually detected (project name, current git branch) — never a fabricated environment. `/header compact|expanded|hidden` (persisted to `~/.simplemdg/cache.json`) controls how much of it shows.

### Command palette

Press `/` at any time (even mid-word — it only triggers as the very first character typed) to open a fuzzy-searchable palette across every command group: `cf`, `cds`, `gitlab`, `git`, `npmrc`, `ai`. Keep typing to filter by name, description, category, or natural-language keyword (e.g. typing `move code` or `open db` finds `/git move-code` / `/cf db studio` even if you don't remember the exact subcommand name). Arrow keys navigate, `Enter` runs the highlighted command, `Esc` closes the palette without doing anything.

Only `git move-code` and `cf org` currently have a bespoke in-shell screen (below) — they run in-process, through the shared interaction service, with no external prompt library involved. Every other command still runs when you pick it, but via **external-process mode**: the shell cleanly unmounts, prints `→ smdg cf apps (external process mode)`, runs the real command as its own child process with the terminal handed to it directly, waits for it to finish, then remounts the shell. This is deliberately different from an earlier version of the shell, which tried to run a not-yet-migrated command's interactive prompts while the shell itself stayed involved — that let two different terminal-input systems fight over stdin at once and crashed (the "Mark this target as favorite?" crash was exactly this). External-process mode never has that conflict: only one process owns the terminal at a time, and the shell resumes cleanly afterward — press Enter at the "Press Enter to return to the console..." prompt to come back.

### `cf org` in the shell

Picking `/cf org` runs the same Cloud Foundry target-switcher, favorites, and region-management menus as `smdg cf org` typed directly, entirely through the shell's own widgets — the "Mark this target as favorite?" confirmation, the target picker, and the region toggles all render natively, with no `prompts`-library dialogs at any point.

### `git move-code` in the shell

Picking `/git move-code` (or the Home screen quick action) runs the same guided workflow described in [Git move-code (release dependency tracing)](#git-move-code-release-dependency-tracing) below, rendered as a live 8-step tracker:

```text
Move Code Assistant

1 ✓ Fetch branches
2 ✓ Search commits
3 ● Select commits
4 ○ Create release branch
5 ○ Cherry-pick
6 ○ Build
7 ○ Trace dependencies
8 ○ Summary
```

Every prompt along the way (branch pickers, commit search/selection, conflict resolution, build-command choice, the final push confirmation) renders as a searchable list, multi-select, or Y/n confirmation instead of a plain terminal prompt — but it is the exact same underlying logic as the traditional command, so behavior (safety rules, what gets committed/pushed) is identical either way. `Ctrl+C` cancels the run — it aborts any in-flight git/build process, not just the on-screen UI.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Open the command palette |
| `Ctrl+K` | Open the command palette (alternate binding) |
| `Ctrl+R` | Search command history |
| `Ctrl+P` | Show recent commands |
| `Ctrl+L` | Clear the visible scrollback |
| `Ctrl+C` | Cancel the running command; press again while idle to exit the shell |
| `↑` / `↓` | Navigate a list, or step through your input history when the composer is empty |
| `Enter` | Submit the current input, or select the highlighted item |
| `Tab` | Autocomplete to the highlighted choice in a searchable list |
| `Alt+Enter` | Insert a newline in the command composer (multiline input) |
| `Esc` | Close the palette, or cancel the current prompt |

`Shift+Enter` is supported for multiline input where the terminal reports it distinctly from plain `Enter`, but this is not universal across terminals in raw input mode — `Alt+Enter` is the reliable binding on every terminal we test against (Windows Terminal, PowerShell 5.1/7, VS Code's integrated terminal).

### History, recents, and favorites

Every command launched from the shell is recorded to `~/.simplemdg/history.json` — command path, project, timestamp, duration, and success/failure. Values that look like a password/token/secret/API key are never written, even redacted-in-part. `Ctrl+R` searches this history; `Ctrl+P` shows the most recent entries; the Home screen's "Recent actions" and the palette's ordering both draw from the same file.

### Themes

Three built-in themes: SimpleMDG Dark, High Contrast, and No Color. Setting the `NO_COLOR` environment variable (to any value) always forces the No Color theme, regardless of the configured preference.

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

### Getting back to old work

Every session view has a **▶ Resume in Claude Code** button, plus a **More ▾** menu — the same actions are also on each session row in the sidebar (hover for a quick-resume icon, right-click for the full menu) and on the "Continue working" widget shown when no session is selected:

- **Resume in Claude Code** opens a new terminal window already running `claude --resume <sessionId>` in the right project folder. A confirmation dialog shows you the exact command first (with a "don't ask again" option) — nothing runs silently.
- **Continue latest session in project** runs `claude --continue` instead — useful when you want "wherever I left off in this project", not this exact session.
- **Copy Resume Command** / **Copy Resume Command (with cd)** copy the command instead of running it, so you can paste it into a terminal you already have open.
- **Copy Suggested Continuation Prompt** builds a "resume with context" prompt from that session's own observed outcome, verification results, errors, and touched files — handy to paste as your first message in the new session.
- **Pin** and the star **Favorite** toggle are Studio-only bookmarks; they never touch the underlying Claude/Codex session file.
- **Open Project Folder** / **Open Project in VS Code** fail gracefully (with a clear message) if the folder is gone or `code` isn't installed — they never crash the Studio.

Codex sessions don't show a resume action yet — there's no verified `codex` resume command to offer, so Studio says so plainly instead of guessing one.

### Privacy

Everything stays on your machine. The server binds to `127.0.0.1` only, session files are opened read-only and never modified, and data lives in `~/.simplemdg/ai-studio/traces.db`. Session titles, error messages, commands, and observation text are redacted by default (Bearer/JWT tokens, API keys, GitLab/GitHub tokens, AWS keys, private key blocks, plain-text "password:"/"pin:"/"token:" mentions). Each session workspace has a **"Show sensitive content"** checkbox to reveal the original text for that session only — an explicit, local, per-view action, not a default.

### Terminal alternatives

```powershell
smdg ai sessions               # table of recent sessions
smdg ai inspect <sessionId>    # one session's summary (prompts you to pick one if omitted)
smdg ai doctor                 # ingestion status + parser diagnostics + storage location
smdg ai scan                   # re-scan for new/changed session files
smdg ai export <sessionId>     # Markdown/JSON export to stdout
smdg ai resume [sessionId]     # resume a Claude Code session right from the terminal
smdg ai continue [sessionId]   # claude --continue in that session's project
smdg ai open [sessionId]       # open the project folder (--vscode for VS Code instead)
smdg ai copy-command [sessionId]  # print the resume command without running it
```

`smdg ai resume`/`continue` prompt you to pick a session if you omit the ID, then resume it directly in your current terminal (add `--new-terminal` to open a separate window instead, or `--copy` on `resume` to just print the command).

`smdg ai studio` requires Node.js 22.5+ (for the built-in `node:sqlite` module used for local storage); every other `smdg` command keeps working on older Node versions. If you're on an older Node, `smdg ai doctor`/`studio` will tell you clearly instead of crashing.

Not yet built: the Graph view, loop/dead-end detection, context-quality and instruction-compliance checks, session comparison, project-level analytics, rule/skill recommendations from repeated findings, the global quick-launch picker (Ctrl+K), a command palette (Ctrl+Shift+P), session aliases, and renaming a Claude session from within Studio. These are tracked as follow-up phases, not abandoned.

## Code Intelligence (GitNexus)

**Code Intelligence** is a tab inside AI Studio that answers questions a normal code search can't: *what calls this function*, *what breaks if I change it*, and *did the AI agent that just edited this file actually look at everything it should have*. Under the hood it's powered by [GitNexus](https://github.com/abhigyanpatwari/GitNexus), a local code-knowledge-graph engine — but you never need to know that, write a graph query, or understand what a "knowledge graph" is. Everything runs on your machine; nothing about your code is uploaded anywhere.

The value in one example: instead of "8 incoming edges", Code Intelligence tells you **"Used by 6 direct callers and participates in 3 business flows"** — a plain sentence you can act on.

### First-time setup

1. `smdg ai studio` → click **Code Intelligence** in the left navigation rail.
2. Click **+ Add** → point it at a parent folder (defaults to the current directory) → **Discover** finds every git repository nested inside it, however deep. Useful for products where the "project" is actually dozens of independent repositories.
3. Tick the repositories you care about → **Analyze**. This builds a local index (a `.gitnexus/` folder inside each repo — never touching your source files) — seconds for a small repo, longer for a large one. The very first analysis on a machine also has to fetch GitNexus itself once (via `npx`), which adds some extra time only that first time.
4. Pick an analyzed repository from the list. You land on **Overview**.

### What each tab does

- **Overview** — a plain-English summary: how many files/functions/dependencies GitNexus found in this repo, whether the index is up to date, and a button into the graph explorer. No graph, no jargon — just numbers you can act on.
- **Graph** — GitNexus's own interactive graph explorer, embedded directly and already pointed at the repository you selected (you don't need to pick it again). Pan, zoom, and click through files/functions/classes to see how they connect — this is where you explore "how does X work" or "what calls this".
- **Change Impact** — pick a scope (uncommitted changes, staged changes, one commit, or branch vs. branch) or type a specific function/class name, and get back a plain risk level (Low/Medium/High/Unknown) *with the reason spelled out* — never a bare number or score. Use this before you commit, to see who else might be affected by what you just changed.
- **AI Agents** — one click to let Claude Code or Codex query this same knowledge graph directly while they work, instead of guessing from what they can `grep`. Removable the same way if you change your mind.

### Workspaces (multi-repo)

If what you're actually working on is several repositories that belong together (a frontend, its backend, shared packages), switch to the **Workspaces** tab in the sidebar, create one, and add each repository to it under a short name (e.g. `frontend`, `backend`). Click **Sync** and GitNexus cross-references the members for shared HTTP endpoints/package usage between them — shown with a **Suggested** badge (it detected the relationship by matching, not a hand-confirmed link) — plus lets you check whether a change in one repository could ripple into another.

### Inside an AI session

Every Claude Code / Codex session under **Sessions** gets its own **Code Intelligence** tab, comparing the files that session actually touched against what GitNexus reports as related in that same repository right now — a concrete finding like *"the agent touched every file GitNexus flagged as changed"*, or a named list of files it never inspected. The **Copy Suggested Continuation Prompt** action folds these findings in automatically once the project has been analyzed.

### Privacy

Everything is local: analysis runs on your machine, indexes live in `.gitnexus/` inside each analyzed repository (source files are never modified), and GitNexus's own local server binds to `localhost` only. Removing a repository from Code Intelligence deletes its index — never your code.

### Terminal alternatives

```powershell
smdg ai nexus setup                    # guided install check + agent config + analyze current repo
smdg ai nexus status                   # readiness + analyzed repos at a glance
smdg ai nexus analyze [path]           # analyze a repository (index-only by default)
smdg ai nexus discover [folder]        # find nested git repositories under a folder
smdg ai nexus changes [--staged|--commit <hash>|--branch <src:tgt>]   # change impact analysis
smdg ai nexus impact <symbol>          # blast-radius for one function/class
smdg ai nexus trace <symbol>           # callers/callees for one function/class
smdg ai nexus overview                 # project overview for an analyzed repo
smdg ai nexus configure --agent <claude|codex|cursor|opencode>   # connect an AI agent
smdg ai nexus workspace <list|create|add|remove|sync|status|contracts|impact|query>
smdg ai nexus graph                    # open GitNexus's own graph explorer in your browser
smdg ai nexus doctor                   # diagnose Code Intelligence problems
```

### Known limits (today)

Full-text keyword search (`smdg ai nexus search`) exists at the CLI level but isn't in the Studio UI today — GitNexus's own search index has been unreliable on some machines (its own diagnostics can report the search extension as unavailable, a native-module limitation independent of anything this integration controls), so the **Graph** tab is the primary way to explore code inside Studio for now. Cross-repo relationship detection in Workspaces works best once every member has been analyzed and the workspace has been synced at least once. GitNexus doesn't understand SAP CAP/CDS files directly — it sees the surrounding TypeScript/JavaScript, not `.cds` service/entity definitions.

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
