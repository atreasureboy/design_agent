import type { BlueprintNode, BlueprintRelation, Ontology, OntologyElement } from "./types.js";
import { flattenNodes } from "./risk.js";

export type InferredKind = "requires" | "depends" | "suggests" | "mitigates" | "contract";

export const INFERRED_KIND_META: Record<InferredKind, { label: string; description: string; color: string; defaultType: import("./types.js").RelationType }> = {
  requires: { label: "依赖（本体声明）", description: "元素 constraints.requires 的实例间投影", color: "#e3b341", defaultType: "depends" },
  depends: { label: "依赖（关系声明）", description: "元素 relations.dependsOn 的实例间投影", color: "#8b949e", defaultType: "depends" },
  suggests: { label: "常见搭配", description: "元素 constraints.suggests 的实例间投影", color: "#39c5cf", defaultType: "uses" },
  mitigates: { label: "风险消解", description: "A 引入的风险由 B 消解（风险中介关联）", color: "#a371f7", defaultType: "depends" },
  contract: { label: "契约匹配", description: "A 的产出与 B 的消费术语匹配（输出→输入）", color: "#3fb950", defaultType: "produces" },
};

export interface InferredEdge {
  id: string;
  source: string;
  target: string;
  kind: InferredKind;
  label: string;
  term?: string;
}

function matchTerm(outputs: string[], inputs: string[]): string | null {
  for (const o of outputs) {
    for (const i of inputs) {
      if (o === i) return o;
      if (o.length >= 2 && i.includes(o)) return o;
      if (i.length >= 2 && o.includes(i)) return i;
    }
  }
  return null;
}

export function inferEdges(ontology: Ontology, nodes: BlueprintNode[], explicit: BlueprintRelation[]): InferredEdge[] {
  const flat = flattenNodes(nodes);
  const instances = new Map<string, BlueprintNode[]>();
  for (const n of flat) {
    const arr = instances.get(n.ref) ?? [];
    arr.push(n);
    instances.set(n.ref, arr);
  }
  const out: InferredEdge[] = [];
  const explicitKeys = new Set(explicit.map((r) => `${r.source}>${r.target}`));
  const seen = new Set<string>();
  const push = (source: BlueprintNode, target: BlueprintNode, kind: InferredKind, label: string, term?: string) => {
    if (source.id === target.id) return;
    const key = `${source.id}>${target.id}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: `inf-${key}`, source: source.id, target: target.id, kind, label, ...(term ? { term } : {}) });
  };

  const projections: [InferredKind, (el: OntologyElement) => string[]][] = [
    ["requires", (el) => el.constraints.requires],
    ["depends", (el) => el.relations?.dependsOn ?? []],
    ["suggests", (el) => el.constraints.suggests],
  ];
  for (const [kind, getTargets] of projections) {
    for (const el of ontology.elements) {
      for (const targetEl of getTargets(el)) {
        const sources = instances.get(el.id);
        const targets = instances.get(targetEl);
        if (!sources?.length || !targets?.length) continue;
        if (sources.some((s) => targets.some((t) => explicitKeys.has(`${s.id}>${t.id}`)))) continue;
        for (const s of sources) for (const t of targets) push(s, t, kind, kind);
      }
    }
  }

  for (const risk of ontology.risks) {
    const mitigators = risk.mitigations.map((m) => m.elementId);
    for (const introEl of ontology.elements) {
      if (!introEl.introduces.includes(risk.id)) continue;
      const sources = instances.get(introEl.id);
      if (!sources?.length) continue;
      for (const mitEl of mitigators) {
        if (mitEl === introEl.id) continue;
        const targets = instances.get(mitEl);
        if (!targets?.length) continue;
        for (const s of sources) for (const t of targets) push(s, t, "mitigates", `消解:${risk.name}`);
      }
    }
  }

  for (const a of flat) {
    if (!a.contract?.outputs?.length) continue;
    for (const b of flat) {
      if (a.id === b.id || !b.contract?.inputs?.length) continue;
      const term = matchTerm(a.contract.outputs, b.contract.inputs);
      if (!term) continue;
      if (explicitKeys.has(`${a.id}>${b.id}`)) continue;
      push(a, b, "contract", `契约:${term}`, term);
    }
  }
  return out;
}
