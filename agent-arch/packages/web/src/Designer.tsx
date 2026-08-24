import { useEffect, useMemo, useState } from "react";
import type {
  Blueprint,
  BlueprintNode,
  BlueprintRelation,
  Comment,
  Contract,
  LintIssue,
  Ontology,
  PropertyValue,
  RelationType,
  RiskReport,
  RuntimeFamilyId,
  Tradeoff,
} from "@agent-arch/core";
import { activeRiskReport, elementById, lintBlueprint, paletteFor, pruneRelations, RELATION_TYPES, RELATION_TYPE_META } from "@agent-arch/core";
import { api } from "./api.js";
import { CommentsPanel, DiagramPanel, DiffPanel, ExportPanel, ExtensionPanel, LintPanel, RiskPanel } from "./panels.js";

const statusLabel: Record<Blueprint["status"], string> = {
  draft: "草稿",
  "in-review": "评审中",
  approved: "已批准",
  rejected: "已驳回",
};

let idc = 0;
const localId = () => `w${Date.now().toString(36)}${(idc += 1).toString(36)}`;

export function findNode(nodes: BlueprintNode[], id: string | null): BlueprintNode | null {
  if (!id) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

function findSiblings(nodes: BlueprintNode[], id: string): BlueprintNode[] | null {
  for (const n of nodes) {
    if (n.id === id) return nodes;
    const hit = findSiblings(n.children, id);
    if (hit) return hit;
  }
  return null;
}

export function makeNode(ontology: Ontology, elementId: string, name: string | null): BlueprintNode {
  const el = elementById(ontology, elementId)!;
  const params: Record<string, PropertyValue> = {};
  for (const [k, s] of Object.entries(el.properties)) params[k] = s.default;
  return {
    id: localId(),
    ref: elementId,
    name,
    params,
    reason: null,
    decision: null,
    responsibility: el.responsibilityTemplate
      ? { owns: [...el.responsibilityTemplate.owns], not: [...el.responsibilityTemplate.not] }
      : null,
    contract: el.contractTemplate
      ? { inputs: [...el.contractTemplate.inputs], outputs: [...el.contractTemplate.outputs], guarantees: [...el.contractTemplate.guarantees] }
      : null,
    children: [],
  };
}

export function mountTarget(ontology: Ontology, nodes: BlueprintNode[], elementId: string): { parent: BlueprintNode | null; missing: string[] } {
  const chain: string[] = [];
  let cursor = elementById(ontology, elementId);
  while (cursor && cursor.parentId) {
    chain.unshift(cursor.parentId);
    cursor = elementById(ontology, cursor.parentId);
  }
  let parent: BlueprintNode | null = null;
  const missing: string[] = [];
  for (const ancestorId of chain) {
    const existing: BlueprintNode | undefined = (parent ? parent.children : nodes).find((n) => n.ref === ancestorId);
    if (existing) {
      parent = existing;
    } else {
      missing.push(ancestorId);
    }
  }
  return { parent, missing };
}

export function nodeLabel(ontology: Ontology, n: BlueprintNode): string {
  return n.name ?? elementById(ontology, n.ref)?.name ?? n.ref;
}

type Tab = "lint" | "diagram" | "risk" | "comments" | "diff" | "export" | "extensions";

export function Designer({ id, user }: { id: string; user: string }) {
  const [ontology, setOntology] = useState<Ontology | null>(null);
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [nodes, setNodes] = useState<BlueprintNode[]>([]);
  const [relations, setRelations] = useState<BlueprintRelation[]>([]);
  const [savedState, setSavedState] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [family, setFamily] = useState<RuntimeFamilyId>("event-driven");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<Comment[]>([]);
  const [tab, setTab] = useState<Tab>("lint");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [explorerMode, setExplorerMode] = useState<"blueprint" | "ontology">("blueprint");
  const [explorerPicked, setExplorerPicked] = useState<string | null>(null);

  const reloadOntology = () => {
    api.ontology().then(setOntology);
  };

  useEffect(() => {
    api.ontology().then(setOntology);
    api.getBlueprint(id).then(({ blueprint, comments }) => {
      setBlueprint(blueprint);
      setNodes(blueprint.nodes);
      setRelations(blueprint.relations ?? []);
      setSavedState(JSON.stringify({ nodes: blueprint.nodes, relations: blueprint.relations ?? [] }));
      setName(blueprint.name);
      setDescription(blueprint.description);
      setFamily(blueprint.runtimeFamily);
      setComments(comments);
    });
  }, [id]);

  const lint: LintIssue[] = useMemo(() => (ontology ? lintBlueprint(ontology, nodes, family, relations) : []), [ontology, nodes, family, relations]);
  const riskReport: RiskReport = useMemo(
    () => (ontology ? activeRiskReport(ontology, nodes) : { statuses: [], unresolvedHigh: [], unresolvedOther: [] }),
    [ontology, nodes],
  );

  if (!ontology || !blueprint) return <div className="loading">加载中…</div>;

  const editable = blueprint.status === "draft" || blueprint.status === "rejected";
  const dirty = savedState !== JSON.stringify({ nodes, relations }) || name !== blueprint.name || description !== blueprint.description || family !== blueprint.runtimeFamily;
  const selectedNode = findNode(nodes, selected);
  const selectedElement = selectedNode ? elementById(ontology, selectedNode.ref) : null;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const addChild = (parentId: string | null, elementId: string, instanceName: string | null) => {
    if (!editable) return flash("当前状态不可编辑");
    const siblings = parentId ? findNode(nodes, parentId)?.children : nodes;
    if (!siblings) return;
    const el = elementById(ontology, elementId)!;
    if (!el.allowMultiple && siblings.some((c) => c.ref === elementId)) return flash("该元素已存在且不允许多实例");
    const count = siblings.filter((c) => c.ref === elementId).length + 1;
    const node = makeNode(ontology, elementId, instanceName ?? (el.allowMultiple ? `${el.name} ${count}` : null));
    siblings.push(node);
    setNodes([...nodes]);
    if (parentId) setExpanded((prev) => new Set([...prev, parentId]));
    setSelected(node.id);
  };

  const removeNode = (nodeId: string) => {
    if (!editable) return;
    const siblings = findSiblings(nodes, nodeId);
    if (!siblings) return;
    const idx = siblings.findIndex((n) => n.id === nodeId);
    siblings.splice(idx, 1);
    setRelations(pruneRelations(relations, nodes));
    setNodes([...nodes]);
    if (selected === nodeId) setSelected(null);
  };

  const patchNode = (nodeId: string, patch: Partial<BlueprintNode>) => {
    const n = findNode(nodes, nodeId);
    if (!n) return;
    Object.assign(n, patch);
    setNodes([...nodes]);
  };

  const addRelationEdge = (source: string, target: string, type: RelationType, description: string | null) => {
    if (!editable) return flash("当前状态不可编辑");
    const ids = new Set<string>();
    const walk = (list: BlueprintNode[]) => {
      for (const n of list) {
        ids.add(n.id);
        walk(n.children);
      }
    };
    walk(nodes);
    if (!ids.has(source) || !ids.has(target)) return flash("关系端点节点不存在");
    if (source === target) return flash("关系不能指向自身");
    if (relations.some((r) => r.source === source && r.target === target && r.type === type)) return flash("该关系已存在");
    setRelations([...relations, { id: localId(), source, target, type, description }]);
  };

  const removeRelationEdge = (relationId: string) => {
    if (!editable) return;
    setRelations(relations.filter((r) => r.id !== relationId));
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.saveBlueprint(id, { name, description, runtimeFamily: family, nodes, relations, actor: user });
      setBlueprint(res.blueprint);
      setNodes(res.blueprint.nodes);
      setRelations(res.blueprint.relations ?? []);
      setSavedState(JSON.stringify({ nodes: res.blueprint.nodes, relations: res.blueprint.relations ?? [] }));
      flash(`已保存 v${res.blueprint.version}${res.diff.structuralChanged ? `（结构性变更 → sv${res.blueprint.structuralVersion}）` : ""}`);
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const transition = async (to: Blueprint["status"]) => {
    setBusy(true);
    try {
      const res = await api.transition(id, to, user);
      setBlueprint(res.blueprint);
      flash(`状态已变更为 ${statusLabel[to]}`);
    } catch (e) {
      const err = e as Error & { body?: { error?: string } };
      flash(err.body?.error ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  const errorCount = lint.filter((i) => i.severity === "error").length;

  return (
    <div className="designer">
      <div className="toolbar">
        <input className="bp-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} />
        <input className="bp-desc" placeholder="描述" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} />
        <select
          value={family}
          onChange={(e) => setFamily(e.target.value as RuntimeFamilyId)}
          disabled={!editable}
          title="Runtime 能力族：设计时约束来源，不锁定实现"
        >
          {ontology.families.map((f) => (
            <option key={f.id} value={f.id}>
              族: {f.name}
            </option>
          ))}
        </select>
        <span className={`status status-${blueprint.status}`}>{statusLabel[blueprint.status]}</span>
        <span className="versions" title="revision / structural version">
          v{blueprint.version} · sv{blueprint.structuralVersion}
        </span>
        <div className="spacer" />
        {editable ? (
          <>
            <button className="btn primary" onClick={save} disabled={busy || !dirty}>
              {dirty ? "保存" : "已保存"}
            </button>
            <button className="btn" onClick={() => transition("in-review")} disabled={busy || dirty}>
              提交评审
            </button>
          </>
        ) : blueprint.status === "in-review" ? (
          <>
            <button className="btn primary" onClick={() => transition("approved")} disabled={busy || errorCount > 0} title={errorCount > 0 ? "存在 error 级问题，门禁拦截" : ""}>
              批准 {errorCount > 0 ? `（${errorCount} 项阻断）` : ""}
            </button>
            <button className="btn danger" onClick={() => transition("rejected")} disabled={busy}>
              驳回
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => transition("draft")} disabled={busy}>
            退回草稿
          </button>
        )}
      </div>
      {!editable && <div className="readonly-banner">当前状态「{statusLabel[blueprint.status]}」为只读，退回草稿后可编辑</div>}
      <div className="designer-body">
        <div className="tree-pane">
          <div className="tree-pane-tabs">
            <button className={`tab ${explorerMode === "blueprint" ? "active" : ""}`} onClick={() => setExplorerMode("blueprint")}>
              蓝图
            </button>
            <button className={`tab ${explorerMode === "ontology" ? "active" : ""}`} onClick={() => setExplorerMode("ontology")}>
              Ontology
            </button>
          </div>
          {explorerMode === "blueprint" ? (
            <>
              <h3>架构树（受约束）</h3>
              <div className="tree">
                <div className={`tree-root ${selected === null ? "selected" : ""}`} onClick={() => setSelected(null)}>
                  Agent System（根）
                </div>
                <TreeView
                  nodes={nodes}
                  ontology={ontology}
                  selected={selected}
                  expanded={expanded}
                  editable={editable}
                  riskReport={riskReport}
                  onSelect={setSelected}
                  onToggle={(nid) =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(nid)) next.delete(nid);
                      else next.add(nid);
                      return next;
                    })
                  }
                  onRemove={removeNode}
                />
              </div>
            </>
          ) : (
            <OntologyExplorer ontology={ontology} onPickElement={(eid) => setExplorerPicked(eid)} picked={explorerPicked} />
          )}
        </div>
        <div className="middle-pane">
          {explorerMode === "ontology" && explorerPicked ? (
            <OntologyInspector ontology={ontology} elementId={explorerPicked} />
          ) : (
            <>
              <Palette ontology={ontology} family={family} nodes={nodes} selectedNode={selectedNode} editable={editable} onAdd={addChild} />
              <Details
                ontology={ontology}
                node={selectedNode}
                editable={editable}
                onPatch={patchNode}
                nodes={nodes}
                relations={relations}
                onAddRelation={addRelationEdge}
                onRemoveRelation={removeRelationEdge}
              />
            </>
          )}
        </div>
        <div className="right-pane">
          <div className="tabs">
            {(
              [
                ["lint", `校验 (${errorCount})`],
                ["diagram", "图形"],
                ["risk", `架构注记 (${riskReport.statuses.filter((s) => s.active).length})`],
                ["extensions", `扩展 (${ontology.elements.filter((e) => e.namespace.startsWith("enterprise.")).length})`],
                ["comments", `评论 (${comments.length})`],
                ["diff", "Diff"],
                ["export", "导出"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === "risk" && (
              <RiskPanel ontology={ontology} report={riskReport} nodes={nodes} editable={editable} onMount={(elId) => {
                const { parent } = mountTarget(ontology, nodes, elId);
                addChild(parent ? parent.id : null, elId, null);
              }} />
            )}
            {tab === "lint" && <LintPanel lint={lint} />}
            {tab === "diagram" && <DiagramPanel blueprintId={id} dirty={dirty} />}
            {tab === "extensions" && ontology && <ExtensionPanel ontology={ontology} onOntologyChanged={reloadOntology} />}
            {tab === "comments" && (
              <CommentsPanel
                comments={comments}
                setComments={setComments}
                blueprintId={id}
                user={user}
                selectedNode={selectedNode}
                ontology={ontology}
                nodes={nodes}
              />
            )}
            {tab === "diff" && <DiffPanel blueprintId={id} />}
            {tab === "export" && <ExportPanel blueprintId={id} dirty={dirty} />}
          </div>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function OntologyExplorer(props: { ontology: Ontology; picked: string | null; onPickElement: (id: string) => void }) {
  const { ontology, picked, onPickElement } = props;
  const [open, setOpen] = useState<Set<string>>(new Set(["harness", "multi-agent", "rag"]));
  const [showRules, setShowRules] = useState(false);
  const roots = ontology.elements.filter((e) => e.parentId === null);
  const renderRow = (elId: string, depth: number): JSX.Element | null => {
    const el = elementById(ontology, elId);
    if (!el) return null;
    const children = ontology.elements.filter((e) => e.parentId === elId);
    const isOpen = open.has(elId);
    return (
      <div key={elId}>
        <div
          className={`tree-row ${picked === elId ? "selected" : ""}`}
          style={{ paddingLeft: depth * 18 + 8 }}
          onClick={() => onPickElement(elId)}
        >
          {children.length > 0 ? (
            <span
              className="tree-toggle"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(elId)) next.delete(elId);
                  else next.add(elId);
                  return next;
                });
              }}
            >
              {isOpen ? "▾" : "▸"}
            </span>
          ) : (
            <span className="tree-toggle leaf">·</span>
          )}
          <span className="tree-label">{el.name}</span>
          {el.extensionPoint && <span className="ext-badge">扩展点</span>}
          {el.required && <span className="req-badge">必选</span>}
        </div>
        {isOpen && children.map((c) => renderRow(c.id, depth + 1))}
      </div>
    );
  };
  return (
    <div className="ontology-explorer">
      <h3>Agent Architecture Tree</h3>
      <div className="hint">浏览架构语言全集（点击元素在右侧 Inspector 查看知识卡）</div>
      <div className="tree">{roots.map((r) => renderRow(r.id, 0))}</div>
      <div className="rules-browser">
        <div className="rules-head" onClick={() => setShowRules(!showRules)}>
          <span className="tree-toggle">{showRules ? "▾" : "▸"}</span>
          <span>架构模式规则库（{ontology.rules.length} 条，建议级推理）</span>
        </div>
        {showRules && (
          <div className="rules-list">
            {ontology.rules.map((r) => (
              <div className="rule-item" key={r.id}>
                <div className="rule-name">
                  <span className={`sev-badge ${r.then.level === "warning" ? "sev-medium" : "sev-low"}`}>{r.then.level}</span>
                  {r.name}
                </div>
                <div className="rule-when">
                  when: {r.when.allOf.map((id) => elementById(ontology, id)?.name ?? id).join(" + ")}
                  {(r.when.noneOf?.length ?? 0) > 0 && `，且无 ${r.when.noneOf!.map((id) => elementById(ontology, id)?.name ?? id).join("/")}`}
                </div>
                <div className="rule-advice">{r.then.advice}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OntologyInspector(props: { ontology: Ontology; elementId: string }) {
  const { ontology, elementId } = props;
  const el = elementById(ontology, elementId);
  if (!el) return null;
  const names = (ids: string[]) => ids.map((i) => elementById(ontology, i)?.name ?? i);
  const parent = el.parentId ? elementById(ontology, el.parentId) : null;
  const introduced = el.introduces.map((r) => ontology.risks.find((x) => x.id === r)).filter(Boolean);
  const mitigated = el.mitigates.map((r) => ontology.risks.find((x) => x.id === r)).filter(Boolean);
  return (
    <div className="details card knowledge-card">
      <h3>{el.name}</h3>
      <section className="kc-section">
        <div className="kc-label">定义</div>
        <p className="kc-def">{el.description}</p>
      </section>
      <section className="kc-section">
        <div className="kc-label">层级与关系</div>
        <div className="kc-rel">
          {parent && <div>挂载于: <strong>{parent.name}</strong></div>}
          {el.relations?.allowedSiblings && el.relations.allowedSiblings.length > 0 && <div>常见搭配: {names(el.relations.allowedSiblings).join("、")}</div>}
          {el.relations?.incompatibleWith && el.relations.incompatibleWith.length > 0 && <div>互斥: {names(el.relations.incompatibleWith).join("、")}</div>}
          {el.relations?.dependsOn && el.relations.dependsOn.length > 0 && <div>依赖: {names(el.relations.dependsOn).join("、")}</div>}
          {el.constraints.requires.length > 0 && <div>requires: {names(el.constraints.requires).join("、")}</div>}
        </div>
      </section>
      {(el.implementations?.length ?? 0) > 0 && (
        <section className="kc-section">
          <div className="kc-label">实现方式</div>
          {el.implementations!.map((impl) => (
            <div key={impl.name} className="kc-impl">
              <code>{impl.name}</code>
              <span>{impl.note}</span>
            </div>
          ))}
        </section>
      )}
      {(el.useCases?.length ?? 0) > 0 && (
        <section className="kc-section">
          <div className="kc-label">适用场景</div>
          <div className="kc-tags">
            {el.useCases!.map((u) => (
              <span key={u} className="chip">{u}</span>
            ))}
          </div>
        </section>
      )}
      {(el.alternatives?.length ?? 0) > 0 && (
        <section className="kc-section">
          <div className="kc-label">替代方案</div>
          <ul className="kc-issues">{el.alternatives!.map((a) => <li key={a}>{a}</li>)}</ul>
        </section>
      )}
      {((el.pros?.length ?? 0) > 0 || (el.cons?.length ?? 0) > 0) && (
        <section className="kc-section">
          <div className="kc-label">Tradeoff</div>
          <div className="kc-prose">
            {el.pros?.map((p) => <div key={p} className="kc-pro">+ {p}</div>)}
            {el.cons?.map((c) => <div key={c} className="kc-con">− {c}</div>)}
          </div>
        </section>
      )}
      {(el.commonIssues?.length ?? 0) > 0 && (
        <section className="kc-section">
          <div className="kc-label">常见考量（Architecture Notes）</div>
          <ul className="kc-issues">{el.commonIssues!.map((i) => <li key={i}>{i}</li>)}</ul>
        </section>
      )}
      {el.responsibilityTemplate && (
        <section className="kc-section">
          <div className="kc-label">职责模板</div>
          <div className="kc-rel">
            <div className="kc-pro">owns: {el.responsibilityTemplate.owns.join("、")}</div>
            <div className="kc-con">not: {el.responsibilityTemplate.not.join("、")}</div>
          </div>
        </section>
      )}
      {el.contractTemplate && (
        <section className="kc-section">
          <div className="kc-label">契约模板（Contract）</div>
          <div className="kc-rel">
            <div>inputs: {el.contractTemplate.inputs.join("、") || "-"}</div>
            <div>outputs: {el.contractTemplate.outputs.join("、") || "-"}</div>
            <div className="kc-pro">guarantees: {el.contractTemplate.guarantees.join("；") || "-"}</div>
          </div>
        </section>
      )}
      {(introduced.length > 0 || mitigated.length > 0) && (
        <section className="kc-section">
          <div className="kc-label">风险关联</div>
          <div className="risk-chips">
            {introduced.map((r) => <span key={r!.id} className="chip">需考量: {r!.name}</span>)}
            {mitigated.map((r) => <span key={r!.id} className="chip green">可应对: {r!.name}</span>)}
          </div>
        </section>
      )}
      {(el.references?.length ?? 0) > 0 && (
        <section className="kc-section">
          <div className="kc-label">参考实现</div>
          <div className="kc-refs">{el.references.join(" · ")}</div>
        </section>
      )}
    </div>
  );
}

function TreeView(props: {
  nodes: BlueprintNode[];
  ontology: Ontology;
  selected: string | null;
  expanded: Set<string>;
  editable: boolean;
  riskReport: RiskReport;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { nodes, ontology, selected, expanded, editable, riskReport, onSelect, onToggle, onRemove } = props;
  const unresolvedByElement = new Map<string, number>();
  const mitigateByElement = new Map<string, number>();
  for (const s of riskReport.statuses) {
    if (s.active && s.unresolved) {
      const introducers = ontology.elements.filter((e) => e.introduces.includes(s.riskId));
      for (const e of introducers) unresolvedByElement.set(e.id, (unresolvedByElement.get(e.id) ?? 0) + 1);
    }
    for (const elId of s.mitigatedBy) mitigateByElement.set(elId, (mitigateByElement.get(elId) ?? 0) + 1);
  }
  return (
    <div className="tree-children">
      {nodes.map((n) => (
        <TreeRow
          key={n.id}
          node={n}
          depth={0}
          ontology={ontology}
          selected={selected}
          expanded={expanded}
          editable={editable}
          unresolvedByElement={unresolvedByElement}
          mitigateByElement={mitigateByElement}
          onSelect={onSelect}
          onToggle={onToggle}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function TreeRow(props: {
  node: BlueprintNode;
  depth: number;
  ontology: Ontology;
  selected: string | null;
  expanded: Set<string>;
  editable: boolean;
  unresolvedByElement: Map<string, number>;
  mitigateByElement: Map<string, number>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { node, depth, ontology, selected, expanded, editable, unresolvedByElement, mitigateByElement, onSelect, onToggle, onRemove } = props;
  const el = elementById(ontology, node.ref);
  const open = expanded.has(node.id);
  const unresolved = unresolvedByElement.get(node.ref) ?? 0;
  const mitigated = mitigateByElement.get(node.ref) ?? 0;
  return (
    <div className="tree-row-group">
      <div className={`tree-row ${selected === node.id ? "selected" : ""}`} style={{ paddingLeft: depth * 18 + 8 }} onClick={() => onSelect(node.id)}>
        {node.children.length > 0 ? (
          <span className="tree-toggle" onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}>
            {open ? "▾" : "▸"}
          </span>
        ) : (
          <span className="tree-toggle leaf">·</span>
        )}
        <span className="tree-label">{nodeLabel(ontology, node)}</span>
        {unresolved > 0 && <span className="dot red" title={`引入 ${unresolved} 个未消解风险`} />}
        {mitigated > 0 && <span className="dot green" title={`消解 ${mitigated} 个风险`} />}
        {el?.allowMultiple && <span className="multi-badge" title="可多实例角色">×N</span>}
        {editable && (
          <span className="tree-remove" title="移除节点" onClick={(e) => { e.stopPropagation(); onRemove(node.id); }}>
            ×
          </span>
        )}
      </div>
      {open &&
        node.children.map((c) => (
          <TreeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            ontology={ontology}
            selected={selected}
            expanded={expanded}
            editable={editable}
            unresolvedByElement={unresolvedByElement}
            mitigateByElement={mitigateByElement}
            onSelect={onSelect}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        ))}
    </div>
  );
}

function Palette(props: {
  ontology: Ontology;
  family: RuntimeFamilyId;
  nodes: BlueprintNode[];
  selectedNode: BlueprintNode | null;
  editable: boolean;
  onAdd: (parentId: string | null, elementId: string, instanceName: string | null) => void;
}) {
  const { ontology, family, nodes, selectedNode, editable, onAdd } = props;
  const candidates = paletteFor(ontology, family, nodes, selectedNode?.id ?? null);
  const scope = selectedNode ? `「${nodeLabel(ontology, selectedNode)}」下` : "根级";
  return (
    <div className="palette card">
      <h3>可添加元素 — {scope}</h3>
      {selectedNode === null && <div className="hint">选中左侧节点后可添加其子元素；未选中时添加根级分区</div>}
      {candidates.length === 0 && <div className="empty">该节点为叶子（参数在下方详情编辑）</div>}
      {candidates.map((c) => (
        <div key={c.element.id} className={`palette-item ${c.available && editable ? "" : "disabled"}`}>
          <div className="palette-info">
            <div className="palette-name">
              {c.element.name}
              {c.element.required && <span className="req-badge">必选</span>}
              {c.element.extensionPoint && <span className="ext-badge" title="企业 Ontology 扩展点">扩展点</span>}
            </div>
            <div className="palette-desc">{c.element.description}</div>
            {c.reason && <div className="palette-reason">{c.reason}</div>}
          </div>
          <button className="btn small" disabled={!c.available || !editable} onClick={() => onAdd(selectedNode?.id ?? null, c.element.id, null)}>
            添加
          </button>
        </div>
      ))}
    </div>
  );
}

function Details(props: {
  ontology: Ontology;
  node: BlueprintNode | null;
  editable: boolean;
  onPatch: (id: string, patch: Partial<BlueprintNode>) => void;
  nodes: BlueprintNode[];
  relations: BlueprintRelation[];
  onAddRelation: (source: string, target: string, type: RelationType, description: string | null) => void;
  onRemoveRelation: (id: string) => void;
}) {
  const { ontology, node, editable, onPatch, nodes, relations, onAddRelation, onRemoveRelation } = props;
  if (!node) return <div className="details card"><h3>节点详情</h3><div className="empty">在左侧选择一个节点</div></div>;
  const el = elementById(ontology, node.ref);
  if (!el) return <div className="details card"><h3>节点详情</h3><div className="empty">未知元素 {node.ref}</div></div>;
  const mitigatedRisks = el.mitigates.map((r) => ontology.risks.find((x) => x.id === r)).filter(Boolean);
  const introducedRisks = el.introduces.map((r) => ontology.risks.find((x) => x.id === r)).filter(Boolean);
  return (
    <div className="details card knowledge-card">
      <h3>{el.name}</h3>

      <section className="kc-section">
        <div className="kc-label">定义</div>
        <p className="kc-def">{el.description}</p>
      </section>

      {(el.implementations?.length ?? 0) > 0 && (
        <section className="kc-section">
          <div className="kc-label">实现方式</div>
          {el.implementations!.map((impl) => (
            <div key={impl.name} className="kc-impl">
              <code>{impl.name}</code>
              <span>{impl.note}</span>
            </div>
          ))}
        </section>
      )}

      {(el.useCases?.length ?? 0) > 0 && (
        <section className="kc-section">
          <div className="kc-label">适用场景</div>
          <div className="kc-tags">
            {el.useCases!.map((u) => (
              <span key={u} className="chip">{u}</span>
            ))}
          </div>
        </section>
      )}

      {Object.entries(el.properties).length > 0 && (
        <section className="kc-section">
          <div className="kc-label">参数（MAY — 实现可调）</div>
          {Object.entries(el.properties).map(([key, schema]) => (
            <div className="form-row" key={key}>
              <label>
                {key}
                <span className="param-kind"> ({schema.kind})</span>
              </label>
              {schema.kind === "enum" ? (
                <select value={String(node.params[key])} onChange={(e) => onPatch(node.id, { params: { ...node.params, [key]: e.target.value } })} disabled={!editable}>
                  {schema.values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : schema.kind === "boolean" ? (
                <input
                  type="checkbox"
                  checked={Boolean(node.params[key])}
                  onChange={(e) => onPatch(node.id, { params: { ...node.params, [key]: e.target.checked } })}
                  disabled={!editable}
                />
              ) : schema.kind === "string" ? (
                <input
                  type="text"
                  value={String(node.params[key] ?? "")}
                  onChange={(e) => onPatch(node.id, { params: { ...node.params, [key]: e.target.value } })}
                  disabled={!editable}
                />
              ) : (
                <input
                  type="number"
                  value={Number(node.params[key])}
                  min={schema.min}
                  max={schema.max}
                  onChange={(e) => onPatch(node.id, { params: { ...node.params, [key]: Number(e.target.value) } })}
                  disabled={!editable}
                />
              )}
            </div>
          ))}
        </section>
      )}

      {((el.pros?.length ?? 0) > 0 || (el.cons?.length ?? 0) > 0) && (
        <section className="kc-section">
          <div className="kc-label">优缺点</div>
          <div className="kc-prose">
            {el.pros?.map((p) => (
              <div key={p} className="kc-pro">+ {p}</div>
            ))}
            {el.cons?.map((c) => (
              <div key={c} className="kc-con">− {c}</div>
            ))}
          </div>
        </section>
      )}

      {(el.commonIssues?.length ?? 0) > 0 && (
        <section className="kc-section">
          <div className="kc-label">常见问题</div>
          <ul className="kc-issues">
            {el.commonIssues!.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      )}

      {(mitigatedRisks.length > 0 || introducedRisks.length > 0) && (
        <section className="kc-section">
          <div className="kc-label">风险关联</div>
          <div className="risk-chips">
            {introducedRisks.map((r) => (
              <span key={r!.id} className="chip red" title={r!.description}>引入: {r!.name}</span>
            ))}
            {mitigatedRisks.map((r) => (
              <span key={r!.id} className="chip green" title={r!.description}>可消解: {r!.name}</span>
            ))}
          </div>
        </section>
      )}

      {(el.references?.length ?? 0) > 0 && (
        <section className="kc-section">
          <div className="kc-label">参考</div>
          <div className="kc-refs">{el.references.join(" · ")}</div>
        </section>
      )}

      <section className="kc-section">
        <div className="kc-label">设计决策（为什么选它，ADR）</div>
        {(() => {
          const enumKeys = Object.entries(el.properties).filter(([, s]) => s.kind === "enum");
          const dec = node.decision;
          return (
            <>
              {enumKeys.length > 0 && (
                <div className="form-row">
                  <label>决策对象（参数）</label>
                  <select
                    value={String(dec?.chosen ?? enumKeys[0][1].default)}
                    onChange={(e) => {
                      const chosen = e.target.value;
                      const key = enumKeys.find(([, s]) => (s as { values: string[] }).values.includes(chosen))?.[0] ?? enumKeys[0][0];
                      const values = (el.properties[key] as { values: string[] }).values;
                      onPatch(node.id, {
                        params: { ...node.params, [key]: chosen },
                        decision: {
                          chosen,
                          alternatives: dec?.alternatives ?? values.filter((v) => v !== chosen),
                          rejectedReason: dec?.rejectedReason ?? null,
                          tradeoffs: dec?.tradeoffs,
                        },
                      });
                    }}
                    disabled={!editable}
                  >
                    {enumKeys.flatMap(([key, s]) =>
                      (s as { values: string[] }).values.map((v) => (
                        <option key={`${key}=${v}`} value={v}>
                          {key} = {v}
                        </option>
                      )),
                    )}
                  </select>
                </div>
              )}
              {dec && (
                <>
                  <div className="form-row">
                    <label>已否决的替代方案（逗号分隔）</label>
                    <input
                      value={dec.alternatives.join(", ")}
                      onChange={(e) =>
                        onPatch(node.id, { decision: { ...dec, alternatives: e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) } })
                      }
                      disabled={!editable}
                    />
                  </div>
                  <div className="form-row">
                    <label>否决理由</label>
                    <input
                      value={dec.rejectedReason ?? ""}
                      placeholder="如：代码上下文不能丢"
                      onChange={(e) => onPatch(node.id, { decision: { ...dec, rejectedReason: e.target.value || null } })}
                      disabled={!editable}
                    />
                  </div>
                  <div className="form-row">
                    <label>架构权衡（Trade-off：选择了它，什么变好/什么变差）</label>
                    <div className="tradeoff-list">
                      {(dec.tradeoffs ?? []).map((t, i) => (
                        <div className="tradeoff-row" key={i}>
                          <select
                            value={t.impact}
                            disabled={!editable}
                            onChange={(e) => {
                              const tradeoffs = (dec.tradeoffs ?? []).map((x, j) => (j === i ? { ...x, impact: e.target.value as Tradeoff["impact"] } : x));
                              onPatch(node.id, { decision: { ...dec, tradeoffs } });
                            }}
                          >
                            <option value="positive">+ 变好</option>
                            <option value="negative">− 变差</option>
                            <option value="neutral">= 中性</option>
                          </select>
                          <input
                            value={t.aspect}
                            placeholder="维度（成本/延迟/复杂度…）"
                            disabled={!editable}
                            onChange={(e) => {
                              const tradeoffs = (dec.tradeoffs ?? []).map((x, j) => (j === i ? { ...x, aspect: e.target.value } : x));
                              onPatch(node.id, { decision: { ...dec, tradeoffs } });
                            }}
                          />
                          <input
                            value={t.note ?? ""}
                            placeholder="备注（可选）"
                            disabled={!editable}
                            onChange={(e) => {
                              const tradeoffs = (dec.tradeoffs ?? []).map((x, j) => (j === i ? { ...x, note: e.target.value || undefined } : x));
                              onPatch(node.id, { decision: { ...dec, tradeoffs } });
                            }}
                          />
                          {editable && (
                            <span className="tree-remove" title="移除" onClick={() => onPatch(node.id, { decision: { ...dec, tradeoffs: (dec.tradeoffs ?? []).filter((_, j) => j !== i) } })}>
                              ×
                            </span>
                          )}
                        </div>
                      ))}
                      {editable && (
                        <button
                          className="btn small"
                          onClick={() => onPatch(node.id, { decision: { ...dec, tradeoffs: [...(dec.tradeoffs ?? []), { aspect: "", impact: "negative" }] } })}
                        >
                          + 添加权衡项
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          );
        })()}
      </section>

      {(el.responsibilityTemplate || node.responsibility) && (
        <section className="kc-section">
          <div className="kc-label">职责边界（Responsibility）</div>
          {node.responsibility ? (
            <>
              <div className="form-row">
                <label>负责（owns，逗号分隔）</label>
                <input
                  value={node.responsibility.owns.join(", ")}
                  onChange={(e) =>
                    onPatch(node.id, {
                      responsibility: {
                        ...node.responsibility!,
                        owns: e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
                      },
                    })
                  }
                  disabled={!editable}
                />
              </div>
              <div className="form-row">
                <label>不负责（not，逗号分隔）</label>
                <input
                  value={node.responsibility.not.join(", ")}
                  onChange={(e) =>
                    onPatch(node.id, {
                      responsibility: {
                        ...node.responsibility!,
                        not: e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
                      },
                    })
                  }
                  disabled={!editable}
                />
              </div>
            </>
          ) : (
            <button
              className="btn small"
              disabled={!editable}
              onClick={() =>
                onPatch(node.id, {
                  responsibility: { owns: [...(el.responsibilityTemplate?.owns ?? [])], not: [...(el.responsibilityTemplate?.not ?? [])] },
                })
              }
            >
              从模板初始化职责边界
            </button>
          )}
        </section>
      )}

      {(el.contractTemplate || node.contract) && (
        <section className="kc-section">
          <div className="kc-label">组件契约（Contract：为什么连接 —— 接口与保证）</div>
          {node.contract ? (
            <>
              {(
                [
                  ["inputs", "消费（inputs，逗号分隔）"],
                  ["outputs", "产出（outputs，逗号分隔）"],
                  ["guarantees", "保证（guarantees，逗号分隔）"],
                ] as [keyof Contract, string][]
              ).map(([key, label]) => (
                <div className="form-row" key={key}>
                  <label>{label}</label>
                  <input
                    value={node.contract![key].join(", ")}
                    onChange={(e) =>
                      onPatch(node.id, {
                        contract: {
                          ...node.contract!,
                          [key]: e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
                        },
                      })
                    }
                    disabled={!editable}
                  />
                </div>
              ))}
            </>
          ) : (
            <button
              className="btn small"
              disabled={!editable}
              onClick={() =>
                onPatch(node.id, {
                  contract: {
                    inputs: [...(el.contractTemplate?.inputs ?? [])],
                    outputs: [...(el.contractTemplate?.outputs ?? [])],
                    guarantees: [...(el.contractTemplate?.guarantees ?? [])],
                  },
                })
              }
            >
              从模板初始化组件契约
            </button>
          )}
        </section>
      )}

      <section className="kc-section">
        <div className="kc-label">架构关系（Architecture Relations：树之外的图语义）</div>
        <RelationEditor
          ontology={ontology}
          node={node}
          nodes={nodes}
          relations={relations}
          editable={editable}
          onAdd={onAddRelation}
          onRemove={onRemoveRelation}
        />
      </section>

      <section className="kc-section">
        <div className="kc-label">设计理由（为什么选它）</div>
        <textarea
          rows={2}
          value={node.reason ?? ""}
          placeholder="写给评审人：为什么这里选择这个方案"
          onChange={(e) => onPatch(node.id, { reason: e.target.value || null })}
          disabled={!editable}
        />
      </section>

      {el.allowMultiple && (
        <div className="form-row">
          <label>实例名称</label>
          <input value={node.name ?? ""} onChange={(e) => onPatch(node.id, { name: e.target.value || null })} disabled={!editable} />
        </div>
      )}
      <div className="meta-line">
        <span>{el.namespace}</span>
        <span>v{el.version}</span>
      </div>
    </div>
  );
}

function RelationEditor(props: {
  ontology: Ontology;
  node: BlueprintNode;
  nodes: BlueprintNode[];
  relations: BlueprintRelation[];
  editable: boolean;
  onAdd: (source: string, target: string, type: RelationType, description: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const { ontology, node, nodes, relations, editable, onAdd, onRemove } = props;
  const [target, setTarget] = useState<string>("");
  const [type, setType] = useState<RelationType>("depends");
  const [desc, setDesc] = useState("");

  const flat: { id: string; label: string }[] = [];
  const walk = (list: BlueprintNode[], prefix: string) => {
    for (const n of list) {
      const label = nodeLabel(ontology, n);
      const path = prefix ? `${prefix} / ${label}` : label;
      flat.push({ id: n.id, label: path });
      walk(n.children, path);
    }
  };
  walk(nodes, "");
  const labelOf = (id: string) => flat.find((f) => f.id === id)?.label ?? id;

  const outgoing = relations.filter((r) => r.source === node.id);
  const incoming = relations.filter((r) => r.target === node.id);
  const candidates = flat.filter((f) => f.id !== node.id);

  return (
    <div className="relation-editor">
      {outgoing.length === 0 && incoming.length === 0 && <div className="empty">尚无架构关系（树表达分类，关系表达架构：谁控制谁、谁产出什么给谁）</div>}
      {outgoing.map((r) => (
        <div className="relation-row" key={r.id}>
          <span className="relation-dir out">出</span>
          <span className="relation-type" data-type={r.type}>
            {r.type}（{RELATION_TYPE_META[r.type]?.label}）
          </span>
          <span className="relation-arrow">→</span>
          <span className="relation-endpoint">{labelOf(r.target)}</span>
          {r.description && <span className="relation-desc">{r.description}</span>}
          {editable && (
            <span className="tree-remove" title="移除关系" onClick={() => onRemove(r.id)}>
              ×
            </span>
          )}
        </div>
      ))}
      {incoming.map((r) => (
        <div className="relation-row" key={r.id}>
          <span className="relation-dir in">入</span>
          <span className="relation-endpoint">{labelOf(r.source)}</span>
          <span className="relation-arrow">→</span>
          <span className="relation-type" data-type={r.type}>
            {r.type}（{RELATION_TYPE_META[r.type]?.label}）
          </span>
          <span className="relation-arrow">→ 本节点</span>
          {r.description && <span className="relation-desc">{r.description}</span>}
          {editable && (
            <span className="tree-remove" title="移除关系" onClick={() => onRemove(r.id)}>
              ×
            </span>
          )}
        </div>
      ))}
      {editable && candidates.length > 0 && (
        <div className="relation-add">
          <select value={type} onChange={(e) => setType(e.target.value as RelationType)} title="关系类型">
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}（{RELATION_TYPE_META[t]?.label}）— {RELATION_TYPE_META[t]?.description}
              </option>
            ))}
          </select>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">选择目标节点…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input value={desc} placeholder="说明（可选）" onChange={(e) => setDesc(e.target.value)} />
          <button
            className="btn small"
            disabled={!target}
            onClick={() => {
              onAdd(node.id, target, type, desc.trim() || null);
              setTarget("");
              setDesc("");
            }}
          >
            添加关系
          </button>
        </div>
      )}
    </div>
  );
}
