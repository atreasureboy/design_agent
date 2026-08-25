import { useMemo, useState } from "react";
import type { ArchitectureBrief, BlueprintNode, LintIssue, Ontology, RiskReport } from "@agent-arch/core";
import { analyzeDesignGuidance, evaluatePath } from "@agent-arch/core";

const split = (value: string) => value.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);

type DecisionOption = { value: string; label: string; description: string };
type DecisionDefinition = { id: string; elementId: string; param: string; title: string; question: string; why: string; options: DecisionOption[] };

const DECISIONS: DecisionDefinition[] = [
  { id: "autonomy", elementId: "agent-paradigm", param: "paradigm", title: "系统自治边界", question: "这个系统应该自主到什么程度？", why: "决定人工责任、审批门和故障兜底的强度。", options: [
    { value: "human-guided", label: "人工主导", description: "Agent 提建议，人决定关键步骤；适合高风险或早期验证。" },
    { value: "hybrid", label: "人机混合", description: "低风险步骤自动执行，高影响动作由人工把关。" },
    { value: "deliberative", label: "审慎规划", description: "执行前先形成计划并验证，适合复杂但边界明确的任务。" },
    { value: "autonomous", label: "高自治", description: "Agent 可持续规划和执行；必须有预算、监控和升级边界。" },
  ] },
  { id: "workflow", elementId: "workflow-pattern", param: "pattern", title: "任务组织方式", question: "请求进入系统后，任务怎样推进？", why: "决定吞吐、可解释性和失败恢复方式。", options: [
    { value: "sequential", label: "顺序流程", description: "步骤固定、容易审计，适合确定性流程。" },
    { value: "parallel", label: "并行处理", description: "独立任务同时执行，降低总耗时但增加汇总复杂度。" },
    { value: "event-driven", label: "事件驱动", description: "由事件推进状态，适合长任务、异步工具和恢复。" },
    { value: "dag", label: "DAG 编排", description: "依赖显式、可按拓扑执行，适合数据和批处理管线。" },
    { value: "hierarchical", label: "分层协作", description: "Supervisor 分解并委派，适合多 Agent 专业分工。" },
  ] },
  { id: "reasoning", elementId: "reasoning-paradigm", param: "strategy", title: "推理与执行策略", question: "Agent 遇到复杂任务时怎么思考和纠错？", why: "直接影响成功率、延迟、Token 成本和可验证性。", options: [
    { value: "react", label: "边想边做（ReAct）", description: "响应快、结构轻，适合短任务和工具调用。" },
    { value: "plan-and-execute", label: "先规划再执行", description: "先拆任务再逐项完成，适合工程和多步骤任务。" },
    { value: "reflexion", label: "失败后反思", description: "基于失败证据调整策略，适合研究和探索。" },
    { value: "verification-driven", label: "验证驱动", description: "每阶段由验证结果决定继续或返工，适合高正确性要求。" },
  ] },
  { id: "routing", elementId: "model-routing", param: "strategy", title: "模型选择策略", question: "不同任务应如何选择模型？", why: "决定能力上限、成本和延迟是否可控。", options: [
    { value: "static", label: "固定模型", description: "最简单稳定，适合任务类型单一的系统。" },
    { value: "capability-based", label: "按能力路由", description: "代码、视觉、长上下文等任务交给擅长模型。" },
    { value: "complexity-based", label: "按复杂度路由", description: "简单任务用轻模型，复杂任务升级强模型。" },
    { value: "cost-based", label: "成本优先", description: "在质量门槛内选择成本更低的模型。" },
    { value: "confidence-based", label: "按置信度升级", description: "低置信结果自动升级模型或转人工。" },
  ] },
  { id: "approval", elementId: "human-approval", param: "scope", title: "人工审批边界", question: "哪些动作必须由人确认？", why: "把抽象的“人在回路”落实成可执行控制点。", options: [
    { value: "destructive-ops", label: "仅破坏性操作", description: "删除、发布、外部写入等高影响动作需审批。" },
    { value: "cost-threshold", label: "超过成本阈值", description: "预计资源或模型成本超预算时暂停确认。" },
    { value: "all-writes", label: "所有写操作", description: "任何状态或数据变更都需确认，控制最严格。" },
  ] },
  { id: "evaluation", elementId: "eval-strategy", param: "strategy", title: "质量证明方式", question: "怎样证明架构修改没有让效果变差？", why: "没有持续评估，架构只能凭感觉迭代。", options: [
    { value: "golden-set", label: "黄金数据集", description: "用固定代表性样本做可重复回归测试。" },
    { value: "shadow", label: "影子评估", description: "新版本旁路运行，不影响真实用户。" },
    { value: "llm-judge", label: "LLM 裁判", description: "覆盖开放问题，但需要校准偏差和一致性。" },
    { value: "a-b", label: "A/B 实验", description: "用真实业务指标比较方案，反馈可靠但周期更长。" },
  ] },
];

