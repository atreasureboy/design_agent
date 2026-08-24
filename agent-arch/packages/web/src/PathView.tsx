import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { BlueprintNode, Ontology, PathStageStatus } from "@agent-arch/core";
import { elementById, evaluatePath } from "@agent-arch/core";

const STAGE_W = 240;
const STAGE_H = 64;
const LEAF_W = 168;
const LEAF_H = 46;
const H_GAP = 26;
const V_GAP = 110;

type StageData = { title: string; hint: string; covered: boolean; count: number } & Record<string, unknown>;
type StageNode = Node<StageData, "pStage">;
type LeafData = { label: string; instanceId: string } & Record<string, unknown>;
type LeafNode = Node<LeafData, "pLeaf">;
type CapData = { label: string } & Record<string, unknown>;
type CapNode = Node<CapData, "pCap">;

function StageBox({ data }: NodeProps<StageNode>) {
  return (
    <div className={`ptree-stage ${data.covered ? "ptree-stage-covered" : "ptree-stage-missing"}`}>
      <Handle type="target" position={Position.Top} style={{ visibility: "hidden" }} isConnectable={false} />
      <div className="ptree-stage-title">{data.title}</div>
      <div className="ptree-stage-hint">{data.hint}</div>
      <div className={`ptree-stage-tag ${data.covered ? "ok" : "miss"}`}>{data.covered ? `${data.count} 组件` : "未设计"}</div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: "hidden" }} isConnectable={false} />
    </div>
  );
}

function LeafBox({ data }: NodeProps<LeafNode>) {
  return (
    <div className="ptree-leaf" title={data.label}>
      <Handle type="target" position={Position.Top} style={{ visibility: "hidden" }} isConnectable={false} />
      {data.label}
      <Handle type="source" position={Position.Bottom} style={{ visibility: "hidden" }} isConnectable={false} />
    </div>
  );
}

function CapBox({ data }: NodeProps<CapNode>) {
  return <div className="ptree-cap">{data.label}</div>;
}

const nodeTypes = { pStage: StageBox, pLeaf: LeafBox, pCap: CapBox };

interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
}

/** 主链路布局：主干（输入→各阶段→输出）严格垂直居中一线；叶子从各自阶段横向扇出 */
function layout(stages: PathStageStatus[]): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = [];
  const unit = LEAF_W + H_GAP;
  const STAGE_LAYER = STAGE_H + 40;      // 阶段盒高 + 叶子层预留
  const LAYER = STAGE_H + 40 + LEAF_H + 46; // 阶段层 + 叶子层 + 层间距

  const maxLeaves = stages.reduce((m, s) => Math.max(m, s.instances.length), 0);
  const total = Math.max(maxLeaves, 1);
  const half = (total * unit) / 2;

  placed.push({ id: "cap-in", x: 0, y: 0, w: 140 });
  stages.forEach((s, i) => {
    const stageY = V_GAP + i * LAYER;
    placed.push({ id: `stage-${s.stage.id}`, x: 0, y: stageY, w: STAGE_W });
    const n = s.instances.length;
    s.instances.forEach((inst, j) => {
      placed.push({
        id: `leaf-${inst.id}`,
        x: (j - (n - 1) / 2) * unit,
        y: stageY + STAGE_LAYER,
        w: LEAF_W,
      });
    });
  });
  const outY = V_GAP + stages.length * LAYER + 30;
  placed.push({ id: "cap-out", x: 0, y: outY, w: 140 });
  return { placed, width: total * unit, height: outY + 80 };
}

