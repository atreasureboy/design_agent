import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dataDir = mkdtempSync(join(tmpdir(), "agentarch-smoke-"));
const entDir = mkdtempSync(join(tmpdir(), "agentarch-smoke-ent-"));
const server = spawn("node", [join(root, "packages/server/dist/main.js")], {
  env: { ...process.env, AGENT_ARCH_PORT: "4021", AGENT_ARCH_DATA_DIR: dataDir, AGENT_ARCH_ENT_DIR: entDir },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
server.stderr.on("data", (d) => process.stderr.write(`[server:err] ${d}`));

const BASE = "http://127.0.0.1:4021";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) {
    console.error(`FAIL - ${name} ${extra}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`  ok - ${name}`);
  }
};

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

const node = (ref, children = [], params = {}) => ({ id: `s-${Math.random().toString(36).slice(2, 8)}`, ref, name: null, params, reason: null, children });

try {
  await sleep(1200);

  console.log("smoke: ontology");
  const ont = await j("GET", "/api/ontology");
  ok("ontology 可用", ont.status === 200 && ont.body.elements.length > 30);

  console.log("smoke: schema migrations + 输入校验");
  const badFamily = await j("POST", "/api/blueprints", { name: "非法族", runtimeFamily: "no-such-family", author: "smoke" });
  ok("非法 runtimeFamily 返回 400", badFamily.status === 400);
  const migBp = await j("POST", "/api/blueprints", { name: "迁移测试", runtimeFamily: "event-driven", author: "smoke", template: "rag" });
  ok("新蓝图带当前 schemaVersion", migBp.body.blueprint.schemaVersion === "1.0");
  const migFile = join(dataDir, "blueprints", `${migBp.body.blueprint.id}.json`);
  const migStored = JSON.parse(readFileSync(migFile, "utf8"));
  delete migStored.current.schemaVersion;
  writeFileSync(migFile, JSON.stringify(migStored, null, 2));
  const migRead = await j("GET", `/api/blueprints/${migBp.body.blueprint.id}`);
  ok("无 schemaVersion 的蓝图自动升级到当前 schema", migRead.body.blueprint.schemaVersion === "1.0");
  ok("升级迁移被记录", Array.isArray(migRead.body.appliedMigrations) && migRead.body.appliedMigrations.length > 0);
  const migReread = await j("GET", `/api/blueprints/${migBp.body.blueprint.id}`);
  ok("已迁移蓝图再次读取不重复迁移", migReread.body.appliedMigrations.length === 0);

  console.log("smoke: RAG template (正向设计流)");
  const ragBp = await j("POST", "/api/blueprints", { name: "企业知识库 Agent", description: "RAG 模板起步", runtimeFamily: "stateful-graph", author: "smoke", template: "rag" });
  ok("RAG 模板创建蓝图", ragBp.status === 201);
  const ragNodes = ragBp.body.blueprint.nodes;
  ok("RAG 管线骨架完整", Array.isArray(ragNodes) && ragNodes[0]?.ref === "rag" && ragNodes[0].children.length === 6);
  ok("retrieval 默认 hybrid + RRF", ragNodes[0].children.find((c) => c.ref === "rag-retrieval")?.params.fusionMethod === "rrf");
  const ragId = ragBp.body.blueprint.id;
  const ragGate = await j("POST", `/api/blueprints/${ragId}/validate`);
  ok("RAG 模板直接通过门禁（reranker+generation 已消解高危）", ragGate.body.gate.pass === true);
  const ragYaml = await fetch(`${BASE}/api/blueprints/${ragId}/export`).then((r) => r.text());
  ok("RAG 导出含 hybrid 参数与消解记录", ragYaml.includes("fusionMethod: rrf") && ragYaml.includes("mitigated:"));

  console.log("smoke: blueprint lifecycle");
  const created = await j("POST", "/api/blueprints", { name: "多 Agent 编码系统", description: "冒烟", runtimeFamily: "event-driven", author: "smoke" });
  ok("创建蓝图", created.status === 201);
  const id = created.body.blueprint.id;

  const badNodes = [node("multi-agent", [node("topology", [node("supervisor-worker")])])];
  const saved1 = await j("PUT", `/api/blueprints/${id}`, { nodes: badNodes });
  ok("保存含缺陷架构", saved1.status === 200);
  ok("requires 缺失被检出", saved1.body.lint.some((i) => i.code === "requires-missing"));
  ok("高危 goal-drift 未消解", saved1.body.riskReport.unresolvedHigh.some((r) => r.riskId === "goal-drift"));
  ok("结构性变更 bump sv", saved1.body.blueprint.structuralVersion === 2 && saved1.body.blueprint.version === 2);

  const gate1 = await j("POST", `/api/blueprints/${id}/transition`, { to: "in-review" });
  ok("提交评审", gate1.status === 200);
  const blocked = await j("POST", `/api/blueprints/${id}/transition`, { to: "approved" });
  ok("审批门禁拦截（422）", blocked.status === 422 && blocked.body.blockers.length > 0);
  const back = await j("POST", `/api/blueprints/${id}/transition`, { to: "draft" });
  ok("退回草稿", back.status === 200);

  console.log("smoke: fix and approve");
  const goodNodes = [
    node("harness", [node("context-engineering", [node("context-compression", [], { strategy: "hierarchical", threshold: 70 }), node("objective-anchor")])]),
    node("multi-agent", [node("topology", [node("supervisor-worker")]), node("lifecycle", [node("lifecycle-manager"), node("budget-caps", [], { maxSubagents: 6 })])]),
    node("agents", [node("planner-role"), node("worker-role", [], { specialty: "coding" })]),
  ];
  const saved2 = await j("PUT", `/api/blueprints/${id}`, { nodes: goodNodes });
  ok("保存修复后架构", saved2.status === 200);
  const errors = saved2.body.lint.filter((i) => i.severity === "error");
  ok("无 error 级问题", errors.length === 0, JSON.stringify(errors));
  ok("goal-drift 已消解", !saved2.body.riskReport.unresolvedHigh.some((r) => r.riskId === "goal-drift"));

  const tweak = structuredClone(goodNodes);
  tweak[0].children[0].children[0].params.threshold = 50;
  const saved3 = await j("PUT", `/api/blueprints/${id}`, { nodes: tweak });
  ok("仅调参数保存", saved3.status === 200);
  ok("参数调整不 bump structural version", saved3.body.blueprint.structuralVersion === saved2.body.blueprint.structuralVersion);

  await j("POST", `/api/blueprints/${id}/transition`, { to: "in-review" });
  const approved = await j("POST", `/api/blueprints/${id}/transition`, { to: "approved" });
  ok("门禁放行，批准成功", approved.status === 200 && approved.body.blueprint.status === "approved");

  const readonly = await j("PUT", `/api/blueprints/${id}`, { nodes: goodNodes });
  ok("approved 后只读（409）", readonly.status === 409);

  console.log("smoke: export / diff / comments");
  const yaml = await fetch(`${BASE}/api/blueprints/${id}/export`).then((r) => r.text());
  ok("导出含 MUST/MAY 分层语义", yaml.includes("MUST") && yaml.includes("MAY"));
  ok("导出含结构树与参数", yaml.includes("structural:") && yaml.includes("threshold: 50"));
  ok("导出含风险消解记录", yaml.includes("mitigated:"));

  console.log("smoke: diagram + comment resolve (P2)");
  const diagram = await fetch(`${BASE}/api/blueprints/${id}/diagram`).then((r) => r.text());
  ok("diagram 返回 SVG 且含蓝图标题", diagram.startsWith("<svg") && diagram.includes("多 Agent 编码系统"));
  ok("diagram 含图例（决策/职责/注记三徽章说明）", diagram.includes("设计决策") && diagram.includes("职责边界") && diagram.includes("待考量"));

  const diff = await j("GET", `/api/blueprints/${id}/diff`);
  ok("最近保存 diff 归类为参数变更（minor）", diff.body.diff.parameter.length > 0 && diff.body.diff.structural.length === 0, JSON.stringify(diff.body.diff));

  const comment = await j("POST", `/api/blueprints/${id}/comments`, { text: "压缩策略建议用 hierarchical", nodeId: null, author: "reviewer-1" });
  ok("添加评审评论", comment.status === 201);
  const comments = await j("GET", `/api/blueprints/${id}/comments`);
  ok("评论可列出", comments.body.length === 1);
  const toggle = await j("POST", `/api/blueprints/${id}/comments/${comments.body[0].id}/toggle`);
  ok("评论可标记解决", toggle.status === 200 && toggle.body.resolved === true);
  const retoggle = await j("POST", `/api/blueprints/${id}/comments/${comments.body[0].id}/toggle`);
  ok("评论可重开", retoggle.status === 200 && retoggle.body.resolved === false);

  console.log("smoke: enterprise extensions (CRD + 审核队列)");
  const extRes = await j("POST", "/api/extensions", { parentId: "tool-system", name: "企业安全策略", description: "内部数据分级" });
  ok("提交企业扩展（pending）", extRes.status === 201 && extRes.body.element.review === "pending");
  const ontPending = await j("GET", "/api/ontology");
  ok("pending 元素不进入本体", !ontPending.body.elements.some((e) => e.id === extRes.body.element.id));
  const approve = await j("POST", `/api/extensions/${extRes.body.element.id}/review`, { approved: true });
  ok("审批通过", approve.status === 200 && approve.body.element.review === "approved");
  const ontApproved = await j("GET", "/api/ontology");
  ok("approved 元素合并入本体", ontApproved.body.elements.some((e) => e.id === extRes.body.element.id));
  const extRes2 = await j("POST", "/api/extensions", { parentId: "multi-agent", name: "临时扩展", description: "将被驳回" });
  const reject = await j("POST", `/api/extensions/${extRes2.body.element.id}/review`, { approved: false });
  ok("驳回后不进入本体", reject.status === 200 && reject.body.element.review === "rejected");
  const ontRejected = await j("GET", "/api/ontology");
  ok("rejected 元素不在本体", !ontRejected.body.elements.some((e) => e.id === extRes2.body.element.id));
  const extList = await j("GET", "/api/extensions");
  ok("治理列表含全部状态", extList.body.enterprise.some((e) => e.review === "approved") && extList.body.enterprise.some((e) => e.review === "rejected"));
  const badParent = await j("POST", "/api/extensions", { parentId: "context-compression", name: "X", description: "" });
  ok("挂载非扩展点被拒绝（422）", badParent.status === 422);
  const extRemoved = await j("DELETE", `/api/extensions/${extRes.body.element.id}`);
  ok("企业元素可删除", extRemoved.status === 200 && extRemoved.body.removed === extRes.body.element.id);

  console.log("smoke: Architecture MCP (AI 搭积木)");
  const mcp = spawn("node", [join(root, "packages/mcp/dist/main.js")], {
    env: { ...process.env, AGENT_ARCH_DATA_DIR: dataDir, AGENT_ARCH_ENT_DIR: entDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let mcpBuf = "";
  const pending = new Map();
  let mcpSeq = 0;
  mcp.stdout.on("data", (d) => {
    mcpBuf += d;
    let idx;
    while ((idx = mcpBuf.indexOf("\n")) >= 0) {
      const line = mcpBuf.slice(0, idx);
      mcpBuf = mcpBuf.slice(idx + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = ++mcpSeq;
      pending.set(id, resolve);
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const call = (name, args) => rpc("tools/call", { name, arguments: args });

  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  ok("MCP 握手成功", init.result?.serverInfo?.name === "agent-arch");
  mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const toolList = await rpc("tools/list", {});
  ok("tools/list 暴露受约束工具集（≥15）", toolList.result.tools.length >= 15 && toolList.result.tools.some((t) => t.name === "add_component"));

  const mcpCreated = await call("create_blueprint", { name: "MCP 搭积木测试", runtimeFamily: "event-driven", template: "multi-agent" });
  ok("MCP 从模板创建蓝图", mcpCreated.result.isError === false && mcpCreated.result.content[0].text.includes("已创建蓝图"));
  const mcpBpId = mcpCreated.result.content[0].text.match(/蓝图 (\S+?)（/)[1];

  const badMount = await call("add_component", { blueprintId: mcpBpId, elementId: "supervisor-worker" });
  ok("非法挂载被拒（topology→supervisor 层级约束）", badMount.result.isError === true);

  const ragMount = await call("add_component", { blueprintId: mcpBpId, elementId: "rag" });
  ok("合法挂载 RAG 分区", ragMount.result.isError === false);
  const mcpTree = (await call("get_blueprint", { blueprintId: mcpBpId })).result.content[0].text;
  const ragNodeId = mcpTree.match(/\[([^\]]+)\] RAG 检索增强/)[1];
  const ragPalette = await call("list_palette", { blueprintId: mcpBpId, parentNodeId: ragNodeId });
  ok("调色板列出 rag 分区可选元素（含约束状态）", ragPalette.result.content[0].text.includes("rag-retrieval") && ragPalette.result.content[0].text.includes("rag-ingestion"));

  const retrAdd = await call("add_component", { blueprintId: mcpBpId, elementId: "rag-retrieval", parentNodeId: ragNodeId });
  ok("挂载 retrieval", retrAdd.result.isError === false);
  const retrId = retrAdd.result.content[0].text.match(/已添加 \[([^\]]+)\]/)[1];

  const badParam = await call("set_parameter", { blueprintId: mcpBpId, nodeId: retrId, key: "topK", value: 500 });
  ok("参数越界被约束引擎拒绝", badParam.result.isError === true && badParam.result.content[0].text.includes("必须是数字"));

  const decision = await call("set_decision", { blueprintId: mcpBpId, nodeId: retrId, chosen: "hybrid", alternatives: ["dense", "bm25"], rejectedReason: "企业术语需要精确匹配兜底" });
  ok("设计决策记录（ADR）", decision.result.isError === false && decision.result.content[0].text.includes("已记录设计决策"));

  const mcpValidate = await call("validate_blueprint", { blueprintId: mcpBpId });
  ok("validate 返回门禁结论", mcpValidate.result.content[0].text.includes("审批门禁"));
  const mcpExport = await call("export_blueprint", { blueprintId: mcpBpId });
  ok("导出含决策记录段", mcpExport.result.content[0].text.includes("decisions:") && mcpExport.result.content[0].text.includes("hybrid"));
  mcp.kill("SIGTERM");

  console.log("smoke: 操作审计");
  const audit = await j("GET", "/api/audit?limit=200");
  ok("审计接口可用", audit.status === 200 && Array.isArray(audit.body.entries));
  const actions = new Set(audit.body.entries.map((e) => e.action));
  ok("蓝图创建有审计（含 actor）", actions.has("blueprint.create") && audit.body.entries.some((e) => e.action === "blueprint.create" && e.actor === "smoke"));
  ok("蓝图保存有审计", actions.has("blueprint.save"));
  ok("状态转移有审计", actions.has("blueprint.transition"));
  ok("评论有审计", actions.has("comment.add"));
  ok("扩展提交与评审有审计", actions.has("extension.submit") && actions.has("extension.review"));
  ok("MCP 操作有审计（actor=mcp）", audit.body.entries.some((e) => e.actor === "mcp"));
  ok("审计条目带时间戳与对象", audit.body.entries.every((e) => e.ts && e.target !== undefined));

  const staticIdx = await fetch(`${BASE}/`).then((r) => r.text());
  ok("web 面板静态托管", staticIdx.includes("AgentArch"));

  console.log(`\nsmoke: ${passed} checks passed${process.exitCode ? " (WITH FAILURES)" : ""}`);
} finally {
  server.kill("SIGTERM");
  await sleep(300);
  try {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(entDir, { recursive: true, force: true });
  } catch {}
}
