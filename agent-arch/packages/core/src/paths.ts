import type { BlueprintNode, MainPath, Ontology, PathReport, PathStageStatus } from "./types.js";
import { flattenNodes } from "./risk.js";

/**
 * 主路径（请求生命周期）：把蓝图实例按"阅读顺序"归入路径阶段。
 * 归属规则：从实例元素沿祖先链向上，第一个命中某阶段 elementIds 的祖先决定归属
 * （特异性优先：tool-manager → tool-system 命中能力域，而非笼统的 harness）。
 * 未命中任何阶段的实例进入 unassigned（企业扩展等）。
 */
export function evaluatePath(ontology: Ontology, nodes: BlueprintNode[], pathId?: string): PathReport | null {
  const path = (ontology.paths ?? []).find((p) => (pathId ? p.id === pathId : true));
  if (!path) return null;

  const stageIndexByElement = new Map<string, number>();
  path.stages.forEach((stage, idx) => {
    for (const eid of stage.elementIds) stageIndexByElement.set(eid, idx);
  });

  const stages: PathStageStatus[] = path.stages.map((stage) => ({ stage, instances: [], covered: false }));
  const unassigned: BlueprintNode[] = [];

  const chainOf = (elementId: string): string[] => {
    const chain: string[] = [];
    let cursor = ontology.elements.find((e) => e.id === elementId);
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      chain.push(cursor.id);
      cursor = cursor.parentId ? ontology.elements.find((e) => e.id === cursor!.parentId) : undefined;
    }
    return chain;
  };

  for (const inst of flattenNodes(nodes)) {
    let hit: number | null = null;
    for (const eid of chainOf(inst.ref)) {
      const idx = stageIndexByElement.get(eid);
      if (idx !== undefined) {
        hit = idx;
        break;
      }
    }
    if (hit === null) unassigned.push(inst);
    else stages[hit].instances.push(inst);
  }
  for (const s of stages) s.covered = s.instances.length > 0;
  return { path, stages, unassigned };
}
