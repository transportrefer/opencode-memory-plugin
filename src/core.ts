import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

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

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export type RecallScope = (typeof RECALL_SCOPES)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

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