function flatten(nodes: BlueprintNode[]): BlueprintNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

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
  onConfigureElement: (elementId: string, param: string, value: string, explanation: string) => void;
  onGoGraph: () => void;
  onGoEditor: () => void;
  onSave: () => void;
}) {
  const { ontology, brief, nodes, lint, riskReport, editable, dirty, onBriefChange, onAddElement, onConfigureElement, onGoGraph, onGoEditor, onSave } = props;
  const [activeDecisionId, setActiveDecisionId] = useState(DECISIONS[0].id);
  const guidance = useMemo(() => analyzeDesignGuidance(ontology, brief, nodes, lint), [ontology, brief, nodes, lint]);
  const { score, actions } = guidance;
  const path = useMemo(() => evaluatePath(ontology, nodes), [ontology, nodes]);
  const sensitive = brief.dataClassifications.some((value) => value === "confidential" || value === "restricted");
  const highAutonomy = brief.autonomyLevel === "bounded-autonomous" || brief.autonomyLevel === "autonomous";
  const flatNodes = useMemo(() => flatten(nodes), [nodes]);
  const decisions = useMemo(() => DECISIONS.flatMap((definition) => {
    const node = flatNodes.find((candidate) => candidate.ref === definition.elementId);
    return node ? [{ definition, node }] : [];
  }), [flatNodes]);
  const activeDecision = decisions.find(({ definition }) => definition.id === activeDecisionId) ?? decisions[0];
  const activeDecisionIndex = activeDecision ? decisions.findIndex(({ definition }) => definition.id === activeDecision.definition.id) : -1;
  const pendingDecisionCount = decisions.filter(({ node }) => node.decision === null).length;

  const patchList = (key: "businessOutcomes" | "stakeholders" | "useCases" | "constraints" | "acceptanceCriteria", value: string) => onBriefChange({ ...brief, [key]: split(value) });
  const next = actions[0];
  const heroTitle = pendingDecisionCount > 0 ? `还有 ${pendingDecisionCount} 个关键架构决策需要确认` : next ? next.title : "这份架构已具备评审基础";
  const heroReason = pendingDecisionCount > 0 ? "不用先读完整图谱。逐项确认下面的关键选择，系统会直接更新蓝图并记录决策依据。" : next ? next.reason : "关键设计上下文、核心执行层和治理条件已经覆盖。接下来检查图关系、契约与权衡记录。";

  return (
    <div className="coach-page">
      <section className="coach-hero">
        <div>
          <div className="coach-eyebrow">ARCHITECTURE COPILOT</div>
          <h1>{heroTitle}</h1>
          <p>{heroReason}</p>
          <div className="coach-hero-actions">
            {pendingDecisionCount > 0 && <button className="btn primary coach-primary" onClick={() => document.getElementById("coach-decisions")?.scrollIntoView({ behavior: "smooth" })}>开始确认关键决策</button>}
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
          {activeDecision && (
            <section className="coach-section coach-decisions" id="coach-decisions">
              <div className="coach-section-head"><div><span>01</span><h2>关键架构决策</h2></div><small>一次只处理一个问题 · {decisions.length - pendingDecisionCount}/{decisions.length} 已确认</small></div>
              <div className="decision-tabs">
                {decisions.map(({ definition, node }, index) => (
                  <button key={definition.id} className={`${activeDecision.definition.id === definition.id ? "active" : ""} ${node.decision ? "confirmed" : ""}`} onClick={() => setActiveDecisionId(definition.id)}>
                    <span>{node.decision ? "✓" : String(index + 1).padStart(2, "0")}</span>{definition.title}
                  </button>
                ))}
              </div>
              <div className="decision-focus">
                <div className="decision-question"><span>{activeDecision.definition.title}</span><h3>{activeDecision.definition.question}</h3><p>{activeDecision.definition.why}</p></div>
                <div className="decision-options">
                  {activeDecision.definition.options.map((option) => {
                    const current = String(activeDecision.node.params[activeDecision.definition.param]) === option.value;
                    return <button key={option.value} className={current ? "selected" : ""} disabled={!editable} onClick={() => onConfigureElement(activeDecision.definition.elementId, activeDecision.definition.param, option.value, `${activeDecision.definition.title}：${option.label}。${option.description}`)}><span className="decision-radio">{current ? "●" : "○"}</span><span><strong>{option.label}{current && <em>{activeDecision.node.decision ? "已确认" : "模板默认"}</em>}</strong><small>{option.description}</small></span></button>;
                  })}
                </div>
                <div className="decision-footer"><span>选择会同步修改组件参数，并写入 ADR 决策记录；保存前仍可更改。</span><div><button className="btn small" onClick={onGoGraph}>查看完整图谱</button>{activeDecisionIndex < decisions.length - 1 && <button className="btn small primary" onClick={() => setActiveDecisionId(decisions[activeDecisionIndex + 1].definition.id)}>下一个决策 →</button>}</div></div>
              </div>
            </section>
          )}

          <section className="coach-section">
            <div className="coach-section-head"><div><span>02</span><h2>下一步设计任务</h2></div><small>只列出当前场景的真实缺口</small></div>
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
            <div className="coach-section-head"><div><span>03</span><h2>设计前提</h2></div><small>用逗号或换行分隔多项</small></div>
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
