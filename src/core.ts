import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

export const MEMORY_TYPES = [
  "decision",
  "learning",
  "preference",
  "blocker",
  "context",
  "pattern",
  "procedure",
  "source",
  "pitfall",
  "command",
] as const;

export const MEMORY_SCOPES = ["repo", "user", "global"] as const;
export const RECALL_SCOPES = ["all", "repo", "user", "global"] as const;
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const CODEX_SESSION_MODES = ["sessions", "prompts", "transcript"] as const;
export const CODEX_SESSION_ROLES = ["all", "user", "assistant"] as const;
export const CODEX_SESSION_MATCH_MODES = ["all", "any"] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export type RecallScope = (typeof RECALL_SCOPES)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type CodexSessionMode = (typeof CODEX_SESSION_MODES)[number];
export type CodexSessionRole = (typeof CODEX_SESSION_ROLES)[number];
export type CodexSessionMatchMode = (typeof CODEX_SESSION_MATCH_MODES)[number];

export type ProjectAlias = {
  paths?: string[];
  remotes?: string[];
  gitCommonDirs?: string[];
  description?: string;
};

export type ProjectsConfig = {
  projects?: Record<string, ProjectAlias>;
};

export type ResolvedProject = {
  id: string;
  source: "alias" | "remote" | "git-common-dir" | "path";
  directory: string;
  gitRoot: string | null;
  remote: string | null;
  gitCommonDir: string | null;
  memoryFile: string;
};

export type MemoryEntry = {
  date: string;
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  confidence: Confidence;
  source: string;
  inferred: boolean;
  note: string;
  section: "Active" | "Superseded";
  file: string;
  lineNumber: number;
  raw: string;
  status?: string;
  supersededAt?: string;
  reason?: string;
};

export type RememberInput = {
  directory: string;
  memoryRoot?: string;
  note: string;
  type?: MemoryType;
  scope?: MemoryScope;
  confidence?: Confidence;
  source?: string;
  inferred?: boolean;
};

export type RecallInput = {
  directory: string;
  memoryRoot?: string;
  query?: string;
  scope?: RecallScope;
  type?: MemoryType;
  limit?: number;
};

export type SupersedeInput = {
  directory: string;
  memoryRoot?: string;
  query: string;
  reason?: string;
  replacement?: string;
  type?: MemoryType;
  scope?: RecallScope;
  confidence?: Confidence;
  source?: string;
  inferred?: boolean;
};

export type CodexSessionSearchInput = {
  query?: string;
  mode?: CodexSessionMode;
  role?: CodexSessionRole;
  match?: CodexSessionMatchMode;
  repo?: string;
  session?: string;
  since?: string;
  until?: string;
  limit?: number;
  maxSessions?: number;
  allSessions?: boolean;
  deep?: boolean;
  includeTools?: boolean;
  includeSynthetic?: boolean;
  codexHome?: string;
  codexSessionsRoot?: string;
};

export type CodexTranscriptMessage = {
  role: "user" | "assistant" | "tool";
  text: string;
  lineNumber: number;
  source: "event_msg" | "response_item";
  synthetic: boolean;
};

export type CodexSessionSummary = {
  id: string;
  timestamp: string;
  file: string;
  cwd: string | null;
  turnCwds: string[];
  promptCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  lineCount: number;
};

export type CodexSessionHit = {
  session: CodexSessionSummary;
  messages: CodexTranscriptMessage[];
  score: number;
};

export type CodexSessionSearchResult = {
  root: string;
  mode: CodexSessionMode;
  role: CodexSessionRole;
  match: CodexSessionMatchMode;
  query?: string;
  repo?: string;
  session?: string;
  since?: string;
  until?: string;
  filesConsidered: number;
  filesScanned: number;
  sessionsMatched: number;
  limit: number;
  maxSessions: number | null;
  deep: boolean;
  resultLimitReached: boolean;
  scanLimitReached: boolean;
  partial: boolean;
  remainingFiles: number;
  includeTools: boolean;
  includeSynthetic: boolean;
  hits: CodexSessionHit[];
};

const MEMORY_TEMPLATE = `# MEMORY.md

Policy: Advisory only. Verify current repo/live state before acting.

## Active

## Superseded
`;

const PROJECTS_TEMPLATE: ProjectsConfig = {
  projects: {},
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]"],
  [/\bghp_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GITHUB_PAT]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_PAT]"],
  [/\b(Bearer\s+)[A-Za-z0-9._\-+/=]{16,}\b/gi, "$1[REDACTED_TOKEN]"],
  [
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token)\b(\s*[:=]\s*|[\s"']+)([A-Za-z0-9._\-+/=]{16,})/gi,
    "$1$2[REDACTED_SECRET]",
  ],
];