export function PathView(props: {
  ontology: Ontology;
  nodes: BlueprintNode[];
  editable: boolean;
  onGoEdit: () => void;
  onPickNode?: (id: string) => void;
  onComplete?: (parentInstanceId: string | null, parentElementId: string | null, title: string) => void;
}) {
  const { ontology, nodes, editable, onGoEdit, onPickNode, onComplete } = props;
  const report = useMemo(() => evaluatePath(ontology, nodes), [ontology, nodes]);

  if (!report || nodes.length === 0) {
    return (
      <div className="graph-empty">
        <div className="empty">蓝图还是空的</div>
        <button className="btn" onClick={onGoEdit}>
          去编辑器搭建
        </button>
      </div>
    );
  }

  const { placed } = layout(report.stages);
  const posOf = new Map(placed.map((p) => [p.id, p]));

  const rfNodes: (StageNode | LeafNode | CapNode)[] = [];
  const rfEdges: Edge[] = [];

  const labelOf = (n: BlueprintNode) => n.name ?? elementById(ontology, n.ref)?.name ?? n.ref;

  rfNodes.push({ id: "cap-in", type: "pCap", position: { x: posOf.get("cap-in")!.x, y: 0 }, data: { label: "用户输入" } });
  report.stages.forEach((s, i) => {
    const stageId = `stage-${s.stage.id}`;
    const p = posOf.get(stageId)!;
    rfNodes.push({
      id: stageId,
      type: "pStage",
      position: { x: p.x - STAGE_W / 2, y: p.y },
      data: { title: s.stage.title, hint: s.stage.hint, covered: s.covered, count: s.instances.length },
    });
    const prev = i === 0 ? "cap-in" : `stage-${report.stages[i - 1].stage.id}`;
    rfEdges.push({
      id: `pe-${stageId}`,
      source: prev,
      target: stageId,
      type: "straight",
      style: { stroke: s.covered ? "#3fb950" : "#f85149", strokeWidth: 2.2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: s.covered ? "#3fb950" : "#f85149", width: 17, height: 17 },
    });
    if (i === 0) {
      rfEdges[rfEdges.length - 1] = {
        id: `pe-${stageId}`,
        source: "cap-in",
        target: stageId,
        type: "straight",
        style: { stroke: "#4f8ff7", strokeWidth: 2.4 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#4f8ff7", width: 18, height: 18 },
      };
    }
    for (const inst of s.instances) {
      const leafId = `leaf-${inst.id}`;
      const lp = posOf.get(leafId);
      if (!lp) continue;
      rfNodes.push({ id: leafId, type: "pLeaf", position: { x: lp.x - LEAF_W / 2, y: lp.y }, data: { label: labelOf(inst), instanceId: inst.id } });
      rfEdges.push({
        id: `le-${leafId}`,
        source: stageId,
        target: leafId,
        type: "default",
        style: { stroke: "#3fb950aa", strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#3fb950aa", width: 12, height: 12 },
      });
    }
  });
  const lastStage = report.stages[report.stages.length - 1];
  rfNodes.push({
    id: "cap-out",
    type: "pCap",
    position: { x: posOf.get("cap-out")!.x, y: posOf.get("cap-out")!.y },
    data: { label: "产出 / 交付" },
  });
  rfEdges.push({
    id: "pe-out",
    source: `stage-${lastStage.stage.id}`,
    target: "cap-out",
    type: "straight",
    style: { stroke: "#4f8ff7", strokeWidth: 2.4 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#4f8ff7", width: 18, height: 18 },
  });
  if (report.unassigned.length > 0) {
    rfNodes.push({
      id: "stage-unassigned",
      type: "pStage",
      position: { x: posOf.get("cap-out")!.x + 260, y: posOf.get("cap-out")!.y - 100 },
      data: { title: "· 其他（未归入主路径）", hint: "企业扩展等", covered: true, count: report.unassigned.length },
    });
    for (const inst of report.unassigned) {
      rfNodes.push({
        id: `leaf-${inst.id}`,
        type: "pLeaf",
        position: { x: posOf.get("cap-out")!.x + 340, y: posOf.get("cap-out")!.y - 60 + (report.unassigned.indexOf(inst)) * (LEAF_H + 10) },
        data: { label: labelOf(inst), instanceId: inst.id },
      });
    }
  }

  const coveredCount = report.stages.filter((s) => s.covered).length;

  return (
    <div className="path-page">
      <div className="path-header">
        <div className="path-header-title">{report.path.name} —— 阅读顺序</div>
        <div className="path-header-desc">
          {report.path.description} · 阶段覆盖 {coveredCount}/{report.stages.length}
          {report.unassigned.length > 0 && ` · 未归类 ${report.unassigned.length} 项`}
        </div>
      </div>
      <div className="path-canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={false}
          colorMode="dark"
          minZoom={0.15}
          maxZoom={1.6}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          proOptions={{ hideAttribution: false }}
          onNodeClick={(_, n) => {
            if (n.type === "pLeaf") {
              onPickNode?.((n.data as LeafData).instanceId);
            } else if (n.type === "pStage" && editable && onComplete) {
              const sid = n.id.replace("stage-", "");
              const s = report.stages.find((x) => x.stage.id === sid);
              if (!s) return;
              const parentInst = s.instances[0]?.id ?? null;
              const parentEl = s.instances.length > 0 ? s.stage.elementIds[0] : null;
              onComplete(parentInst, parentEl, `补全：${s.stage.title}`);
            }
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#21262d" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="path-hintbar">
        绿=已设计 / 红=未设计；点组件卡片跳转图谱定位{editable && "；点红色阶段卡片直接补全（可选方案）"}
      </div>
    </div>
  );
}
