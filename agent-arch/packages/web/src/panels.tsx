import { useEffect, useState } from "react";
import type { BlueprintDiff, Comment, LintIssue, Ontology, RiskReport } from "@agent-arch/core";
import { elementById } from "@agent-arch/core";
import { api } from "./api.js";
import { mountTarget, nodeLabel } from "./Designer.js";
import type { BlueprintNode } from "@agent-arch/core";

const sevClass: Record<string, string> = { high: "sev-high", medium: "sev-medium", low: "sev-low" };

export function RiskPanel(props: {
  ontology: Ontology;
  report: RiskReport;
  nodes: BlueprintNode[];
  editable: boolean;
  onMount: (elementId: string) => void;
}) {
  const { ontology, report, nodes, editable, onMount } = props;
  const active = report.statuses.filter((s) => s.active);
  const [openRisk, setOpenRisk] = useState<string | null>(null);

  const canMount = (elementId: string) => {
    const { missing } = mountTarget(ontology, nodes, elementId);
    return missing.length === 0;
  };
  const missingText = (elementId: string) => {
    const { missing } = mountTarget(ontology, nodes, elementId);
    return missing.map((m) => elementById(ontology, m)?.name ?? m).join(" / ");
  };

  if (active.length === 0) return <div className="panel-inner"><div className="empty">当前架构无已激活的架构注记</div></div>;

  return (
    <div className="panel-inner">
      <div className="hint">Architecture Notes —— 设计过程中的常见考量与应对手段；仅在违反硬约束时才会阻断审批</div>
      {active.map((s) => {
        const risk = ontology.risks.find((r) => r.id === s.riskId)!;
        const open = openRisk === s.riskId;
        return (
          <div key={s.riskId} className={`risk-item ${s.unresolved ? sevClass[s.severity] : "sev-mitigated"}`}>
            <div className="risk-head" onClick={() => setOpenRisk(open ? null : s.riskId)}>
              <span className={`sev-badge ${sevClass[s.severity]}`}>{s.severity}</span>
              <span className="risk-name">{s.name}</span>
              <span className={`risk-state ${s.unresolved ? "unresolved" : "ok"}`}>{s.unresolved ? "待考量" : `已应对 ×${s.mitigatedBy.length}`}</span>
              <span className="tree-toggle">{open ? "▾" : "▸"}</span>
            </div>
            {open && (
              <div className="risk-body">
                <p>{risk.description}</p>
                <div className="risk-causes">成因: {risk.causes.join("；")}</div>
                <h5>应对手段</h5>
                {risk.mitigations.map((m) => {
                  const mounted = s.mitigatedBy.includes(m.elementId);
                  const el = elementById(ontology, m.elementId);
                  return (
                    <div key={m.elementId} className="mitigation-row">
                      <span className={`chip ${mounted ? "green" : ""}`}>{el?.name ?? m.elementId}</span>
                      <span className="mitigation-note">{m.note}（代价: {m.tradeoff}）</span>
                      {!mounted && editable && (
                        <button
                          className="btn small"
                          disabled={!canMount(m.elementId)}
                          title={canMount(m.elementId) ? "一键挂载该消解元素" : `需先添加所属分区: ${missingText(m.elementId)}`}
                          onClick={() => onMount(m.elementId)}
                        >
                          挂载
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LintPanel({ lint }: { lint: LintIssue[] }) {
  const groups: [string, LintIssue[]][] = [
    ["error", lint.filter((i) => i.severity === "error")],
    ["warning", lint.filter((i) => i.severity === "warning")],
    ["info", lint.filter((i) => i.severity === "info")],
  ];
  return (
    <div className="panel-inner">
      {groups.map(([sev, items]) =>
        items.length > 0 ? (
          <div key={sev} className={`lint-group lint-${sev}`}>
            <h4>{sev} ({items.length})</h4>
            {items.map((i, idx) => (
              <div key={idx} className="lint-item">
                <code>{i.code}</code> {i.message}
              </div>
            ))}
          </div>
        ) : null,
      )}
      {lint.length === 0 && <div className="empty">无校验问题</div>}
    </div>
  );
}

export function CommentsPanel(props: {
  comments: Comment[];
  setComments: (c: Comment[]) => void;
  blueprintId: string;
  user: string;
  selectedNode: BlueprintNode | null;
  ontology: Ontology;
  nodes: BlueprintNode[];
}) {
  const { comments, setComments, blueprintId, user, selectedNode, ontology, nodes } = props;
  const [text, setText] = useState("");
  const [filterNode, setFilterNode] = useState(false);
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    const c = await api.addComment(blueprintId, text.trim(), selectedNode?.id ?? null, user);
    setComments([...comments, c]);
    setText("");
  };

  const toggleResolve = async (cid: string) => {
    const updated = await api.toggleComment(blueprintId, cid);
    setComments(comments.map((c) => (c.id === cid ? updated : c)));
  };

  const shown = comments
    .filter((c) => !filterNode || c.nodeId === (selectedNode?.id ?? "__none__"))
    .filter((c) => !onlyUnresolved || !c.resolved);

  return (
    <div className="panel-inner">
      <div className="comments-filters">
        <label>
          <input type="checkbox" checked={filterNode} onChange={(e) => setFilterNode(e.target.checked)} /> 仅当前节点{selectedNode ? `（${nodeLabel(ontology, selectedNode)}）` : ""}
        </label>
        <label>
          <input type="checkbox" checked={onlyUnresolved} onChange={(e) => setOnlyUnresolved(e.target.checked)} /> 只看未解决（{comments.filter((c) => !c.resolved).length}）
        </label>
      </div>
      <div className="comment-input">
        <textarea rows={2} placeholder={selectedNode ? `对「${nodeLabel(ontology, selectedNode)}」的评审意见…` : "对整个蓝图的评审意见…"} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn primary" onClick={submit} disabled={!text.trim()}>
          发表（{user}）
        </button>
      </div>
      {shown.length === 0 && <div className="empty">暂无评论</div>}
      {shown
        .slice()
        .reverse()
        .map((c) => {
          const targetNode = c.nodeId ? findNodeById(nodes, c.nodeId) : null;
          const target = targetNode ? nodeLabel(ontology, targetNode) : null;
          return (
            <div key={c.id} className={`comment-item ${c.resolved ? "resolved" : ""}`}>
              <div className="comment-meta">
                <strong>{c.author}</strong>
                <span className="comment-time">{new Date(c.createdAt).toLocaleString()}</span>
                {target && <span className="comment-target">→ {target}</span>}
                <button className="btn small ghost" onClick={() => toggleResolve(c.id)}>
                  {c.resolved ? "✓ 已解决（重开）" : "标记解决"}
                </button>
              </div>
              <div className="comment-text">{c.text}</div>
            </div>
          );
        })}
    </div>
  );
}

function findNodeById(nodes: BlueprintNode[], id: string): BlueprintNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNodeById(n.children, id);
    if (hit) return hit;
  }
  return null;
}

export function DiagramPanel({ blueprintId, dirty }: { blueprintId: string; dirty: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.diagramSvg(blueprintId).then(setSvg);
  }, [blueprintId]);
  if (!svg) return <div className="panel-inner"><div className="empty">加载中…</div></div>;
  const download = () => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "blueprint.svg";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="panel-inner">
      {dirty && <div className="hint warn">有未保存的修改，图形基于最近保存的版本</div>}
      <div className="diagram-actions">
        <button
          className="btn small"
          onClick={() => {
            navigator.clipboard?.writeText(svg);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "已复制" : "复制 SVG"}
        </button>
        <button className="btn small" onClick={download}>下载 .svg</button>
      </div>
      <div className="diagram-box" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

export function DiffPanel({ blueprintId }: { blueprintId: string }) {  const [data, setData] = useState<{ diff: BlueprintDiff; fromVersion?: number; toVersion?: number; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.diff(blueprintId).then(setData).catch((e) => setError(String((e as Error).message)));
  }, [blueprintId]);
  if (error) return <div className="panel-inner"><div className="error">{error}</div></div>;
  if (!data) return <div className="panel-inner"><div className="empty">加载中…</div></div>;
  return (
    <div className="panel-inner">
      <div className="hint">最近一次保存的变更对比（结构性 = major 需重审；参数 = minor）</div>
      {data.note && <div className="empty">{data.note}</div>}
      <h4>结构性变更（structural · sv bump）{data.diff.structural.length === 0 ? " — 无" : ` (${data.diff.structural.length})`}</h4>
      {data.diff.structural.map((c, i) => (
        <div key={i} className={`diff-item ${c.type === "node-added" ? "added" : "removed"}`}>
          [{c.type === "node-added" ? "+" : "-"}] {c.path}
        </div>
      ))}
      <h4>参数变更（parameter · minor）{data.diff.parameter.length === 0 ? " — 无" : ` (${data.diff.parameter.length})`}</h4>
      {data.diff.parameter.map((c, i) => (
        <div key={i} className="diff-item changed">
          [~] {c.path}: {c.detail}
        </div>
      ))}
    </div>
  );
}

export function ExportPanel({ blueprintId, dirty }: { blueprintId: string; dirty: boolean }) {
  const [yaml, setYaml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.exportYaml(blueprintId).then(setYaml);
  }, [blueprintId]);
  if (!yaml) return <div className="panel-inner"><div className="empty">加载中…</div></div>;
  return (
    <div className="panel-inner">
      {dirty && <div className="hint warn">有未保存的修改，导出的是最近保存的版本</div>}
      <button
        className="btn small"
        onClick={() => {
          navigator.clipboard?.writeText(yaml);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "已复制" : "复制 YAML"}
      </button>
      <pre className="yaml-pre">{yaml}</pre>
    </div>
  );
}
