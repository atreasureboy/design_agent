import type { BlueprintChange, BlueprintDiff, BlueprintNode, BlueprintRelation, Ontology } from "./types.js";
import { nodeLabel } from "./blueprint.js";
import { RELATION_TYPE_META } from "./relations.js";

interface IndexEntry {
  node: BlueprintNode;
  path: string;
}

function indexTree(ontology: Ontology, nodes: BlueprintNode[], prefix: string, map: Map<string, IndexEntry>): void {
  for (const n of nodes) {
    const label = nodeLabel(ontology, n);
    const path = prefix ? `${prefix} / ${label}` : label;
    map.set(path, { node: n, path });
    indexTree(ontology, n.children, path, map);
  }
}

function nodeIdLabel(ontology: Ontology, nodes: BlueprintNode[], nodeId: string): string {
  const find = (list: BlueprintNode[]): BlueprintNode | null => {
    for (const n of list) {
      if (n.id === nodeId) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const n = find(nodes);
  return n ? nodeLabel(ontology, n) : nodeId;
}

export function diffBlueprints(
  ontology: Ontology,
  before: BlueprintNode[],
  after: BlueprintNode[],
  beforeRelations: BlueprintRelation[] = [],
  afterRelations: BlueprintRelation[] = [],
): BlueprintDiff {
  const structural: BlueprintChange[] = [];
  const parameter: BlueprintChange[] = [];
  const beforeMap = new Map<string, IndexEntry>();
  const afterMap = new Map<string, IndexEntry>();
  indexTree(ontology, before, "", beforeMap);
  indexTree(ontology, after, "", afterMap);

  for (const [path, entry] of afterMap) {
    const old = beforeMap.get(path);
    if (!old) {
      structural.push({ kind: "structural", type: "node-added", path, detail: "新增节点（结构性变更，major）" });
      continue;
    }
    if (old.node.ref !== entry.node.ref) {
      structural.push({ kind: "structural", type: "node-added", path, detail: `元素引用变化: ${old.node.ref} → ${entry.node.ref}（major）` });
      continue;
    }
    const props = new Set([...Object.keys(old.node.params), ...Object.keys(entry.node.params)]);
    for (const key of props) {
      const a = old.node.params[key];
      const b = entry.node.params[key];
      if (a !== b) {
        parameter.push({
          kind: "parameter",
          type: "param-changed",
          path,
          detail: `${key}: ${JSON.stringify(a)} → ${JSON.stringify(b)}（参数调整，minor）`,
        });
      }
    }
    if ((old.node.name ?? "") !== (entry.node.name ?? "")) {
      parameter.push({
        kind: "parameter",
        type: "label-changed",
        path,
        detail: `实例名: ${old.node.name ?? "-"} → ${entry.node.name ?? "-"}`,
      });
    }
    if ((old.node.reason ?? "") !== (entry.node.reason ?? "")) {
      parameter.push({
        kind: "parameter",
        type: "reason-changed",
        path,
        detail: `设计理由更新`,
      });
    }
    const decA = old.node.decision ? JSON.stringify(old.node.decision) : null;
    const decB = entry.node.decision ? JSON.stringify(entry.node.decision) : null;
    if (decA !== decB) {
      parameter.push({
        kind: "parameter",
        type: "label-changed",
        path,
        detail: `决策记录更新（${entry.node.decision?.chosen ?? "-"}${entry.node.decision?.tradeoffs?.length ? `，含 ${entry.node.decision.tradeoffs.length} 项权衡` : ""}）`,
      });
    }
    const respA = old.node.responsibility ? JSON.stringify(old.node.responsibility) : null;
    const respB = entry.node.responsibility ? JSON.stringify(entry.node.responsibility) : null;
    if (respA !== respB) {
      parameter.push({
        kind: "parameter",
        type: "label-changed",
        path,
        detail: `职责边界更新`,
      });
    }
    const conA = old.node.contract ? JSON.stringify(old.node.contract) : null;
    const conB = entry.node.contract ? JSON.stringify(entry.node.contract) : null;
    if (conA !== conB) {
      parameter.push({
        kind: "parameter",
        type: "label-changed",
        path,
        detail: `组件契约更新（inputs/outputs/guarantees）`,
      });
    }
  }

  for (const [path] of beforeMap) {
    if (!afterMap.has(path)) {
      structural.push({ kind: "structural", type: "node-removed", path, detail: "移除节点（结构性变更，major）" });
    }
  }

  const relKey = (r: BlueprintRelation) => `${r.source}>${r.target}:${r.type}`;
  const beforeRelMap = new Map(beforeRelations.map((r) => [relKey(r), r]));
  const afterRelMap = new Map(afterRelations.map((r) => [relKey(r), r]));
  for (const [key, rel] of afterRelMap) {
    if (!beforeRelMap.has(key)) {
      const typeLabel = RELATION_TYPE_META[rel.type]?.label ?? rel.type;
      structural.push({
        kind: "structural",
        type: "relation-added",
        path: `${nodeIdLabel(ontology, after, rel.source)} —${rel.type}→ ${nodeIdLabel(ontology, after, rel.target)}`,
        detail: `新增架构关系（${typeLabel}，结构性变更，major）`,
      });
    }
  }
  for (const [key, rel] of beforeRelMap) {
    if (!afterRelMap.has(key)) {
      const typeLabel = RELATION_TYPE_META[rel.type]?.label ?? rel.type;
      structural.push({
        kind: "structural",
        type: "relation-removed",
        path: `${nodeIdLabel(ontology, before, rel.source)} —${rel.type}→ ${nodeIdLabel(ontology, before, rel.target)}`,
        detail: `移除架构关系（${typeLabel}，结构性变更，major）`,
      });
    }
  }

  return { structural, parameter, structuralChanged: structural.length > 0 };
}
