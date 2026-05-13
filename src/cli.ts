#!/usr/bin/env node
import {
  type Confidence,
  type MemoryScope,
  type MemoryType,
  type RecallScope,
  formatCodexMatches,
  formatCodexSessionSearch,
  formatEntries,
  formatList,
  listMemory,
  recallMemory,
  rememberMemory,
  searchCodexMemory,
  searchCodexSessions,
  supersedeMemory,
} from "./core.js";

type ParsedArgs = {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith("--")) {
      const inline = token.slice(2);
      const equalsIndex = inline.indexOf("=");
      if (equalsIndex !== -1) {
        flags[inline.slice(0, equalsIndex)] = inline.slice(equalsIndex + 1);
        continue;
      }
      const key = inline;
      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function help(): string {
  return `OpenCode Memory Plugin

Usage:
  opencode-memory-plugin remember <note> [--dir <path>] [--scope repo|user|global] [--type context] [--confidence medium] [--source user] [--inferred]
  opencode-memory-plugin recall [query] [--dir <path>] [--scope all|repo|user|global] [--limit 20]
  opencode-memory-plugin list [--dir <path>] [--scope all|repo|user|global]
  opencode-memory-plugin supersede <query> [--replacement <note>] [--reason <why>] [--dir <path>]
  opencode-memory-plugin codex-search <query> [--depth summary-registry-rollouts] [--limit 20]
  opencode-memory-plugin codex-sessions [query] [--repo <path>|--all-repos] [--mode prompts|sessions|transcript] [--role user|assistant|all] [--session <id-or-file>] [--limit 20] [--max-sessions 200|--deep|--all-sessions] [--codex-home <path>|--codex-sessions-root <path>]
`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const directory = flagString(args.flags, "dir") || process.cwd();
  const memoryRoot = flagString(args.flags, "memory-root");

  if (args.command === "remember") {
    const note = args.positional.join(" ").trim();
    if (!note) throw new Error("remember requires a note.");
    const saved = await rememberMemory({
      directory,
      memoryRoot,
      note,
      scope: flagString(args.flags, "scope") as MemoryScope | undefined,
      type: flagString(args.flags, "type") as MemoryType | undefined,
      confidence: flagString(args.flags, "confidence") as Confidence | undefined,
      source: flagString(args.flags, "source") || "cli",
      inferred: Boolean(args.flags.inferred),
    });
    console.log(`Saved ${saved.entry.id} to ${saved.file}:${saved.entry.lineNumber}`);
    return 0;
  }

  if (args.command === "recall") {
    const result = await recallMemory({
      directory,
      memoryRoot,
      query: args.positional.join(" ").trim() || undefined,
      scope: flagString(args.flags, "scope") as RecallScope | undefined,
      type: flagString(args.flags, "type") as MemoryType | undefined,
      limit: flagString(args.flags, "limit") ? Number(flagString(args.flags, "limit")) : undefined,
    });
    console.log(formatEntries(result.entries));
    return 0;
  }

  if (args.command === "list") {
    const result = await listMemory({
      directory,
      memoryRoot,
      scope: flagString(args.flags, "scope") as RecallScope | undefined,
    });
    console.log(formatList(result));
    return 0;
  }

  if (args.command === "supersede") {
    const query = args.positional.join(" ").trim();
    if (!query) throw new Error("supersede requires a query.");
    const result = await supersedeMemory({
      directory,
      memoryRoot,
      query,
      replacement: flagString(args.flags, "replacement"),
      reason: flagString(args.flags, "reason"),
      scope: flagString(args.flags, "scope") as RecallScope | undefined,
      type: flagString(args.flags, "type") as MemoryType | undefined,
    });
    console.log(result.superseded ? `Superseded ${result.superseded.id}` : "No matching active memory found.");
    return 0;
  }

  if (args.command === "codex-search") {
    const query = args.positional.join(" ").trim();
    if (!query) throw new Error("codex-search requires a query.");
    const matches = await searchCodexMemory({
      query,
      depth: flagString(args.flags, "depth") as "summary" | "summary-registry" | "summary-registry-rollouts" | undefined,
      limit: flagString(args.flags, "limit") ? Number(flagString(args.flags, "limit")) : undefined,
    });
    console.log(formatCodexMatches(matches));
    return 0;
  }

  if (args.command === "codex-sessions") {
    const query = args.positional.join(" ").trim();
    const maxSessions = flagString(args.flags, "max-sessions");
    const result = await searchCodexSessions({
      query: query || undefined,
      mode: flagString(args.flags, "mode") as "sessions" | "prompts" | "transcript" | undefined,
      role: flagString(args.flags, "role") as "all" | "user" | "assistant" | undefined,
      match: flagString(args.flags, "match") as "all" | "any" | undefined,
      repo: args.flags["all-repos"] ? undefined : flagString(args.flags, "repo") || directory,
      session: flagString(args.flags, "session"),
      since: flagString(args.flags, "since"),
      until: flagString(args.flags, "until"),
      limit: flagString(args.flags, "limit") ? Number(flagString(args.flags, "limit")) : undefined,
      maxSessions: maxSessions ? Number(maxSessions) : undefined,
      allSessions: Boolean(args.flags["all-sessions"]),
      deep: Boolean(args.flags.deep),
      includeTools: Boolean(args.flags["include-tools"]),
      includeSynthetic: Boolean(args.flags["include-synthetic"]),
      codexHome: flagString(args.flags, "codex-home"),
      codexSessionsRoot: flagString(args.flags, "codex-sessions-root"),
    });
    if (args.flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatCodexSessionSearch(result));
    }
    return 0;
  }

  console.log(help());
  return args.command === "help" ? 0 : 2;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
