# OpenCode Memory Plugin

🧠 **Lightweight Markdown memory for OpenCode agents.**

OpenCode Memory is an OpenCode memory plugin that gives your coding agent a small, inspectable memory layer without a vector database, MCP server, cloud account, background daemon, or hidden state. It stores durable project facts, user preferences, useful commands, pitfalls, and decisions in plain `MEMORY.md` files.

Use it when you want future OpenCode sessions in the same repo to remember the few things that actually matter, while keeping every note readable, editable, and easy to supersede when it becomes stale. It also gives agents read-only Codex history search over standard Codex session transcripts.

![OpenCode Memory saving repo and user notes inside an OpenCode session](assets/opencode-memory.png)

## Features

- ✍️ **Markdown-first**: memory is text you can read, diff, edit, and delete.
- 🗂️ **Repo-aware**: each repository gets its own memory file in a central OpenCode memory folder.
- 🌍 **Global notes**: keep cross-project user preferences separate from repo-specific facts.
- 🧭 **Agent-callable**: OpenCode agents get native tools like `memory_recall` and `memory_remember`.
- 🔎 **Codex-aware**: optionally search existing Codex memory and standard Codex session transcripts read-only before promoting useful notes.
- 🪶 **Light by default**: no embeddings, no vector DB, no MCP server, no hosted service.
- 🚦 **Staleness-aware**: outdated notes are marked superseded instead of silently disappearing.
- 🔐 **Secret-conscious**: notes are lightly redacted before saving, and the policy tells agents not to store credentials.

## Quick Start

Clone and install locally:

```bash
git clone https://github.com/transportrefer/opencode-memory-plugin.git
cd opencode-memory-plugin
npm install
npm run build
npm run install:local
```

Restart OpenCode, then try:

```text
/memory
/memory deploy
/remember This repo deploys from GitHub Actions on main.
/codex-memory opencode config
/codex-sessions deploy
```

Headless OpenCode works too:

```bash
opencode run --command memory "deploy"
opencode run --command remember "This repo uses pnpm check before commits."
opencode run --command codex-memory "opencode slim"
opencode run --command codex-sessions "deploy"
```

Once the package is published, your OpenCode config can use the package name instead of a local `file://` checkout:

```jsonc
{
  "plugin": ["@kab/opencode-memory-plugin"]
}
```

## Give This To Your LLM Agent

Paste this into Codex, OpenCode, Claude Code, or another coding agent when you want it to install the plugin for you:

```text
Install the OpenCode Memory plugin from this repo.

Requirements:
- Create a timestamped backup of ~/.config/opencode/opencode.json before editing it.
- Run npm install, npm run build, and npm test.
- Add a file:// plugin entry for this checkout to ~/.config/opencode/opencode.json.
- Copy commands/*.md into ~/.config/opencode/commands/ unless they already exist; back up overwritten files.
- Do not store real memory data in the plugin repo.
- Verify that ~/.config/opencode/memory/projects.json exists.
- Verify with: opencode run --command memory "test"
```

## How It Works

Memory is stored outside the plugin source repo:

```text
~/.config/opencode/memory/
  global/
    MEMORY.md
  repos/
    <project-id>/
      MEMORY.md
  projects.json
```

Project ids are resolved in this order:

1. explicit aliases in `projects.json`
2. git remote identity
3. git common-dir/worktree identity
4. normalized path hash fallback

## Agent Tools

The plugin exposes these OpenCode tools:

| Tool | Purpose |
| --- | --- |
| `memory_recall` | Search global and repo memory. |
| `memory_remember` | Save a durable memory note. |
| `memory_supersede` | Mark an old memory superseded and optionally add a replacement. |
| `memory_list` | Show memory file locations and active/superseded counts. |
| `codex_memory_search` | Search Codex memory read-only. |
| `codex_session_search` | Search standard Codex session JSONL transcripts read-only. |

## Codex Session Search

For raw Codex history, the plugin reads the standard session logs under:

```text
$CODEX_HOME/sessions/**/*.jsonl
```

