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
  instantiateTemplate,
  ARCH_TEMPLATES,
  renderBlueprintDiagram,
  makeEnterpriseElement,
  applyMigrations,
  compareVersions,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const ontDir = join(here, "../../../ontology/core");

const loadElements = () => {
  const all = [];
  for (const f of readdirSync(ontDir).filter((x) => x === "elements.json" || x.endsWith("-elements.json"))) {
    all.push(...JSON.parse(readFileSync(join(ontDir, f), "utf8")));
  }
  return all;
};
const elements = loadElements();
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
  const note = issues.find((i) => i.code === "risk-unresolved-high");
  assert.ok(note, "risk-unresolved-high 应存在");
  assert.equal(note.severity, "warning", "v7: 风险降级为 warning（不阻断审批）");
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
  assert.deepEqual(root.map((c) => c.element.id).sort(), ["agents", "harness", "multi-agent", "rag"]);
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

console.log("templates & RAG:");
test("RAG 架构族已入库（含知识卡）", () => {
  const rag = ontology.elements.find((e) => e.id === "rag");
  assert.ok(rag, "rag root missing");
  const retrieval = ontology.elements.find((e) => e.id === "rag-retrieval");
  assert.ok(retrieval.properties.strategy.values.includes("hybrid"));
  assert.ok(retrieval.properties.fusionMethod.values.includes("rrf"));
  assert.ok((retrieval.commonIssues?.length ?? 0) > 0, "retrieval 知识卡缺 commonIssues");
  assert.ok((retrieval.implementations?.length ?? 0) >= 3);
  assert.ok(retrieval.references.some((r) => r.includes("RRF")));
});
test("multi-agent 模板实例化骨架", () => {
  const nodes = instantiateTemplate(ontology, "multi-agent");
  const refs = JSON.stringify(nodes);
  assert.ok(refs.includes("context-compression") && refs.includes("topology") && refs.includes("planner-role"));
  const refsSet = new Set(nodes.map((n) => n.ref));
  assert.deepEqual([...refsSet].sort(), ["agents", "harness", "multi-agent"]);
});
test("rag 模板实例化完整管线", () => {
  const nodes = instantiateTemplate(ontology, "rag");
  const rag = nodes.find((n) => n.ref === "rag");
  assert.equal(nodes.length, 1);
  const childRefs = rag.children.map((c) => c.ref);
  assert.deepEqual(childRefs, ["rag-ingestion", "rag-retrieval", "rag-embedding", "rag-vector-db", "rag-reranker", "rag-generation"]);
  const retrieval = rag.children.find((c) => c.ref === "rag-retrieval");
  assert.equal(retrieval.params.strategy, "hybrid");
  assert.equal(retrieval.params.fusionMethod, "rrf");
});
test("RAG 蓝图：风险附属视图（rag 引入 hallucination，generation 消解）", () => {
  const nodes = instantiateTemplate(ontology, "rag");
  const report = activeRiskReport(ontology, nodes);
  assert.ok(report.statuses.some((s) => s.riskId === "hallucination" && s.active));
  assert.ok(report.statuses.some((s) => s.riskId === "hallucination" && !s.unresolved), "generation 应消解 hallucination");
  const issues = lintBlueprint(ontology, nodes, "stateful-graph");
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
  assert.equal(approvalGate(issues).pass, true);
});
test("架构模板清单含 blank/multi-agent/rag", () => {
  assert.deepEqual(ARCH_TEMPLATES.map((t) => t.id), ["blank", "multi-agent", "rag"]);
});

