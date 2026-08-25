import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BlueprintNode, BlueprintRelation, CoverageGap, InferredEdge, InferredKind, Ontology, RelationType, RiskReport, RuntimeFamilyId } from "@agent-arch/core";
import { computeCoverage, elementById, inferEdges, INFERRED_KIND_META, RELATION_TYPES, RELATION_TYPE_META, RELATION_TYPE_COLORS } from "@agent-arch/core";

const SECTION_COLORS: Record<string, string> = {
  harness: "#4f8ff7",
  "multi-agent": "#f78166",
  agents: "#a371f7",
  rag: "#3fb950",
  intelligence: "#39c5cf",
  hitl: "#f85149",
  governance: "#d29922",
  evaluation: "#db61a2",
  paradigm: "#8b949e",
  runtime: "#7ee787",
};

const NODE_W = 208;
const NODE_H = 58;
const GAP_X = 170;
const GAP_Y = 58;
const ROW = NODE_H + GAP_Y;
/** 子树行数超过该值视为"大子树"，兄弟大子树之间插入额外块间距（父层按子树规模拉开） */
const BIG_SUBTREE_ROWS = 3;
const SUBTREE_GAP = 1.2; // 额外空行数
const ROOT_GAP = 3; // 根分区之间的空行数（每个分区是独立大块，大幅拉开）

type ArchData = {
  label: string;
  color: string;
  badges: { decision: boolean; resp: boolean; contract: boolean };
  riskRed: number;
  riskGreen: number;
  selected: boolean;
  multi: boolean;
  root?: boolean;
  faded?: boolean;
  missing?: boolean;
} & Record<string, unknown>;
type ArchNodeT = Node<ArchData, "arch">;

function labelOf(ontology: Ontology, n: BlueprintNode): string {
  return n.name ?? elementById(ontology, n.ref)?.name ?? n.ref;
}

function sectionOf(ontology: Ontology, elementId: string): string {
  let cursor = elementById(ontology, elementId);
  while (cursor && cursor.parentId) cursor = elementById(ontology, cursor.parentId);
  return cursor?.id ?? elementId;
}

function flattenAll(nodes: BlueprintNode[]): BlueprintNode[] {
  const out: BlueprintNode[] = [];
  const walk = (list: BlueprintNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function findNode(nodes: BlueprintNode[], id: string): BlueprintNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findNode(node.children, id);
    if (nested) return nested;
  }
  return null;
}

/**
 * 分层布局：
 * 1. 每个根分区的子树独立布局成"纵带"（叶子按行槽，父按子树规模居中——父层间隔天然正比于子树规模）
 * 2. 各纵带自上而下排列，带间大幅留白
 * 3. 根节点单独放在最左列，按各自子树带的中心对齐（不是堆在顶部往下挤）
 */
function tidyLayout(roots: BlueprintNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const unit = ROW;

  const layoutSubtree = (n: BlueprintNode, depth: number, topSlot: number): { rows: number; centerY: number } => {
    if (n.children.length === 0) {
      pos.set(n.id, { x: depth * (NODE_W + GAP_X), y: topSlot * unit });
      return { rows: 1, centerY: topSlot * unit + NODE_H / 2 };
    }
    let cursor = topSlot;
    let rows = 0;
    const childCenters: number[] = [];
    n.children.forEach((c, i) => {
      const r = layoutSubtree(c, depth + 1, cursor);
      cursor += r.rows;
      rows += r.rows;
      childCenters.push(r.centerY);
      const isBig = r.rows >= BIG_SUBTREE_ROWS;
      if (isBig && i < n.children.length - 1) {
        cursor += SUBTREE_GAP;
        rows += SUBTREE_GAP;
      }
    });
    const centerY = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    pos.set(n.id, { x: depth * (NODE_W + GAP_X), y: centerY - NODE_H / 2 });
    return { rows, centerY };
  };

  let bandTop = 0;
  const rootPositions: { id: string; centerY: number }[] = [];
  for (const r of roots) {
    const { rows, centerY } = layoutSubtree(r, 0, bandTop);
    rootPositions.push({ id: r.id, centerY });
    bandTop += rows + ROOT_GAP;
  }

  // 根列：x=0，y 对齐各自子树中心（根之间天然隔开整个子树带的高度）
  for (const rp of rootPositions) {
    pos.set(rp.id, { x: 0, y: rp.centerY - NODE_H / 2 });
  }
  return pos;
}

