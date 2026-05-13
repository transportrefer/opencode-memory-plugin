---
description: Save a durable OpenCode memory note
---

Save this as OpenCode memory:

`$ARGUMENTS`

Steps:

1. If the arguments are empty, ask the user what to remember.
2. Otherwise call `memory_remember`.
3. Use `scope="repo"` unless the note is clearly about the user across projects, in which case use `scope="user"`.
4. Choose the most fitting type from `decision`, `learning`, `preference`, `blocker`, `context`, `pattern`, `procedure`, `source`, `pitfall`, or `command`.
5. Use `confidence="medium"` unless the user explicitly stated it or current repo/live evidence proves it.
6. After saving, tell the user exactly what was added.
7. Do not read memory files directly after saving unless the user asks for inspection.