console.log("architecture language (v7):");
test("relations.incompatibleWith 生效（peer-to-peer 与 supervisor-worker 互斥）", () => {
  const bp = [node("multi-agent", {}, [node("topology", {}, [node("supervisor-worker"), node("peer-to-peer")]), node("lifecycle", {}, [node("lifecycle-manager")])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "forbidden-combo"));
});
test("relations 数据通过 schema 校验（引用完整性 + parentId 一致）", () => {
  assert.ok(ontology.elements.filter((e) => e.relations).length >= 10);
});
test("makeNode 预填职责模板（planner-role）", () => {
  const p = makeNode(el("planner-role"));
  assert.ok(p.responsibility);
  assert.ok(p.responsibility.owns.includes("任务分解"));
  assert.ok(p.responsibility.not.includes("子任务执行"));
});
test("decision 缺失提醒（info 级）", () => {
  const bp = [node("harness", {}, [node("context-engineering", {}, [node("context-compression", { strategy: "summary" })])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "decision-missing" && i.severity === "info"));
});
test("导出含决策记录与职责边界段", () => {
  const bp = createBlueprint("b2", "决策导出测试", "", "event-driven", "t");
  const comp = makeNode(el("context-compression"));
  comp.decision = { chosen: "hierarchical", alternatives: ["sliding-window"], rejectedReason: "代码上下文不能丢" };
  const ce = makeNode(el("context-engineering"));
  ce.children.push(comp);
  const h = makeNode(el("harness"));
  h.children.push(ce);
  const planner = makeNode(el("planner-role"));
  bp.nodes = [h, node("agents", {}, [planner])];
  const yaml = exportBlueprintYaml(ontology, bp);
  assert.ok(yaml.includes("decisions:"));
  assert.ok(yaml.includes("chosen: hierarchical"));
  assert.ok(yaml.includes("rejected_reason: 代码上下文不能丢"));
  assert.ok(yaml.includes("responsibility:"));
  assert.ok(yaml.includes("owns: 任务分解"));
});

test("约束引擎对 requires/dependsOn 双重声明去重（子 agent 会话缺陷回归）", () => {
  const bp = [node("multi-agent", {}, [node("topology", {}, [node("supervisor-worker")])])];
  const issues = lintBlueprint(ontology, bp, "event-driven").filter((i) => i.code === "requires-missing" && i.elementId === "supervisor-worker");
  assert.equal(issues.length, 1, `应恰好 1 条，实际 ${issues.length}`);
});

console.log("diagram (P2):");
test("SVG 图渲染（标题/盒子/决策徽章/图例）", () => {
  const bp = createBlueprint("b3", "图渲染测试", "", "event-driven", "t");
  const comp = makeNode(el("context-compression"));
  comp.decision = { chosen: "hierarchical", alternatives: ["sliding-window"], rejectedReason: "代码上下文不能丢" };
  const ce = makeNode(el("context-engineering"));
  ce.children.push(comp);
  const h = makeNode(el("harness"));
  h.children.push(ce);
  const planner = makeNode(el("planner-role"));
  bp.nodes = [h, node("agents", {}, [planner])];
  const svg = renderBlueprintDiagram(ontology, bp);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("图渲染测试"));
  assert.ok(svg.includes("上下文压缩"));
  assert.ok(svg.includes("决策"));
  assert.ok(svg.includes("职责"));
  assert.ok(svg.includes("待考量"));
  const rectCount = (svg.match(/<rect /g) ?? []).length;
  assert.ok(rectCount >= 4, `盒子数过少: ${rectCount}`);
  const boxCount = (svg.match(/<text /g) ?? []).length;
  assert.ok(boxCount >= 4);
});

console.log("enterprise extensions (CRD):");
test("挂载 Core 扩展点合法（namespace/relations 完整）", () => {
  const el = makeEnterpriseElement(ontology, { parentId: "tool-system", name: "企业安全策略", description: "内部数据分级" });
  assert.equal(el.namespace, "enterprise.local");
  assert.equal(el.parentId, "tool-system");
  assert.deepEqual(el.relations.allowedParents, ["tool-system"]);
  assert.equal(el.review, "pending", "v7: 提交即进入评审队列");
  assert.ok(el.implementations.length > 0 && el.useCases.length > 0, "企业元素带知识卡");
});
test("挂载非扩展点被拒绝", () => {
  assert.throws(() => makeEnterpriseElement(ontology, { parentId: "context-compression", name: "X", description: "" }), /扩展点/);
  assert.throws(() => makeEnterpriseElement(ontology, { parentId: "no-such", name: "Y", description: "" }), /不存在/);
});
test("挂到已有企业元素下允许（递归扩展）", () => {
  const base = makeEnterpriseElement(ontology, { parentId: "tool-system", name: "母公司扩展", description: "" });
  const ont2 = { ...ontology, elements: [...ontology.elements, base] };
  const child = makeEnterpriseElement(ont2, { parentId: base.id, name: "子公司扩展", description: "" });
  assert.equal(child.parentId, base.id);
});
test("企业元素重名被拒绝", () => {
  const e1 = makeEnterpriseElement(ontology, { parentId: "tool-system", name: "重复检查", description: "" });
  const ont2 = { ...ontology, elements: [...ontology.elements, e1] };
  assert.throws(() => makeEnterpriseElement(ont2, { parentId: "multi-agent", name: "重复检查", description: "" }), /已存在/);
});

console.log("schema migrations:");
test("compareVersions 语义比较", () => {
  assert.equal(compareVersions("0.1", "1.0"), -1);
  assert.equal(compareVersions("1.0", "1.0"), 0);
  assert.equal(compareVersions("1.2", "1.10"), -1);
  assert.equal(compareVersions("2.0", "1.9"), 1);
});
test("迁移引擎递归重命名元素引用", () => {
  const spec = {
    schemaVersion: "2.0",
    migrations: [
      { from: "0.1", to: "1.0", renameElements: { "legacy-mem": "vector-memory" } },
      { from: "1.0", to: "2.0", renameElements: { "old-tool": "tool-manager" } },
    ],
  };
  const raw = (ref, children = []) => ({ id: `t-${ref}`, ref, name: null, params: {}, reason: null, decision: null, responsibility: null, children });
  const nodes = [raw("legacy-mem", [raw("old-tool")])];
  const { nodes: migrated, applied } = applyMigrations(nodes, "0.1", spec);
  assert.deepEqual(applied.map((m) => m.to), ["1.0", "2.0"]);
  assert.equal(migrated[0].ref, "vector-memory");
  assert.equal(migrated[0].children[0].ref, "tool-manager");
});
test("已是最新版本的蓝图跳过迁移（幂等）", () => {
  const spec = { schemaVersion: "1.0", migrations: [{ from: "0.1", to: "1.0", renameElements: { a: "b" } }] };
  const { applied } = applyMigrations([], "1.0", spec);
  assert.deepEqual(applied, []);
});
test("无 schemaVersion 的旧蓝图从 0.0 起步迁移", () => {
  const spec = { schemaVersion: "1.0", migrations: [{ from: "0.0", to: "1.0", renameElements: { x: "y" } }] };
  const rawNode = { id: "t-x", ref: "x", name: null, params: {}, reason: null, decision: null, responsibility: null, children: [] };
  const { nodes } = applyMigrations([rawNode], undefined, spec);
  assert.equal(nodes[0].ref, "y");
});

console.log("ontology quality gate (P1):");
test("全元素知识完整度：implementations/useCases/pros/cons/commonIssues/references 100%", () => {
  const bad = ontology.elements.filter(
    (e) => !e.implementations?.length || !e.useCases?.length || !e.pros?.length || !e.cons?.length || !e.commonIssues?.length || !e.references?.length,
  );
  assert.deepEqual(bad.map((e) => e.id), []);
});
test("关系完整性：全部元素有 relations 且 allowedParents 覆盖 parentId", () => {
  const bad = ontology.elements.filter((e) => {
    if (!e.relations) return true;
    if (e.parentId && !(e.relations.allowedParents ?? []).includes(e.parentId)) return true;
    return false;
  });
  assert.deepEqual(bad.map((e) => e.id), []);
});
test("含枚举参数的元素必须提供替代方案（决策依据）", () => {
  const withEnum = ontology.elements.filter((e) => Object.values(e.properties).some((p) => p.kind === "enum"));
  const bad = withEnum.filter((e) => !e.alternatives?.length);
  assert.deepEqual(bad.map((e) => e.id), []);
});
test("角色元素必须有职责模板", () => {
  const roles = ontology.elements.filter((e) => e.parentId === "agents");
  const bad = roles.filter((e) => !e.responsibilityTemplate);
  assert.deepEqual(bad.map((e) => e.id), []);
  assert.ok(roles.length >= 4);
});

console.log(`\n${passed} tests passed`);