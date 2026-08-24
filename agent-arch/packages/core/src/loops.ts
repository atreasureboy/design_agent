import type { BlueprintNode, LoopDef, LoopReport, LoopStageStatus, Ontology } from "./types.js";
import { flattenNodes } from "./risk.js";

export function evaluateLoops(ontology: Ontology, nodes: BlueprintNode[]): LoopReport[] {
  const flat = flattenNodes(nodes);
  const firstInstance = (elementId: string): BlueprintNode | null => flat.find((n) => n.ref === elementId) ?? null;
  const reports: LoopReport[] = [];
  for (const loop of ontology.loops ?? []) {
    const stages: LoopStageStatus[] = loop.stages.map((s) => {
      const el = ontology.elements.find((e) => e.id === s.elementId);
      return {
        elementId: s.elementId,
        name: el?.name ?? s.elementId,
        label: s.label ?? el?.name ?? s.elementId,
        instance: firstInstance(s.elementId),
      };
    });
    const covered = stages.filter((s) => s.instance !== null).length;
    reports.push({ loop, stages, coverage: stages.length === 0 ? 0 : covered / stages.length });
  }
  return reports;
}
