import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ontDir = join(here, "../ontology/core");

const elements = [];
for (const f of readdirSync(ontDir).filter((x) => x === "elements.json" || x.endsWith("-elements.json"))) {
  elements.push(...JSON.parse(readFileSync(join(ontDir, f), "utf8")));
}
const byId = new Map(elements.map((e) => [e.id, e]));
const extended = JSON.parse(readFileSync(join(ontDir, "extended-elements.json"), "utf8"));

const wave3 = [
  {
    id: "paradigm", namespace: "core", name: "范式层",
    description: "Agent 范式与工作流范式的显式声明：系统是什么形态、步骤怎么编排",
    parentId: null, allowMultiple: false, extensionPoint: true, runtimeFamilies: "any",
    properties: {}, mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: [] }, required: false,
    references: ["目录.md §1 Agent 基础范式"], version: "0.4.0",
    implementations: [{ name: "Agent 范式 + 工作流范式", note: "先定形态，再定编排" }],
    useCases: ["架构评审时显式化系统形态"],
    pros: ["形态假设显式可审", "编排选择有据"],
    cons: ["范式命名易起争议"],
    commonIssues: ["范式与实际实现漂移"],
    relations: { allowedSiblings: ["harness", "multi-agent", "agents"] },
  },
  {
    id: "agent-paradigm", namespace: "core", name: "Agent 范式",
    description: "Agent 的行为形态：反应式/审议式/自主/人在环/持久化",
    parentId: "paradigm", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: { paradigm: { kind: "enum", values: ["reactive", "deliberative", "hybrid", "autonomous", "human-guided", "persistent"], default: "hybrid" } },
    mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: [] }, required: false,
    references: ["目录.md §1.1 基础 Agent", "BDI 模型"], version: "0.4.0",
    implementations: [
      { name: "reactive", note: "刺激-响应，无内部规划" },
      { name: "deliberative", note: "先规划后行动" },
      { name: "hybrid", note: "反应+审议分层" },
      { name: "autonomous", note: "长期自主运行" },
      { name: "human-guided", note: "关键节点人在环" },
      { name: "persistent", note: "跨会话持久存在" },
    ],
    useCases: ["架构评审声明系统自主度", "合规场景声明人在环程度"],
    pros: ["自主度显式化", "与审批策略对齐"],
    cons: ["范式边界模糊"],
    commonIssues: ["声称自主实际处处要人批", "持久化带来状态治理负担"],
    alternatives: ["reactive（最简）", "deliberative（规划型）", "hybrid（默认推荐）", "human-guided（合规优先）"],
    relations: { allowedParents: ["paradigm"], allowedSiblings: ["workflow-pattern"] },
  },
  {
    id: "workflow-pattern", namespace: "core", name: "工作流范式",
    description: "步骤编排形态：顺序/并行/条件/循环/事件驱动/DAG/动态",
    parentId: "paradigm", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: { pattern: { kind: "enum", values: ["sequential", "parallel", "conditional", "loop", "event-driven", "dag", "dynamic", "hierarchical"], default: "sequential" } },
    mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: [] }, required: false,
    references: ["目录.md §1.3 Workflow 范式"], version: "0.4.0",
    implementations: [
      { name: "sequential", note: "固定顺序流水线" },
      { name: "parallel", note: "并行分支后汇聚" },
      { name: "dag", note: "有向无环图编排" },
      { name: "dynamic", note: "运行时决定下一步" },
    ],
    useCases: ["步骤固定的自动化", "需要显式依赖管理的编排"],
    pros: ["编排形态显式", "依赖可静态分析"],
    cons: ["动态工作流难预审"],
    commonIssues: ["循环无终止条件", "并行分支汇聚死等"],
    alternatives: ["sequential（最简）", "dag（依赖复杂时）", "dynamic（Agent 驱动）", "event-driven（异步解耦）"],
    relations: { allowedParents: ["paradigm"], allowedSiblings: ["agent-paradigm"] },
  },
  {
    id: "multi-model-voting", namespace: "core", name: "多模型投票",
    description: "多个模型独立作答后投票/择优，用冗余换正确率",
    parentId: "model-integration", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: ["hallucination"], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["cost-control"] }, required: false,
    references: ["Self-Consistency (Wang et al.)", "目录.md §2.5 Multi-Model Voting"], version: "0.4.0",
    implementations: [{ name: "多数投票", note: "N 路采样取多数" }, { name: "异构互验", note: "不同供应商模型互相验证" }],
    useCases: ["正确性极敏感的关键判断", "单模型不可信场景"],
    pros: ["正确率显著提升", "单模型偏差被稀释"],
    cons: ["成本 N 倍", "延迟取最慢者"],
    commonIssues: ["投票平局裁决", "同源模型偏差一致"],
    relations: { allowedParents: ["model-integration"], allowedSiblings: ["model-routing", "output-guard"] },
  },
  {
    id: "idempotency", namespace: "core", name: "幂等设计",
    description: "重试与重复投递安全的幂等机制：去重键/唯一标识/状态检查",
    parentId: "error-recovery", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: ["duplicate-execution"], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["retry-policy"] }, required: false,
    references: ["目录.md §23.1 Idempotency", "消息队列幂等消费实践"], version: "0.4.0",
    implementations: [{ name: "去重键", note: "请求唯一 ID + 已处理登记" }, { name: "状态前置检查", note: "执行前检查目标状态" }],
    useCases: ["有副作用的工具调用", "消息驱动架构"],
    pros: ["重试安全", "重复投递无害"],
    cons: ["去重存储成本", "键设计复杂"],
    commonIssues: ["去重窗口过短漏判", "键生成不稳定"],
    relations: { allowedParents: ["error-recovery"], allowedSiblings: ["retry-policy", "circuit-breaker"] },
  },
  {
    id: "rate-limit", namespace: "core", name: "限流",
    description: "对调用频率设上限，保护下游并抑制重试放大",
    parentId: "error-recovery", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: ["retry-storm"], introduces: [],
    constraints: { requires: [], forbids: [], suggests: [] }, required: false,
    references: ["目录.md §23.1 Rate Limit / Load Shedding"], version: "0.4.0",
    implementations: [{ name: "令牌桶", note: "平滑限流允许突发" }, { name: "并发窗口", note: "限制同时在途请求数" }],
    useCases: ["外部 API 有配额", "重试密集链路"],
    pros: ["下游保护", "成本可控"],
    cons: ["合法请求被拒", "阈值需实测"],
    commonIssues: ["限流触发后的退避策略缺失", "分布式限流口径不一"],
    relations: { allowedParents: ["error-recovery"], allowedSiblings: ["circuit-breaker", "retry-policy"] },
  },
  {
    id: "fault-diagnosis", namespace: "core", name: "故障诊断",
    description: "故障兜底链的诊断环节：错误分类、根因分析、状态检查",
    parentId: "error-recovery", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["trace"] }, required: false,
    references: ["目录.md §61 Diagnose"], version: "0.4.0",
    implementations: [{ name: "错误分类器", note: "按错误类型选择恢复策略" }, { name: "根因分析", note: "沿轨迹回溯首个异常点" }],
    useCases: ["恢复策略需要按因施策", "事故复盘自动化"],
    pros: ["恢复不再盲目重试", "复盘提速"],
    cons: ["分类体系维护成本"],
    commonIssues: ["错误分类粒度太粗", "诊断自身消耗上下文"],
    relations: { allowedParents: ["error-recovery"], allowedSiblings: ["fallback-strategy", "circuit-breaker"] },
  },
  {
    id: "data-masking", namespace: "core", name: "数据脱敏",
    description: "轨迹/日志/指标中的敏感信息脱敏后再落盘",
    parentId: "observability", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: ["secret-leakage"], introduces: [],
    constraints: { requires: [], forbids: [], suggests: [] }, required: false,
    references: ["目录.md §26 Security", "可观测数据合规实践"], version: "0.4.0",
    implementations: [{ name: "规则脱敏", note: "密钥/证件号等模式识别替换" }, { name: "字段白名单", note: "只记录白名单字段" }],
    useCases: ["观测数据合规要求", "跨团队共享轨迹"],
    pros: ["观测与合规兼得"],
    cons: ["过度脱敏影响排障", "规则漏判"],
    commonIssues: ["新型敏感信息漏脱", "脱敏后无法关联排查"],
    relations: { allowedParents: ["observability"], allowedSiblings: ["trace", "audit-log"] },
  },
  {
    id: "dead-letter-queue", namespace: "core", name: "死信队列",
    description: "无法投递/处理的消息进入死信队列留存，供人工检视与重放",
    parentId: "communication", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: [], introduces: [],
    constraints: { requires: ["message-bus"], forbids: [], suggests: [] }, required: false,
    references: ["目录.md §18 Dead Letter Queue", "消息中间件死信实践"], version: "0.4.0",
    implementations: [{ name: "死信留存 + 告警", note: "N 次失败转死信并通知" }],
    useCases: ["消息驱动的异步协作", "不允许静默丢消息的场景"],
    pros: ["消息不静默丢失", "可重放修复"],
    cons: ["死信积压治理成本"],
    commonIssues: ["死信无人处理变成垃圾场", "重放导致重复副作用"],
    relations: { allowedParents: ["communication"], allowedSiblings: ["message-bus"] },
  },
  {
    id: "skill-system", namespace: "core", name: "技能系统",
    description: "可复用技能包的注册、发现、组合与版本管理（比工具更高一级的能力单元）",
    parentId: "tool-system", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["procedural-memory"] }, required: false,
    references: ["目录.md §11 Skill System", "Voyager 技能库"], version: "0.4.0",
    implementations: [{ name: "技能注册表", note: "技能声明能力与前置条件" }, { name: "技能组合", note: "按任务拼装技能链" }],
    useCases: ["重复性任务流程沉淀", "跨任务能力复用"],
    pros: ["能力复用降本", "新任务冷启动快"],
    cons: ["技能库治理成本", "技能冲突"],
    commonIssues: ["技能与当前环境不匹配", "版本漂移"],
    relations: { allowedParents: ["tool-system"], allowedSiblings: ["tool-manager", "mcp-gateway"] },
  },
  {
    id: "identity-auth", namespace: "core", name: "身份与认证",
    description: "Agent/服务/工具的身份标识与认证：API Key / OAuth / mTLS / 服务账号",
    parentId: "governance", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["policy-engine"] }, required: false,
    references: ["目录.md §26.1 Identity / §26.2 Authentication"], version: "0.4.0",
    implementations: [{ name: "服务身份 + 短凭证", note: "每个 Agent/工具有独立身份，凭证短期有效" }],
    useCases: ["多 Agent 跨服务调用", "审计需要责任主体"],
    pros: ["责任可追溯到主体", "凭证泄露面收缩"],
    cons: ["身份体系接入成本"],
    commonIssues: ["共享凭证无法归因", "凭证轮换机制缺失"],
    relations: { allowedParents: ["governance"], allowedSiblings: ["policy-engine", "data-governance"] },
  },
  {
    id: "data-governance", namespace: "core", name: "数据治理",
    description: "数据分级、驻留与合规：什么数据能进什么上下文、存在哪里、保留多久",
    parentId: "governance", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["policy-engine"] }, required: false,
    references: ["目录.md §27 Data Policy / §28 Data Residency"], version: "0.4.0",
    implementations: [{ name: "数据分级标签", note: "按密级约束流向（上下文/存储/外发）" }],
    useCases: ["合规行业（金融/医疗）", "跨租户平台"],
    pros: ["合规可证明", "数据流向可控"],
    cons: ["分级打标成本", "过严拖慢业务"],
    commonIssues: ["分级口径不一", "驻留要求与云区域冲突"],
    relations: { allowedParents: ["governance"], allowedSiblings: ["policy-engine", "identity-auth"] },
  },
  {
    id: "performance-targets", namespace: "core", name: "性能目标",
    description: "架构级性能预算：延迟目标、吞吐、并发与冷启动约束",
    parentId: "governance", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["metrics"] }, required: false,
    references: ["目录.md §33 Performance Engineering"], version: "0.4.0",
    implementations: [{ name: "SLO 声明", note: "P95 延迟/吞吐写进架构决策" }],
    useCases: ["交互式 Agent（延迟敏感）", "批量任务（吞吐优先）"],
    pros: ["性能取舍有据", "回归有基线"],
    cons: ["目标拍定需实测"],
    commonIssues: ["目标与模型延迟现实冲突", "无实测支撑的目标"],
    relations: { allowedParents: ["governance"], allowedSiblings: ["cost-control", "scaling-strategy"] },
  },
  {
    id: "scaling-strategy", namespace: "core", name: "扩展策略",
    description: "规模增长的应对：水平/垂直/自动伸缩/分片",
    parentId: "governance", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: { strategy: { kind: "enum", values: ["horizontal", "vertical", "auto-scaling", "sharding"], default: "horizontal" } },
    mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: [] }, required: false,
    references: ["目录.md §34 Scalability"], version: "0.4.0",
    implementations: [{ name: "horizontal", note: "加实例" }, { name: "auto-scaling", note: "按负载弹性" }, { name: "sharding", note: "按租户/任务分片" }],
    useCases: ["多租户平台", "并发波动大"],
    pros: ["增长路径显式"],
    cons: ["分布式引入一致性复杂度"],
    commonIssues: ["扩容后状态同步问题", "分片键选择不均"],
    alternatives: ["horizontal（默认）", "auto-scaling（波动负载）", "sharding（多租户）"],
    relations: { allowedParents: ["governance"], allowedSiblings: ["performance-targets"] },
  },
  {
    id: "deployment-model", namespace: "core", name: "部署形态",
    description: "部署位置与形态决策：云/混合/本地/边缘（含数据驻留约束）",
    parentId: "governance", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: { model: { kind: "enum", values: ["cloud", "hybrid", "on-prem", "edge"], default: "cloud" } },
    mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["data-governance"] }, required: false,
    references: ["目录.md §35 Deployment"], version: "0.4.0",
    implementations: [{ name: "cloud", note: "全托管云" }, { name: "hybrid", note: "敏感数据本地 + 推理上云" }, { name: "on-prem", note: "全本地（含本地模型）" }],
    useCases: ["数据驻留合规", "内网隔离要求"],
    pros: ["合规边界清晰"],
    cons: ["本地部署运维成本"],
    commonIssues: ["混合部署的网络边界模糊", "本地模型能力差距"],
    alternatives: ["cloud（默认）", "hybrid（合规折中）", "on-prem（强隔离）"],
    relations: { allowedParents: ["governance"], allowedSiblings: ["data-governance"] },
  },
  {
    id: "confidence-gate", namespace: "core", name: "置信度门禁",
    description: "按置信度决定放行/升级/拒答：低置信不硬答",
    parentId: "intelligence", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: ["hallucination"], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["human-escalation"] }, required: false,
    references: ["目录.md §48 Confidence System"], version: "0.4.0",
    implementations: [{ name: "阈值升级", note: "低于阈值转人工或拒答" }, { name: "证据充分性检查", note: "无检索证据不生成断言" }],
    useCases: ["知识问答", "高风险决策辅助"],
    pros: ["无据幻觉显著减少", "用户信任提升"],
    cons: ["阈值难调", "过度拒答影响体验"],
    commonIssues: ["置信度估计本身不准", "阈值一刀切"],
    relations: { allowedParents: ["intelligence"], allowedSiblings: ["model-integration", "planning-system"] },
  },
  {
    id: "feedback-loop", namespace: "core", name: "反馈闭环",
    description: "行动→观察→评估→策略更新的持续改进闭环（含经验回放）",
    parentId: "intelligence", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: [], introduces: [],
    constraints: { requires: [], forbids: [], suggests: ["evaluation", "procedural-memory"] }, required: false,
    references: ["目录.md §45 Learning / §46 Feedback Loop"], version: "0.4.0",
    implementations: [{ name: "离线复盘", note: "失败案例离线分析更新策略" }, { name: "经验回放", note: "成功经验入库供检索复用" }],
    useCases: ["长期运行的 Agent 系统", "策略需要持续迭代"],
    pros: ["系统越用越好", "失败转化为资产"],
    cons: ["错误经验固化风险", "评估成本"],
    commonIssues: ["反馈信号噪声大", "策略更新未经验证即上线"],
    relations: { allowedParents: ["intelligence"], allowedSiblings: ["planning-system", "reasoning-paradigm"] },
  },
  {
    id: "knowledge-provenance", namespace: "core", name: "知识溯源",
    description: "答案的证据链：引用、出处、新鲜度与信任级别，无据可溯即标注",
    parentId: "rag", allowMultiple: false, extensionPoint: false, runtimeFamilies: "any",
    properties: {}, mitigates: ["hallucinated-citation"], introduces: [],
    constraints: { requires: ["rag-generation"], forbids: [], suggests: [] }, required: false,
    references: ["目录.md §49 Knowledge Provenance", "Grounded Generation"], version: "0.4.0",
    implementations: [{ name: "引用强制", note: "每个断言挂引用，无引用标注为推断" }, { name: "溯源元数据", note: "记录出处/时间/信任级" }],
    useCases: ["企业知识库问答", "合规审计场景"],
    pros: ["幻觉引用可拦截", "答案可审计"],
    cons: ["引用对齐成本", "溯源链过长影响可读性"],
    commonIssues: ["引用与断言不对齐", "陈旧来源未标注"],
    relations: { allowedParents: ["rag"], allowedSiblings: ["rag-generation", "rag-reranker"] },
  },
];

