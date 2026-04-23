# @razroo/iso-trace

**Local observability for AI coding agent transcripts.**

`agentmd` scores per-rule adherence, `isolint` lints prose portability,
`iso-harness` fans out the harness layout, and `iso-eval` scores task
success on synthetic workspaces. All of those work off signals *you
authored*. Once the agent is in a real user's hands, the rest of the
chain goes blind — and that's the gap this package closes.

`iso-trace` parses the transcript files Claude Code, Cursor, Codex, and
OpenCode already write to disk, normalises them into one event model,
and lets you ask the questions the rest of the chain can't:

- Which rules ever actually fire in production? (candidates to remove)
- Which tools does my agent reach for, in what order? (pattern drift)
- Which captured sessions would make good regression eval fixtures?
- Did the tool-call mix change after the last prompt edit?

Supported local sources today:

- Claude Code JSONL sessions in `~/.claude/projects/<encoded-cwd>/*.jsonl`
- Cursor JSONL agent transcripts in
  `~/.cursor/projects/<encoded-cwd>/agent-transcripts/<chat-id>/<chat-id>.jsonl`
- Codex JSONL sessions in `~/.codex/sessions/**.jsonl`
- OpenCode sessions discovered from `~/.local/share/opencode/opencode.db`
  and loaded via `opencode export <session-id>` for full-session reads.
  OpenCode `model-score` queries the SQLite store directly instead of
  replaying every export.

The event model is harness-agnostic, so consumers do not need to care
where a session came from.

> **Zero upload.** The tool never opens a network connection. Everything
> is local reads and stdout / user-specified file output.

## Install

```bash
npm install -D @razroo/iso-trace
```

## Event model

Every source is normalised into the same `Session → Turn → Event[]`
shape:

```ts
type Event =
  | { kind: "message",    role: "user" | "assistant" | "system", text: string }
  | { kind: "tool_call",  id: string, name: string, input: unknown }
  | { kind: "tool_result",toolUseId: string, output: string, error?: string }
  | { kind: "file_op",    op: "read"|"write"|"edit"|"list"|"search", path: string, tool: string }
  | { kind: "token_usage",input: number, output: number, cacheRead: number, cacheCreated: number, model?: string };
```

`file_op` events are *derived* from the file-touching tools each harness
emits (`Read`/`Write`/`Edit`, Codex `apply_patch` and common shell reads,
OpenCode `read`/`grep`/`glob`, and so on). The original `tool_call` is
always preserved alongside — nothing is lossy.

Claude Code `thinking` blocks are deliberately dropped on parse to keep
exported data safer to share. Everything else round-trips.

## CLI

```bash
iso-trace sources                # show detected transcript roots + parser status
iso-trace where                  # print the raw paths iso-trace scans

iso-trace list                   # recent sessions across every detected root
iso-trace list --since 7d
iso-trace list --cwd .           # only sessions whose cwd matches this project
iso-trace list --json            # machine-readable

iso-trace show <id-or-prefix>                       # full normalised event stream
iso-trace show cc_abcd1234 --events tool_call,file_op
iso-trace show cc_abcd1234 --grep "H3"              # regex across message + tool input

iso-trace stats                  # aggregate across all discovered sessions
iso-trace stats cc_abcd1234 cc_abcd5678
iso-trace stats --since 7d --cwd .
iso-trace stats --source path/to/sample.jsonl       # one file, no discovery needed

iso-trace model-score --cwd . --harness opencode --tool read
iso-trace model-score --since-hours 24 --harness opencode --tool read --fail-on-schema
iso-trace model-score --since 7d --tool Bash --json # model success/error scorecard

iso-trace export <id> --format jsonl --redact > session.jsonl
iso-trace export <id> --format json --redact-regex 'gho_[A-Za-z0-9]+'

iso-trace export-fixture <id> --out fixtures/my-task/         # lift a session into an iso-eval fixture
iso-trace export-fixture --source path/to/sample.jsonl --out fixtures/my-task/
iso-trace export-fixture <id> --out fixtures/my-task/ --runner claude-code --harness-source dist --edit-checks exists-only --run
```

Session IDs are 8-char prefixes derived from path + first-line hash, so
they're stable across reads and unambiguous by design. Prefix matching
follows git's semantics: unique prefix wins, multiple matches errors.

### `model-score` — which models are using tools correctly?

`model-score` is currently available for Claude Code, Codex, and
OpenCode. Cursor transcripts are parsed and exportable, but they do not
yet expose stable model IDs or tool-result metadata, so Cursor is
intentionally excluded from scorecards for now.

`model-score` groups tool calls by the model that emitted them and
reports call volume, success/error counts, schema-error counts, and the
latest observed timestamp.

