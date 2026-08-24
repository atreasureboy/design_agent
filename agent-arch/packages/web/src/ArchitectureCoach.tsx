import { useMemo } from "react";
import type { ArchitectureBrief, BlueprintNode, LintIssue, Ontology, RiskReport } from "@agent-arch/core";
import { analyzeDesignGuidance, evaluatePath } from "@agent-arch/core";

const split = (value: string) => value.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);

export function ArchitectureCoach(props: {
  ontology: Ontology;
  brief: ArchitectureBrief;
  nodes: BlueprintNode[];
  lint: LintIssue[];
  riskReport: RiskReport;
  editable: boolean;
  dirty: boolean;
  onBriefChange: (brief: ArchitectureBrief) => void;
  onAddElement: (elementId: string) => void;
  onGoGraph: () => void;
  onGoEditor: () => void;
  onSave: () => void;
}) {
  const { ontology, brief, nodes, lint, riskReport, editable, dirty, onBriefChange, onAddElement, onGoGraph, onGoEditor, onSave } = props;
  const guidance = useMemo(() => analyzeDesignGuidance(ontology, brief, nodes, lint), [ontology, brief, nodes, lint]);
  const { score, actions } = guidance;
  const path = useMemo(() => evaluatePath(ontology, nodes), [ontology, nodes]);
  const sensitive = brief.dataClassifications.some((value) => value === "confidential" || value === "restricted");
  const highAutonomy = brief.autonomyLevel === "bounded-autonomous" || brief.autonomyLevel === "autonomous";

  const patchList = (key: "businessOutcomes" | "stakeholders" | "useCases" | "constraints" | "acceptanceCriteria", value: string) => onBriefChange({ ...brief, [key]: split(value) });
  const next = actions[0];

  return (
    <div className="coach-page">
      <section className="coach-hero">
        <div>
          <div className="coach-eyebrow">ARCHITECTURE COPILOT</div>
          <h1>{next ? next.title : "这份架构已具备评审基础"}</h1>
          <p>{next ? next.reason : "关键设计上下文、核心执行层和治理条件已经覆盖。接下来检查图关系、契约与权衡记录。"}</p>
          <div className="coach-hero-actions">
            {next?.kind === "component" && next.elementId && editable && <button className="btn primary coach-primary" onClick={() => onAddElement(next.elementId!)}>加入建议组件</button>}
            {next?.kind === "brief" && <button className="btn primary coach-primary" onClick={() => document.getElementById("coach-brief")?.scrollIntoView({ behavior: "smooth" })}>完善设计前提</button>}
            {next?.kind === "review" && <button className="btn primary coach-primary" onClick={onGoEditor}>查看阻断项</button>}
            <button className="btn ghost" onClick={onGoGraph}>查看架构图</button>
            {dirty && editable && <button className="btn" onClick={onSave}>保存当前修改</button>}
          </div>
        </div>
        <div className="coach-score" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{score}</strong><span>设计就绪度</span></div>
        </div>
      </section>

      <div className="coach-layout">
        <main className="coach-main">
          <section className="coach-section">
            <div className="coach-section-head"><div><span>01</span><h2>下一步设计任务</h2></div><small>按场景影响排序，不是通用组件清单</small></div>
            <div className="coach-actions">
              {actions.length === 0 && <div className="coach-done"><strong>✓ 没有明显缺口</strong><p>建议进入图谱检查组件关系，并为关键选择补全 ADR、契约和权衡。</p></div>}
              {actions.map((action, index) => (
                <article className={`coach-action coach-${action.level}`} key={action.id}>
                  <div className="coach-action-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="coach-action-body"><div className="coach-action-title"><span>{action.level === "critical" ? "关键" : action.level === "important" ? "建议" : "优化"}</span>{action.title}</div><p>{action.reason}</p><small>完成后：{action.outcome}</small></div>
                  <div className="coach-action-cta">
                    {action.kind === "component" && action.elementId && <button className="btn small primary" disabled={!editable} onClick={() => onAddElement(action.elementId!)}>一键加入</button>}
                    {action.kind === "brief" && <button className="btn small" onClick={() => document.getElementById("coach-brief")?.scrollIntoView({ behavior: "smooth" })}>去回答</button>}
                    {action.kind === "review" && <button className="btn small" onClick={onGoEditor}>去修复</button>}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="coach-section" id="coach-brief">
            <div className="coach-section-head"><div><span>02</span><h2>设计前提</h2></div><small>用逗号或换行分隔多项</small></div>
            <div className="coach-brief-form">
              <label className="wide">业务目标<textarea rows={2} placeholder="例：将知识检索响应时间降低 60%；回答必须可追溯" value={brief.businessOutcomes.join("，")} onChange={(e) => patchList("businessOutcomes", e.target.value)} disabled={!editable} /></label>
              <label className="wide">关键用例<textarea rows={2} placeholder="例：员工查询内部制度；法务复核高风险回答" value={brief.useCases.join("，")} onChange={(e) => patchList("useCases", e.target.value)} disabled={!editable} /></label>
              <label>利益相关者<input placeholder="业务方，安全，平台团队" value={brief.stakeholders.join("，")} onChange={(e) => patchList("stakeholders", e.target.value)} disabled={!editable} /></label>
              <label>硬约束<input placeholder="内网部署，不允许训练使用" value={brief.constraints.join("，")} onChange={(e) => patchList("constraints", e.target.value)} disabled={!editable} /></label>
              <label className="wide">验收标准<textarea rows={2} placeholder="例：引用正确率 ≥ 95%；高危操作 100% 人工审批" value={brief.acceptanceCriteria.join("，")} onChange={(e) => patchList("acceptanceCriteria", e.target.value)} disabled={!editable} /></label>
              <label>数据级别<select multiple value={brief.dataClassifications} onChange={(e) => onBriefChange({ ...brief, dataClassifications: Array.from(e.target.selectedOptions, (option) => option.value) as ArchitectureBrief["dataClassifications"] })} disabled={!editable}><option value="public">公开</option><option value="internal">内部</option><option value="confidential">机密</option><option value="restricted">受限</option></select></label>
              <label>自治程度<select value={brief.autonomyLevel} onChange={(e) => onBriefChange({ ...brief, autonomyLevel: e.target.value as ArchitectureBrief["autonomyLevel"] })} disabled={!editable}><option value="assistive">辅助建议</option><option value="supervised">全程监督</option><option value="bounded-autonomous">边界内自主</option><option value="autonomous">自主执行</option></select></label>
              <label>月度预算<div className="coach-inline"><input type="number" placeholder="未限定" value={brief.nfr.monthlyBudget ?? ""} onChange={(e) => onBriefChange({ ...brief, nfr: { ...brief.nfr, monthlyBudget: e.target.value ? Number(e.target.value) : null } })} disabled={!editable} /><input value={brief.nfr.currency} onChange={(e) => onBriefChange({ ...brief, nfr: { ...brief.nfr, currency: e.target.value } })} disabled={!editable} /></div></label>
              <label>P95 延迟目标（ms）<input type="number" placeholder="未限定" value={brief.nfr.latencyP95Ms ?? ""} onChange={(e) => onBriefChange({ ...brief, nfr: { ...brief.nfr, latencyP95Ms: e.target.value ? Number(e.target.value) : null } })} disabled={!editable} /></label>
            </div>
          </section>
        </main>

        <aside className="coach-aside">
          <section className="coach-side-card"><div className="coach-side-title">设计阶段</div>{path?.stages.map((stage) => <button key={stage.stage.id} className={`coach-stage ${stage.covered ? "covered" : ""}`} onClick={stage.covered ? onGoGraph : onGoEditor}><i /> <span><strong>{stage.stage.title.replace(/^\S+\s*/, "")}</strong><small>{stage.covered ? `${stage.instances.length} 个组件` : "尚未设计"}</small></span></button>)}</section>
          <section className="coach-side-card"><div className="coach-side-title">架构体检</div><div className="coach-metrics"><div><strong>{guidance.metrics.components}</strong><span>组件</span></div><div><strong>{guidance.metrics.errors}</strong><span>阻断</span></div><div><strong>{guidance.metrics.warnings}</strong><span>提醒</span></div><div><strong>{riskReport.statuses.filter((risk) => risk.active && risk.unresolved).length}</strong><span>风险注记</span></div></div><button className="btn coach-full" onClick={onGoEditor}>打开完整校验</button></section>
          <section className="coach-side-card coach-principle"><div className="coach-side-title">当前设计原则</div><p>{sensitive ? "敏感数据优先：先定义信任边界与数据治理，再扩展能力。" : highAutonomy ? "高自治优先：所有高影响动作必须有可验证边界和升级路径。" : "先形成最小可评审闭环，再按真实约束增加复杂度。"}</p></section>
        </aside>
      </div>
    </div>
  );
}
