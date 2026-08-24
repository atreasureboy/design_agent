import type { ArchitectureBrief, BlueprintNode, LintIssue, Ontology } from "./types.js";
import { flattenNodes } from "./risk.js";

export interface DesignGuidanceAction {
  id: string;
  level: "critical" | "important" | "improve";
  title: string;
  reason: string;
  outcome: string;
  elementId?: string;
  kind: "brief" | "component" | "review";
}

export interface DesignGuidance {
  score: number;
  actions: DesignGuidanceAction[];
  metrics: { components: number; errors: number; warnings: number };
}

export function analyzeDesignGuidance(ontology: Ontology, brief: ArchitectureBrief, nodes: BlueprintNode[], lint: LintIssue[]): DesignGuidance {
  const flat = flattenNodes(nodes);
  const present = new Set(flat.map((node) => node.ref));
  const sensitive = brief.dataClassifications.some((value) => value === "confidential" || value === "restricted");
  const highAutonomy = brief.autonomyLevel === "bounded-autonomous" || brief.autonomyLevel === "autonomous";
  const multiAgentIntent = present.has("multi-agent") || [...brief.useCases, ...brief.constraints].some((value) => /多\s*agent|multi.?agent|协作|委派/i.test(value));
  const briefChecks = [brief.businessOutcomes.length > 0, brief.useCases.length > 0, brief.stakeholders.length > 0, brief.constraints.length > 0, brief.acceptanceCriteria.length > 0];
  const coreChecks = ["paradigm", "runtime", "intelligence", "harness", "agents"].map((id) => present.has(id));
  const contextualChecks = [!sensitive || present.has("data-governance"), !highAutonomy || present.has("human-approval") || present.has("human-escalation"), brief.nfr.monthlyBudget === null || present.has("cost-control"), present.has("evaluation")];
  const errors = lint.filter((issue) => issue.severity === "error");
  const warnings = lint.filter((issue) => issue.severity === "warning");
  const score = Math.round((briefChecks.filter(Boolean).length / briefChecks.length) * 30 + (coreChecks.filter(Boolean).length / coreChecks.length) * 40 + (contextualChecks.filter(Boolean).length / contextualChecks.length) * 20 + (errors.length === 0 ? 10 : Math.max(0, 10 - errors.length * 3)));
  const actions: DesignGuidanceAction[] = [];
  if (!brief.businessOutcomes.length || !brief.useCases.length) actions.push({ id: "brief-intent", level: "critical", kind: "brief", title: "先钉死目标与关键用例", reason: "没有业务目标和用例，组件选择无法判断是否过度设计。", outcome: "让后续建议从场景出发，而不是堆组件。" });
  if (!brief.acceptanceCriteria.length) actions.push({ id: "brief-acceptance", level: "important", kind: "brief", title: "定义架构验收标准", reason: "当前没有可用于评审的成功条件。", outcome: "实现团队能判断架构是否真正落地。" });
  const add = (id: string, level: DesignGuidanceAction["level"], title: string, reason: string, outcome: string) => {
    if (!present.has(id) && ontology.elements.some((element) => element.id === id)) actions.push({ id: `add-${id}`, level, kind: "component", title, reason, outcome, elementId: id });
  };
  add("paradigm", "critical", "明确 Agent / Workflow 范式", "系统形态尚未声明，后续拓扑与 Runtime 缺少决策基线。", "确定系统是反应式、规划式、工作流还是自治 Agent。");
  add("runtime", "important", "补齐运行时模型", "蓝图描述了能力，但没有说明调度、事件循环与工作者如何承载。", "把静态组件图变成可实现的执行架构。");
  add("harness", "critical", "建立执行框架边界", "上下文、工具、状态、恢复和观测尚无统一承载层。", "形成 Agent 系统稳定运行的工程骨架。");
  if (nodes.length > 0) add("evaluation", "important", "设计评估与验证闭环", "没有评估策略，架构无法证明质量提升或防止回归。", "让质量成为可测量、可发布的门禁。");
  if (sensitive) add("data-governance", "critical", "为敏感数据增加治理边界", `Brief 声明了 ${brief.dataClassifications.join(" / ")} 数据。`, "明确分类、驻留、脱敏与访问责任。");
  if (highAutonomy) add("human-approval", "critical", "为高自治操作增加人工控制", `自治程度为 ${brief.autonomyLevel}，需要明确不可越过的人工边界。`, "把高影响操作纳入审批或升级路径。");
  if (brief.nfr.monthlyBudget !== null) add("cost-control", "important", "让预算约束进入架构", `月度预算为 ${brief.nfr.monthlyBudget} ${brief.nfr.currency}，但尚无成本控制。`, "把 token、工具和模型成本变成可归因预算。");
  if (present.has("harness")) add("observability", "improve", "补齐可观测性", "架构已有执行框架，但缺少 trace、指标和审计视角。", "让故障和质量问题可定位。");
  if (multiAgentIntent) add("multi-agent", "important", "显式设计协作拓扑", "用例包含多 Agent 协作意图，但蓝图尚未声明通信、生命周期与拓扑。", "避免角色列表存在而协作协议缺失。");
  for (const issue of errors.slice(0, 2)) actions.push({ id: `lint-${issue.code}-${issue.nodeId}`, level: "critical", kind: "review", title: "修复阻断项", reason: issue.message, outcome: "恢复架构可审批状态。" });
  return { score, actions: actions.slice(0, 8), metrics: { components: flat.length, errors: errors.length, warnings: warnings.length } };
}
