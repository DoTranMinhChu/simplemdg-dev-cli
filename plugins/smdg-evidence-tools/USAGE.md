# Evidence File Tools (`smdg-evidence-tools`)

Registers one MCP server, `smdg-evidence-tools`, at **user scope** (machine-wide), wrapping
`@negokaz/excel-mcp-server@0.12.0` — same rationale as `smdg-playwright-browsers`: local
file-reading capability is a machine concern, not a per-repo one.

## What it's for

Reads locally-downloaded `.xlsx`/`.xlsm`/`.xltx`/`.xltm` files that `Read`/`Grep`/`Glob` cannot
parse (they're binary). Exposes (among others) two read tools an agent can use once this plugin is
installed:
- `mcp__smdg-evidence-tools__excel_describe_sheets` — lists sheet names/dimensions in a workbook
- `mcp__smdg-evidence-tools__excel_read_sheet` — reads cell values from a sheet, paginated
  (`EXCEL_MCP_PAGING_CELLS_LIMIT` env var, default 4000 cells per call)

You normally won't install this directly — it's pulled in automatically as a dependency of
`smdg-jira-reproducer` (and transitively by `smdg-jira-fix-issue`), used when a user hands the
pipeline a local evidence folder path containing an Excel file (e.g. the actual spreadsheet used
for a mass upload, or a downloaded report export).

## Known limitations

- Only reads `.xlsx`/`.xlsm`/`.xltx`/`.xltm` — not legacy `.xls` or `.csv`.
- The underlying package also exposes write/formatting tools (`excel_write_to_sheet`,
  `excel_create_table`, `excel_format_range`, `excel_copy_sheet`). This pipeline's agents are never
  granted those in their own `tools:` frontmatter allowlist — only the two read tools above — so
  they're registered by the server but unreachable by any agent in this pipeline. Do not wire a new
  agent to the write tools without a deliberate review, since these evidence files can be real
  customer SAP master data.
- No pagination-limit override is currently plumbed through this CLI's plugin mechanism (an
  `mcp-bundle`'s `TMcpServerSpec` only has `package`/`args`, no env-var passthrough) — the
  package's 4000-cell default applies as-is.

Verify registration any time with `claude mcp list`. If Claude Code was already running when this
installed, restart it so the new MCP server loads.
