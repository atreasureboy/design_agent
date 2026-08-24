import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { BlueprintNode, LoopReport, Ontology, RuntimeFamilyId } from "@agent-arch/core";
import { elementById, evaluateLoops } from "@agent-arch/core";

const R = 210;

type LoopStageData = {
  label: string;
  sub: string;
  covered: boolean;
} & Record<string, unknown>;
type LoopStageNode = Node<LoopStageData, "loopStage">;

function StageRenderer({ data }: NodeProps<LoopStageNode>) {
  const covered = data.covered;
  return (
    <div className={`loop-stage ${covered ? "loop-stage-covered" : "loop-stage-missing"}`}>
      <Handle type="target" position={Position.Bottom} style={{ visibility: "hidden" }} isConnectable={false} />
      <div className="loop-stage-label">{covered ? "" : "○ "}{data.label}</div>
      <div className="loop-stage-sub">{data.sub}</div>
      <div className="loop-stage-tag">{covered ? "已设计" : "未设计"}</div>
      <Handle type="source" position={Position.Top} style={{ visibility: "hidden" }} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { loopStage: StageRenderer };

export function LoopView(props: {
  ontology: Ontology;
  nodes: BlueprintNode[];
  runtimeFamily: RuntimeFamilyId;
  onGoEdit: () => void;
}) {
  const { ontology, nodes, runtimeFamily, onGoEdit } = props;
  const reports = useMemo<LoopReport[]>(() => evaluateLoops(ontology, nodes), [ontology, nodes]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (active >= reports.length) setActive(0);
  }, [reports.length, active]);

  if (reports.length === 0) {
    return (
      <div className="graph-empty">
        <div className="empty">本体未定义任何架构循环</div>
      </div>
    );
  }
  const report = reports[Math.min(active, reports.length - 1)];
  const count = report.stages.length;

  const rfNodes: LoopStageNode[] = report.stages.map((s, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const el = elementById(ontology, s.elementId);
    return {
      id: `stage-${s.elementId}`,
      type: "loopStage",
      position: { x: Math.cos(angle) * R, y: Math.sin(angle) * R },
      data: {
        label: s.label,
        sub: s.instance ? (s.instance.name ?? el?.name ?? s.elementId) : (el?.name ?? s.elementId),
        covered: s.instance !== null,
      },
    };
  });

  const rfEdges: Edge[] = report.stages.map((s, i) => {
    const next = report.stages[(i + 1) % count];
    return {
      id: `loop-edge-${i}`,
      source: `stage-${s.elementId}`,
      target: `stage-${next.elementId}`,
      type: "default",
      style: { stroke: s.instance && next.instance ? "#3fb950" : "#f8514966", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: s.instance && next.instance ? "#3fb950" : "#f8514966", width: 18, height: 18 },
    };
  });

  const coveredStages = report.stages.filter((s) => s.instance).length;

  return (
    <div className="loop-page">
      <div className="loop-tabs">
        {reports.map((r, i) => (
          <button key={r.loop.id} className={`tab ${i === active ? "active" : ""}`} onClick={() => setActive(i)}>
            {r.loop.name}（{Math.round(r.coverage * 100)}%）
          </button>
        ))}
      </div>
      <div className="loop-desc">
        {report.loop.description} —— 环节覆盖 {coveredStages}/{count}，绿色=已设计，红色=未设计（点击图谱视图红节点可一键补齐）
      </div>
      <div className="loop-canvas">
        <ReactFlow
          nodes={[...rfNodes, { id: "loop-center", type: "loopStage", position: { x: 0, y: -30 }, data: { label: report.loop.name, sub: `${Math.round(report.coverage * 100)}%`, covered: report.coverage === 1 }, draggable: false, selectable: false, connectable: false } as LoopStageNode]}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={false}
          edgesFocusable={false}
          colorMode="dark"
          minZoom={0.3}
          maxZoom={1.6}
          fitView
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#21262d" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <button className="btn loop-goto" onClick={onGoEdit}>
        去编辑器补齐缺失环节 →
      </button>
    </div>
  );
}
