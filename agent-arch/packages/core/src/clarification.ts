import type { ClarificationAnswer, ClarificationQuestion, DesignSession } from "./types.js";

export const CLARIFICATION_ROUND_SIZE = 10;
export const FINALIZATION_UNDERSTANDING_THRESHOLD = 95;

export const CLARIFICATION_DIMENSIONS = [
  "目标与成功标准", "用户与使用场景", "单 Agent / 多 Agent 边界", "多 Agent 协作拓扑",
  "主 Agent 与子 Agent 权限", "任务拆分与并行策略", "模型与路由", "上下文与记忆",
  "工具、MCP 与外部系统", "数据与知识", "安全与隔离", "人工审批与自治程度",
  "失败恢复与幂等", "评测与质量门禁", "可观测性与审计", "性能、规模与成本",
  "部署与 Runtime", "演进、兼容与验收",
] as const;

export const CODING_AGENT_CLARIFICATION_PROTOCOL = `# AgentArch 架构需求澄清协议

你的职责是主导 Agent 系统架构设计，而不是等待用户自己画图。

## 每轮出题规则
1. 每轮必须发布恰好 10 道题，优先选择题，问题覆盖当前理解中影响最大的架构缺口。
2. 单选题和多选题使用 A/B/C/D 选项；D 默认必须是“其他（请补充）”且 custom=true。只有确实无法合理枚举时才使用填空题。
3. 问题应让非专家也能回答；选项描述要解释架构影响，避免只堆术语。
4. 不重复询问已确认事实。答案相互矛盾时，下一轮优先消解矛盾。
5. 每次读取 session_id（用户回复）.md 后，更新理解度、已确认事实和未决领域。理解度是对“能否无重大猜测地完成架构设计”的评估，不是答题完成率。
6. 理解度低于 95% 时继续发布下一轮 10 题；达到 95% 后停止追问并撰写架构.md。

## 架构.md要求
架构.md 是唯一最终产物，应至少说明：目标与边界、关键假设、Agent 角色、协作拓扑、主流程、上下文与记忆、工具与权限、数据、安全、可靠性、可观测性、评测、部署、成本、关键决策、风险与验收标准。不得把“见会话记录”作为设计内容的替代。
`;

function text(value: unknown, name: string, required = true): string {
  if (typeof value !== "string" || (required && value.trim() === "")) throw new Error(`${name} 必须是${required ? "非空" : ""}字符串`);
  return value.trim();
}

export function validateQuestionRound(input: unknown): ClarificationQuestion[] {
  if (!Array.isArray(input) || input.length !== CLARIFICATION_ROUND_SIZE) {
    throw new Error(`每轮必须恰好提交 ${CLARIFICATION_ROUND_SIZE} 道题`);
  }
  const ids = new Set<string>();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`第 ${index + 1} 题格式无效`);
    const value = raw as Record<string, unknown>;
    const id = text(value.id, `第 ${index + 1} 题 id`);
    if (ids.has(id)) throw new Error(`问题 id 重复：${id}`);
    ids.add(id);
    const kind = value.kind;
    if (kind !== "single-choice" && kind !== "multiple-choice" && kind !== "text") throw new Error(`第 ${index + 1} 题 kind 无效`);
    const options = kind === "text" ? [] : (() => {
      if (!Array.isArray(value.options) || value.options.length !== 4) throw new Error(`第 ${index + 1} 题必须有 A/B/C/D 四个选项`);
      const parsed = value.options.map((option, optionIndex) => {
        if (!option || typeof option !== "object") throw new Error(`第 ${index + 1} 题选项格式无效`);
        const item = option as Record<string, unknown>;
        return {
          id: text(item.id, "选项 id"),
          label: text(item.label, "选项 label"),
          ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim() } : {}),
          ...(item.custom === true ? { custom: true } : {}),
        };
      });
      if (parsed.map((option) => option.id).join("") !== "ABCD") throw new Error(`第 ${index + 1} 题选项 id 必须依次为 A/B/C/D`);
      if (!parsed[3].custom) throw new Error(`第 ${index + 1} 题 D 选项必须设置 custom=true`);
      return parsed;
    })();
    return {
      id,
      dimension: text(value.dimension, `第 ${index + 1} 题 dimension`),
      prompt: text(value.prompt, `第 ${index + 1} 题 prompt`),
      ...(typeof value.whyItMatters === "string" && value.whyItMatters.trim() ? { whyItMatters: value.whyItMatters.trim() } : {}),
      kind,
      options,
      required: value.required !== false,
    };
  });
}

export function validateAnswers(questions: ClarificationQuestion[], input: unknown): ClarificationAnswer[] {
  if (!Array.isArray(input)) throw new Error("answers 必须是数组");
  const byQuestion = new Map(input.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("答案格式无效");
    const item = raw as Record<string, unknown>;
    return [text(item.questionId, "questionId"), item] as const;
  }));
  return questions.map((question) => {
    const raw = byQuestion.get(question.id);
    if (!raw) throw new Error(`缺少问题 ${question.id} 的答案`);
    const selectedOptionIds = Array.isArray(raw.selectedOptionIds) ? raw.selectedOptionIds.map((item) => text(item, "selectedOptionId")) : [];
    const customText = typeof raw.customText === "string" ? raw.customText.trim() : "";
    if (question.kind === "text" && question.required && !customText) throw new Error(`问题 ${question.id} 必须填写`);
    if (question.kind !== "text") {
      if (question.required && selectedOptionIds.length === 0) throw new Error(`问题 ${question.id} 必须选择`);
      if (question.kind === "single-choice" && selectedOptionIds.length > 1) throw new Error(`问题 ${question.id} 只能单选`);
      if (selectedOptionIds.some((id) => !question.options.some((option) => option.id === id))) throw new Error(`问题 ${question.id} 包含无效选项`);
      if (selectedOptionIds.includes("D") && !customText) throw new Error(`问题 ${question.id} 选择 D 后必须补充说明`);
    }
    return { questionId: question.id, selectedOptionIds, customText, answeredAt: new Date().toISOString() };
  });
}

export function renderUserResponseMarkdown(session: DesignSession): string {
  const lines = [
    `# ${session.id} 用户回复`, "", "> 本文件由 AgentArch 自动生成，供 Coding Agent 持续理解需求。请勿把它当作最终架构设计。", "",
    "## 会话", "", `- 设计主题：${session.title}`, `- 初始诉求：${session.initialRequest || "未填写"}`, `- 当前理解度：${session.understandingPercent}%`, `- 状态：${session.status}`, `- 最后更新：${session.updatedAt}`, "",
    "## 已确认事实", "", ...(session.confirmedFacts.length ? session.confirmedFacts.map((item) => `- ${item}`) : ["- 暂无"]), "",
    "## 尚未确定", "", ...(session.unresolvedAreas.length ? session.unresolvedAreas.map((item) => `- ${item}`) : ["- 等待 Agent 评估"]), "",
  ];
  for (const round of session.rounds) {
    lines.push(`## 第 ${round.number} 轮：${round.focus}`, "");
    for (const [index, question] of round.questions.entries()) {
      const answer = round.answers.find((item) => item.questionId === question.id);
      const labels = answer?.selectedOptionIds.map((id) => question.options.find((option) => option.id === id)).filter(Boolean).map((option) => `${option!.id}. ${option!.label}`) ?? [];
      lines.push(`### ${index + 1}. ${question.prompt}`, "", `- 维度：${question.dimension}`, `- 用户选择：${labels.join("；") || (answer ? "未选择" : "等待回答")}`);
      if (answer?.customText) lines.push(`- 用户补充：${answer.customText}`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