const META_KEYS = new Set([
  "id",
  "type",
  "scope",
  "confidence",
  "source",
  "inferred",
  "status",
  "superseded_at",
  "reason",
]);

export function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
}

export function defaultMemoryRoot(): string {
  return path.resolve(expandHome(process.env.OPENCODE_MEMORY_DIR || "~/.config/opencode/memory"));
}

export function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/\.git$/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "project";
}

export function normalizeRemote(remote: string): string {
  let value = remote.trim();
  value = value.replace(/^git@([^:]+):/, "$1/");
  value = value.replace(/^ssh:\/\/git@/, "");
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/\.git$/, "");
  return value.toLowerCase();
}

export function redactSecrets(input: string): string {
  let out = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function sanitizeNote(input: string): string {
  return redactSecrets(input).replace(/\s+/g, " ").trim();
}

function sanitizeField(input: string): string {
  return input.trim().replace(/\s+/g, "_").replace(/\|/g, "-").slice(0, 120) || "unknown";
}

function runGit(directory: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function realPathIfExists(input: string): string {
  try {
    return realpathSync(input);
  } catch {
    return path.resolve(input);
  }
}

async function readProjectsConfig(memoryRoot: string): Promise<ProjectsConfig> {
  const file = path.join(memoryRoot, "projects.json");
  try {
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text) as ProjectsConfig;
    return parsed && typeof parsed === "object" ? parsed : PROJECTS_TEMPLATE;
  } catch {
    return PROJECTS_TEMPLATE;
  }
}

export async function ensureProjectsConfig(memoryRoot = defaultMemoryRoot()): Promise<string> {
  const file = path.join(memoryRoot, "projects.json");
  await mkdir(memoryRoot, { recursive: true });
  if (!existsSync(file)) {
    await writeFile(file, JSON.stringify(PROJECTS_TEMPLATE, null, 2) + "\n", "utf8");
  }
  return file;
}

function matchProjectAlias(
  config: ProjectsConfig,
  directory: string,
  gitRoot: string | null,
  remote: string | null,
  gitCommonDir: string | null,
): string | null {
  const projects = config.projects || {};
  const resolvedDirectory = realPathIfExists(directory);
  const resolvedGitRoot = gitRoot ? realPathIfExists(gitRoot) : null;
  const normalizedRemote = remote ? normalizeRemote(remote) : null;
  const resolvedCommonDir = gitCommonDir ? realPathIfExists(gitCommonDir) : null;

  for (const [id, alias] of Object.entries(projects)) {
    for (const candidate of alias.paths || []) {
      const resolved = realPathIfExists(expandHome(candidate));
      if (
        resolvedDirectory === resolved ||
        resolvedDirectory.startsWith(`${resolved}${path.sep}`) ||
        resolvedGitRoot === resolved
      ) {
        return slugify(id);
      }
    }
    for (const candidate of alias.remotes || []) {
      if (normalizedRemote && normalizeRemote(candidate) === normalizedRemote) {
        return slugify(id);
      }
    }
    for (const candidate of alias.gitCommonDirs || []) {
      if (resolvedCommonDir && realPathIfExists(expandHome(candidate)) === resolvedCommonDir) {
        return slugify(id);
      }
    }
  }
  return null;
}

function projectIdFromBasis(kind: ResolvedProject["source"], basis: string): string {
  const readable = slugify(kind === "remote" ? normalizeRemote(basis) : path.basename(basis) || basis);
  return `${readable}--${sha1(basis).slice(0, 12)}`;
}

export async function resolveProject(directory: string, memoryRoot = defaultMemoryRoot()): Promise<ResolvedProject> {
  const resolvedDirectory = realPathIfExists(expandHome(directory));
  const gitRoot = runGit(resolvedDirectory, ["rev-parse", "--show-toplevel"]);
  const baseDirectory = gitRoot ? realPathIfExists(gitRoot) : resolvedDirectory;
  const remote = runGit(baseDirectory, ["config", "--get", "remote.origin.url"]);
  const commonDirRaw = runGit(baseDirectory, ["rev-parse", "--git-common-dir"]);
  const gitCommonDir = commonDirRaw
    ? realPathIfExists(path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(baseDirectory, commonDirRaw))
    : null;
  const config = await readProjectsConfig(memoryRoot);
  const alias = matchProjectAlias(config, resolvedDirectory, gitRoot, remote, gitCommonDir);

  let id: string;
  let source: ResolvedProject["source"];
  if (alias) {
    id = alias;
    source = "alias";
  } else if (remote) {
    const normalized = normalizeRemote(remote);
    id = projectIdFromBasis("remote", normalized);
    source = "remote";
  } else if (gitCommonDir) {
    id = projectIdFromBasis("git-common-dir", gitCommonDir);
    source = "git-common-dir";
  } else {
    id = projectIdFromBasis("path", resolvedDirectory);
    source = "path";
  }

  return {
    id,
    source,
    directory: resolvedDirectory,
    gitRoot: gitRoot ? realPathIfExists(gitRoot) : null,
    remote: remote ? normalizeRemote(remote) : null,
    gitCommonDir,
    memoryFile: path.join(memoryRoot, "repos", id, "MEMORY.md"),
  };
}

async function ensureMemoryFile(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  if (!existsSync(file)) {
    await writeFile(file, MEMORY_TEMPLATE, "utf8");
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function newMemoryId(note: string): string {
  return `mem_${sha1(`${Date.now()}:${note}`).slice(0, 10)}`;
}

function formatEntry(entry: {
  date: string;
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  confidence: Confidence;
  source: string;
  inferred: boolean;
  note: string;
}): string {
  return [
    `- ${entry.date}`,
    `id=${sanitizeField(entry.id)}`,
    `type=${entry.type}`,
    `scope=${entry.scope}`,
    `confidence=${entry.confidence}`,
    `source=${sanitizeField(entry.source)}`,
    `inferred=${entry.inferred ? "true" : "false"}`,
    sanitizeNote(entry.note),
  ].join(" | ");
}

function formatSuperseded(entry: MemoryEntry, reason: string): string {
  return [
    `- ${entry.date}`,
    `id=${sanitizeField(entry.id)}`,
    "status=superseded",
    `superseded_at=${today()}`,
    `reason=${sanitizeField(reason || "replaced")}`,
    entry.note,
  ].join(" | ");
}

function insertIntoSection(text: string, section: "Active" | "Superseded", line: string): string {
  const marker = `## ${section}`;
  let working = text.includes(marker) ? text : `${text.trimEnd()}\n\n${marker}\n`;
  const start = working.indexOf(marker);
  const contentStart = working.indexOf("\n", start);
  const nextSection = working.indexOf("\n## ", contentStart + 1);
  const insertAt = nextSection === -1 ? working.length : nextSection;
  const before = working.slice(0, insertAt).trimEnd();
  const after = working.slice(insertAt).trimStart();
  return `${before}\n${line}\n${after ? `\n${after}` : ""}`;
}

function parseLine(line: string, section: MemoryEntry["section"], file: string, lineNumber: number): MemoryEntry | null {
  if (!line.startsWith("- ")) return null;
  const parts = line.slice(2).split(" | ");
  const date = parts.shift()?.trim() || "";
  const meta: Record<string, string> = {};
  const noteParts: string[] = [];

  for (const part of parts) {
    const match = part.match(/^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$/);
    if (match && META_KEYS.has(match[1]) && noteParts.length === 0) {
      meta[match[1]] = match[2];
    } else {
      noteParts.push(part);
    }
  }

  const type = MEMORY_TYPES.includes(meta.type as MemoryType) ? (meta.type as MemoryType) : "context";
  const scope = MEMORY_SCOPES.includes(meta.scope as MemoryScope) ? (meta.scope as MemoryScope) : "repo";
  const confidence = CONFIDENCE_LEVELS.includes(meta.confidence as Confidence)
    ? (meta.confidence as Confidence)
    : "medium";

  return {
    date,
    id: meta.id || sha1(line).slice(0, 10),
    type,
    scope,
    confidence,
    source: meta.source || "unknown",
    inferred: meta.inferred === "true",
    note: noteParts.join(" | ").trim(),
    section,
    file,
    lineNumber,
    raw: line,
    status: meta.status,
    supersededAt: meta.superseded_at,
    reason: meta.reason,
  };
}

async function readEntries(file: string): Promise<MemoryEntry[]> {
  try {
    const text = await readFile(file, "utf8");
    const entries: MemoryEntry[] = [];
    let section: MemoryEntry["section"] | null = null;
    text.split(/\r?\n/).forEach((line, index) => {
      const heading = line.match(/^##\s+(Active|Superseded)\s*$/);
      if (heading) {
        section = heading[1] as MemoryEntry["section"];
        return;
      }
      if (!section) return;
      const entry = parseLine(line, section, file, index + 1);
      if (entry) entries.push(entry);
    });
    return entries;
  } catch {
    return [];
  }
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9._-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1);
}

function scoreEntry(entry: MemoryEntry, words: string[]): number {
  if (words.length === 0) return 1;
  const haystack = `${entry.type} ${entry.scope} ${entry.confidence} ${entry.source} ${entry.note}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (haystack.includes(word)) score += 1;
    if (entry.type === word) score += 2;
    if (entry.scope === word) score += 2;
  }
  return score;
}

function sortEntries(entries: MemoryEntry[], words: string[]): MemoryEntry[] {
  return [...entries].sort((a, b) => {
    const scoreDiff = scoreEntry(b, words) - scoreEntry(a, words);
    if (scoreDiff !== 0) return scoreDiff;
    return b.date.localeCompare(a.date);
  });
}

export async function rememberMemory(input: RememberInput): Promise<{ entry: MemoryEntry; file: string; project: ResolvedProject }> {
  const memoryRoot = path.resolve(expandHome(input.memoryRoot || defaultMemoryRoot()));
  await ensureProjectsConfig(memoryRoot);
  const project = await resolveProject(input.directory, memoryRoot);
  const scope = input.scope || "repo";
  const file =
    scope === "repo" ? project.memoryFile : path.join(memoryRoot, "global", "MEMORY.md");
  await ensureMemoryFile(file);

  const entryLine = formatEntry({
    date: today(),
    id: newMemoryId(input.note),
    type: input.type || "context",
    scope,
    confidence: input.confidence || "medium",
    source: input.source || "assistant",
    inferred: input.inferred || false,
    note: input.note,
  });

  const text = await readFile(file, "utf8");
  await writeFile(file, insertIntoSection(text, "Active", entryLine), "utf8");
  const entries = await readEntries(file);
  const entry = entries.find((candidate) => candidate.raw === entryLine);
  if (!entry) throw new Error("Saved memory could not be read back.");
  return { entry, file, project };
}

async function filesForRecall(directory: string, memoryRoot: string, scope: RecallScope): Promise<{ project: ResolvedProject; files: string[] }> {
  await ensureProjectsConfig(memoryRoot);
  const project = await resolveProject(directory, memoryRoot);
  const globalFile = path.join(memoryRoot, "global", "MEMORY.md");
  const files =
    scope === "repo"
      ? [project.memoryFile]
      : scope === "global" || scope === "user"
        ? [globalFile]
        : [globalFile, project.memoryFile];
  return { project, files };
}

export async function recallMemory(input: RecallInput): Promise<{ entries: MemoryEntry[]; project: ResolvedProject; files: string[] }> {
  const memoryRoot = path.resolve(expandHome(input.memoryRoot || defaultMemoryRoot()));
  const scope = input.scope || "all";
  const { project, files } = await filesForRecall(input.directory, memoryRoot, scope);
  const allEntries = (await Promise.all(files.map(readEntries))).flat();
  const words = tokenize(input.query || "");
  const filtered = allEntries.filter((entry) => {
    if (entry.section !== "Active") return false;
    if (input.type && entry.type !== input.type) return false;
    if (scope === "user" && entry.scope !== "user") return false;
    const score = scoreEntry(entry, words);
    return words.length === 0 || score > 0;
  });
  const entries = sortEntries(filtered, words).slice(0, Math.max(1, input.limit || 20));
  return { entries, project, files };
}

export async function supersedeMemory(input: SupersedeInput): Promise<{
  superseded: MemoryEntry | null;
  replacement?: MemoryEntry;
  project: ResolvedProject;
  file?: string;
}> {
  const memoryRoot = path.resolve(expandHome(input.memoryRoot || defaultMemoryRoot()));
  const recall = await recallMemory({
    directory: input.directory,
    memoryRoot,
    query: input.query,
    scope: input.scope || "all",
    type: input.type,
    limit: 1,
  });
  const target = recall.entries[0] || null;
  if (!target) return { superseded: null, project: recall.project };

  const text = await readFile(target.file, "utf8");
  const lines = text.split(/\r?\n/);
  const nextLines = lines.filter((line, index) => !(index + 1 === target.lineNumber && line === target.raw));
  const withSuperseded = insertIntoSection(nextLines.join("\n"), "Superseded", formatSuperseded(target, input.reason || "replaced"));
  await writeFile(target.file, withSuperseded, "utf8");

  let replacement: MemoryEntry | undefined;
  if (input.replacement) {
    const saved = await rememberMemory({
      directory: input.directory,
      memoryRoot,
      note: input.replacement,
      type: input.type || target.type,
      scope: target.scope,
      confidence: input.confidence || "medium",
      source: input.source || "assistant",
      inferred: input.inferred || false,
    });
    replacement = saved.entry;
  }

  return { superseded: target, replacement, project: recall.project, file: target.file };
}

export async function listMemory(input: { directory: string; memoryRoot?: string; scope?: RecallScope }): Promise<{
  project: ResolvedProject;
  files: Array<{ file: string; active: number; superseded: number; exists: boolean }>;
}> {
  const memoryRoot = path.resolve(expandHome(input.memoryRoot || defaultMemoryRoot()));
  const { project, files } = await filesForRecall(input.directory, memoryRoot, input.scope || "all");
  const result = [];
  for (const file of files) {
    const entries = await readEntries(file);
    result.push({
      file,
      active: entries.filter((entry) => entry.section === "Active").length,
      superseded: entries.filter((entry) => entry.section === "Superseded").length,
      exists: existsSync(file),
    });
  }
  return { project, files: result };
}

export function formatEntries(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "No matching active memories.";
  return entries
    .map((entry) => {
      const location = `${entry.file}:${entry.lineNumber}`;
      return `- ${entry.date} | ${entry.type}/${entry.scope} | confidence=${entry.confidence} | source=${entry.source} | inferred=${entry.inferred} | ${entry.note}\n  ${location}`;
    })
    .join("\n");
}

export function formatList(result: Awaited<ReturnType<typeof listMemory>>): string {
  const lines = [
    `Project: ${result.project.id} (${result.project.source})`,
    `Directory: ${result.project.directory}`,
    "",
  ];
  for (const file of result.files) {
    lines.push(`- ${file.file}`);
    lines.push(`  exists=${file.exists} active=${file.active} superseded=${file.superseded}`);
  }
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeSearchText(input: string): string {
  return input.toLowerCase().normalize("NFKC");
}

function tokenizeCodexQuery(query: string): string[] {
  return normalizeSearchText(query)
    .split(/[^\p{L}\p{N}._-]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 1);
}

function scoreText(text: string, words: string[], matchMode: CodexSessionMatchMode): number {
  if (words.length === 0) return 1;
  const haystack = normalizeSearchText(text);
  const matched = words.filter((word) => haystack.includes(word));
  if (matchMode === "all" && matched.length !== words.length) return 0;
  return matched.length;
}

function compactWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function truncate(input: string, max = 260): string {
  const text = compactWhitespace(input);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      return stringValue(part.text) || stringValue(part.input_text) || stringValue(part.output_text) || "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function isSyntheticUserMessage(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("# AGENTS.md instructions for ") ||
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<turn_aborted>") ||
    trimmed.startsWith("<user_shell_command>") ||
    trimmed.startsWith("<user_bash_command>") ||
    trimmed.startsWith("<INSTRUCTIONS>") ||
    trimmed.includes("\n<environment_context>") ||
    trimmed.includes("\n</INSTRUCTIONS>")
  );
}

function effectiveSessionRole(input: CodexSessionSearchInput): CodexSessionRole {
  if (input.role) return input.role;
  return input.mode === "prompts" || !input.mode ? "user" : "all";
}

function defaultCodexSessionsRoot(codexHome?: string): string {
  if (process.env.CODEX_SESSIONS_DIR) {
    return path.resolve(expandHome(process.env.CODEX_SESSIONS_DIR));
  }
  const home = codexHome || process.env.CODEX_HOME || "~/.codex";
  return path.join(path.resolve(expandHome(home)), "sessions");
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => b.localeCompare(a));
}

function resolveRepoFilter(repo: string | undefined): string | undefined {
  if (!repo) return undefined;
  const resolved = realPathIfExists(expandHome(repo));
  const gitRoot = runGit(resolved, ["rev-parse", "--show-toplevel"]);
  return gitRoot ? realPathIfExists(gitRoot) : resolved;
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function cwdMatchesRepo(cwd: string | null, repo: string | undefined): boolean {
  if (!repo || !cwd) return !repo;
  const resolvedCwd = realPathIfExists(expandHome(cwd));
  return pathContains(repo, resolvedCwd);
}

function parseDateBoundary(input: string | undefined, endOfDay: boolean): number | null {
  if (!input) return null;
  const value = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? `${input}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : input;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function timestampWithin(timestamp: string, since: string | undefined, until: string | undefined): boolean {
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) return true;
  const sinceValue = parseDateBoundary(since, false);
  const untilValue = parseDateBoundary(until, true);
  if (sinceValue !== null && value < sinceValue) return false;
  if (untilValue !== null && value > untilValue) return false;
  return true;
}

function sessionSummary(parsed: {
  id: string;
  timestamp: string;
  file: string;
  cwd: string | null;
  turnCwds: string[];
  messages: CodexTranscriptMessage[];
  toolCallCount: number;
  lineCount: number;
}): CodexSessionSummary {
  return {
    id: parsed.id,
    timestamp: parsed.timestamp,
    file: parsed.file,
    cwd: parsed.cwd,
    turnCwds: parsed.turnCwds,
    promptCount: parsed.messages.filter((message) => message.role === "user" && !message.synthetic).length,
    assistantMessageCount: parsed.messages.filter((message) => message.role === "assistant").length,
    toolCallCount: parsed.toolCallCount,
    lineCount: parsed.lineCount,
  };
}

async function parseCodexSessionFile(file: string, includeTools: boolean): Promise<{
  id: string;
  timestamp: string;
  file: string;
  cwd: string | null;
  turnCwds: string[];
  messages: CodexTranscriptMessage[];
  toolCallCount: number;
  lineCount: number;
}> {
  const eventUserMessages: CodexTranscriptMessage[] = [];
  const responseUserMessages: CodexTranscriptMessage[] = [];
  const eventAssistantMessages: CodexTranscriptMessage[] = [];
  const responseAssistantMessages: CodexTranscriptMessage[] = [];
  const toolMessages: CodexTranscriptMessage[] = [];
  const turnCwds = new Set<string>();
  let id = path.basename(file).replace(/^rollout-/, "").replace(/\.jsonl$/, "");
  let timestamp = "";
  let cwd: string | null = null;
  let toolCallCount = 0;
  let lineCount = 0;

  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    lineCount += 1;
    if (!line.trim()) continue;
    if (!includeTools && (line.includes('"function_call"') || line.includes('"function_call_output"'))) {
      toolCallCount += 1;
      continue;
    }
    if (!includeTools && line.includes('"encrypted_content"')) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const type = stringValue(parsed.type);
    const payload = isRecord(parsed.payload) ? parsed.payload : {};

    if (type === "session_meta") {
      id = stringValue(payload.id) || id;
      timestamp = stringValue(payload.timestamp) || timestamp;
      cwd = stringValue(payload.cwd) || cwd;
      continue;
    }

    if (type === "turn_context") {
      const turnCwd = stringValue(payload.cwd);
      if (turnCwd) turnCwds.add(turnCwd);
      continue;
    }

    if (type === "event_msg") {
      const eventType = stringValue(payload.type);
      const lineTimestamp = stringValue(parsed.timestamp);
      if (!timestamp && lineTimestamp) timestamp = lineTimestamp;
      if (eventType === "user_message") {
        const message = stringValue(payload.message) || "";
        if (message) {
          eventUserMessages.push({
            role: "user",
            text: message,
            lineNumber: lineCount,
            source: "event_msg",
            synthetic: isSyntheticUserMessage(message),
          });
        }
      } else if (eventType === "agent_message") {
        const message = stringValue(payload.message) || "";
        if (message) {
          eventAssistantMessages.push({
            role: "assistant",
            text: message,
            lineNumber: lineCount,
            source: "event_msg",
            synthetic: false,
          });
        }
      }
      continue;
    }

    if (type !== "response_item") continue;
    const responseType = stringValue(payload.type);

    if (responseType === "message") {
      const role = stringValue(payload.role);
      const text = extractMessageText(payload.content);
      if (!text) continue;
      if (role === "user") {
        responseUserMessages.push({
          role: "user",
          text,
          lineNumber: lineCount,
          source: "response_item",
          synthetic: isSyntheticUserMessage(text),
        });
      } else if (role === "assistant") {
        responseAssistantMessages.push({
          role: "assistant",
          text,
          lineNumber: lineCount,
          source: "response_item",
          synthetic: false,
        });
      }
      continue;
    }

    if (responseType === "function_call" || responseType === "function_call_output") {
      toolCallCount += 1;
      if (!includeTools) continue;
      const name = stringValue(payload.name) || stringValue(payload.call_id) || responseType;
      const details =
        responseType === "function_call"
          ? stringValue(payload.arguments) || ""
          : stringValue(payload.output) || "";
      toolMessages.push({
        role: "tool",
        text: `${responseType}: ${name}${details ? ` ${truncate(details, 500)}` : ""}`,
        lineNumber: lineCount,
        source: "response_item",
        synthetic: false,
      });
    }
  }

  const userMessages = eventUserMessages.length > 0
    ? eventUserMessages
    : responseUserMessages.filter((message) => !message.synthetic);
  const assistantMessages = eventAssistantMessages.length > 0 ? eventAssistantMessages : responseAssistantMessages;
  const messages = [...userMessages, ...assistantMessages, ...toolMessages].sort((a, b) => a.lineNumber - b.lineNumber);

  return {
    id,
    timestamp,
    file,
    cwd,
    turnCwds: [...turnCwds],
    messages,
    toolCallCount,
    lineCount,
  };
}

function messagesForSearch(
  messages: CodexTranscriptMessage[],
  role: CodexSessionRole,
  includeSynthetic: boolean,
): CodexTranscriptMessage[] {
  return messages.filter((message) => {
    if (!includeSynthetic && message.synthetic) return false;
    if (role !== "all" && message.role !== role) return false;
    return true;
  });
}

function messagesMatchingQuery(
  messages: CodexTranscriptMessage[],
  query: string | undefined,
  matchMode: CodexSessionMatchMode,
): { messages: CodexTranscriptMessage[]; score: number } {
  const words = tokenizeCodexQuery(query || "");
  if (words.length === 0) return { messages, score: messages.length };
  const matched: CodexTranscriptMessage[] = [];
  let score = 0;
  for (const message of messages) {
    const messageScore = scoreText(message.text, words, matchMode);
    if (messageScore > 0) {
      matched.push(message);
      score += messageScore;
    }
  }
  return { messages: matched, score };
}

function candidateSessionFiles(files: string[], session: string | undefined): string[] {
  if (!session) return files;
  const expanded = path.resolve(expandHome(session));
  if (existsSync(expanded) && expanded.endsWith(".jsonl")) return [expanded];
  const needle = session.toLowerCase();
  const matching = files.filter((file) => file.toLowerCase().includes(needle));
  return matching.length > 0 ? matching : files;
}

export async function searchCodexSessions(input: CodexSessionSearchInput = {}): Promise<CodexSessionSearchResult> {
  const root = path.resolve(expandHome(input.codexSessionsRoot || defaultCodexSessionsRoot(input.codexHome)));
  const mode = input.mode || "prompts";
  const role = effectiveSessionRole({ ...input, mode });
  const match = input.match || "all";
  const limit = Math.max(1, input.limit || 20);
  const defaultMaxSessions = 200;
  const deep = Boolean(input.deep || input.allSessions);
  const maxSessions = deep ? null : Math.max(1, input.maxSessions || defaultMaxSessions);
  const repo = resolveRepoFilter(input.repo);
  const allFiles = await listJsonlFiles(root);
  const candidates = candidateSessionFiles(allFiles, input.session);
  const filesToScan = maxSessions === null ? candidates : candidates.slice(0, maxSessions);
  const hits: CodexSessionHit[] = [];
  let filesScanned = 0;
  let promptHitCount = 0;
  let resultLimitReached = false;

  for (const file of filesToScan) {
    const parsed = await parseCodexSessionFile(file, Boolean(input.includeTools));
    filesScanned += 1;

    if (input.session && parsed.id !== input.session && !parsed.file.includes(input.session)) continue;
    if (!timestampWithin(parsed.timestamp, input.since, input.until)) continue;
    if (repo) {
      const sessionCwds = [parsed.cwd, ...parsed.turnCwds];
      if (!sessionCwds.some((candidate) => cwdMatchesRepo(candidate, repo))) continue;
    }

    const baseMessages = messagesForSearch(parsed.messages, role, Boolean(input.includeSynthetic));
    const matched = messagesMatchingQuery(baseMessages, input.query, match);
    if (matched.messages.length === 0) continue;

    if (mode === "prompts") {
      const promptMessages = matched.messages.filter((message) => message.role === "user");
      if (promptMessages.length === 0) continue;
      const remaining = limit - promptHitCount;
      hits.push({
        session: sessionSummary(parsed),
        messages: promptMessages.slice(0, remaining),
        score: matched.score,
      });
      promptHitCount += Math.min(promptMessages.length, remaining);
      if (promptHitCount >= limit) {
        resultLimitReached = true;
        break;
      }
      continue;
    }

    hits.push({
      session: sessionSummary(parsed),
      messages: mode === "sessions" ? matched.messages.slice(0, 3) : baseMessages,
      score: matched.score,
    });
    if (hits.length >= limit) {
      resultLimitReached = true;
      break;
    }
  }

  const remainingFiles = Math.max(0, candidates.length - filesScanned);
  const scanLimitReached =
    maxSessions !== null && filesScanned >= filesToScan.length && filesToScan.length < candidates.length && !resultLimitReached;

  return {
    root,
    mode,
    role,
    match,
    query: input.query,
    repo,
    session: input.session,
    since: input.since,
    until: input.until,
    filesConsidered: candidates.length,
    filesScanned,
    sessionsMatched: hits.length,
    limit,
    maxSessions,
    deep,
    resultLimitReached,
    scanLimitReached,
    partial: scanLimitReached,
    remainingFiles,
    includeTools: Boolean(input.includeTools),
    includeSynthetic: Boolean(input.includeSynthetic),
    hits,
  };
}

function codexSessionSearchHints(result: CodexSessionSearchResult): string[] {
  const hints: string[] = [];
  if (result.partial) {
    hints.push(
      `Search was partial: ${result.remainingFiles} older candidate file(s) were not scanned. Use --deep on the CLI, deep=true in the OpenCode tool, --all-sessions, a larger --max-sessions value, or a tighter --since/--until range.`,
    );
  }
  if (result.resultLimitReached) {
    hints.push(`Result limit reached at ${result.limit}. Increase --limit if you need more matches.`);
  }
  return hints;
}

function appendCodexSessionSearchHints(lines: string[], result: CodexSessionSearchResult): void {
  const hints = codexSessionSearchHints(result);
  if (hints.length === 0) return;
  lines.push("", ...hints.map((hint) => `Note: ${hint}`));
}

export function formatCodexSessionSearch(result: CodexSessionSearchResult): string {
  if (result.hits.length === 0) {
    const filters = [
      result.repo ? `repo=${result.repo}` : "repo=all",
      result.query ? `query="${result.query}"` : "query=none",
      `mode=${result.mode}`,
      `role=${result.role}`,
      `scanned=${result.filesScanned}/${result.filesConsidered}`,
    ];
    const lines = [`No Codex session matches found. ${filters.join(" ")}`];
    appendCodexSessionSearchHints(lines, result);
    return lines.join("\n");
  }

  const header = [
    `Codex sessions: mode=${result.mode}`,
    `role=${result.role}`,
    result.repo ? `repo=${result.repo}` : "repo=all",
    result.query ? `query="${result.query}"` : "query=none",
    `scanned=${result.filesScanned}/${result.filesConsidered}`,
    result.maxSessions === null ? "maxSessions=all" : `maxSessions=${result.maxSessions}`,
    result.deep ? "deep=true" : "deep=false",
  ].join(" ");

  const lines = [header, ""];

  if (result.mode === "prompts") {
    let count = 0;
    for (const hit of result.hits) {
      for (const message of hit.messages) {
        count += 1;
        lines.push(`- ${hit.session.timestamp || "unknown-time"} | session=${hit.session.id} | line=${message.lineNumber}`);
        lines.push(`  cwd=${hit.session.cwd || "unknown"}`);
        lines.push(`  file=${hit.session.file}`);
        lines.push(`  ${truncate(message.text, 600)}`);
      }
    }
    lines[0] = `${lines[0]} results=${count}`;
    appendCodexSessionSearchHints(lines, result);
    return lines.join("\n");
  }

  if (result.mode === "sessions") {
    for (const hit of result.hits) {
      const preview = hit.messages[0] ? truncate(hit.messages[0].text, 420) : "";
      lines.push(`- ${hit.session.timestamp || "unknown-time"} | session=${hit.session.id} | score=${hit.score}`);
      lines.push(`  cwd=${hit.session.cwd || "unknown"}`);
      lines.push(
        `  prompts=${hit.session.promptCount} assistant=${hit.session.assistantMessageCount} tools=${hit.session.toolCallCount} lines=${hit.session.lineCount}`,
      );
      lines.push(`  file=${hit.session.file}`);
      if (preview) lines.push(`  preview=${preview}`);
    }
    appendCodexSessionSearchHints(lines, result);
    return lines.join("\n");
  }

  for (const hit of result.hits) {
    lines.push(`## ${hit.session.timestamp || "unknown-time"} | session=${hit.session.id}`);
    lines.push(`cwd=${hit.session.cwd || "unknown"}`);
    lines.push(`file=${hit.session.file}`);
    lines.push("");
    for (const message of hit.messages) {
      const label = message.role === "tool" ? "tool" : message.role;
      lines.push(`[${label} line ${message.lineNumber}] ${truncate(message.text, 1200)}`);
    }
    lines.push("");
  }
  appendCodexSessionSearchHints(lines, result);
  return lines.join("\n").trimEnd();
}

export async function searchCodexMemory(input: {
  query: string;
  depth?: "summary" | "summary-registry" | "summary-registry-rollouts";
  limit?: number;
  codexMemoryRoot?: string;
}): Promise<Array<{ file: string; lineNumber: number; line: string; score: number }>> {
  const root = path.resolve(expandHome(input.codexMemoryRoot || "~/.codex/memories"));
  const depth = input.depth || "summary-registry-rollouts";
  const files = [path.join(root, "memory_summary.md")];
  if (depth !== "summary") files.push(path.join(root, "MEMORY.md"));
  if (depth === "summary-registry-rollouts") {
    const rollouts = path.join(root, "rollout_summaries");
    try {
      const names = await readdir(rollouts);
      for (const name of names) {
        if (name.endsWith(".md")) files.push(path.join(rollouts, name));
      }
    } catch {
      // Missing rollout summaries are fine.
    }
  }

  const words = tokenize(input.query);
  const matches: Array<{ file: string; lineNumber: number; line: string; score: number }> = [];
  for (const file of files) {
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, index) => {
      const haystack = line.toLowerCase();
      const score = words.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0);
      if (score > 0) {
        matches.push({ file, lineNumber: index + 1, line: line.trim(), score });
      }
    });
  }

  return matches
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.lineNumber - b.lineNumber)
    .slice(0, Math.max(1, input.limit || 20));
}

export function formatCodexMatches(matches: Awaited<ReturnType<typeof searchCodexMemory>>): string {
  if (matches.length === 0) return "No Codex memory matches found.";
  return matches
    .map((match) => `- ${match.file}:${match.lineNumber}\n  ${match.line}`)
    .join("\n");
}