let added = 0;
for (const el of wave3) {
  if (!byId.has(el.id)) {
    extended.push(el);
    added += 1;
  }
}
writeFileSync(join(ontDir, "extended-elements.json"), JSON.stringify(extended, null, 2) + "\n");
console.log(`elements appended: ${added}`);

const patch = (id, fn) => {
  const e = byId.get(id);
  if (!e) throw new Error(`missing element ${id}`);
  fn(e);
};
const addI = (id, r) => patch(id, (e) => { if (!e.introduces.includes(r)) e.introduces.push(r); });
const addM = (id, r) => patch(id, (e) => { if (!e.mitigates.includes(r)) e.mitigates.push(r); });
addI("tool-system", "tool-hallucination");
addI("tool-system", "data-exfiltration");
addI("harness", "long-context-degradation");
addI("harness", "lost-in-the-middle");
addI("retry-policy", "duplicate-execution");
addI("observability", "secret-leakage");
addI("rag-generation", "hallucinated-citation");
addM("tool-manager", "tool-hallucination");
addM("context-compression", "long-context-degradation");
addM("context-compression", "lost-in-the-middle");
addM("sandboxing", "data-exfiltration");
addM("permission-policy", "data-exfiltration");
for (const file of ["elements.json", "rag-elements.json"]) {
  const p = join(ontDir, file);
  const list = JSON.parse(readFileSync(p, "utf8"));
  for (const el of list) {
    const updated = byId.get(el.id);
    if (updated) {
      el.introduces = updated.introduces;
      el.mitigates = updated.mitigates;
    }
  }
  writeFileSync(p, JSON.stringify(list, null, 2) + "\n");
}
console.log("element-side bindings patched");

