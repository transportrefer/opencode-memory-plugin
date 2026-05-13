import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  formatCodexMatches,
  formatCodexSessionSearch,
  recallMemory,
  rememberMemory,
  resolveProject,
  searchCodexMemory,
  searchCodexSessions,
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

test("codex session search returns repo-scoped user prompts from standard jsonl", async () => {
  const { root, repo } = await fixture();
  const otherRepo = path.join(root, "other");
  const sessionsRoot = path.join(root, "codex-sessions", "2026", "05", "13");
  await mkdir(otherRepo, { recursive: true });
  await mkdir(sessionsRoot, { recursive: true });

  const sessionFile = path.join(sessionsRoot, "rollout-2026-05-13T12-00-00-session-a.jsonl");
  const otherSessionFile = path.join(sessionsRoot, "rollout-2026-05-13T12-10-00-session-b.jsonl");
  const parentSessionFile = path.join(sessionsRoot, "rollout-2026-05-13T12-20-00-session-parent.jsonl");
  await writeFile(
    sessionFile,
    [
      {
        timestamp: "2026-05-13T12:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-a", timestamp: "2026-05-13T12:00:00.000Z", cwd: repo },
      },
      {
        timestamp: "2026-05-13T12:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "# AGENTS.md instructions for /tmp/repo\n\n<environment_context>" }],
        },
      },
      {
        timestamp: "2026-05-13T12:00:02.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "<user_shell_command>\nCloudflare deploy shell wrapper\n</user_shell_command>" },
      },
      {
        timestamp: "2026-05-13T12:00:03.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Please verify Cloudflare deploy history for this repo." },
      },
      {
        timestamp: "2026-05-13T12:00:04.000Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call_1", output: "very verbose tool output" },
      },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
  await writeFile(
    otherSessionFile,
    [
      {
        timestamp: "2026-05-13T12:10:00.000Z",
        type: "session_meta",
        payload: { id: "session-b", timestamp: "2026-05-13T12:10:00.000Z", cwd: otherRepo },
      },
      {
        timestamp: "2026-05-13T12:10:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Cloudflare deploy in another repo." },
      },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
  await writeFile(
    parentSessionFile,
    [
      {
        timestamp: "2026-05-13T12:20:00.000Z",
        type: "session_meta",
        payload: { id: "session-parent", timestamp: "2026-05-13T12:20:00.000Z", cwd: root },
      },
      {
        timestamp: "2026-05-13T12:20:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Cloudflare deploy from parent folder should not match repo." },
      },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n",
  );

  const result = await searchCodexSessions({
    query: "cloudflare deploy",
    repo,
    codexSessionsRoot: path.join(root, "codex-sessions"),
  });

  assert.equal(result.filesScanned, 3);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].session.id, "session-a");
  assert.equal(result.hits[0].messages.length, 1);
  assert.match(result.hits[0].messages[0].text, /Cloudflare deploy history/);
  assert.doesNotMatch(formatCodexSessionSearch(result), /AGENTS\.md instructions/);
  assert.doesNotMatch(formatCodexSessionSearch(result), /tool output/);
});

test("codex session transcript excludes tools by default and can target a session", async () => {
  const { root, repo } = await fixture();
  const sessionsRoot = path.join(root, "codex-sessions", "2026", "05", "13");
  await mkdir(sessionsRoot, { recursive: true });
  const sessionFile = path.join(sessionsRoot, "rollout-2026-05-13T13-00-00-session-c.jsonl");
  await writeFile(
    sessionFile,
    [
      {
        timestamp: "2026-05-13T13:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-c", timestamp: "2026-05-13T13:00:00.000Z", cwd: repo },
      },
      {
        timestamp: "2026-05-13T13:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Show the concise transcript." },
      },
      {
        timestamp: "2026-05-13T13:00:02.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "I will inspect it without tools in the transcript." },
      },
      {
        timestamp: "2026-05-13T13:00:03.000Z",
        type: "response_item",
        payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"cat huge.log\"}" },
      },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n",
  );

  const compact = await searchCodexSessions({
    session: "session-c",
    mode: "transcript",
    repo,
    codexSessionsRoot: path.join(root, "codex-sessions"),
  });
  const withTools = await searchCodexSessions({
    session: sessionFile,
    mode: "transcript",
    repo,
    includeTools: true,
    codexSessionsRoot: path.join(root, "codex-sessions"),
  });

  assert.equal(compact.hits.length, 1);
  assert.equal(compact.hits[0].messages.some((message) => message.role === "tool"), false);
  assert.match(formatCodexSessionSearch(compact), /Show the concise transcript/);
  assert.equal(withTools.hits[0].messages.some((message) => message.role === "tool"), true);
});

test("codex session search supports Codex home overrides", async () => {
  const { root, repo } = await fixture();
  const codexHome = path.join(root, "custom-codex-home");
  const sessionsRoot = path.join(codexHome, "sessions", "2026", "05", "13");
  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    path.join(sessionsRoot, "rollout-2026-05-13T14-00-00-home-override.jsonl"),
    [
      {
        timestamp: "2026-05-13T14:00:00.000Z",
        type: "session_meta",
        payload: { id: "home-override", timestamp: "2026-05-13T14:00:00.000Z", cwd: repo },
      },
      {
        timestamp: "2026-05-13T14:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Find this through a Codex home override." },
      },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n",
  );

  const result = await searchCodexSessions({
    query: "home override",
    repo,
    codexHome,
  });

  assert.equal(result.root, path.join(codexHome, "sessions"));
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].session.id, "home-override");
});

test("codex session search reports partial capped scans and deep scans older history", async () => {
  const { root, repo } = await fixture();
  const sessionsRoot = path.join(root, "codex-sessions", "2026", "05", "13");
  await mkdir(sessionsRoot, { recursive: true });

  async function writeSession(name: string, id: string, timestamp: string, message: string): Promise<void> {
    await writeFile(
      path.join(sessionsRoot, name),
      [
        {
          timestamp,
          type: "session_meta",
          payload: { id, timestamp, cwd: repo },
        },
        {
          timestamp,
          type: "event_msg",
          payload: { type: "user_message", message },
        },
      ].map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
  }

  await writeSession(
    "rollout-2026-05-13T15-00-00-older-match.jsonl",
    "older-match",
    "2026-05-13T15:00:00.000Z",
    "This older session contains the rare deep-history needle.",
  );
  await writeSession(
    "rollout-2026-05-13T15-10-00-newer-miss.jsonl",
    "newer-miss",
    "2026-05-13T15:10:00.000Z",
    "This newer session is unrelated.",
  );

  const capped = await searchCodexSessions({
    query: "deep-history needle",
    repo,
    codexSessionsRoot: path.join(root, "codex-sessions"),
    maxSessions: 1,
  });
  const deep = await searchCodexSessions({
    query: "deep-history needle",
    repo,
    codexSessionsRoot: path.join(root, "codex-sessions"),
    deep: true,
  });

  assert.equal(capped.hits.length, 0);
  assert.equal(capped.partial, true);
  assert.equal(capped.scanLimitReached, true);
  assert.equal(capped.remainingFiles, 1);
  assert.match(formatCodexSessionSearch(capped), /--deep/);
  assert.equal(deep.deep, true);
  assert.equal(deep.maxSessions, null);
  assert.equal(deep.partial, false);
  assert.equal(deep.hits.length, 1);
  assert.equal(deep.hits[0].session.id, "older-match");
});
