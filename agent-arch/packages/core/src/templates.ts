import type { ArchTemplate, ArchTemplateId, BlueprintNode, BlueprintRelation, Ontology, OntologyElement, PropertyValue } from "./types.js";
import { elementById } from "./ontology.js";
import { makeRelation } from "./relations.js";

let counter = 0;
function nid(): string {
  counter += 1;
  return `tpl${Date.now().toString(36)}${counter.toString(36)}`;
}

function inst(element: OntologyElement, paramOverrides: Record<string, PropertyValue> = {}): BlueprintNode {
  const params: Record<string, PropertyValue> = {};
  for (const [k, s] of Object.entries(element.properties)) params[k] = s.default;
  return {
    id: nid(),
    ref: element.id,
    name: element.allowMultiple ? element.name : null,
    params: { ...params, ...paramOverrides },
    reason: null,
    decision: null,
    responsibility: element.responsibilityTemplate
      ? { owns: [...element.responsibilityTemplate.owns], not: [...element.responsibilityTemplate.not] }
      : null,
    contract: element.contractTemplate
      ? { inputs: [...element.contractTemplate.inputs], outputs: [...element.contractTemplate.outputs], guarantees: [...element.contractTemplate.guarantees] }
      : null,
    children: [],
  };
}

export const ARCH_TEMPLATES: ArchTemplate[] = [
  { id: "blank", name: "空白画布", description: "从零开始自由搭建", suggestedFamily: "event-driven" },
  { id: "multi-agent", name: "多 Agent 协作基座", description: "Supervisor-Worker 拓扑 + 上下文工程 + 生命周期管理的骨架（含角色间架构关系）", suggestedFamily: "event-driven" },
  { id: "rag", name: "RAG 检索增强", description: "知识入库 → 检索 → 重排 → 生成的完整管线骨架（含管线依赖关系）", suggestedFamily: "stateful-graph" },
  { id: "coding-agent", name: "Coding Agent", description: "规划-编码-评审闭环：沙箱工具 + 验证门禁 + 人工审批 + Plan-and-Execute（目录 §41）", suggestedFamily: "event-driven" },
  { id: "research-agent", name: "Research Agent", description: "检索-取证-核验-综合的研究闭环：Reflexion + 来源验证（目录 §42）", suggestedFamily: "event-driven" },
  { id: "data-agent", name: "Data Agent", description: "查询规划-生成-验证的数据闭环：最小权限 + 成本归因（目录 §43）", suggestedFamily: "event-driven" },
];

export interface TemplateInstance {
  nodes: BlueprintNode[];
  relations: BlueprintRelation[];
}