function ArchNodeRenderer({ data }: NodeProps<ArchNodeT>) {
  const { color, badges, riskRed, riskGreen, selected, missing, root, faded } = data;
  return (
    <div className={`arch-node ${root ? "arch-node-root" : ""} ${selected ? "arch-node-selected" : ""} ${missing ? "arch-node-missing" : ""} ${faded ? "arch-node-faded" : ""}`} style={{ borderColor: missing ? "var(--red)" : color }}>
      <Handle type="target" position={Position.Left} style={{ background: missing ? "var(--red)" : color, width: 7, height: 7 }} isConnectableStart={false} />
      <div className="arch-node-label" style={{ color: missing ? "var(--red)" : color }}>
        {missing ? "○ " : ""}
        {data.label}
      </div>
      {root && <div className="arch-node-kicker">架构域</div>}
      {missing ? (
        <div className="arch-node-missing-tag">未设计</div>
      ) : (
        <div className="arch-node-badges">
          {badges.decision && <span className="arch-badge arch-badge-decision" title="已记录设计决策">●决策</span>}
          {badges.resp && <span className="arch-badge arch-badge-resp" title="已声明职责边界">■职责</span>}
          {badges.contract && <span className="arch-badge arch-badge-contract" title="已声明组件契约">◆契约</span>}
          {riskRed > 0 && <span className="arch-badge arch-badge-risk" title={`引入 ${riskRed} 个未消解风险`}>▲{riskRed}</span>}
          {riskGreen > 0 && <span className="arch-badge arch-badge-green" title={`消解 ${riskGreen} 个风险`}>✓{riskGreen}</span>}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: missing ? "var(--red)" : color, width: 7, height: 7 }} isConnectableStart />
    </div>
  );
}

const nodeTypes = { arch: ArchNodeRenderer };

