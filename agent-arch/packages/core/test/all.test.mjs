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
  addRelation,
  removeRelation,
  pruneRelations,
  RELATION_TYPES,
  ruleMatches,
  removeNode,
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
const rules = JSON.parse(readFileSync(join(ontDir, "rules.json"), "utf8"));
const ontology = validateOntology({ version: "0.1.0", elements, risks, families, rules });

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
test("根级调色板只出现九大 section，族过滤生效", () => {
  const bp = createBlueprint("b1", "test", "", "stateless-loop", "tester");
  const root = paletteFor(ontology, "stateless-loop", bp.nodes, null);
  assert.deepEqual(root.map((c) => c.element.id).sort(), ["agents", "evaluation", "governance", "harness", "hitl", "intelligence", "multi-agent", "paradigm", "rag"]);
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
  const { nodes } = instantiateTemplate(ontology, "multi-agent");
  const refs = JSON.stringify(nodes);
  assert.ok(refs.includes("context-compression") && refs.includes("topology") && refs.includes("planner-role"));
  const refsSet = new Set(nodes.map((n) => n.ref));
  assert.deepEqual([...refsSet].sort(), ["agents", "harness", "multi-agent"]);
});
test("rag 模板实例化完整管线", () => {
  const { nodes } = instantiateTemplate(ontology, "rag");
  const rag = nodes.find((n) => n.ref === "rag");
  assert.equal(nodes.length, 1);
  const childRefs = rag.children.map((c) => c.ref);
  assert.deepEqual(childRefs, ["rag-ingestion", "rag-retrieval", "rag-embedding", "rag-vector-db", "rag-reranker", "rag-generation"]);
  const retrieval = rag.children.find((c) => c.ref === "rag-retrieval");
  assert.equal(retrieval.params.strategy, "hybrid");
  assert.equal(retrieval.params.fusionMethod, "rrf");
});
test("RAG 蓝图：风险附属视图（rag 引入 hallucination，generation 消解）", () => {
  const { nodes } = instantiateTemplate(ontology, "rag");
  const report = activeRiskReport(ontology, nodes);
  assert.ok(report.statuses.some((s) => s.riskId === "hallucination" && s.active));
  assert.ok(report.statuses.some((s) => s.riskId === "hallucination" && !s.unresolved), "generation 应消解 hallucination");
  const issues = lintBlueprint(ontology, nodes, "stateful-graph");
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
  assert.equal(approvalGate(issues).pass, true);
});
test("架构模板清单含 6 模板（含三大领域模板）", () => {
  assert.deepEqual(ARCH_TEMPLATES.map((t) => t.id), ["blank", "multi-agent", "rag", "coding-agent", "research-agent", "data-agent"]);
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
  const worker = makeNode(el("worker-role"));
  const agents = makeNode(el("agents"));
  agents.children.push(planner, worker);
  bp.nodes = [h, agents];
  bp.relations = [{ id: "r-diag", source: planner.id, target: worker.id, type: "produces", description: "任务定义" }];
  const svg = renderBlueprintDiagram(ontology, bp);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("图渲染测试"));
  assert.ok(svg.includes("上下文压缩"));
  assert.ok(svg.includes("决策"));
  assert.ok(svg.includes("职责"));
  assert.ok(svg.includes("待考量"));
  assert.ok(svg.includes("stroke-dasharray"), "架构关系应为虚线边");
  assert.ok(svg.includes("产出"), "关系边带类型标签");
  assert.ok(svg.includes("架构关系"), "图例说明关系类型");
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
test("角色元素必须有契约模板（Responsibility 与 Interface 结合）", () => {
  const roles = ontology.elements.filter((e) => e.parentId === "agents");
  const bad = roles.filter(
    (e) => !e.contractTemplate || !e.contractTemplate.inputs.length || !e.contractTemplate.outputs.length || !e.contractTemplate.guarantees.length,
  );
  assert.deepEqual(bad.map((e) => e.id), []);
});

console.log("architecture graph (v8):");
test("关系类型词汇表对齐目录 §29.2（14 类型）", () => {
  assert.deepEqual(RELATION_TYPES, [
    "contains", "depends", "uses", "produces", "consumes", "calls", "communicates",
    "controls", "observes", "routes", "reads", "writes", "publishes", "subscribes",
  ]);
});
test("模板种子架构关系（树负责分类，图负责架构）", () => {
  const ma = instantiateTemplate(ontology, "multi-agent");
  assert.ok(ma.relations.length >= 3);
  assert.ok(ma.relations.some((r) => r.type === "controls"));
  assert.ok(ma.relations.some((r) => r.type === "produces"));
  const rag = instantiateTemplate(ontology, "rag");
  assert.ok(rag.relations.some((r) => r.type === "depends"));
  assert.ok(rag.relations.some((r) => r.type === "consumes"));
});
test("addRelation 校验：悬空/自环/重复/未知类型", () => {
  const bp = [node("agents", {}, [node("planner-role"), node("worker-role")])];
  const plannerId = bp[0].children[0].id;
  const workerId = bp[0].children[1].id;
  const ok = addRelation(bp, [], { source: plannerId, target: workerId, type: "produces" });
  assert.equal(ok.error, null);
  assert.equal(ok.relations.length, 1);
  assert.equal(ok.added.type, "produces");
  assert.ok(addRelation(bp, ok.relations, { source: plannerId, target: workerId, type: "produces" }).error.includes("已存在"));
  assert.ok(addRelation(bp, [], { source: plannerId, target: plannerId, type: "depends" }).error.includes("自身"));
  assert.ok(addRelation(bp, [], { source: "ghost", target: workerId, type: "depends" }).error.includes("不在蓝图中"));
  assert.ok(addRelation(bp, [], { source: plannerId, target: workerId, type: "marries" }).error.includes("未知关系类型"));
});
test("removeRelation / pruneRelations（删节点级联清理悬空关系）", () => {
  const bp = [node("agents", {}, [node("planner-role"), node("worker-role")])];
  const plannerId = bp[0].children[0].id;
  const workerId = bp[0].children[1].id;
  let rels = addRelation(bp, [], { source: plannerId, target: workerId, type: "produces" }).relations;
  assert.equal(removeRelation(rels, rels[0].id).removed, true);
  rels = addRelation(bp, [], { source: plannerId, target: workerId, type: "produces" }).relations;
  removeNode(bp[0].children, workerId);
  assert.equal(pruneRelations(rels, bp).length, 0);
});
test("悬空关系被 lint 判 error 并阻断门禁", () => {
  const bp = [node("agents", {}, [node("planner-role")])];
  const rel = [{ id: "r1", source: bp[0].children[0].id, target: "ghost", type: "consumes", description: null }];
  const issues = lintBlueprint(ontology, bp, "event-driven", rel);
  assert.ok(issues.some((i) => i.code === "relation-dangling" && i.severity === "error"));
  assert.equal(approvalGate(issues).pass, false);
});
test("自环/重复关系被检出", () => {
  const bp = [node("agents", {}, [node("planner-role"), node("worker-role")])];
  const a = bp[0].children[0].id;
  const b = bp[0].children[1].id;
  const rels = [
    { id: "r1", source: a, target: a, type: "depends", description: null },
    { id: "r2", source: a, target: b, type: "communicates", description: null },
    { id: "r3", source: a, target: b, type: "communicates", description: null },
  ];
  const issues = lintBlueprint(ontology, bp, "event-driven", rels);
  assert.ok(issues.some((i) => i.code === "relation-self-loop"));
  assert.ok(issues.some((i) => i.code === "relation-duplicate"));
});
test("关系变更判 structural（diff major），契约变更判 parameter（minor）", () => {
  const before = [node("agents", {}, [node("planner-role"), node("worker-role")])];
  const after = [node("agents", {}, [node("planner-role"), node("worker-role")])];
  after[0].children[0].contract = { inputs: ["目标"], outputs: ["计划"], guarantees: ["可审"] };
  const relA = [{ id: "r1", source: after[0].children[0].id, target: after[0].children[1].id, type: "produces", description: null }];
  const d = diffBlueprints(ontology, before, after, [], relA);
  assert.equal(d.structuralChanged, true);
  assert.ok(d.structural.some((c) => c.type === "relation-added"));
  assert.ok(d.parameter.some((c) => c.detail.includes("契约")));
});
test("makeNode 预填契约模板（planner-role）", () => {
  const p = makeNode(el("planner-role"));
  assert.ok(p.contract);
  assert.ok(p.contract.outputs.some((o) => o.includes("任务定义")));
  assert.ok(p.contract.inputs.length > 0 && p.contract.guarantees.length > 0);
});
test("导出含架构关系段、决策权衡与组件契约", () => {
  const bp = createBlueprint("b4", "v8 导出", "", "event-driven", "t");
  const planner = makeNode(el("planner-role"));
  const worker = makeNode(el("worker-role"));
  planner.decision = {
    chosen: "dynamic-replan",
    alternatives: ["one-shot"],
    rejectedReason: "长任务变化多",
    tradeoffs: [
      { aspect: "延迟", impact: "negative" },
      { aspect: "完成率", impact: "positive", note: "可重规划" },
    ],
  };
  const agents = makeNode(el("agents"));
  agents.children.push(planner, worker);
  bp.nodes = [agents];
  bp.relations = [{ id: "r1", source: planner.id, target: worker.id, type: "produces", description: "任务定义" }];
  const yaml = exportBlueprintYaml(ontology, bp);
  assert.ok(yaml.includes("relations:"));
  assert.ok(yaml.includes("type: produces"));
  assert.ok(yaml.includes("tradeoffs:"));
  assert.ok(yaml.includes("- 延迟"));
  assert.ok(yaml.includes("contract:"));
  assert.ok(yaml.includes("guarantees:"));
});

console.log("architecture pattern rules (v8):");
test("规则库入库且通过自校验", () => {
  assert.ok(ontology.rules.length >= 8);
});
test("共享记忆 + 多 Agent → 建议隔离（warning 级，架构推理而非规则匹配）", () => {
  const bp = [node("multi-agent", {}, [node("memory", {}, [node("shared-memory")])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  const hit = issues.find((i) => i.code === "pattern-rule" && i.message.includes("共享记忆需要隔离"));
  assert.ok(hit, "pattern-rule 应触发");
  assert.equal(hit.severity, "warning");
});
test("挂上 context-isolation 后规则被抑制（noneOf 生效）", () => {
  const bp = [
    node("multi-agent", {}, [node("memory", {}, [node("shared-memory")])]),
    node("harness", {}, [node("context-engineering", {}, [node("context-isolation")])]),
  ];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(!issues.some((i) => i.code === "pattern-rule" && i.message.includes("共享记忆需要隔离")));
});
test("参数条件规则：selective-drop 无情景记忆兜底时提醒", () => {
  const bp = [node("harness", {}, [node("context-engineering", {}, [node("context-compression", { strategy: "selective-drop" })])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "pattern-rule" && i.message.includes("选择性丢弃")));
  const bp2 = [
    node("harness", {}, [node("context-engineering", {}, [node("context-compression", { strategy: "selective-drop" })])]),
    node("multi-agent", {}, [node("memory", {}, [node("episodic-memory")])]),
  ];
  const issues2 = lintBlueprint(ontology, bp2, "event-driven");
  assert.ok(!issues2.some((i) => i.code === "pattern-rule" && i.message.includes("选择性丢弃")));
});
test("ruleMatches 直接可用（供 MCP/外部推理复用）", () => {
  const rule = ontology.rules.find((r) => r.id === "rule-spawn-needs-manager");
  assert.ok(ruleMatches(rule, [node("lifecycle", {}, [node("subagent-spawn")])].flatMap((n) => [n, ...n.children]), "event-driven"));
});
test("规则只建议不阻断（门禁仅硬约束 error）", () => {
  const bp = [node("multi-agent", {}, [node("topology", {}, [node("supervisor-worker")]), node("lifecycle", {}, [node("lifecycle-manager")])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "pattern-rule"));
  assert.equal(approvalGate(issues).pass, true);
});
test("规则引用未知元素时 ontology 校验抛错", () => {
  const bad = JSON.parse(JSON.stringify({ version: "0.1.0", elements, risks, families, rules }));
  bad.rules[0].when.allOf.push("no-such-element");
  assert.throws(() => validateOntology(bad), /unknown element/);
});
test("规则 level 只能是 info/warning（Constraint 禁止，Rule 建议）", () => {
  const bad = JSON.parse(JSON.stringify({ version: "0.1.0", elements, risks, families, rules }));
  bad.rules[0].then.level = "error";
  assert.throws(() => validateOntology(bad), /info\|warning/);
});

console.log("knowledge graph alignment (v9):");
test("目录接入：新增四大分区 + 智能/协同/治理/评估元素入库", () => {
  for (const id of [
    "intelligence", "reasoning-paradigm", "model-integration", "model-routing", "output-guard", "model-escalation",
    "planning-system", "plan-validation", "replan-policy",
    "hitl", "human-approval", "human-escalation",
    "governance", "policy-engine", "cost-control",
    "evaluation", "eval-strategy",
    "verification-gate", "circuit-breaker", "mcp-gateway",
  ]) {
    assert.ok(el(id), `缺少元素 ${id}`);
  }
  assert.ok(ontology.elements.length >= 74);
});
test("目录 §24 错误体系接入：新增 6 风险且双向绑定完整", () => {
  for (const rid of ["invalid-output", "retry-storm", "delegation-loop", "invalid-plan", "duplicate-work", "judge-bias"]) {
    assert.ok(ontology.risks.some((r) => r.id === rid), `缺少风险 ${rid}`);
  }
  assert.ok(el("retry-policy").introduces.includes("retry-storm"));
  assert.ok(el("circuit-breaker").mitigates.includes("retry-storm"));
  assert.ok(el("planner-role").introduces.includes("invalid-plan"));
  assert.ok(el("plan-validation").mitigates.includes("invalid-plan"));
  assert.ok(el("supervisor-worker").mitigates.includes("duplicate-work"));
  assert.ok(el("model-escalation").mitigates.includes("single-point-failure"));
  assert.ok(el("human-approval").mitigates.includes("permission-escalation"));
  assert.ok(el("cost-control").mitigates.includes("runaway-cost"));
});
test("反模式检测：无界重试（Unbounded Retry）参数级规则", () => {
  const bp = [node("harness", {}, [node("error-recovery", {}, [node("retry-policy", { maxRetries: 8 })])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  const hit = issues.find((i) => i.code === "pattern-rule" && i.message.includes("无界重试"));
  assert.ok(hit, "maxRetries=8 无熔断应触发");
  assert.equal(hit.severity, "warning");
  const bp2 = [node("harness", {}, [node("error-recovery", {}, [node("retry-policy", { maxRetries: 8 }), node("circuit-breaker")])])];
  assert.ok(!lintBlueprint(ontology, bp2, "event-driven").some((i) => i.message.includes("无界重试")));
  const bp3 = [node("harness", {}, [node("error-recovery", {}, [node("retry-policy", { maxRetries: 3 })])])];
  assert.ok(!lintBlueprint(ontology, bp3, "event-driven").some((i) => i.message.includes("无界重试")));
});
test("HITL 规则：工具+角色但无人工审批门时提醒", () => {
  const bp = [node("harness", {}, [node("tool-system", {}, [node("tool-manager")])]), node("agents", {}, [node("worker-role")])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "pattern-rule" && i.message.includes("人工审批门")));
});
test("mcp-gateway requires permission-policy（不可信工具源强约束）", () => {
  const bp = [node("harness", {}, [node("tool-system", {}, [node("mcp-gateway")])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "requires-missing" && i.elementId === "mcp-gateway"));
});
test("coding-agent 模板：闭环骨架 + 种子关系 + 直接过门禁", () => {
  const { nodes, relations } = instantiateTemplate(ontology, "coding-agent");
  const refs = JSON.stringify(nodes);
  assert.ok(refs.includes("verification-gate") && refs.includes("human-approval") && refs.includes("plan-validation"));
  assert.ok(relations.some((r) => r.type === "produces"));
  assert.ok(relations.some((r) => r.type === "consumes"));
  assert.ok(relations.some((r) => r.type === "controls"));
  const issues = lintBlueprint(ontology, nodes, "event-driven", relations);
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
  assert.equal(approvalGate(issues).pass, true);
});
test("风险报告：eval-strategy 激活 judge-bias（无消解手段的开放问题）", () => {
  const bp = [node("evaluation", {}, [node("eval-strategy", { strategy: "llm-judge" })])];
  const report = activeRiskReport(ontology, bp);
  const jb = report.statuses.find((s) => s.riskId === "judge-bias");
  assert.ok(jb.active && jb.unresolved);
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "pattern-rule" && i.message.includes("LLM Judge")));
});

console.log("knowledge graph alignment wave 2 (v10):");
test("目录第二波接入：Prompt 层 / 新角色 / 新拓扑 / 记忆策略", () => {
  for (const id of [
    "prompt-engineering", "prompt-hierarchy", "prompt-composition",
    "pipeline", "swarm", "judge-role", "router-role", "monitor-role", "critic-role",
    "procedural-memory", "memory-consolidation",
  ]) {
    assert.ok(el(id), `缺少元素 ${id}`);
  }
  assert.ok(ontology.elements.length >= 85);
  assert.ok(ontology.risks.length >= 28);
});
test("新角色全部带职责模板 + 契约模板（质量门）", () => {
  for (const id of ["judge-role", "router-role", "monitor-role", "critic-role"]) {
    const e = el(id);
    assert.ok(e.responsibilityTemplate && e.responsibilityTemplate.owns.length > 0, `${id} 缺职责模板`);
    assert.ok(e.contractTemplate && e.contractTemplate.outputs.length > 0, `${id} 缺契约模板`);
  }
});
test("新风险双向绑定（指令冲突/Supervisor 瓶颈/记忆污染/陈旧记忆）", () => {
  assert.ok(el("prompt-engineering").introduces.includes("instruction-collision"));
  assert.ok(el("prompt-hierarchy").mitigates.includes("instruction-collision"));
  assert.ok(el("supervisor-worker").introduces.includes("supervisor-bottleneck"));
  assert.ok(el("hierarchical").mitigates.includes("supervisor-bottleneck"));
  assert.ok(el("shared-memory").introduces.includes("memory-pollution"));
  assert.ok(el("episodic-memory").introduces.includes("stale-memory"));
  assert.ok(el("memory-consolidation").mitigates.includes("stale-memory"));
});
test("反模式：Prompt 单体（组装无层级 → warning，挂层级后抑制）", () => {
  const bp = [node("harness", {}, [node("prompt-engineering", {}, [node("prompt-composition", { mode: "dynamic" })])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  const hit = issues.find((i) => i.code === "pattern-rule" && i.message.includes("Prompt 单体"));
  assert.ok(hit);
  assert.equal(hit.severity, "warning");
  const bp2 = [node("harness", {}, [node("prompt-engineering", {}, [node("prompt-hierarchy"), node("prompt-composition", { mode: "dynamic" })])])];
  assert.ok(!lintBlueprint(ontology, bp2, "event-driven").some((i) => i.message.includes("Prompt 单体")));
});
test("反模式：不可恢复工作流（有状态无持久化）", () => {
  const bp = [node("harness", {}, [node("state-management")])];
  const issues = lintBlueprint(ontology, bp, "stateful-graph");
  assert.ok(issues.some((i) => i.code === "pattern-rule" && i.message.includes("不可恢复工作流")));
  const bp2 = [node("harness", {}, [node("state-management", {}, [node("checkpoint")])])];
  assert.ok(!lintBlueprint(ontology, bp2, "stateful-graph").some((i) => i.message.includes("不可恢复工作流")));
});
test("反模式：群体拓扑无预算 → warning", () => {
  const bp = [node("multi-agent", {}, [node("topology", {}, [node("swarm")]), node("lifecycle")])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "pattern-rule" && i.message.includes("群体拓扑需要预算上限")));
});
test("反模式：辩论范式无裁决者 → 建议 Judge", () => {
  const bp = [node("intelligence", {}, [node("reasoning-paradigm", { strategy: "debate" })]), node("agents", {}, [node("worker-role"), node("reviewer-role")])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "pattern-rule" && i.message.includes("辩论范式需要裁决者")));
});
test("节点级反模式：God Agent（单角色+工具系统）", () => {
  const bp = [node("harness", {}, [node("tool-system", {}, [node("tool-manager")])]), node("agents", {}, [node("worker-role")])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "anti-pattern-god-agent"));
  const bp2 = [node("harness", {}, [node("tool-system", {}, [node("tool-manager")])]), node("agents", {}, [node("planner-role"), node("worker-role")])];
  assert.ok(!lintBlueprint(ontology, bp2, "event-driven").some((i) => i.code === "anti-pattern-god-agent"));
});
test("research-agent 模板：研究闭环 + uses 关系 + 过门禁", () => {
  const { nodes, relations } = instantiateTemplate(ontology, "research-agent");
  assert.ok(relations.some((r) => r.type === "uses"));
  assert.ok(relations.some((r) => r.type === "produces"));
  const issues = lintBlueprint(ontology, nodes, "event-driven", relations);
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
  assert.equal(approvalGate(issues).pass, true);
});
test("data-agent 模板：数据闭环 + controls/observes 关系 + 过门禁", () => {
  const { nodes, relations } = instantiateTemplate(ontology, "data-agent");
  assert.ok(relations.some((r) => r.type === "controls"));
  assert.ok(relations.some((r) => r.type === "observes"));
  const issues = lintBlueprint(ontology, nodes, "event-driven", relations);
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
  assert.equal(approvalGate(issues).pass, true);
});

console.log("knowledge graph full coverage (v11):");
test("Runtime 族 3→5（DAG 编排 / Actor 模型），既有族限制元素自动兼容", () => {
  assert.deepEqual(ontology.families.map((f) => f.id).sort(), ["actor-runtime", "dag-runtime", "event-driven", "stateful-graph", "stateless-loop"]);
  const cp = el("checkpoint");
  assert.ok(cp.runtimeFamilies.includes("dag-runtime") && cp.runtimeFamilies.includes("actor-runtime"));
  const bp = [node("harness", {}, [node("state-management", {}, [node("checkpoint")])])];
  assert.ok(!lintBlueprint(ontology, bp, "dag-runtime").some((i) => i.code === "family-unavailable"));
  assert.ok(lintBlueprint(ontology, bp, "stateless-loop").some((i) => i.code === "family-unavailable" && i.elementId === "checkpoint"));
});
test("目录 §1 范式层入库（Agent 范式 + 工作流范式）", () => {
  assert.ok(el("paradigm") && el("paradigm").parentId === null);
  assert.ok(el("agent-paradigm").properties.paradigm.values.includes("human-guided"));
  assert.ok(el("workflow-pattern").properties.pattern.values.includes("dag"));
});
test("目录剩余章节全部有落点（技能/死信/幂等/限流/诊断/脱敏/身份/数据治理/性能/扩展/部署/置信/反馈/溯源/投票）", () => {
  for (const id of [
    "skill-system", "dead-letter-queue", "idempotency", "rate-limit", "fault-diagnosis",
    "data-masking", "identity-auth", "data-governance", "performance-targets", "scaling-strategy",
    "deployment-model", "confidence-gate", "feedback-loop", "knowledge-provenance", "multi-model-voting",
  ]) {
    assert.ok(el(id), `缺少元素 ${id}`);
  }
  assert.ok(ontology.elements.length >= 103);
});
test("新增 7 风险双向绑定完整（工具幻觉/长上下文退化/中段丢失/重复执行/敏感泄漏/幻觉引用/数据外泄）", () => {
  for (const rid of ["tool-hallucination", "long-context-degradation", "lost-in-the-middle", "duplicate-execution", "secret-leakage", "hallucinated-citation", "data-exfiltration"]) {
    assert.ok(ontology.risks.some((r) => r.id === rid), `缺少风险 ${rid}`);
  }
  assert.ok(el("retry-policy").introduces.includes("duplicate-execution"));
  assert.ok(el("idempotency").mitigates.includes("duplicate-execution"));
  assert.ok(el("observability").introduces.includes("secret-leakage"));
  assert.ok(el("rag-generation").introduces.includes("hallucinated-citation"));
  assert.ok(el("knowledge-provenance").mitigates.includes("hallucinated-citation"));
  assert.ok(el("multi-model-voting").mitigates.includes("hallucination"));
  assert.ok(el("confidence-gate").mitigates.includes("hallucination"));
});
test("知识库蓝图：无溯源时幻觉引用被提醒（建议级）", () => {
  const { nodes } = instantiateTemplate(ontology, "rag");
  const issues = lintBlueprint(ontology, nodes, "stateful-graph");
  assert.ok(issues.some((i) => i.code === "pattern-rule" && i.message.includes("知识溯源")));
  assert.equal(approvalGate(issues).pass, true);
});
test("幂等/限流/死信等可靠性元素挂载合法（分类树校验）", () => {
  const bp = [node("harness", {}, [node("context-engineering"), node("error-recovery", {}, [node("idempotency"), node("rate-limit"), node("fault-diagnosis")]), node("observability", {}, [node("data-masking")])]), node("multi-agent", {}, [node("topology"), node("communication", {}, [node("message-bus"), node("dead-letter-queue")])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
});
test("治理五件套（身份/数据治理/性能/扩展/部署）挂载合法", () => {
  const bp = [node("governance", {}, [node("identity-auth"), node("data-governance"), node("performance-targets"), node("scaling-strategy"), node("deployment-model", { model: "hybrid" })])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
});

console.log("final coverage (v12):");
test("能力域补全：多模态/浏览器/Computer-Use/上下文组装/A2A", () => {
  for (const id of ["multimodal-router", "browser-automation", "computer-use", "context-assembly", "a2a-protocol"]) {
    assert.ok(el(id), `缺少元素 ${id}`);
  }
  assert.ok(ontology.elements.length >= 108);
});
test("高危能力域引入对应风险（浏览器→注入，Computer-Use→权限升级）", () => {
  assert.ok(el("browser-automation").introduces.includes("prompt-injection"));
  assert.ok(el("computer-use").introduces.includes("permission-escalation"));
  assert.ok(el("context-assembly").mitigates.includes("context-overflow"));
});
test("反模式：Agent Explosion（角色实例 > 8）", () => {
  const many = [];
  for (let i = 0; i < 9; i++) many.push(node("worker-role", {}, [], `Worker ${i}`));
  const bp = [node("agents", {}, many)];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "anti-pattern-agent-explosion"));
  const few = [node("agents", {}, [node("planner-role"), node("worker-role")])];
  assert.ok(!lintBlueprint(ontology, few, "event-driven").some((i) => i.code === "anti-pattern-agent-explosion"));
});
test("反模式：隐藏全局状态（共享状态无可观测）", () => {
  const bp = [node("multi-agent", {}, [node("topology"), node("communication", {}, [node("shared-state")])])];
  const issues = lintBlueprint(ontology, bp, "event-driven");
  assert.ok(issues.some((i) => i.code === "pattern-rule" && i.message.includes("隐藏全局状态")));
  const bp2 = [node("multi-agent", {}, [node("topology"), node("communication", {}, [node("shared-state")])]), node("harness", {}, [node("observability", {}, [node("trace")])])];
  assert.ok(!lintBlueprint(ontology, bp2, "event-driven").some((i) => i.message.includes("隐藏全局状态")));
});

console.log(`\n${passed} tests passed`);