import type { BlueprintNode, BlueprintRelation, LintIssue, Ontology, RelationType } from "./types.js";
import { elementById } from "./ontology.js";
import { flattenNodes } from "./risk.js";

export const RELATION_TYPES: RelationType[] = [
  "contains",
  "depends",
  "uses",
  "produces",
  "consumes",
  "calls",
  "communicates",
  "controls",
  "observes",
  "routes",
  "reads",
  "writes",
  "publishes",
  "subscribes",
];

export const RELATION_TYPE_COLORS: Record<RelationType, string> = {
  contains: "#6e7681",
  depends: "#8b949e",
  uses: "#58a6ff",
  produces: "#3fb950",
  consumes: "#d29922",
  calls: "#79c0ff",
  communicates: "#4f8ff7",
  controls: "#f78166",
  observes: "#a371f7",
  routes: "#f0883e",
  reads: "#56d364",
  writes: "#e3b341",
  publishes: "#bc8cff",
  subscribes: "#d2a8ff",
};

export const RELATION_TYPE_META: Record<RelationType, { label: string; description: string }> = {
  contains: { label: "包含", description: "组成/容纳关系（与分类树互补的显式声明）" },
  depends: { label: "依赖", description: "运行或设计时依赖另一组件" },
  uses: { label: "使用", description: "使用另一组件的能力（弱于依赖）" },
  produces: { label: "产出", description: "产出中间对象（任务定义/工件/消息）" },
  consumes: { label: "消费", description: "消费另一组件产出的对象" },
  calls: { label: "调用", description: "同步/异步调用另一组件（单向请求）" },
  communicates: { label: "通信", description: "双向消息交换" },
  controls: { label: "控制", description: "派发、监督、裁决或门禁另一组件" },
  observes: { label: "观测", description: "读取轨迹/指标而不介入执行" },
  routes: { label: "路由", description: "将任务/消息分发到目标组件" },
  reads: { label: "读取", description: "读取存储/状态（不改写）" },
  writes: { label: "写入", description: "写入存储/状态" },
  publishes: { label: "发布", description: "向事件通道发布消息" },
  subscribes: { label: "订阅", description: "订阅事件通道的消息" },
};

let relCounter = 0;
export function newRelationId(): string {
  relCounter += 1;
  return `r${Date.now().toString(36)}${relCounter.toString(36)}`;
}

export function makeRelation(source: string, target: string, type: RelationType, description: string | null = null): BlueprintRelation {
  return { id: newRelationId(), source, target, type, description };
}

export function relationKey(rel: Pick<BlueprintRelation, "source" | "target" | "type">): string {
  return `${rel.source}>${rel.target}:${rel.type}`;
}

export interface AddRelationResult {
  relations: BlueprintRelation[];
  added: BlueprintRelation | null;
  error: string | null;
}

export function addRelation(
  nodes: BlueprintNode[],
  relations: BlueprintRelation[],
  input: { source: string; target: string; type: RelationType; description?: string | null },
): AddRelationResult {
  const ids = new Set(flattenNodes(nodes).map((n) => n.id));
  if (!ids.has(input.source)) return { relations, added: null, error: `源节点 ${input.source} 不在蓝图中` };
  if (!ids.has(input.target)) return { relations, added: null, error: `目标节点 ${input.target} 不在蓝图中` };
  if (input.source === input.target) return { relations, added: null, error: "关系不能指向自身" };
  if (!RELATION_TYPES.includes(input.type)) return { relations, added: null, error: `未知关系类型 ${input.type}（可用: ${RELATION_TYPES.join(", ")}）` };
  const dup = relations.some((r) => r.source === input.source && r.target === input.target && r.type === input.type);
  if (dup) return { relations, added: null, error: "该关系已存在（同源/同目标/同类型）" };
  const rel = makeRelation(input.source, input.target, input.type, input.description ?? null);
  return { relations: [...relations, rel], added: rel, error: null };
}

export function removeRelation(relations: BlueprintRelation[], relationId: string): { relations: BlueprintRelation[]; removed: boolean } {
  const idx = relations.findIndex((r) => r.id === relationId);
  if (idx < 0) return { relations, removed: false };
  return { relations: relations.filter((r) => r.id !== relationId), removed: true };
}

export function pruneRelations(relations: BlueprintRelation[], nodes: BlueprintNode[]): BlueprintRelation[] {
  const ids = new Set(flattenNodes(nodes).map((n) => n.id));
  return relations.filter((r) => ids.has(r.source) && ids.has(r.target));
}

export function validateRelations(ontology: Ontology, nodes: BlueprintNode[], relations: BlueprintRelation[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const byId = new Map(flattenNodes(nodes).map((n) => [n.id, n]));
  const label = (nodeId: string): string => {
    const n = byId.get(nodeId);
    if (!n) return nodeId;
    return n.name ?? elementById(ontology, n.ref)?.name ?? n.ref;
  };
  const seen = new Set<string>();
  for (const rel of relations) {
    if (!byId.has(rel.source)) {
      issues.push({ severity: "error", code: "relation-dangling", message: `关系 ${RELATION_TYPE_META[rel.type]?.label ?? rel.type} 的源节点 ${rel.source} 不存在`, nodeId: rel.source, elementId: null });
      continue;
    }
    if (!byId.has(rel.target)) {
      issues.push({ severity: "error", code: "relation-dangling", message: `关系 ${RELATION_TYPE_META[rel.type]?.label ?? rel.type} 的目标节点 ${rel.target} 不存在`, nodeId: rel.target, elementId: null });
      continue;
    }
    if (rel.source === rel.target) {
      issues.push({ severity: "error", code: "relation-self-loop", message: `${label(rel.source)} 不能与自身建立 ${RELATION_TYPE_META[rel.type]?.label ?? rel.type} 关系`, nodeId: rel.source, elementId: null });
      continue;
    }
    const key = relationKey(rel);
    if (seen.has(key)) {
      issues.push({ severity: "warning", code: "relation-duplicate", message: `重复关系: ${label(rel.source)} —${rel.type}→ ${label(rel.target)}`, nodeId: rel.source, elementId: null });
      continue;
    }
    seen.add(key);
  }
  return issues;
}

export function relationsOf(relations: BlueprintRelation[], nodeId: string): { outgoing: BlueprintRelation[]; incoming: BlueprintRelation[] } {
  return {
    outgoing: relations.filter((r) => r.source === nodeId),
    incoming: relations.filter((r) => r.target === nodeId),
  };
}
