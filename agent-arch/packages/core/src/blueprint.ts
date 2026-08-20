import type { Blueprint, BlueprintNode, Ontology, OntologyElement, PropertyValue, RuntimeFamilyId } from "./types.js";
import { childrenOf, elementById, familyAvailable } from "./ontology.js";

let counter = 0;
export function newNodeId(): string {
  counter += 1;
  return `n${Date.now().toString(36)}${counter.toString(36)}`;
}

export function makeNode(element: OntologyElement, label: string | null = null): BlueprintNode {
  const params: Record<string, PropertyValue> = {};
  for (const [key, schema] of Object.entries(element.properties)) {
    params[key] = schema.default;
  }
  return {
    id: newNodeId(),
    ref: element.id,
    name: label,
    params,
    reason: null,
    decision: null,
    responsibility: element.responsibilityTemplate ? { owns: [...element.responsibilityTemplate.owns], not: [...element.responsibilityTemplate.not] } : null,
    children: [],
  };
}

export function createBlueprint(id: string, name: string, description: string, family: RuntimeFamilyId, author: string): Blueprint {
  const now = new Date().toISOString();
  return {
    id,
    name,
    description,
    runtimeFamily: family,
    nodes: [],
    status: "draft",
    version: 1,
    structuralVersion: 1,
    author,
    createdAt: now,
    updatedAt: now,
  };
}

export function findNode(nodes: BlueprintNode[], nodeId: string): BlueprintNode | null {
  for (const n of nodes) {
    if (n.id === nodeId) return n;
    const hit = findNode(n.children, nodeId);
    if (hit) return hit;
  }
  return null;
}

export function findParent(nodes: BlueprintNode[], nodeId: string): BlueprintNode[] | null {
  for (const n of nodes) {
    if (n.id === nodeId) return nodes;
    const hit = findParent(n.children, nodeId);
    if (hit) return hit;
  }
  return null;
}

export function removeNode(nodes: BlueprintNode[], nodeId: string): { nodes: BlueprintNode[]; removed: boolean } {
  const siblings = findParent(nodes, nodeId);
  if (!siblings) return { nodes, removed: false };
  const idx = siblings.findIndex((n) => n.id === nodeId);
  if (idx < 0) return { nodes, removed: false };
  siblings.splice(idx, 1);
  return { nodes, removed: true };
}

export interface PaletteCandidate {
  element: OntologyElement;
  available: boolean;
  reason: string | null;
  alreadyPresent: boolean;
}

export function paletteFor(
  ontology: Ontology,
  family: RuntimeFamilyId,
  nodes: BlueprintNode[],
  parentNodeId: string | null,
): PaletteCandidate[] {
  const parentElementId = parentNodeId
    ? (findNode(nodes, parentNodeId)?.ref ?? null)
    : null;
  if (parentNodeId && !parentElementId) return [];
  const candidates = childrenOf(ontology, parentElementId);
  const present = new Set<string>();
  const collect = (list: BlueprintNode[]) => {
    for (const n of list) {
      present.add(n.ref);
      collect(n.children);
    }
  };
  collect(nodes);
  return candidates.map((el) => {
    const famOk = familyAvailable(el, family);
    const slotTaken = !el.allowMultiple && (parentNodeId ? (findNode(nodes, parentNodeId)?.children ?? []).some((c) => c.ref === el.id) : nodes.some((c) => c.ref === el.id));
    let reason: string | null = null;
    if (!famOk) reason = `Runtime 族 ${family} 不支持`;
    else if (slotTaken) reason = "已存在（该元素不允许多实例）";
    return { element: el, available: famOk && !slotTaken, reason, alreadyPresent: slotTaken };
  });
}

export function countElements(nodes: BlueprintNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (list: BlueprintNode[]) => {
    for (const n of list) {
      counts.set(n.ref, (counts.get(n.ref) ?? 0) + 1);
      walk(n.children);
    }
  };
  walk(nodes);
  return counts;
}

export function nodeLabel(ontology: Ontology, node: BlueprintNode): string {
  const el = elementById(ontology, node.ref);
  return node.name ?? el?.name ?? node.ref;
}
