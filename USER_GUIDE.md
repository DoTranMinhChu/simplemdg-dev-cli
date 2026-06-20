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

A local database explorer for SAP HANA and PostgreSQL, with one-click import of credentials from BTP apps. The studio runs a web server bound to `127.0.0.1` only and opens your browser.

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
- **SQL tabs** — open from "Open SQL Console", "New query", "Generate SELECT", or a saved query. Run with **Ctrl+Enter**, format, explain (PostgreSQL), pick a row limit, export CSV/JSON, save to a `.sql` file. Dangerous statements require confirmation; read-only mode blocks writes.
- **Data tabs** — a compact, icon-based toolbar gives the **WHERE filter** most of the width (Enter applies, Ctrl+Enter applies + shows generated SQL); next to it are small icon buttons: Apply ▶, Show SQL, Refresh ⟳, Insert ＋, Delete 🗑 (danger), Structure ▦, and an **Export ⬇ menu** (current page / current query / selected rows as CSV/JSON, plus *Export custom…* for choosing source, columns and format). **Pagination moved to a footer** below the table showing the range, offset, duration, page-size and ◀/▶ buttons. Click row numbers to **multi-select** (Ctrl/Shift to add). For tables with a primary key you can **edit inline** (double-click a cell → yellow), **Insert** (green), and **mark rows for delete** (red) — deletes show a *"N rows marked for delete · Undo"* toast and aren't applied until **Save changes**. A colored pending bar (yellow edits · green inserts · red deletes) offers Save / Revert / Show changes. Right-click a row for **View details / Copy row JSON / Copy INSERT / Copy UPDATE**. Keyboard: `Ctrl+S` save, `Ctrl+Z`/`Ctrl+Y` undo/redo, `Delete` mark selected.
- **Structure tabs** — Columns (name, type, length, scale, nullable, key, default, comment), Indexes + primary key, generated **DDL**, and table Info (row count).
- **BTP Import wizard** — a modal (Target → App → Services → Save) that reads `cf env`, detects HANA/PostgreSQL services, and saves a connection with a display name, color, environment, and favorite.

The bottom status bar shows connection state, last query duration, row count, and pending-change count.

### Productivity features

- **Workspace restore** — your open tabs (including unsaved "New Query" content) are auto-saved and restored next time you open the Studio. Toggle this in **Settings**.
- **Tabs** — drag to reorder, right-click for Close / Close Others / Close to Right / Pin / Rename / Duplicate. `Ctrl+Tab` / `Ctrl+Shift+Tab` switch tabs, `Ctrl+W` closes the active tab.
- **Command palette** — press `Ctrl+Shift+P` to run any action (new SQL, run, save, import, toggle read-only, settings, …).
- **SQL editor** — `Ctrl+Enter` runs the selection or the statement at the cursor, `F5` runs the whole tab, the Run ▾ menu offers Run Selected / Current / All / Explain, and **Format** pretty-prints. `Ctrl+S` saves to a `.sql` file (or Save As).
- **Quick-filter SQL** — in a Data tab, type a `WHERE` and click **Show SQL** to see/copy the exact generated query or open it in a SQL console.
- **Grid editing** — `Ctrl+Z`/`Ctrl+Y` undo/redo pending edits, `Delete` marks the selected row, `Enter`/`Tab` confirm a cell and move. A change-summary bar shows counts and **Show Changes** lists every old→new value before you save.
- **Search** — every list highlights matches; press Enter to search, Esc to clear.
- **Cell viewer** — double-click a result cell to open a viewer that pretty-prints JSON.
- Press `Ctrl+Shift+P` → **Show Keyboard Shortcuts** for the full list.

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
