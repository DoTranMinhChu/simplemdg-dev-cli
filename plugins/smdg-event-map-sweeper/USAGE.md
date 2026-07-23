# Event/Queue Map Sweeper (`smdg-event-map-sweeper`)

A subagent that sweeps a set of repos you name for SAP CAP messaging patterns and builds a cross-referenced producer/consumer index of event topics — `.claude/knowledge/event-map.md`.

You normally invoke this deliberately, not per bug ticket — think of it as bootstrapping or refreshing knowledge, the same way you'd point `smdg-knowledge-bootstrap` at a set of repos. `smdg-root-cause-tracer` reads (and incrementally appends to) `event-map.md` on its own whenever a ticket's symptoms look event/queue-shaped, but it never runs this sweeper itself — the sweeper is a separate, wider pass you run when you want the map to cover more ground than what individual tickets have happened to touch.

Depends on: nothing (no MCP servers, no browser tools — it works entirely off files already on disk).

Give it either:
- A specific list of repo paths or domain-folder names to sweep, or
- "All" — in which case it reads `.claude/knowledge/repo-map.md` and sweeps every repo already marked `status: checked-out` there. If that map doesn't exist yet, it will ask you which folders to sweep instead of guessing.

It:
- Skips any target repo that isn't actually checked out (a bare `.git` folder), noting it rather than failing the whole sweep.
- Greps only for messaging touchpoints (`srv.emit`/`srv.on` filtered to topic-shaped first arguments, `cds.connect.to('messaging')`, and messaging/destination keys in `mta.yaml`/`.cdsrc.json`) — never a general-purpose code scan.
- Cross-references matches by normalized topic string across every repo it swept, so one topic's producer and all its known consumers land in a single `event-map.md` entry.
- Appends to `event-map.md` (creating it if needed) using the same append-only discipline as `repo-map.md` — existing entries are never edited or deleted, only superseded by a newer entry appended after them.

It stops and asks — rather than guessing — when it's told "all" but no `repo-map.md` exists yet to seed the scope from.

Known gotcha it deliberately guards against: `srv.on('CREATE', 'SomeEntity', ...)` is an ordinary CAP request hook, not a queue-event subscription — the sweeper only treats an `srv.on(` call as a consumer registration when its first argument actually looks like a topic string (contains `/` or `.`), not a bare CRUD verb/entity name.

## Knowledge output

`.claude/knowledge/event-map.md` — a plain project file, not installed or managed by this plugin directly (same posture as `repo-map.md`), safe to commit or `.gitignore` per your team's preference. One block per distinct topic: producer repo/function, consumer repo(s)/handler(s), queue binding name (if discoverable from config), retry/DLQ notes, and a status that distinguishes "not checked out" from "producer-only" or "consumer-only" (a genuine structural gap, not a missing checkout).
