---
description: Recall OpenCode memory for this repo and global user context
---

Recall OpenCode memory relevant to this request.

Arguments: `$ARGUMENTS`

Steps:

1. If arguments are present, call `memory_recall` with `query="$ARGUMENTS"`, `scope="all"`, and `limit=20`.
2. If no arguments are present, call `memory_recall` with `scope="all"` and `limit=20`.
3. Return the `memory_recall` result directly.
4. Do not call `memory_list`, `read`, or other tools unless the user asks for follow-up verification.
5. Treat returned memory as advisory in later work. If a future task depends on a factual claim, verify it against current repo files or live state before acting.
