import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  formatCodexMatches,
  recallMemory,
  rememberMemory,
  resolveProject,
  searchCodexMemory,
  supersedeMemory,
} from "./core.js";

async function fixture(): Promise<{ root: string; repo: string; memoryRoot: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-memory-"));
  const repo = path.join(root, "repo");
  const memoryRoot = path.join(root, "memory");
  await mkdir(repo, { recursive: true });
  return { root, repo, memoryRoot };
}

test("resolves project from git remote", async () => {
  const { repo, memoryRoot } = await fixture();
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:owner/example.git"], { cwd: repo, stdio: "ignore" });

  const project = await resolveProject(repo, memoryRoot);

  assert.equal(project.source, "remote");
  assert.match(project.id, /^github.com-owner-example--[a-f0-9]{12}$/);
});

test("explicit projects config overrides git/path identity", async () => {
  const { repo, memoryRoot } = await fixture();
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(
    path.join(memoryRoot, "projects.json"),
    JSON.stringify({ projects: { "manual-id": { paths: [repo] } } }, null, 2),
  );

  const project = await resolveProject(repo, memoryRoot);

  assert.equal(project.source, "alias");
  assert.equal(project.id, "manual-id");
});

test("remember and recall use Markdown memory files", async () => {
  const { repo, memoryRoot } = await fixture();

  const saved = await rememberMemory({
    directory: repo,
    memoryRoot,
    note: "Use pnpm check before deploying.",
    type: "command",
    scope: "repo",
    confidence: "high",
    source: "test",
  });
  const recalled = await recallMemory({ directory: repo, memoryRoot, query: "pnpm deploy" });
  const text = await readFile(saved.file, "utf8");

  assert.match(text, /## Active/);
  assert.equal(recalled.entries.length, 1);
  assert.equal(recalled.entries[0].note, "Use pnpm check before deploying.");
});

test("supersede moves old note and stores replacement", async () => {
  const { repo, memoryRoot } = await fixture();

  await rememberMemory({
    directory: repo,
    memoryRoot,
    note: "Deploys from a manual worker upload.",
    type: "source",
    scope: "repo",
    confidence: "medium",
    source: "test",
  });
  const result = await supersedeMemory({
    directory: repo,
    memoryRoot,
    query: "manual worker",
    reason: "deploy source changed",
    replacement: "Deploys from GitHub Actions on main.",
    source: "test",
  });
  const recalled = await recallMemory({ directory: repo, memoryRoot, query: "deploys" });
  const text = await readFile(result.file || "", "utf8");

  assert.ok(result.superseded);
  assert.ok(result.replacement);
  assert.match(text, /## Superseded/);
  assert.match(text, /manual worker upload/);
  assert.equal(recalled.entries.some((entry) => entry.note.includes("manual worker")), false);
  assert.equal(recalled.entries.some((entry) => entry.note.includes("GitHub Actions")), true);
});

test("codex memory search reads summary registry and rollouts", async () => {
  const { root } = await fixture();
  const codexRoot = path.join(root, "codex");
  await mkdir(path.join(codexRoot, "rollout_summaries"), { recursive: true });
  await writeFile(path.join(codexRoot, "memory_summary.md"), "OpenCode prefers light memory.\n");
  await writeFile(path.join(codexRoot, "MEMORY.md"), "Mempalace was removed.\n");
  await writeFile(path.join(codexRoot, "rollout_summaries", "one.md"), "Use Markdown memory for OpenCode.\n");

  const matches = await searchCodexMemory({
    query: "OpenCode Markdown",
    codexMemoryRoot: codexRoot,
    depth: "summary-registry-rollouts",
  });

  assert.equal(matches.length, 2);
  assert.match(formatCodexMatches(matches), /memory_summary\.md/);
  assert.match(formatCodexMatches(matches), /rollout_summaries/);
});