const risks = JSON.parse(readFileSync(join(ontDir, "risks.json"), "utf8"));
const riskIds = new Set(risks.map((r) => r.id));
const newRisks = [
  { id: "tool-hallucination", name: "工具幻觉", severity: "medium", description: "模型调用不存在的工具或虚构参数，执行链中断或产生脏副作用", causes: ["工具清单未做注册校验", "参数 schema 校验缺失"], mitigations: [{ elementId: "tool-manager", note: "工具注册表 + 调用前 schema 强校验", tradeoff: "校验增加一跳延迟" }], references: ["目录.md §2.4 Tool Hallucination"] },
  { id: "long-context-degradation", name: "长上下文退化", severity: "medium", description: "上下文过长时模型注意力分散，指令遵循与召回质量下降", causes: ["上下文无限堆积", "未做压缩与分区"], mitigations: [{ elementId: "context-compression", note: "超阈值压缩历史，保持有效窗口", tradeoff: "压缩引入信息丢失风险" }], references: ["目录.md §2.4 Long Context Degradation"] },
  { id: "lost-in-the-middle", name: "中段信息丢失", severity: "medium", description: "长上下文中部内容被模型忽略，关键信息恰好位于中段时失效", causes: ["关键信息埋在长上下文中段"], mitigations: [{ elementId: "context-compression", note: "压缩缩短上下文，关键信息前置/后置", tradeoff: "压缩引入信息丢失风险" }], references: ["Lost in the Middle (Liu et al.)"] },
  { id: "duplicate-execution", name: "重复执行", severity: "medium", description: "重试或重复投递导致副作用重复发生（重复下单/重复写入）", causes: ["非幂等操作被重试", "消息重复投递"], mitigations: [{ elementId: "idempotency", note: "去重键/状态前置检查保证重试安全", tradeoff: "去重存储成本" }], references: ["目录.md §7.4 Duplicate Execution"] },
  { id: "secret-leakage", name: "敏感信息泄漏", severity: "medium", description: "密钥/隐私数据混入轨迹、日志或指标被持久化", causes: ["观测数据未脱敏", "工具输出含敏感信息直接留痕"], mitigations: [{ elementId: "data-masking", note: "落盘前规则脱敏/字段白名单", tradeoff: "过度脱敏影响排障" }], references: ["目录.md §26.5 Secret Leakage"] },
  { id: "hallucinated-citation", name: "幻觉引用", severity: "high", description: "生成内容附带不存在或不对齐的引用，企业知识库场景误导决策", causes: ["生成未强制证据对齐", "引用与断言分离生成"], mitigations: [{ elementId: "knowledge-provenance", note: "断言强制挂引用，无据标注为推断", tradeoff: "引用对齐成本" }], references: ["目录.md §14.7 Hallucinated Citation"] },
  { id: "data-exfiltration", name: "数据外泄", severity: "high", description: "Agent 经工具读取敏感数据后外发（网络请求/文件写出），造成泄漏", causes: ["工具可直接外发数据", "无最小权限与出口管控"], mitigations: [{ elementId: "sandboxing", note: "沙箱隔离工具执行与网络出口", tradeoff: "沙箱冷启动延迟" }, { elementId: "permission-policy", note: "按策略限定可读数据与外发边界", tradeoff: "策略维护成本" }], references: ["目录.md §26.5 Data Exfiltration"] },
];
for (const r of newRisks) if (!riskIds.has(r.id)) risks.push(r);
const addMit = (rid, elId, note, tradeoff) => {
  const r = risks.find((x) => x.id === rid);
  if (!r.mitigations.some((m) => m.elementId === elId)) r.mitigations.push({ elementId: elId, note, tradeoff });
};
addMit("hallucination", "multi-model-voting", "多模型独立作答投票，单模型幻觉被稀释", "成本 N 倍");
addMit("hallucination", "confidence-gate", "低置信拒答或升级，不硬答", "过度拒答影响体验");
addMit("retry-storm", "rate-limit", "限流抑制重试放大", "合法请求可能被拒");
writeFileSync(join(ontDir, "risks.json"), JSON.stringify(risks, null, 2) + "\n");
console.log("risks total =", risks.length);

