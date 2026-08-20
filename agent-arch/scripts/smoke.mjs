import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dataDir = mkdtempSync(join(tmpdir(), "agentarch-smoke-"));
const server = spawn("node", [join(root, "packages/server/dist/main.js")], {
  env: { ...process.env, AGENT_ARCH_PORT: "4021", AGENT_ARCH_DATA_DIR: dataDir },
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

  const diff = await j("GET", `/api/blueprints/${id}/diff`);
  ok("最近保存 diff 归类为参数变更（minor）", diff.body.diff.parameter.length > 0 && diff.body.diff.structural.length === 0, JSON.stringify(diff.body.diff));

  const comment = await j("POST", `/api/blueprints/${id}/comments`, { text: "压缩策略建议用 hierarchical", nodeId: null, author: "reviewer-1" });
  ok("添加评审评论", comment.status === 201);
  const comments = await j("GET", `/api/blueprints/${id}/comments`);
  ok("评论可列出", comments.body.length === 1);

  const staticIdx = await fetch(`${BASE}/`).then((r) => r.text());
  ok("web 面板静态托管", staticIdx.includes("AgentArch"));

  console.log(`\nsmoke: ${passed} checks passed${process.exitCode ? " (WITH FAILURES)" : ""}`);
} finally {
  server.kill("SIGTERM");
  await sleep(300);
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {}
}
