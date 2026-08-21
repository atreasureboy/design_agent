#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const toolName = process.argv[2];
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
if (!toolName) {
  console.error("用法: node scripts/mcp-client.mjs <toolName> '<jsonArgs>'");
  console.error("先运行 list 查看工具: node scripts/mcp-client.mjs list");
  process.exit(2);
}

const entDir = process.env.AGENT_ARCH_ENT_DIR ?? mkdtempSync(join(tmpdir(), "agentarch-ent-"));

const server = spawn("node", [join(root, "packages/mcp/dist/main.js")], {
  env: { ...process.env, AGENT_ARCH_ENT_DIR: entDir },
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
let initialized = false;
const send = (obj) => server.stdin.write(JSON.stringify(obj) + "\n");

server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
server.stdout.on("data", (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === 1) {
      initialized = true;
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      if (toolName === "list") {
        send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      } else {
        send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } });
      }
    } else if (msg.id === 2) {
      if (toolName === "list") {
        const tools = msg.result?.tools ?? [];
        console.log(`共 ${tools.length} 个工具:`);
        for (const t of tools) console.log(`  ${t.name}: ${t.description}`);
      } else {
        const content = msg.result?.content ?? [];
        for (const c of content) process.stdout.write(c.text + "\n");
        if (msg.result?.isError) process.exitCode = 1;
      }
      server.kill("SIGTERM");
      if (!process.env.AGENT_ARCH_ENT_DIR) rmSync(entDir, { recursive: true, force: true });
      process.exit(process.exitCode ?? 0);
    }
  }
});

setTimeout(() => {
  console.error("超时（10s），检查 mcp 构建与工具名");
  server.kill("SIGTERM");
  process.exit(3);
}, 10000);

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-client", version: "0" } } });
if (!initialized) void initialized;