export function instantiateTemplate(ontology: Ontology, templateId: ArchTemplateId): TemplateInstance {
  const el = (id: string): OntologyElement => {
    const found = elementById(ontology, id);
    if (!found) throw new Error(`template element missing from ontology: ${id}`);
    return found;
  };
  const put = (parent: BlueprintNode | null, child: BlueprintNode): BlueprintNode => {
    if (parent) parent.children.push(child);
    return child;
  };

  if (templateId === "blank") return { nodes: [], relations: [] };

  if (templateId === "multi-agent") {
    const harness = inst(el("harness"));
    const ce = put(harness, inst(el("context-engineering")));
    put(ce, inst(el("context-compression")));
    put(harness, inst(el("error-recovery")));

    const ma = inst(el("multi-agent"));
    const topo = put(ma, inst(el("topology")));
    put(topo, inst(el("supervisor-worker")));
    put(ma, inst(el("communication")));
    const lifecycle = put(ma, inst(el("lifecycle")));
    put(lifecycle, inst(el("lifecycle-manager")));

    const agents = inst(el("agents"));
    const supervisor = put(agents, inst(el("supervisor-role")));
    const planner = put(agents, inst(el("planner-role")));
    const worker = put(agents, inst(el("worker-role")));
    const relations = [
      makeRelation(supervisor.id, planner.id, "controls", "Supervisor 派发规划任务"),
      makeRelation(supervisor.id, worker.id, "controls", "Supervisor 派发子任务并汇总结果"),
      makeRelation(planner.id, worker.id, "produces", "Planner 产出任务定义，Worker 消费执行"),
    ];
    return { nodes: [harness, ma, agents], relations };
  }

  if (templateId === "coding-agent") {
    const harness = inst(el("harness"));
    const ce = put(harness, inst(el("context-engineering")));
    put(ce, inst(el("context-compression"), { strategy: "hierarchical", threshold: 85 }));
    const ts = put(harness, inst(el("tool-system")));
    put(ts, inst(el("tool-manager")));
    put(ts, inst(el("sandboxing")));
    put(ts, inst(el("permission-policy")));
    const er = put(harness, inst(el("error-recovery")));
    put(er, inst(el("timeout-guard")));
    const gate = put(harness, inst(el("verification-gate")));

    const intel = inst(el("intelligence"));
    put(intel, inst(el("reasoning-paradigm"), { strategy: "plan-and-execute" }));
    const ps = put(intel, inst(el("planning-system")));
    put(ps, inst(el("plan-validation")));

    const hitl = inst(el("hitl"));
    const approval = put(hitl, inst(el("human-approval"), { scope: "destructive-ops" }));

    const agents = inst(el("agents"));
    const planner = put(agents, inst(el("planner-role")));
    const worker = put(agents, inst(el("worker-role"), { specialty: "coding" }));
    const reviewer = put(agents, inst(el("reviewer-role")));

    const relations = [
      makeRelation(planner.id, worker.id, "produces", "Planner 产出任务定义与执行计划"),
      makeRelation(reviewer.id, worker.id, "consumes", "Reviewer 消费 Worker 产出进行评审"),
      makeRelation(approval.id, worker.id, "controls", "破坏性操作（删除/发布）执行前需人工批准"),
      makeRelation(gate.id, worker.id, "controls", "测试门禁：验证不通过阻断交付"),
    ];
    return { nodes: [harness, intel, hitl, agents], relations };
  }

  if (templateId === "research-agent") {
    const harness = inst(el("harness"));
    const ce = put(harness, inst(el("context-engineering")));
    put(ce, inst(el("context-compression"), { strategy: "hierarchical", threshold: 80 }));
    const ts = put(harness, inst(el("tool-system")));
    const toolMgr = put(ts, inst(el("tool-manager")));
    put(ts, inst(el("permission-policy")));

    const intel = inst(el("intelligence"));
    put(intel, inst(el("reasoning-paradigm"), { strategy: "reflexion" }));
    const ps = put(intel, inst(el("planning-system")));
    put(ps, inst(el("plan-validation")));
    put(ps, inst(el("replan-policy"), { trigger: "on-failure" }));

    const agents = inst(el("agents"));
    const planner = put(agents, inst(el("planner-role")));
    const worker = put(agents, inst(el("worker-role"), { specialty: "research" }));
    const reviewer = put(agents, inst(el("reviewer-role")));

    const relations = [
      makeRelation(planner.id, worker.id, "produces", "Planner 产出检索计划与取证任务"),
      makeRelation(reviewer.id, worker.id, "consumes", "Reviewer 消费证据做来源验证与交叉核对"),
      makeRelation(worker.id, toolMgr.id, "uses", "Worker 调用搜索/抓取工具收集证据"),
    ];
    return { nodes: [harness, intel, agents], relations };
  }

  if (templateId === "data-agent") {
    const harness = inst(el("harness"));
    const ce = put(harness, inst(el("context-engineering")));
    put(ce, inst(el("context-compression")));
    const ts = put(harness, inst(el("tool-system")));
    const toolMgr = put(ts, inst(el("tool-manager")));
    const perm = put(ts, inst(el("permission-policy")));
    const gate = put(harness, inst(el("verification-gate")));

    const intel = inst(el("intelligence"));
    const ps = put(intel, inst(el("planning-system")));
    put(ps, inst(el("plan-validation")));

    const gov = inst(el("governance"));
    const cost = put(gov, inst(el("cost-control")));

    const agents = inst(el("agents"));
    const planner = put(agents, inst(el("planner-role")));
    const worker = put(agents, inst(el("worker-role")));
    const reviewer = put(agents, inst(el("reviewer-role")));

    const relations = [
      makeRelation(planner.id, worker.id, "produces", "Planner 产出查询计划与 SQL 任务"),
      makeRelation(reviewer.id, worker.id, "consumes", "Reviewer 消费查询结果做验证"),
      makeRelation(perm.id, toolMgr.id, "controls", "数据访问按最小权限策略裁决"),
      makeRelation(cost.id, toolMgr.id, "observes", "查询与 token 成本归因"),
      makeRelation(gate.id, worker.id, "controls", "结果验证不通过阻断交付"),
    ];
    return { nodes: [harness, intel, gov, agents], relations };
  }

  if (templateId !== "rag") throw new Error(`模板 ${templateId} 不存在（可用: blank / multi-agent / rag / coding-agent / research-agent / data-agent）`);
  const rag = inst(el("rag"));
  const ingestion = put(rag, inst(el("rag-ingestion")));
  const retrieval = put(rag, inst(el("rag-retrieval"), { strategy: "hybrid", bm25Enabled: true, denseModel: "bge-m3", fusionMethod: "rrf" }));
  const embedding = put(rag, inst(el("rag-embedding")));
  const vectorDb = put(rag, inst(el("rag-vector-db")));
  const reranker = put(rag, inst(el("rag-reranker")));
  const generation = put(rag, inst(el("rag-generation")));
  const relations = [
    makeRelation(ingestion.id, vectorDb.id, "produces", "入库管线产出向量索引"),
    makeRelation(retrieval.id, embedding.id, "depends", "检索依赖查询向量化"),
    makeRelation(retrieval.id, vectorDb.id, "depends", "检索依赖向量库"),
    makeRelation(generation.id, reranker.id, "consumes", "生成消费精排后的高质证据"),
  ];
  return { nodes: [rag], relations };
}
