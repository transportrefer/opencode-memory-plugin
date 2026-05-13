#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const opencodeDir = path.join(homedir(), ".config", "opencode");
const opencodeConfig = path.join(opencodeDir, "opencode.json");
const commandsDir = path.join(opencodeDir, "commands");
const memoryRoot = path.join(opencodeDir, "memory");
const pluginRef = pathToFileURL(repoRoot).href;

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

async function backup(file) {
  if (!existsSync(file)) return null;
  const target = `${file}.bak-opencode-memory-${timestamp()}`;
  await copyFile(file, target);
  return target;
}

async function installPluginRef() {
  const backupPath = await backup(opencodeConfig);
  const raw = await readFile(opencodeConfig, "utf8");
  const config = JSON.parse(raw);
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  const alreadyInstalled = plugins.some((entry) => {
    if (typeof entry === "string") return entry === pluginRef;
    return Array.isArray(entry) && entry[0] === pluginRef;
  });
  if (!alreadyInstalled) {
    plugins.push(pluginRef);
    config.plugin = plugins;
    await writeFile(opencodeConfig, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  return { backupPath, alreadyInstalled };
}

async function installCommands() {
  await mkdir(commandsDir, { recursive: true });
  const commands = ["memory.md", "remember.md", "codex-memory.md", "codex-sessions.md"];
  const installed = [];
  for (const name of commands) {
    const source = path.join(repoRoot, "commands", name);
    const target = path.join(commandsDir, name);
    const backupPath = await backup(target);
    await copyFile(source, target);
    installed.push({ target, backupPath });
  }
  return installed;
}

async function ensureMemoryRoot() {
  await mkdir(memoryRoot, { recursive: true });
  const projects = path.join(memoryRoot, "projects.json");
  if (!existsSync(projects)) {
    await writeFile(projects, `${JSON.stringify({ projects: {} }, null, 2)}\n`, "utf8");
  }
  return projects;
}

async function main() {
  const plugin = await installPluginRef();
  const commands = await installCommands();
  const projects = await ensureMemoryRoot();

  console.log(`Plugin ref: ${pluginRef}`);
  console.log(`OpenCode config: ${opencodeConfig}`);
  if (plugin.backupPath) console.log(`Config backup: ${plugin.backupPath}`);
  console.log(plugin.alreadyInstalled ? "Plugin ref already present." : "Plugin ref added.");
  for (const command of commands) {
    console.log(`Command installed: ${command.target}${command.backupPath ? ` (backup: ${command.backupPath})` : ""}`);
  }
  console.log(`Projects config: ${projects}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