const famFile = join(ontDir, "families.json");
const families = JSON.parse(readFileSync(famFile, "utf8"));
if (!families.some((f) => f.id === "dag-runtime")) {
  families.push({ id: "dag-runtime", name: "DAG 编排", description: "有向无环图任务编排：节点间依赖显式，按拓扑序执行", examples: ["Airflow 风格", "LangGraph DAG 模式"] });
}
if (!families.some((f) => f.id === "actor-runtime")) {
  families.push({ id: "actor-runtime", name: "Actor 模型", description: "Actor 并发模型：独立状态单元 + 消息传递，天然隔离", examples: ["Erlang/Akka 风格", "Orleans"] });
}
writeFileSync(famFile, JSON.stringify(families, null, 2) + "\n");
for (const id of ["state-management", "checkpoint", "session-persistence"]) {
  const e = byId.get(id);
  for (const f of ["dag-runtime", "actor-runtime"]) if (!e.runtimeFamilies.includes(f)) e.runtimeFamilies.push(f);
}
for (const file of ["elements.json"]) {
  const p = join(ontDir, file);
  const list = JSON.parse(readFileSync(p, "utf8"));
  for (const el of list) {
    const updated = byId.get(el.id);
    if (updated && Array.isArray(el.runtimeFamilies)) el.runtimeFamilies = updated.runtimeFamilies;
  }
  writeFileSync(p, JSON.stringify(list, null, 2) + "\n");
}
console.log("families total =", families.length);
