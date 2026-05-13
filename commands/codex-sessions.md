---
description: Search standard Codex session transcripts read-only
---

Search standard Codex session JSONL transcripts for:

`$ARGUMENTS`

Use this command when you need prior Codex history, user prompts, repo-scoped sessions, or a compact transcript. It reads standard Codex session JSONL from `$CODEX_HOME/sessions/**/*.jsonl` when `CODEX_HOME` is set, otherwise `~/.codex/sessions/**/*.jsonl`. Do not rely on repo-local patch files such as `.codex/user-prompts.md`.

Agent-friendly defaults:

- Current repo only.
- `mode="prompts"`.
- `role="user"`.
- `limit=20`.
- `maxSessions=200` unless `deep=true` or `allSessions=true`.
- Tool calls and tool outputs excluded.
- Synthetic context wrappers excluded.

Useful calls:

- Recent user prompts in this repo: call `codex_session_search` with `mode="prompts"`.
- User prompts in this repo containing keywords: call `codex_session_search` with `query="$ARGUMENTS"`, `mode="prompts"`, `match="all"`.
- Matching sessions instead of individual prompts: call `codex_session_search` with `query="$ARGUMENTS"`, `mode="sessions"`.
- Compact transcript for a known session: call `codex_session_search` with `session="<session id or .jsonl path>"`, `mode="transcript"`, `limit=1`.
- Search all repos: add `allRepos=true`.
- Search older or huge history: set `deep=true` first. You can also increase `maxSessions` or set `allSessions=true`.
- Search a non-default Codex profile: set `codexHome="/path/to/.codex"` or run with `CODEX_HOME=/path/to/.codex`.
- Search an exact nonstandard sessions directory: set `codexSessionsRoot="/path/to/sessions"`.
- Include compact tool-call summaries only when explicitly useful: set `includeTools=true`.

Steps:

1. If arguments are present, pass them as `query`.
2. Start with the defaults above unless the user asks for all repos, a transcript, a date range, or tool data.
3. If the result says the search was partial and older history matters, rerun once with `deep=true`.
4. Return the `codex_session_search` result directly.
5. Treat results as read-only evidence. Do not edit, delete, rewrite, or compact Codex session files.
