import { type Plugin, type PluginModule, tool } from "@opencode-ai/plugin";
import {
  CONFIDENCE_LEVELS,
  MEMORY_SCOPES,
  MEMORY_TYPES,
  RECALL_SCOPES,
  formatCodexMatches,
  formatEntries,
  formatList,
  listMemory,
  recallMemory,
  rememberMemory,
  searchCodexMemory,
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
    },
  };
};

export const server = OpenCodeMemoryPlugin;

const pluginModule: PluginModule = {
  id,
  server,
};

export default pluginModule;
