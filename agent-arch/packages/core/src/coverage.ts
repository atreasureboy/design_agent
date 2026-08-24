import type { BlueprintNode, CoverageGap, Ontology, RuntimeFamilyId } from "./types.js";
import { elementById, familyAvailable } from "./ontology.js";
import { flattenNodes } from "./risk.js";

/**
 * Architecture Coverage：蓝图实例在分区下"应有而未设计"的能力组件。
 * 不是错误（那是 Constraint 的事），是 K8s Dashboard 式的 Missing 提醒。
 *
 * 规则：
 * - 只对"分区型"元素计算（本体中存在子元素的实例）
 * - 分区子元素集合中若存在任一对 incompatibleWith（互斥选项组，如拓扑/记忆选型），整组跳过
 * - allowMultiple 的多实例元素（如角色）不提醒——按需使用，不算缺失
 * - 族不支持的元素不提醒（是选型约束，不是遗漏）
 * - 根级只提醒 runtime（执行模型维度，其余根按需不强推）
 */
export function computeCoverage(ontology: Ontology, nodes: BlueprintNode[], family: RuntimeFamilyId): CoverageGap[] {
  const flat = flattenNodes(nodes);
  const childrenOf = (id: string | null) => ontology.elements.filter((e) => e.parentId === id);
  const isSection = (id: string) => childrenOf(id).length > 0;

  const gaps: CoverageGap[] = [];
  for (const inst of flat) {
    const el = elementById(ontology, inst.ref);
    if (!el || !isSection(el.id)) continue;
    const group = childrenOf(el.id);
    if (group.length === 0) continue;
    const mutualExclusive = group.some((a) => (a.relations?.incompatibleWith ?? []).some((b) => group.some((g) => g.id === b)));
    if (mutualExclusive) continue;
    const instantiatedRefs = new Set(inst.children.map((c) => c.ref));
    for (const child of group) {
      if (child.allowMultiple) continue;
      if (instantiatedRefs.has(child.id)) continue;
      if (!familyAvailable(child, family)) continue;
      gaps.push({ parentInstanceId: inst.id, parentNodeId: null, element: child });
    }
  }

  const hasRuntime = flat.some((n) => {
    const el = elementById(ontology, n.ref);
    if (!el) return false;
    let cursor: ReturnType<typeof elementById> = el;
    while (cursor?.parentId) cursor = elementById(ontology, cursor.parentId);
    return cursor?.id === "runtime";
  });
  if (!hasRuntime) {
    const runtimeEl = elementById(ontology, "runtime");
    if (runtimeEl) gaps.push({ parentInstanceId: null, parentNodeId: "runtime", element: runtimeEl });
  }
  return gaps;
}
