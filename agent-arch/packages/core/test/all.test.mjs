import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  validateOntology,
  lintBlueprint,
  approvalGate,
  activeRiskReport,
  diffBlueprints,
  exportBlueprintYaml,
  makeNode,
  createBlueprint,
  paletteFor,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const ontDir = join(here, "../../../ontology/core");

const elements = JSON.parse(readFileSync(join(ontDir, "elements.json"), "utf8"));
const risks = JSON.parse(readFileSync(join(ontDir, "risks.json"), "utf8"));
const families = JSON.parse(readFileSync(join(ontDir, "families.json"), "utf8"));
const ontology = validateOntology({ version: "0.1.0", elements, risks, families });

const el = (id) => elements.find((e) => e.id === id);
const node = (id, params = {}, children = [], name = null) => {
  const e = el(id);
  const defaults = {};
  for (const [k, s] of Object.entries(e.properties)) defaults[k] = s.default;
  return { id: `t-${id}-${Math.random().toString(36).slice(2, 6)}`, ref: id, name, params: { ...defaults, ...params }, reason: null, children };
};

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    throw err;
  }
};

console.log("ontology:");
test("加载并通过自校验（含双向绑定一致性）", () => {
  assert.ok(ontology.elements.length >= 30);
  assert.ok(ontology.risks.length >= 10);
});
test("双向绑定断裂时抛错", () => {
  const broken = JSON.parse(JSON.stringify({ version: "0.1.0", elements, risks, families }));
  broken.elements.find((e) => e.id === "trace").mitigates.push("goal-drift");
  assert.throws(() => validateOntology(broken), /bidirectional/);
});
test("未知父节点抛错", () => {
  const bad = JSON.parse(JSON.stringify({ version: "0.1.0", elements, risks, families }));
  bad.elements.push({ ...bad.elements[0], id: "orphan-x", parentId: "no-such" });
  assert.throws(() => validateOntology(bad), /parent/);
});

console.log("constraint engine:");
test("Runtime 族不可用报错（checkpoint 在 stateless-loop）", () => {
  const bp = [node("harness", {}, [node("state-management", {}, [node("checkpoint")])])];
  const issues = lintBlueprint(ontology, bp, "stateless-loop");
  assert.ok(issues.some((i) => i.code === "family-unavailable" && i.elementId === "checkpoint"));
});
test("requires 缺失报错（supervisor-worker 依赖 lifecycle-manager）", () => {
  const bp = [node("multi-agent", {}, [node("topology", {}, [node("supervisor-worker")])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "requires-missing"));
});
test("required 子节点缺失报错（multi-agent 下必须有 topology）", () => {
  const bp = [node("multi-agent", {}, [node("communication", {}, [node("message-bus")])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "required-missing" && i.elementId === "topology"));
});
test("非法父子关系报错（taxonomy-violation）", () => {
  const bp = [node("harness", {}, [node("supervisor-worker")])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "taxonomy-violation"));
});
test("参数越界/枚举外报错", () => {
  const bp = [node("harness", {}, [node("context-engineering", {}, [node("context-compression", { threshold: 500 })])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "param-invalid"));
});

console.log("risk engine:");
test("multi-agent 引入 goal-drift，未消解为高危阻断", () => {
  const bp = [node("multi-agent", {}, [node("topology", {}, [node("supervisor-worker")]), node("lifecycle", {}, [node("lifecycle-manager")])])];
  const report = activeRiskReport(ontology, bp);
  assert.ok(report.unresolvedHigh.some((s) => s.riskId === "goal-drift"));
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "risk-unresolved-high" && i.message.includes("目标漂移")));
});
test("挂上 objective-anchor 后 goal-drift 被消解", () => {
  const bp = [
    node("multi-agent", {}, [node("topology", {}, [node("supervisor-worker")]), node("lifecycle", {}, [node("lifecycle-manager")])]),
    node("harness", {}, [node("context-engineering", {}, [node("objective-anchor")])]),
  ];
  const report = activeRiskReport(ontology, bp);
  assert.ok(!report.unresolvedHigh.some((s) => s.riskId === "goal-drift"));
});
test("context-isolation 消解 context-pollution 与 context-bleeding", () => {
  const bp = [node("harness", {}, [node("context-engineering", {}, [node("context-isolation")])])];
  const report = activeRiskReport(ontology, bp);
  const pollution = report.statuses.find((s) => s.riskId === "context-pollution");
  assert.deepEqual(pollution.mitigatedBy, ["context-isolation"]);
});
test("完整合法蓝图通过审批门禁", () => {
  const bp = [
    node("harness", {}, [
      node("context-engineering", {}, [node("context-compression"), node("objective-anchor"), node("injection-defense")]),
      node("error-recovery", {}, [node("timeout-guard")]),
    ]),
    node("multi-agent", {}, [
      node("topology", {}, [node("supervisor-worker")]),
      node("lifecycle", {}, [node("lifecycle-manager"), node("budget-caps")]),
    ]),
  ];
  const issues = lintBlueprint(ontology, bp, "event-driven").filter((i) => i.severity === "error");
  assert.deepEqual(issues.map((i) => i.message), []);
  assert.equal(approvalGate(lintBlueprint(ontology, bp, "event-driven")).pass, true);
});

console.log("palette:");
test("根级调色板只出现三大 section，族过滤生效", () => {
  const bp = createBlueprint("b1", "test", "", "stateless-loop", "tester");
  const root = paletteFor(ontology, "stateless-loop", bp.nodes, null);
  assert.deepEqual(root.map((c) => c.element.id).sort(), ["agents", "harness", "multi-agent"]);
  const harness = node("harness");
  const kids = paletteFor(ontology, "stateless-loop", [harness], harness.id);
  const stateMgmt = kids.find((c) => c.element.id === "state-management");
  assert.equal(stateMgmt.available, false);
  assert.equal(stateMgmt.reason.includes("不支持"), true);
});

console.log("diff:");
test("节点增删判 structural，参数变化判 parameter", () => {
  const before = [node("harness", {}, [node("context-engineering", {}, [node("context-compression", { threshold: 80 })])])];
  const after = [node("harness", {}, [node("context-engineering", {}, [node("context-compression", { threshold: 50 }), node("context-isolation")])])];
  const d = diffBlueprints(ontology, before, after);
  assert.equal(d.structural.length, 1);
  assert.equal(d.structural[0].type, "node-added");
  assert.equal(d.parameter.length, 1);
  assert.equal(d.parameter[0].type, "param-changed");
  assert.equal(d.structuralChanged, true);
});

console.log("export:");
test("分层导出包含 MUST/MAY 语义与风险记录", () => {
  const bp = createBlueprint("b1", "演示蓝图", "多 Agent 编码系统", "event-driven", "arch");
  const comp = makeNode(el("context-compression"));
  comp.params.threshold = 70;
  const ce = makeNode(el("context-engineering"));
  ce.children.push(comp);
  const h = makeNode(el("harness"));
  h.children.push(ce);
  bp.nodes = [h];
  const yaml = exportBlueprintYaml(ontology, bp);
  assert.ok(yaml.includes("MUST"));
  assert.ok(yaml.includes("MAY"));
  assert.ok(yaml.includes("structural:"));
  assert.ok(yaml.includes("parameters:"));
  assert.ok(yaml.includes("threshold: 70"));
  assert.ok(yaml.includes("mitigated:"));
});

console.log(`\n${passed} tests passed`);