export function ArchitectureGraph(props: {
  ontology: Ontology;
  nodes: BlueprintNode[];
  relations: BlueprintRelation[];
  riskReport: RiskReport;
  runtimeFamily: RuntimeFamilyId;
  editable: boolean;
  selectedId: string | null;
  onSelectNode: (id: string) => void;
  onAddRelation: (source: string, target: string, type: RelationType, description: string | null) => void;
  onRemoveRelation: (id: string) => void;
  onRemoveNode: (id: string) => void;
  onFlash: (msg: string) => void;
  onGoEdit?: () => void;
  onAddMissing?: (parentInstanceId: string | null, elementId: string) => void;
}) {
  const { ontology, nodes, relations, riskReport, runtimeFamily, editable, selectedId, onSelectNode, onAddRelation, onRemoveRelation, onRemoveNode, onFlash, onGoEdit, onAddMissing } = props;
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<ArchNodeT>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [pending, setPending] = useState<{ source: string; target: string } | null>(null);
  const [pendingType, setPendingType] = useState<RelationType>("depends");
  const [pendingDesc, setPendingDesc] = useState("");
  const [selectedRel, setSelectedRel] = useState<BlueprintRelation | null>(null);
  const [selectedInf, setSelectedInf] = useState<InferredEdge | null>(null);
  const [infType, setInfType] = useState<RelationType>("depends");
  const [relationMode, setRelationMode] = useState<"focus" | "all" | "hidden">("focus");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [layers, setLayers] = useState<Record<string, boolean>>({ infer: false, contract: false, risk: false, cover: false });
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [selectedGap, setSelectedGap] = useState<CoverageGap | null>(null);
  const rf = useRef<ReactFlowInstance<ArchNodeT, Edge> | null>(null);
  const lastFitKey = useRef("");

  const coverage = useMemo(() => computeCoverage(ontology, nodes, runtimeFamily).filter((g) => !dismissed.has(`gap-${g.parentInstanceId ?? "root"}-${g.element.id}`)), [ontology, nodes, runtimeFamily, dismissed]);

  const inferred = useMemo(
    () => inferEdges(ontology, nodes, relations).filter((e) => !dismissed.has(e.id)),
    [ontology, nodes, relations, dismissed],
  );
  const inferredByKey = useMemo(() => new Map(inferred.map((e) => [e.id, e])), [inferred]);
  const kindLayer: Record<InferredKind, string> = {
    requires: "infer",
    depends: "infer",
    suggests: "infer",
    mitigates: "risk",
    contract: "contract",
  };

  const structureKey = useMemo(() => flattenAll(nodes).map((n) => `${n.id}:${n.ref}:${n.decision ? 1 : 0}${n.responsibility ? 1 : 0}${n.contract ? 1 : 0}`).join("|"), [nodes]);
  const sectionsInUse = useMemo(() => new Set(flattenAll(nodes).map((node) => sectionOf(ontology, node.ref))), [ontology, nodes]);
  const selectedScopeIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const selected = findNode(nodes, selectedId);
    return new Set(selected ? flattenAll([selected]).map((node) => node.id) : [selectedId]);
  }, [nodes, selectedId]);
  const focusedRelations = useMemo(
    () => relations.filter((relation) => selectedScopeIds.has(relation.source) || selectedScopeIds.has(relation.target)),
    [relations, selectedScopeIds],
  );
  const selectedRootId = useMemo(
    () => nodes.find((root) => flattenAll([root]).some((node) => node.id === selectedId))?.id ?? null,
    [nodes, selectedId],
  );
  const rootDirectory = useMemo(
    () => nodes.map((root) => {
      const scope = new Set(flattenAll([root]).map((node) => node.id));
      return {
        node: root,
        count: scope.size - 1,
        relationCount: relations.filter((relation) => scope.has(relation.source) || scope.has(relation.target)).length,
        color: SECTION_COLORS[sectionOf(ontology, root.ref)] ?? "#8b949e",
      };
    }),
    [nodes, ontology, relations],
  );

  useEffect(() => {
    const flat = flattenAll(nodes);
    const byId = new Map(flat.map((n) => [n.id, n]));
    const pos = tidyLayout(nodes);
    const rootIds = new Set(nodes.map((node) => node.id));
    const focusIds = new Set<string>();
    if (selectedId) {
      const findPath = (list: BlueprintNode[], path: string[]): boolean => {
        for (const node of list) {
          const nextPath = [...path, node.id];
          if (node.id === selectedId) {
            nextPath.forEach((id) => focusIds.add(id));
            flattenAll([node]).forEach((item) => focusIds.add(item.id));
            return true;
          }
          if (findPath(node.children, nextPath)) {
            nextPath.forEach((id) => focusIds.add(id));
            return true;
          }
        }
        return false;
      };
      findPath(nodes, []);
      for (const relation of focusedRelations) {
        focusIds.add(relation.source);
        focusIds.add(relation.target);
      }
      for (const edge of inferred) {
        if (edge.source === selectedId || edge.target === selectedId) {
          focusIds.add(edge.source);
          focusIds.add(edge.target);
        }
      }
    }

    const unresolvedByElement = new Map<string, number>();
    const mitigateByElement = new Map<string, number>();
    for (const s of riskReport.statuses) {
      if (s.active && s.unresolved) {
        for (const e of ontology.elements.filter((x) => x.introduces.includes(s.riskId))) {
          unresolvedByElement.set(e.id, (unresolvedByElement.get(e.id) ?? 0) + 1);
        }
      }
      for (const elId of s.mitigatedBy) mitigateByElement.set(elId, (mitigateByElement.get(elId) ?? 0) + 1);
    }

    const nextNodes: ArchNodeT[] = flat.map((n) => {
      const el = elementById(ontology, n.ref);
      const color = SECTION_COLORS[sectionOf(ontology, n.ref)] ?? "#8b949e";
      return {
        id: n.id,
        type: "arch",
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        data: {
          label: labelOf(ontology, n),
          color,
          badges: { decision: n.decision !== null, resp: n.responsibility !== null, contract: n.contract != null },
          riskRed: el ? (unresolvedByElement.get(el.id) ?? 0) : 0,
          riskGreen: el ? (mitigateByElement.get(el.id) ?? 0) : 0,
          selected: selectedId === n.id,
          multi: el?.allowMultiple ?? false,
          root: rootIds.has(n.id),
          faded: selectedId !== null && !focusIds.has(n.id),
        },
      };
    });

    const treeEdges: Edge[] = [];
    const walkTree = (list: BlueprintNode[]) => {
      for (const n of list) {
        for (const c of n.children) {
          treeEdges.push({
            id: `tree-${c.id}`,
            source: n.id,
            target: c.id,
            type: "smoothstep",
            style: { stroke: "#3b4658", strokeWidth: 1.35, opacity: selectedId && (!focusIds.has(n.id) || !focusIds.has(c.id)) ? 0.14 : 0.72 },
          });
        }
        walkTree(n.children);
      }
    };
    walkTree(nodes);

    const visibleRelations = relations
      .filter((r) => byId.has(r.source) && byId.has(r.target))
      .filter((r) => relationMode === "all" || (relationMode === "focus" && focusedRelations.some((focused) => focused.id === r.id)));
    const relEdges: Edge[] = visibleRelations
      .map((r) => {
        const color = RELATION_TYPE_COLORS[r.type] ?? "#8b949e";
        const meta = RELATION_TYPE_META[r.type];
        const isSel = selectedRel?.id === r.id;
        const focused = relationMode === "focus";
        return {
          id: `rel-${r.id}`,
          source: r.source,
          target: r.target,
          type: "smoothstep",
          label: focused || isSel ? (meta?.label ?? r.type) : undefined,
          labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "#0d1117", fillOpacity: 0.92 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          style: { stroke: color, strokeWidth: isSel ? 3 : focused ? 2 : 1.15, strokeDasharray: "7 4", opacity: isSel ? 1 : focused ? 0.95 : 0.24 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: focused || isSel ? 16 : 11, height: focused || isSel ? 16 : 11 },
          zIndex: isSel ? 3 : focused ? 2 : 1,
        };
      });

    const infEdges: Edge[] = inferred
      .filter((e) => layers[kindLayer[e.kind]])
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => {
        const meta = INFERRED_KIND_META[e.kind];
        const isSel = selectedInf?.id === e.id;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "default",
          label: meta.label.split("（")[0],
          labelStyle: { fill: meta.color, fontSize: 9.5, fontWeight: 500 },
          labelBgStyle: { fill: "#0d1117", fillOpacity: 0.85 },
          labelBgPadding: [3, 2] as [number, number],
          labelBgBorderRadius: 4,
          style: { stroke: meta.color, strokeWidth: isSel ? 2.4 : 1, strokeDasharray: "2 6", opacity: selectedId && !focusIds.has(e.source) && !focusIds.has(e.target) ? 0.1 : isSel ? 1 : 0.42 },
          markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 11, height: 11 },
        };
      });

    const gapNodes: ArchNodeT[] = [];
    const gapEdges: Edge[] = [];
    if (layers.cover) {
      let maxDepth = 0;
      const depthOf = (list: BlueprintNode[], d: number) => {
        for (const n of list) {
          maxDepth = Math.max(maxDepth, d);
          depthOf(n.children, d + 1);
        }
      };
      depthOf(nodes, 0);
      const gapColX = (maxDepth + 1) * (NODE_W + GAP_X);
      const ordered = [...coverage].sort((a, b) => {
        const ay = a.parentInstanceId ? (pos.get(a.parentInstanceId)?.y ?? 0) : -1e9;
        const by = b.parentInstanceId ? (pos.get(b.parentInstanceId)?.y ?? 0) : -1e9;
        return ay - by;
      });
      ordered.forEach((gap, slot) => {
        const gapId = `gap-${gap.parentInstanceId ?? "root"}-${gap.element.id}`;
        if (gap.parentInstanceId) {
          gapEdges.push({
            id: `gape-${gapId}`,
            source: gap.parentInstanceId,
            target: gapId,
            type: "default",
            style: { stroke: "#f85149", strokeWidth: 1, strokeDasharray: "3 5", opacity: 0.5 },
          });
        }
        gapNodes.push({
          id: gapId,
          type: "arch",
          position: { x: gapColX, y: slot * ROW },
          data: {
            label: gap.element.name,
            color: "var(--red)",
            badges: { decision: false, resp: false, contract: false },
            riskRed: 0,
            riskGreen: 0,
            selected: selectedGap === gap,
            multi: false,
            faded: selectedId !== null && gap.parentInstanceId !== selectedId,
            missing: true,
          },
        });
      });
    }

    setRfNodes([...nextNodes, ...gapNodes]);
    setRfEdges([...treeEdges, ...relEdges, ...infEdges, ...gapEdges]);
    const fitKey = `${structureKey}|cover:${layers.cover ? 1 : 0}`;
    if (lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey;
      rf.current?.fitView({ padding: 0.18, duration: 300, maxZoom: 1.05 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, relations, relationMode, focusedRelations, selectedId, selectedRel, selectedInf, selectedGap, riskReport, inferred, layers, coverage]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!editable || !c.source || !c.target || c.source === c.target) return;
      if (!editable) return onFlash("当前状态不可编辑");
      setPending({ source: c.source, target: c.target });
      setPendingType("depends");
      setPendingDesc("");
    },
    [editable, onFlash],
  );

  const confirmRelation = () => {
    if (!pending) return;
    onAddRelation(pending.source, pending.target, pendingType, pendingDesc.trim() || null);
    setPending(null);
  };

  const jumpToRoot = (root: BlueprintNode) => {
    onSelectNode(root.id);
    setSelectedRel(null);
    setSelectedInf(null);
    setSelectedGap(null);
    const graphNode = rf.current?.getNode(root.id);
    if (!graphNode) return;
    rf.current?.setCenter(graphNode.position.x + NODE_W / 2, graphNode.position.y + NODE_H / 2, { zoom: 1, duration: 450 });
  };

  const labelById = (id: string) => {
    const find = (list: BlueprintNode[]): BlueprintNode | null => {
      for (const n of list) {
        if (n.id === id) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    const n = find(nodes);
    return n ? labelOf(ontology, n) : id;
  };

  if (nodes.length === 0) {
    return (
      <div className="graph-empty">
        <div className="empty">蓝图还是空的</div>
        <div className="hint">在编辑器从调色板添加元素，或从模板/导入创建架构后回到图谱</div>
        {onGoEdit && (
          <button className="btn" onClick={onGoEdit}>
            去编辑器搭建
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => {
          if (n.id.startsWith("gap-")) {
            const key = n.id.slice(4);
            const gap = coverage.find((g) => `${g.parentInstanceId ?? "root"}-${g.element.id}` === key) ?? null;
            setSelectedGap(gap);
            setSelectedRel(null);
            setSelectedInf(null);
            return;
          }
          onSelectNode(n.id);
        }}
        onEdgeClick={(_, e) => {
          if (e.id.startsWith("rel-")) {
            setSelectedRel(relations.find((r) => `rel-${r.id}` === e.id) ?? null);
            setSelectedInf(null);
          } else if (e.id.startsWith("inf-")) {
            const inf = inferredByKey.get(e.id) ?? null;
            setSelectedInf(inf);
            if (inf) setInfType(INFERRED_KIND_META[inf.kind].defaultType);
            setSelectedRel(null);
          } else {
            setSelectedRel(null);
            setSelectedInf(null);
          }
        }}
        onPaneClick={() => {
          setSelectedRel(null);
          setSelectedInf(null);
          setSelectedGap(null);
        }}
        onInit={(inst) => {
          rf.current = inst;
          inst.fitView({ padding: 0.18, maxZoom: 1.05 });
        }}
        colorMode="dark"
        minZoom={0.15}
        maxZoom={2.2}
        nodesConnectable={editable}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#21262d" />
        <Controls showInteractive={false} />
      </ReactFlow>

      <nav className={`graph-domain-nav ${navCollapsed ? "collapsed" : ""}`} aria-label="顶层架构域目录">
        <div className="graph-domain-nav-head">
          {!navCollapsed && (
            <div>
              <strong>架构域目录</strong>
              <span>{nodes.length} 个顶层域</span>
            </div>
          )}
          <button type="button" title={navCollapsed ? "展开架构域目录" : "收起架构域目录"} onClick={() => setNavCollapsed((value) => !value)}>
            {navCollapsed ? "目录 ›" : "‹"}
          </button>
        </div>
        {!navCollapsed && (
          <>
            <button
              type="button"
              className="graph-domain-overview"
              onClick={() => rf.current?.fitView({ padding: 0.18, duration: 450, maxZoom: 1.05 })}
            >
              <span>总览全部架构域</span>
              <small>{flattenAll(nodes).length} 节点</small>
            </button>
            <div className="graph-domain-nav-list">
              {rootDirectory.map(({ node, count, relationCount, color }, index) => (
                <button
                  key={node.id}
                  type="button"
                  className={selectedRootId === node.id ? "active" : ""}
                  onClick={() => jumpToRoot(node)}
                  title={`定位到 ${labelOf(ontology, node)}`}
                >
                  <span className="graph-domain-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="graph-domain-dot" style={{ background: color }} />
                  <span className="graph-domain-name">{labelOf(ontology, node)}</span>
                  <span className="graph-domain-meta">{count} 节点 · {relationCount} 关系</span>
                </button>
              ))}
            </div>
          </>
        )}
      </nav>

      <div className="graph-layers">
        <span className="graph-layers-label">架构接线</span>
        {(
          [
            ["focus", "聚焦接线", focusedRelations.length],
            ["all", "全部（降噪）", relations.length],
            ["hidden", "隐藏", 0],
          ] as ["focus" | "all" | "hidden", string, number][]
        ).map(([mode, label, count]) => (
          <button
            key={mode}
            type="button"
            className={`graph-layer-chip graph-mode-chip ${relationMode === mode ? "active" : ""}`}
            title={mode === "focus" ? "默认显示选中节点；选中父模块时显示整个子树的相关接线" : mode === "all" ? "显示全部显式关系；隐藏边标签并降低透明度" : "只查看架构分层结构"}
            onClick={() => {
              setRelationMode(mode);
              setSelectedRel(null);
            }}
          >
            {label}
            {mode !== "hidden" && <span className="graph-layer-count">{count}</span>}
          </button>
        ))}
        <span className="graph-layers-divider" />
        <span className="graph-layers-label">分析图层</span>
        {(
          [
            ["infer", "推断依赖（本体 requires/dependsOn/suggests 投影）"],
            ["contract", "契约匹配（产出→消费 术语对齐）"],
            ["risk", "风险消解（引入方→消解方）"],
            ["cover", "覆盖缺失（该设计而未设计的能力，红标提醒）"],
          ] as [string, string][]
        ).map(([key, title]) => (
          <label key={key} className="graph-layer-chip" title={title}>
            <input
              type="checkbox"
              checked={layers[key] ?? false}
              onChange={(e) => setLayers((prev) => ({ ...prev, [key]: e.target.checked }))}
            />
            {key === "infer" ? "推断依赖" : key === "contract" ? "契约匹配" : key === "risk" ? "风险消解" : "覆盖缺失"}
            <span className="graph-layer-count">{key === "cover" ? coverage.length : inferred.filter((x) => kindLayer[x.kind] === key).length}</span>
          </label>
        ))}
        {Object.values(layers).some(Boolean) && (
          <button className="graph-layer-reset" onClick={() => setLayers({ infer: false, contract: false, risk: false, cover: false })}>清空</button>
        )}
      </div>

      <div className="graph-legend">
        {Object.entries(SECTION_COLORS).filter(([id]) => sectionsInUse.has(id)).map(([id, color]) => {
          const el = elementById(ontology, id);
          if (!el) return null;
          return (
            <span key={id} className="graph-legend-item">
              <span className="graph-legend-dot" style={{ background: color }} />
              {el.name}
            </span>
          );
        })}
      </div>

      {editable && (
        <div className="graph-hint">点击节点聚焦直连接线 · 拖拽圆点创建关系</div>
      )}

      {pending && (
        <div className="graph-popover">
          <div className="graph-popover-title">
            创建架构关系：{labelById(pending.source)} → {labelById(pending.target)}
          </div>
          <select value={pendingType} onChange={(e) => setPendingType(e.target.value as RelationType)}>
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}（{RELATION_TYPE_META[t]?.label}）— {RELATION_TYPE_META[t]?.description}
              </option>
            ))}
          </select>
          <input value={pendingDesc} placeholder="说明（可选）" onChange={(e) => setPendingDesc(e.target.value)} />
          <div className="graph-popover-actions">
            <button className="btn primary small" onClick={confirmRelation}>
              添加
            </button>
            <button className="btn small" onClick={() => setPending(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      {selectedGap && (
        <div className="graph-popover">
          <div className="graph-popover-title" style={{ color: "var(--red)" }}>
            ○ 未设计：{selectedGap.element.name}
          </div>
          <div className="graph-popover-desc">{selectedGap.element.description}</div>
          {(selectedGap.element.commonIssues?.length ?? 0) > 0 && (
            <div className="graph-popover-desc">常见考量：{selectedGap.element.commonIssues![0]}</div>
          )}
          {(selectedGap.element.pros?.length ?? 0) > 0 && <div className="graph-popover-desc">价值：{selectedGap.element.pros![0]}</div>}
          <div className="graph-popover-actions">
            {editable && onAddMissing && (
              <button
                className="btn primary small"
                onClick={() => {
                  onAddMissing(selectedGap.parentInstanceId, selectedGap.element.id);
                  setSelectedGap(null);
                }}
              >
                一键添加该组件
              </button>
            )}
            <button
              className="btn small"
              onClick={() => {
                setDismissed((prev) => new Set([...prev, `gap-${selectedGap.parentInstanceId ?? "root"}-${selectedGap.element.id}`]));
                setSelectedGap(null);
              }}
            >
              忽略提醒
            </button>
            <button className="btn small" onClick={() => setSelectedGap(null)}>
              关闭
            </button>
          </div>
        </div>
      )}

      {selectedInf && (
        <div className="graph-popover">
          <div className="graph-popover-title">
            <span style={{ color: INFERRED_KIND_META[selectedInf.kind].color }}>◆ {INFERRED_KIND_META[selectedInf.kind].label}</span>
          </div>
          <div className="graph-popover-desc">
            {labelById(selectedInf.source)} → {labelById(selectedInf.target)}
            {selectedInf.term && `（匹配术语：${selectedInf.term}）`}
          </div>
          <div className="graph-popover-desc">{INFERRED_KIND_META[selectedInf.kind].description}—— 本体知识推断，非显式声明</div>
          {editable && (
            <>
              <select value={infType} onChange={(e) => setInfType(e.target.value as RelationType)}>
                {RELATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}（{RELATION_TYPE_META[t]?.label}）
                  </option>
                ))}
              </select>
              <div className="graph-popover-actions">
                <button
                  className="btn primary small"
                  onClick={() => {
                    onAddRelation(selectedInf.source, selectedInf.target, infType, `由${INFERRED_KIND_META[selectedInf.kind].label}固化`);
                    setSelectedInf(null);
                  }}
                >
                  固化为架构关系
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    setDismissed((prev) => new Set([...prev, selectedInf.id]));
                    setSelectedInf(null);
                  }}
                >
                  忽略此推断
                </button>
              </div>
            </>
          )}
          {!editable && (
            <div className="graph-popover-actions">
              <button className="btn small" onClick={() => setSelectedInf(null)}>
                关闭
              </button>
            </div>
          )}
        </div>
      )}

      {selectedRel && (
        <div className="graph-popover">
          <div className="graph-popover-title">
            <span className="relation-type" data-type={selectedRel.type}>
              {selectedRel.type}（{RELATION_TYPE_META[selectedRel.type]?.label}）
            </span>
            {labelById(selectedRel.source)} → {labelById(selectedRel.target)}
          </div>
          {selectedRel.description && <div className="graph-popover-desc">{selectedRel.description}</div>}
          <div className="graph-popover-actions">
            {editable && (
              <button
                className="btn danger small"
                onClick={() => {
                  onRemoveRelation(selectedRel.id);
                  setSelectedRel(null);
                }}
              >
                删除关系
              </button>
            )}
            <button className="btn small" onClick={() => setSelectedRel(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
