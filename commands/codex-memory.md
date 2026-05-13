---
description: Search existing Codex memory read-only
---

Search Codex memory read-only for:

`$ARGUMENTS`

Steps:

1. If the arguments are empty, ask the user what to search for.
2. Otherwise call `codex_memory_search` with `query="$ARGUMENTS"` and `depth="summary-registry-rollouts"`.
3. Return the `codex_memory_search` result directly.
4. Do not copy anything into OpenCode memory unless the user asks or it is clearly useful at the end of the task.
5. If promoting a Codex finding into OpenCode memory, use `memory_remember` and set `source="codex-memory"`.
