import { useMemo } from "react";
import type { BlueprintNode, Ontology, RuntimeFamilyId } from "@agent-arch/core";
import { elementById, familyAvailable } from "@agent-arch/core";

export interface MissingOption {
  elementId: string;
  name: string;
  description: string;
  available: boolean;
  reason: string | null;
  implementations: { name: string; note: string }[];
  pros: string[];
  cons: string[];
  existing: boolean;
}

/**
 * 通用补全弹窗：给定分区实例（或根），列出所有可添加的缺失能力。
 * 与架构图谱红节点、主路径红阶段、循环红环节共用。
 */
export function CompleteDialog(props: {
  ontology: Ontology;
  nodes: BlueprintNode[];
  runtimeFamily: RuntimeFamilyId;
  parentInstanceId: string | null;
  parentElementId: string | null;
  title: string;
  onClose: () => void;
  onAdd: (parentInstanceId: string | null, elementId: string) => void;
}) {
  const { ontology, nodes, runtimeFamily, parentInstanceId, parentElementId, title, onClose, onAdd } = props;

  const parent = parentElementId ? elementById(ontology, parentElementId) : null;
  const children = useMemo(
    () => (parent ? ontology.elements.filter((e) => e.parentId === parent.id) : ontology.elements.filter((e) => e.parentId === null)),
    [ontology, parent],
  );

  const existingRefs = useMemo(() => {
    if (!parentInstanceId) return new Set<string>();
    const find = (list: BlueprintNode[]): BlueprintNode | null => {
      for (const n of list) {
        if (n.id === parentInstanceId) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    const inst = find(nodes);
    return new Set((inst?.children ?? []).map((c) => c.ref));
  }, [nodes, parentInstanceId]);

  const options: MissingOption[] = useMemo(
    () =>
      children
        .filter((el) => !existingRefs.has(el.id))
        .map((el) => {
          const famOk = familyAvailable(el, runtimeFamily);
          const slotTaken = !el.allowMultiple && existingRefs.has(el.id);
          return {
            elementId: el.id,
            name: el.name,
            description: el.description,
            available: famOk && !slotTaken,
            reason: !famOk ? `Runtime 族 ${runtimeFamily} 不支持` : null,
            implementations: el.implementations ?? [],
            pros: el.pros ?? [],
            cons: el.cons ?? [],
            existing: slotTaken,
          };
        }),
    [children, existingRefs, runtimeFamily],
  );

  const groups = useMemo(() => {
    const groupIds = new Set<string>();
    for (const a of children) {
      const incompat = a.relations?.incompatibleWith ?? [];
      const hit = children.find((b) => incompat.includes(b.id));
      if (hit) {
        groupIds.add(a.id);
        groupIds.add(hit.id);
      }
    }
    return { groupIds };
  }, [children]);

  return (
    <div className="complete-overlay" onClick={onClose}>
      <div className="complete-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="complete-head">
          <div className="complete-title">{title}</div>
          <button className="complete-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="complete-sub">
          {parent ? `挂载到「${parent.name}」下——选择方案后添加（互斥选型只能选其一，选型类不添加也是合法设计）` : "根级分区"}
        </div>
        <div className="complete-list">
          {options.length === 0 && <div className="empty">该分区没有可添加的缺失能力</div>}
          {options.map((opt) => (
            <div key={opt.elementId} className={`complete-option ${opt.available ? "" : "disabled"}`}>
              <div className="complete-option-main">
                <div className="complete-option-name">
                  {opt.name}
                  {groups.groupIds.has(opt.elementId) && <span className="complete-option-tag">选型</span>}
                </div>
                <div className="complete-option-desc">{opt.description}</div>
                {opt.implementations.length > 0 && (
                  <div className="complete-option-impls">
                    方案：{opt.implementations.map((i) => i.name).join(" / ")}
                  </div>
                )}
                {(opt.pros.length > 0 || opt.cons.length > 0) && (
                  <div className="complete-option-tradeoff">
                    {opt.pros[0] && <span className="kc-pro">+ {opt.pros[0]}</span>}
                    {opt.cons[0] && <span className="kc-con">− {opt.cons[0]}</span>}
                  </div>
                )}
                {opt.reason && <div className="complete-option-reason">{opt.reason}</div>}
              </div>
              <button
                className="btn small primary"
                disabled={!opt.available}
                onClick={() => {
                  onAdd(parentInstanceId, opt.elementId);
                }}
              >
                添加
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
