---
description: Recall OpenCode memory for this repo and global user context
---

Recall OpenCode memory relevant to this request.

Arguments: `$ARGUMENTS`

Steps:

1. If arguments are present, call `memory_recall` with `query="$ARGUMENTS"`, `scope="all"`, and `limit=20`.
2. If no arguments are present, call `memory_recall` with `scope="all"` and `limit=20`.
3. Treat returned memory as advisory. If the task depends on a factual claim, verify it against current repo files or live state before acting.