For OpenCode, `--tool read` also breaks out the observed input shape, so
you can spot schema drift immediately:

```bash
iso-trace model-score --cwd /path/to/project --harness opencode --tool read
```

If a weak route is sending `read({ path: ... })` instead of
`read({ filePath: ... })`, the scorecard will show that in the `path` /
`file_path` columns together with the schema-error rate.

OpenCode windows are filtered by the actual tool event timestamp, not
just the session start time, so long-running sessions do not hide fresh
regressions near the end of a conversation.

For routing and schema guardrails, `model-score` can also fail
non-zero:

```bash
iso-trace model-score \
  --cwd /path/to/project \
  --harness opencode \
  --tool read \
  --since-hours 24 \
  --fail-on-schema \
  --fail-on-model openrouter/minimax/minimax-m2.5:free
```

`--fail-on-model` is repeatable, so you can block multiple routes in one
check.

### `export-fixture` — turn an observed session into a regression fixture

When a real session does something you want to lock in as an `iso-eval`
regression test, `export-fixture` lifts it into a fresh suite:

```
fixtures/my-task/
├── task.md      — the first user message from the session
├── workspace/   — empty placeholders for every file the agent read
└── checks.yml   — runner metadata plus file_exists per write; edits can
                   emit file_contains placeholders or exists-only checks
```

This is a *seed*, not a perfect replay — iso-trace can't know the
agent's starting workspace, and it can't guess what "success" should
assert. Review `checks.yml` and fill in any baseline workspace files,
then drop the directory into an iso-eval suite and run
`iso-eval run fixtures/my-task/checks.yml`.

For a faster path from "observed failure" to "rerunnable suite":

- `--runner <fake|codex|claude-code|cursor|opencode>` persists the intended eval runner.
- `--harness-source <path>` persists which generated harness files should
  be staged into each rerun workspace.
- `--edit-checks exists-only` avoids `REPLACE_ME` placeholders so the
  exported suite can smoke-run immediately.
- `--run` invokes `iso-eval run` directly after export.
- `--redact` and `--redact-regex` scrub the exported task text and paths
  before anything is written.

## Library API

```ts
import {
  discoverSessions, loadSessionFromPath, filter, stats, exportSession,
} from "@razroo/iso-trace";

// discovery: autodetects Claude Code, Cursor, Codex, and OpenCode local sources
const refs = await discoverSessions({ since: "7d", cwd: process.cwd() });

// load + normalise one session
const session = loadSessionFromPath(refs[0].source.path);

// query
const bash = filter(session, (e) => e.kind === "tool_call" && e.name === "Bash");

// aggregate
const s = stats([session]);
// → { sessions, turns, durationMs, tokens, toolCalls, fileOps, filesTouched }

// export
process.stdout.write(exportSession(session, "jsonl"));
```

Bring your own roots (e.g. a CI agent that captures Claude/Codex JSONL
under an arbitrary directory, or a host with OpenCode's default DB):

```ts
await discoverSessions({ roots: ["/path/to/captured/transcripts"] });
```

## How this fits the rest of the monorepo

```
agent.md → agentmd → isolint → iso-harness → CLAUDE.md / AGENTS.md / .cursor/rules

                (user runs the agent in production — hours / days / weeks)
                                     │
                           transcripts on disk
                                     │    iso-trace
                                     ▼
                     normalised Session / Event stream
                 ┌───────────────────┼───────────────────┐
                 ▼                   ▼                   ▼
        iso-trace stats       export             agentmd
        (firing rates,        → iso-eval         adherence from
         tool patterns)        regression        production traces
                               fixtures
```

Other packages depend on `iso-trace`; the reverse never holds. A bare
Claude Code user with none of the other `@razroo/*` packages installed
still gets value from `iso-trace` alone.

## Privacy posture

- Transcripts may contain code snippets, shell commands, and occasionally
  secrets. `iso-trace` never transmits them over the network.
- `show` and `export` write to stdout or user-specified paths only. The
  tool will never edit, move, or delete a transcript.
- `--redact` scrubs source paths, cwd/home prefixes, common API keys,
  bearer tokens, and private-key blocks. `--redact-regex` lets you add
  project-specific denylist patterns.
- `export-fixture --redact` applies the same scrubbing before it writes
  `task.md`, `workspace/`, and `checks.yml`.
- `thinking` blocks are stripped on parse so exports don't accidentally
  publish internal reasoning.
- Inspect exports before sharing anyway; redaction reduces risk, it does
  not make arbitrary transcripts safe by magic.

## License

MIT — see [LICENSE](./LICENSE).
