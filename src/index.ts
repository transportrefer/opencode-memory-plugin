import { type Plugin, type PluginModule, tool } from "@opencode-ai/plugin";
import {
  CONFIDENCE_LEVELS,
  CODEX_SESSION_MATCH_MODES,
  CODEX_SESSION_MODES,
  CODEX_SESSION_ROLES,
  MEMORY_SCOPES,
  MEMORY_TYPES,
  RECALL_SCOPES,
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

const schema = tool.schema;

export const id = "opencode-memory-plugin";

export const OpenCodeMemoryPlugin: Plugin = async (_ctx, options = {}) => {
  const optionMemoryRoot = typeof options.memoryRoot === "string" ? options.memoryRoot : undefined;

  return {
    tool: {
      memory_recall: tool({
        description:
          "Recall advisory OpenCode memory for the current repo and/or global user context. Verify factual claims against current repo/live state before acting.",
        args: {
          query: schema.string().optional().describe("Search query. Omit to list recent active memories."),
          scope: schema.enum(RECALL_SCOPES).optional().describe("Memory scope to search. Defaults to all."),
          type: schema.enum(MEMORY_TYPES).optional().describe("Optional memory type filter."),
          limit: schema.number().optional().describe("Maximum results. Defaults to 20."),
        },
        async execute(args, context) {
          const result = await recallMemory({
            directory: context.directory,
            memoryRoot: optionMemoryRoot,
            query: args.query,
            scope: args.scope,
            type: args.type,
            limit: args.limit,
          });
          context.metadata({
            title: `Memory recall: ${result.entries.length} result(s)`,
            metadata: { project: result.project.id, files: result.files },
          });
          return formatEntries(result.entries);
        },
      }),

      memory_remember: tool({
        description:
          "Save a durable Markdown memory. Use for stable repo facts, user preferences, commands, pitfalls, decisions, or useful inferred lessons. Do not save secrets. Tell the user what was saved.",
        args: {
          note: schema.string().describe("The durable memory note to save."),
          type: schema.enum(MEMORY_TYPES).optional().describe("Memory type. Defaults to context."),
          scope: schema.enum(MEMORY_SCOPES).optional().describe("repo, user, or global. Defaults to repo."),
          confidence: schema.enum(CONFIDENCE_LEVELS).optional().describe("Confidence level. Defaults to medium."),
          source: schema.string().optional().describe("Source label such as user, repo, live-check, codex-memory, or inference."),
          inferred: schema.boolean().optional().describe("True if this is an inferred lesson rather than directly stated fact."),
        },
        async execute(args, context) {
          const result = await rememberMemory({
            directory: context.directory,
            memoryRoot: optionMemoryRoot,
            note: args.note,
            type: args.type,
            scope: args.scope,
            confidence: args.confidence,
            source: args.source,
            inferred: args.inferred,
          });
          context.metadata({
            title: "Memory saved",
            metadata: { project: result.project.id, file: result.file, id: result.entry.id },
          });
          return [
            `Saved memory: ${result.entry.note}`,
            `File: ${result.file}:${result.entry.lineNumber}`,
            "Notify the user that this was added to memory.",
          ].join("\n");
        },
      }),

      memory_supersede: tool({
        description:
          "Mark an outdated or wrong memory as superseded and optionally add a replacement. This preserves audit history instead of silently deleting notes.",
        args: {
          query: schema.string().describe("Search query identifying the memory to supersede."),
          replacement: schema.string().optional().describe("Optional replacement memory note."),
          reason: schema.string().optional().describe("Why the memory is superseded."),
          scope: schema.enum(RECALL_SCOPES).optional().describe("Scope to search. Defaults to all."),
          type: schema.enum(MEMORY_TYPES).optional().describe("Optional type filter."),
          confidence: schema.enum(CONFIDENCE_LEVELS).optional().describe("Replacement confidence. Defaults to medium."),
          source: schema.string().optional().describe("Replacement source label."),
          inferred: schema.boolean().optional().describe("Whether the replacement is inferred."),
        },
        async execute(args, context) {
          const result = await supersedeMemory({
            directory: context.directory,
            memoryRoot: optionMemoryRoot,
            query: args.query,
            replacement: args.replacement,
            reason: args.reason,
            scope: args.scope,
            type: args.type,
            confidence: args.confidence,
            source: args.source,
            inferred: args.inferred,
          });
          if (!result.superseded) return "No matching active memory found to supersede.";
          context.metadata({
            title: "Memory superseded",
            metadata: {
              project: result.project.id,
              file: result.file,
              superseded: result.superseded.id,
              replacement: result.replacement?.id,
            },
          });
          return [
            `Superseded memory: ${result.superseded.note}`,
            result.replacement ? `Replacement saved: ${result.replacement.note}` : "No replacement was saved.",
            `File: ${result.file}`,
          ].join("\n");
        },
      }),

      memory_list: tool({
        description: "List OpenCode memory files and active/superseded counts for the current project.",
        args: {
          scope: schema.enum(RECALL_SCOPES).optional().describe("Scope to list. Defaults to all."),
        },
        async execute(args, context) {
          const result = await listMemory({
            directory: context.directory,
            memoryRoot: optionMemoryRoot,
            scope: args.scope,
          });
          return formatList(result);
        },
      }),

      codex_memory_search: tool({
        description:
          "Search existing Codex memory read-only. Use this to learn from Codex memory, then promote only useful durable notes into OpenCode memory with memory_remember.",
        args: {
          query: schema.string().describe("Search query for Codex memory."),
          depth: schema
            .enum(["summary", "summary-registry", "summary-registry-rollouts"])
            .optional()
            .describe("How deep to search. Defaults to summary-registry-rollouts."),
          limit: schema.number().optional().describe("Maximum matches. Defaults to 20."),
        },
        async execute(args) {
          const matches = await searchCodexMemory({
            query: args.query,
            depth: args.depth,
            limit: args.limit,
          });
          return formatCodexMatches(matches);
        },
      }),

      codex_session_search: tool({
        description:
          "Search raw Codex session JSONL transcripts read-only. Use for repo-scoped history lookup, user-prompt search, and compact transcripts without verbose tool-call data. Defaults to current repo, recent user prompts, and standard ~/.codex/sessions JSONL only.",
        args: {
          query: schema.string().optional().describe("Keyword query. Defaults to recent matching items without a keyword filter."),
          mode: schema
            .enum(CODEX_SESSION_MODES)
            .optional()
            .describe("Output mode: prompts, sessions, or transcript. Defaults to prompts."),
          role: schema
            .enum(CODEX_SESSION_ROLES)
            .optional()
            .describe("Which messages to search. Defaults to user for prompts and all for transcript/sessions."),
          match: schema
            .enum(CODEX_SESSION_MATCH_MODES)
            .optional()
            .describe("Keyword matching mode. all requires every query token; any accepts any token. Defaults to all."),
          repo: schema
            .string()
            .optional()
            .describe("Repo/path filter. Defaults to the current OpenCode working directory unless allRepos=true."),
          allRepos: schema.boolean().optional().describe("Search sessions from all repos instead of the current repo."),
          session: schema.string().optional().describe("Session id substring or absolute .jsonl file path to read."),
          since: schema.string().optional().describe("Only sessions on/after this date or ISO timestamp."),
          until: schema.string().optional().describe("Only sessions on/before this date or ISO timestamp."),
          limit: schema.number().optional().describe("Maximum prompt/session results. Defaults to 20."),
          maxSessions: schema
            .number()
            .optional()
            .describe("Maximum recent session files to scan. Defaults to 200 unless deep=true or allSessions=true."),
          deep: schema
            .boolean()
            .optional()
            .describe("Scan all candidate session files for high recall. Use when a capped search says it was partial."),
          allSessions: schema.boolean().optional().describe("Scan every Codex session file. Can be slower on large histories."),
          codexHome: schema
            .string()
            .optional()
            .describe("Optional Codex home directory override. Defaults to CODEX_HOME when set, otherwise ~/.codex."),
          codexSessionsRoot: schema
            .string()
            .optional()
            .describe("Optional exact sessions directory override. Overrides codexHome."),
          includeTools: schema
            .boolean()
            .optional()
            .describe("Include compact tool-call/tool-output summaries. Defaults to false to avoid verbose transcript data."),
          includeSynthetic: schema
            .boolean()
            .optional()
            .describe("Include injected context messages such as AGENTS/environment wrappers. Defaults to false."),
        },
        async execute(args, context) {
          const result = await searchCodexSessions({
            query: args.query,
            mode: args.mode,
            role: args.role,
            match: args.match,
            repo: args.allRepos ? undefined : args.repo || context.directory,
            session: args.session,
            since: args.since,
            until: args.until,
            limit: args.limit,
            maxSessions: args.maxSessions,
            allSessions: args.allSessions,
            deep: args.deep,
            codexHome: args.codexHome,
            codexSessionsRoot: args.codexSessionsRoot,
            includeTools: args.includeTools,
            includeSynthetic: args.includeSynthetic,
          });
          context.metadata({
            title: `Codex sessions: ${result.sessionsMatched} result(s)`,
            metadata: {
              root: result.root,
              repo: result.repo,
              filesScanned: result.filesScanned,
              filesConsidered: result.filesConsidered,
              partial: result.partial,
              mode: result.mode,
            },
          });
          return formatCodexSessionSearch(result);
        },
      }),
    },
  };
};

export const server = OpenCodeMemoryPlugin;

const pluginModule: PluginModule = {
  id,
  server,
};

export default pluginModule;
