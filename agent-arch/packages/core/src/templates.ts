import type { ArchTemplate, ArchTemplateId, BlueprintNode, Ontology, OntologyElement, PropertyValue } from "./types.js";
import { elementById } from "./ontology.js";

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
    children: [],
  };
}

export const ARCH_TEMPLATES: ArchTemplate[] = [
  { id: "blank", name: "空白画布", description: "从零开始自由搭建", suggestedFamily: "event-driven" },
  { id: "multi-agent", name: "多 Agent 协作基座", description: "Supervisor-Worker 拓扑 + 上下文工程 + 生命周期管理的骨架", suggestedFamily: "event-driven" },
  { id: "rag", name: "RAG 检索增强", description: "知识入库 → 检索 → 重排 → 生成的完整管线骨架", suggestedFamily: "stateful-graph" },
];

export function instantiateTemplate(ontology: Ontology, templateId: ArchTemplateId): BlueprintNode[] {
  const el = (id: string): OntologyElement => {
    const found = elementById(ontology, id);
    if (!found) throw new Error(`template element missing from ontology: ${id}`);
    return found;
  };
  const put = (parent: BlueprintNode | null, child: BlueprintNode): BlueprintNode => {
    if (parent) parent.children.push(child);
    return child;
  };

  if (templateId === "blank") return [];

  if (templateId === "multi-agent") {
    const harness = inst(el("harness"));
    const ce = put(harness, inst(el("context-engineering")));
    put(ce, inst(el("context-compression")));
    put(harness, inst(el("error-recovery")));

    const ma = inst(el("multi-agent"));
    put(ma, inst(el("topology")));
    put(ma, inst(el("communication")));
    put(ma, inst(el("lifecycle")));

    const agents = inst(el("agents"));
    put(agents, inst(el("planner-role")));
    put(agents, inst(el("worker-role")));
    return [harness, ma, agents];
  }

  const rag = inst(el("rag"));
  const ingestion = put(rag, inst(el("rag-ingestion")));
  put(ingestion, inst(el("rag-chunking")));
  put(rag, inst(el("rag-retrieval"), { strategy: "hybrid", bm25Enabled: true, denseModel: "bge-m3", fusionMethod: "rrf" }));
  put(rag, inst(el("rag-embedding")));
  put(rag, inst(el("rag-vector-db")));
  put(rag, inst(el("rag-reranker")));
  put(rag, inst(el("rag-generation")));
  return [rag];
}