If `CODEX_HOME` is not set, it falls back to `~/.codex/sessions/**/*.jsonl`, matching Codex's default home directory. It does not depend on repo-local helper files such as `.codex/user-prompts.md`.

The agent-facing defaults are intentionally narrow: current repo only, user prompts only, recent 200 session files, no tool-call output, and no injected context wrappers. If a capped search cannot exhaust the candidate history, the output says so and points agents to `--deep`, `--all-sessions`, or a larger `--max-sessions`.

Common CLI examples:

```bash
# Recent user prompts in the current repo
opencode-memory-plugin codex-sessions

# User prompts in the current repo containing both words
opencode-memory-plugin codex-sessions "deploy cloudflare"

# Matching sessions instead of individual prompts
opencode-memory-plugin codex-sessions "deploy cloudflare" --mode sessions

# Compact non-tool transcript for a known session id or JSONL path
opencode-memory-plugin codex-sessions --session 019e2224-75f4 --mode transcript --limit 1

# Search a non-default Codex home
opencode-memory-plugin codex-sessions "deploy" --codex-home /path/to/.codex

# Search across all repos and all candidate session history
opencode-memory-plugin codex-sessions "opencode slim" --all-repos --deep
```

Useful flags:

| Flag | Purpose |
| --- | --- |
| `--repo <path>` | Filter to sessions whose Codex cwd/turn cwd matches a repo path. Defaults to the current directory. |
| `--all-repos` | Search sessions from every repo. |
| `--mode prompts|sessions|transcript` | Show individual prompts, session summaries, or compact transcripts. |
| `--role user|assistant|all` | Search only user prompts, assistant messages, or both. |
| `--match all|any` | Require every query token or accept any token. Defaults to `all`. |
| `--since`, `--until` | Filter by session timestamp. Accepts `YYYY-MM-DD` or ISO timestamps. |
| `--deep` | Scan all candidate session files for high recall. Same scan depth as `--all-sessions`, with a clearer agent-friendly name. |
| `--max-sessions <n>`, `--all-sessions` | Control how much history to scan. |
| `--codex-home <path>` | Read sessions from `<path>/sessions`; useful when `CODEX_HOME` is not the default. |
| `--codex-sessions-root <path>` | Read sessions from an exact sessions directory. Overrides `--codex-home`. |
| `--include-tools` | Include compact tool-call summaries. Off by default. |
| `--include-synthetic` | Include injected context wrapper messages. Off by default. |
| `--json` | Emit structured JSON for scripts or agents. |

The OpenCode tool uses the same concepts in camelCase, for example `maxSessions`, `allSessions`, `deep`, `codexHome`, and `codexSessionsRoot`.

## Memory Policy

Memory is advisory, not authority.

- Current user instructions win.
- Current repo files and live systems win.
- If memory conflicts with reality, mark it superseded.
- Do not save secrets, credentials, raw tokens, or speculative claims as fact.
- If the agent saves memory autonomously, it should say what it saved.

## Example MEMORY.md

```md
# MEMORY.md

Policy: Advisory only. Verify current repo/live state before acting.

## Active
- 2026-05-13 | id=mem_abc123 | type=preference | scope=user | confidence=medium | source=user | inferred=false | User prefers end-of-task memory saves to be reported in chat.

## Superseded
- 2026-05-13 | id=mem_old123 | status=superseded | superseded_at=2026-05-14 | reason=changed | Old note text...
```

## Development

```bash
npm install
npm test
npm pack --dry-run
```

## Publishing Notes

Suggested GitHub description:

```text
OpenCode memory plugin with Markdown repo memory and read-only Codex session/history search for agents.
```

Suggested GitHub topics, capped at GitHub's 20-topic limit:

```text
opencode opencode-ai opencode-plugin opencode-memory opencode-memory-plugin ai-agents coding-agent agent-tools agent-memory llm-memory ai-memory markdown-memory plain-text-memory repo-memory codex codex-memory codex-history codex-sessions codex-transcripts codex-session-search
```

## License

MIT
