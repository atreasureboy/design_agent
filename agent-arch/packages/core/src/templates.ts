import type { ArchTemplate, ArchTemplateId, BlueprintNode, BlueprintRelation, Ontology, OntologyElement, PropertyValue } from "./types.js";
import { elementById } from "./ontology.js";
import { makeRelation } from "./relations.js";

let counter = 0;
function nid(): string {
  counter += 1;
  return `tpl${Date.now().toString(36)}${counter.toString(36)}`;
}

function inst(element: OntologyElement, paramOverrides: Record<string, PropertyValue> = {}, instanceName?: string): BlueprintNode {
  const params: Record<string, PropertyValue> = {};
  for (const [k, s] of Object.entries(element.properties)) params[k] = s.default;
  return {
    id: nid(),
    ref: element.id,
    name: element.allowMultiple ? (instanceName ?? element.name) : null,
    params: { ...params, ...paramOverrides },
    reason: null,
    decision: null,
    responsibility: element.responsibilityTemplate
      ? { owns: [...element.responsibilityTemplate.owns], not: [...element.responsibilityTemplate.not] }
      : null,
    contract: element.contractTemplate
      ? { inputs: [...element.contractTemplate.inputs], outputs: [...element.contractTemplate.outputs], guarantees: [...element.contractTemplate.guarantees] }
      : null,
    children: [],
  };
}

export const ARCH_TEMPLATES: ArchTemplate[] = [
  { id: "blank", name: "自定义架构", description: "只创建设计空间与 Brief，由架构师从边界和主路径开始设计。", suggestedFamily: "event-driven", bestFor: ["创新形态", "迁移既有架构", "尚未确定范式"], includes: ["空白受约束画布", "完整架构助手"], considerations: ["自由度最高，但需要自行建立执行、治理和评估骨架"] },
  { id: "multi-agent", name: "多 Agent 协作系统", description: "可直接进入架构评审的 Supervisor-Worker 参考架构，覆盖执行、协作、恢复与治理闭环。", suggestedFamily: "event-driven", bestFor: ["复杂任务分解", "专业角色协作", "并行执行"], includes: ["Supervisor + Planner + 专业 Worker + Reviewer + Monitor", "事件循环、调度器与 Worker 生命周期", "消息总线、死信队列、角色记忆与委派预算", "上下文、工具、恢复、观测、HITL、治理与评估"], considerations: ["这是可删减的完整参考架构；评审时应按任务复杂度裁剪角色、通信和持久化能力"] },
  { id: "rag", name: "企业知识与 RAG", description: "可追溯知识问答参考架构，覆盖数据入库、检索生成、运行保障和数据治理。", suggestedFamily: "stateful-graph", bestFor: ["企业知识问答", "制度检索", "带引用生成"], includes: ["解析切分、Embedding、向量库、混合检索与 RRF", "重排、受约束生成、知识来源链", "检查点、失败恢复、链路观测与质量评估", "数据治理、身份策略与人工升级"], considerations: ["重点评审数据权限、知识新鲜度、召回率和引用正确性"] },
  { id: "coding-agent", name: "软件工程 Agent", description: "规划、编码、验证、评审和恢复完备的软件工程执行参考架构。", suggestedFamily: "event-driven", bestFor: ["代码修改", "仓库维护", "工程自动化"], includes: ["Plan-and-Execute 与失败重规划", "仓库上下文、MCP 工具、沙箱与权限策略", "测试验证门禁、Reviewer 与人工审批", "会话恢复、可观测性、成本治理与持续评估"], considerations: ["破坏性操作、测试可信度和长任务恢复必须显式设计"] },
  { id: "research-agent", name: "研究与情报 Agent", description: "问题分解、并行取证、交叉核验、证据综合和人工升级完备的研究参考架构。", suggestedFamily: "event-driven", bestFor: ["行业研究", "尽调", "证据综合"], includes: ["Reflexion、检索规划与失败重规划", "多来源工具、证据上下文与会话检查点", "Researcher + Reviewer + Monitor 分工", "来源审计、置信门、人工升级与质量评估"], considerations: ["必须控制来源质量、时效性、观点偏差和不可证实结论"] },
  { id: "data-agent", name: "数据分析 Agent", description: "查询规划、受控执行、结果验证、审批和成本归因完备的数据分析参考架构。", suggestedFamily: "event-driven", bestFor: ["自然语言查数", "指标分析", "数据运营"], includes: ["查询计划、SQL 执行与失败重规划", "身份、数据治理、最小权限和沙箱", "结果验证、Reviewer 与写操作审批", "查询追踪、成本归因、性能目标与质量评估"], considerations: ["重点评审数据权限、SQL 安全、指标口径和查询成本"] },
];

export interface TemplateInstance {
  nodes: BlueprintNode[];
  relations: BlueprintRelation[];
}

export function instantiateTemplate(ontology: Ontology, templateId: ArchTemplateId): TemplateInstance {
  const el = (id: string): OntologyElement => {
    const found = elementById(ontology, id);
    if (!found) throw new Error(`template element missing from ontology: ${id}`);
    return found;
  };
  const put = (parent: BlueprintNode | null, child: BlueprintNode): BlueprintNode => {
    if (parent) parent.children.push(child);
    return child;
  };

  if (templateId === "blank") return { nodes: [], relations: [] };

  if (templateId === "multi-agent") {
    const paradigm = inst(el("paradigm"));
    put(paradigm, inst(el("agent-paradigm"), { paradigm: "hybrid" }));
    put(paradigm, inst(el("workflow-pattern"), { pattern: "hierarchical" }));

    const runtime = inst(el("runtime"));
    const eventLoop = put(runtime, inst(el("event-loop")));
    const scheduler = put(runtime, inst(el("scheduler")));
    const workerManager = put(runtime, inst(el("worker-manager")));

    const harness = inst(el("harness"));
    put(harness, inst(el("agent-loop")));
    const ce = put(harness, inst(el("context-engineering")));
    put(ce, inst(el("context-assembly"), { allocation: "dynamic-budget" }));
    put(ce, inst(el("context-compression"), { strategy: "hierarchical", threshold: 80 }));
    put(ce, inst(el("context-isolation")));
    const contextGateway = put(ce, inst(el("context-gateway")));
    put(ce, inst(el("objective-anchor")));
    const state = put(harness, inst(el("state-management")));
    put(state, inst(el("checkpoint")));
    put(state, inst(el("session-persistence")));
    const tools = put(harness, inst(el("tool-system")));
    const toolManager = put(tools, inst(el("tool-manager")));
    const permission = put(tools, inst(el("permission-policy")));
    put(tools, inst(el("sandboxing")));
    put(tools, inst(el("mcp-gateway")));
    const recovery = put(harness, inst(el("error-recovery")));
    put(recovery, inst(el("timeout-guard"), { timeoutSeconds: 300 }));
    put(recovery, inst(el("retry-policy"), { maxRetries: 3 }));
    put(recovery, inst(el("circuit-breaker")));
    put(recovery, inst(el("fallback-strategy"), { fallbackAction: "degrade-task" }));
    const verification = put(harness, inst(el("verification-gate")));
    const observability = put(harness, inst(el("observability")));
    const trace = put(observability, inst(el("trace")));
    put(observability, inst(el("metrics")));
    put(observability, inst(el("audit-log")));

    const intelligence = inst(el("intelligence"));
    put(intelligence, inst(el("reasoning-paradigm"), { strategy: "plan-and-execute" }));
    const models = put(intelligence, inst(el("model-integration")));
    const routing = put(models, inst(el("model-routing"), { strategy: "capability-based" }));
    put(models, inst(el("output-guard"), { mode: "reject-retry" }));
    const planning = put(intelligence, inst(el("planning-system")));
    put(planning, inst(el("plan-validation")));
    put(planning, inst(el("replan-policy"), { trigger: "on-failure" }));
    const confidence = put(intelligence, inst(el("confidence-gate")));

    const ma = inst(el("multi-agent"));
    const topo = put(ma, inst(el("topology")));
    put(topo, inst(el("supervisor-worker")));
    const communication = put(ma, inst(el("communication")));
    const messageBus = put(communication, inst(el("message-bus")));
    put(communication, inst(el("dead-letter-queue")));
    const lifecycle = put(ma, inst(el("lifecycle")));
    const lifecycleManager = put(lifecycle, inst(el("lifecycle-manager")));
    put(lifecycle, inst(el("subagent-spawn")));
    put(lifecycle, inst(el("budget-caps"), { maxSubagents: 8, maxTurnsPerTask: 50 }));
    const memory = put(ma, inst(el("memory")));
    put(memory, inst(el("role-based-memory")));
    put(memory, inst(el("memory-consolidation")));

    const agents = inst(el("agents"));
    const supervisor = put(agents, inst(el("supervisor-role"), {}, "任务总控 Supervisor"));
    const planner = put(agents, inst(el("planner-role"), {}, "任务规划 Planner"));
    const knowledgeWorker = put(agents, inst(el("worker-role"), { specialty: "research" }, "知识与检索 Worker"));
    const executionWorker = put(agents, inst(el("worker-role"), { specialty: "generic" }, "工具执行 Worker"));
    const reviewer = put(agents, inst(el("reviewer-role"), {}, "结果评审 Reviewer"));
    const monitor = put(agents, inst(el("monitor-role"), {}, "运行监控 Monitor"));

    const hitl = inst(el("hitl"));
    const approval = put(hitl, inst(el("human-approval"), { scope: "destructive-ops" }));
    const escalation = put(hitl, inst(el("human-escalation")));

    const governance = inst(el("governance"));
    const policy = put(governance, inst(el("policy-engine")));
    put(governance, inst(el("identity-auth")));
    const cost = put(governance, inst(el("cost-control")));
    put(governance, inst(el("performance-targets")));

    const evaluation = inst(el("evaluation"));
    const evalStrategy = put(evaluation, inst(el("eval-strategy"), { strategy: "golden-set" }));

    const relations = [
      makeRelation(supervisor.id, planner.id, "controls", "Supervisor 派发规划任务"),
      makeRelation(planner.id, knowledgeWorker.id, "produces", "Planner 产出检索与分析子任务"),
      makeRelation(planner.id, executionWorker.id, "produces", "Planner 产出工具执行子任务"),
      makeRelation(supervisor.id, messageBus.id, "publishes", "Supervisor 通过消息总线派发任务"),
      makeRelation(knowledgeWorker.id, messageBus.id, "communicates", "专业 Worker 通过受控信道协作"),
      makeRelation(executionWorker.id, toolManager.id, "uses", "执行 Worker 通过工具管理器调用外部能力"),
      makeRelation(contextGateway.id, knowledgeWorker.id, "controls", "上下文网关按角色裁剪知识上下文"),
      makeRelation(lifecycleManager.id, workerManager.id, "controls", "生命周期管理器控制 Worker 创建、取消与回收"),
      makeRelation(scheduler.id, executionWorker.id, "routes", "调度器按能力与负载路由执行任务"),
      makeRelation(eventLoop.id, scheduler.id, "calls", "事件循环驱动调度决策"),
      makeRelation(permission.id, toolManager.id, "controls", "策略约束工具权限和调用边界"),
      makeRelation(reviewer.id, knowledgeWorker.id, "consumes", "Reviewer 复核知识 Worker 证据与结论"),
      makeRelation(verification.id, reviewer.id, "controls", "验证门禁阻断未经复核的最终结果"),
      makeRelation(monitor.id, trace.id, "reads", "Monitor 读取分布式追踪定位协作异常"),
      makeRelation(trace.id, supervisor.id, "observes", "全链路追踪观察任务分解与汇总"),
      makeRelation(policy.id, approval.id, "controls", "策略命中高风险动作时进入人工审批"),
      makeRelation(confidence.id, escalation.id, "routes", "低置信或冲突结果升级给人工"),
      makeRelation(cost.id, routing.id, "observes", "成本治理观察模型路由和委派开销"),
      makeRelation(evalStrategy.id, verification.id, "observes", "离线评估持续校准验证门禁"),
    ];
    return { nodes: [paradigm, runtime, intelligence, harness, ma, agents, hitl, governance, evaluation], relations };
  }

  if (templateId === "coding-agent") {
    const paradigm = inst(el("paradigm"));
    put(paradigm, inst(el("agent-paradigm"), { paradigm: "human-guided" }));
    put(paradigm, inst(el("workflow-pattern"), { pattern: "loop" }));
    const runtime = inst(el("runtime"));
    const eventLoop = put(runtime, inst(el("event-loop")));
    const scheduler = put(runtime, inst(el("scheduler")));
    put(runtime, inst(el("worker-manager")));

    const harness = inst(el("harness"));
    put(harness, inst(el("agent-loop")));
    const ce = put(harness, inst(el("context-engineering")));
    put(ce, inst(el("context-assembly"), { allocation: "priority-preempt" }));
    put(ce, inst(el("context-compression"), { strategy: "hierarchical", threshold: 85 }));
    put(ce, inst(el("context-isolation")));
    const ts = put(harness, inst(el("tool-system")));
    const toolManager = put(ts, inst(el("tool-manager")));
    put(ts, inst(el("sandboxing")));
    const permission = put(ts, inst(el("permission-policy")));
    put(ts, inst(el("mcp-gateway")));
    const state = put(harness, inst(el("state-management")));
    put(state, inst(el("checkpoint")));
    put(state, inst(el("session-persistence")));
    const er = put(harness, inst(el("error-recovery")));
    put(er, inst(el("timeout-guard"), { timeoutSeconds: 900 }));
    put(er, inst(el("retry-policy"), { maxRetries: 2 }));
    put(er, inst(el("fallback-strategy"), { fallbackAction: "abort" }));
    put(er, inst(el("fault-diagnosis")));
    const gate = put(harness, inst(el("verification-gate")));
    const obs = put(harness, inst(el("observability")));
    const trace = put(obs, inst(el("trace")));
    put(obs, inst(el("metrics")));
    put(obs, inst(el("audit-log")));

    const intel = inst(el("intelligence"));
    put(intel, inst(el("reasoning-paradigm"), { strategy: "plan-and-execute" }));
    const models = put(intel, inst(el("model-integration")));
    const routing = put(models, inst(el("model-routing"), { strategy: "complexity-based" }));
    put(models, inst(el("output-guard"), { mode: "reject-retry" }));
    const ps = put(intel, inst(el("planning-system")));
    put(ps, inst(el("plan-validation")));
    put(ps, inst(el("replan-policy"), { trigger: "on-failure" }));

    const hitl = inst(el("hitl"));
    const approval = put(hitl, inst(el("human-approval"), { scope: "destructive-ops" }));
    const escalation = put(hitl, inst(el("human-escalation")));

    const agents = inst(el("agents"));
    const planner = put(agents, inst(el("planner-role"), {}, "变更规划 Planner"));
    const worker = put(agents, inst(el("worker-role"), { specialty: "coding" }, "代码实现 Worker"));
    const reviewer = put(agents, inst(el("reviewer-role"), {}, "代码评审 Reviewer"));
    const monitor = put(agents, inst(el("monitor-role"), {}, "长任务监控 Monitor"));

    const governance = inst(el("governance"));
    const policy = put(governance, inst(el("policy-engine")));
    put(governance, inst(el("identity-auth")));
    const cost = put(governance, inst(el("cost-control")));

    const evaluation = inst(el("evaluation"));
    const evalStrategy = put(evaluation, inst(el("eval-strategy"), { strategy: "golden-set" }));

    const relations = [
      makeRelation(planner.id, worker.id, "produces", "Planner 产出任务定义与执行计划"),
      makeRelation(scheduler.id, worker.id, "routes", "调度器恢复或继续长任务"),
      makeRelation(eventLoop.id, scheduler.id, "calls", "事件循环驱动编码步骤与验证反馈"),
      makeRelation(worker.id, toolManager.id, "uses", "Worker 通过工具管理器读写仓库并执行测试"),
      makeRelation(permission.id, toolManager.id, "controls", "最小权限策略限制工具与仓库范围"),
      makeRelation(reviewer.id, worker.id, "consumes", "Reviewer 消费 Worker 产出进行评审"),
      makeRelation(approval.id, worker.id, "controls", "破坏性操作（删除/发布）执行前需人工批准"),
      makeRelation(gate.id, worker.id, "controls", "测试门禁：验证不通过阻断交付"),
      makeRelation(monitor.id, trace.id, "reads", "Monitor 读取长任务轨迹和失败上下文"),
      makeRelation(policy.id, approval.id, "controls", "治理策略决定哪些变更必须人工审批"),
      makeRelation(cost.id, routing.id, "observes", "按模型路由和工具执行归集任务成本"),
      makeRelation(gate.id, escalation.id, "routes", "连续验证失败时升级人工处理"),
      makeRelation(evalStrategy.id, gate.id, "observes", "工程基准集持续校准验证门禁"),
    ];
    return { nodes: [paradigm, runtime, intel, harness, agents, hitl, governance, evaluation], relations };
  }

  if (templateId === "research-agent") {
    const paradigm = inst(el("paradigm"));
    put(paradigm, inst(el("agent-paradigm"), { paradigm: "deliberative" }));
    put(paradigm, inst(el("workflow-pattern"), { pattern: "parallel" }));
    const runtime = inst(el("runtime"));
    const eventLoop = put(runtime, inst(el("event-loop")));
    const scheduler = put(runtime, inst(el("scheduler")));

    const harness = inst(el("harness"));
    put(harness, inst(el("agent-loop")));
    const ce = put(harness, inst(el("context-engineering")));
    put(ce, inst(el("context-assembly"), { allocation: "dynamic-budget" }));
    put(ce, inst(el("context-compression"), { strategy: "hierarchical", threshold: 80 }));
    put(ce, inst(el("objective-anchor")));
    const ts = put(harness, inst(el("tool-system")));
    const toolMgr = put(ts, inst(el("tool-manager")));
    put(ts, inst(el("permission-policy")));
    put(ts, inst(el("browser-automation")));
    const state = put(harness, inst(el("state-management")));
    put(state, inst(el("checkpoint")));
    put(state, inst(el("session-persistence")));
    const recovery = put(harness, inst(el("error-recovery")));
    put(recovery, inst(el("timeout-guard")));
    put(recovery, inst(el("retry-policy"), { maxRetries: 2 }));
    put(recovery, inst(el("fallback-strategy"), { fallbackAction: "degrade-task" }));
    const gate = put(harness, inst(el("verification-gate")));
    const obs = put(harness, inst(el("observability")));
    const trace = put(obs, inst(el("trace")));
    put(obs, inst(el("audit-log")));

    const intel = inst(el("intelligence"));
    put(intel, inst(el("reasoning-paradigm"), { strategy: "reflexion" }));
    const models = put(intel, inst(el("model-integration")));
    put(models, inst(el("model-routing"), { strategy: "capability-based" }));
    put(models, inst(el("output-guard"), { mode: "validate-only" }));
    const ps = put(intel, inst(el("planning-system")));
    put(ps, inst(el("plan-validation")));
    put(ps, inst(el("replan-policy"), { trigger: "on-failure" }));
    const confidence = put(intel, inst(el("confidence-gate")));

    const multiAgent = inst(el("multi-agent"));
    const topology = put(multiAgent, inst(el("topology")));
    put(topology, inst(el("pipeline")));
    const communication = put(multiAgent, inst(el("communication")));
    const directMessaging = put(communication, inst(el("direct-messaging")));
    const lifecycle = put(multiAgent, inst(el("lifecycle")));
    put(lifecycle, inst(el("lifecycle-manager")));
    put(lifecycle, inst(el("budget-caps"), { maxSubagents: 6, maxTurnsPerTask: 30 }));

    const agents = inst(el("agents"));
    const planner = put(agents, inst(el("planner-role"), {}, "研究规划 Planner"));
    const worker = put(agents, inst(el("worker-role"), { specialty: "research" }, "检索取证 Researcher"));
    const reviewer = put(agents, inst(el("reviewer-role"), {}, "证据核验 Reviewer"));
    const monitor = put(agents, inst(el("monitor-role"), {}, "来源质量 Monitor"));

    const hitl = inst(el("hitl"));
    const escalation = put(hitl, inst(el("human-escalation")));
    const governance = inst(el("governance"));
    put(governance, inst(el("policy-engine")));
    put(governance, inst(el("identity-auth")));
    const evaluation = inst(el("evaluation"));
    const evalStrategy = put(evaluation, inst(el("eval-strategy"), { strategy: "golden-set" }));

    const relations = [
      makeRelation(planner.id, worker.id, "produces", "Planner 产出检索计划与取证任务"),
      makeRelation(eventLoop.id, scheduler.id, "calls", "事件循环驱动检索、核验和反思迭代"),
      makeRelation(scheduler.id, worker.id, "routes", "调度器并行分派来源检索任务"),
      makeRelation(planner.id, directMessaging.id, "publishes", "Planner 通过直接消息传递取证任务和证据要求"),
      makeRelation(reviewer.id, worker.id, "consumes", "Reviewer 消费证据做来源验证与交叉核对"),
      makeRelation(worker.id, toolMgr.id, "uses", "Worker 调用搜索/抓取工具收集证据"),
      makeRelation(gate.id, reviewer.id, "controls", "证据覆盖和来源核验未通过时阻断综合结论"),
      makeRelation(monitor.id, trace.id, "reads", "Monitor 从轨迹识别单一来源和取证缺口"),
      makeRelation(confidence.id, escalation.id, "routes", "低置信或证据冲突时升级领域专家"),
      makeRelation(evalStrategy.id, gate.id, "observes", "研究基准集持续评估证据完整性和结论忠实度"),
    ];
    return { nodes: [paradigm, runtime, intel, harness, multiAgent, agents, hitl, governance, evaluation], relations };
  }

  if (templateId === "data-agent") {
    const paradigm = inst(el("paradigm"));
    put(paradigm, inst(el("agent-paradigm"), { paradigm: "human-guided" }));
    put(paradigm, inst(el("workflow-pattern"), { pattern: "conditional" }));
    const runtime = inst(el("runtime"));
    const eventLoop = put(runtime, inst(el("event-loop")));
    const scheduler = put(runtime, inst(el("scheduler")));

    const harness = inst(el("harness"));
    put(harness, inst(el("agent-loop")));
    const ce = put(harness, inst(el("context-engineering")));
    put(ce, inst(el("context-assembly"), { allocation: "priority-preempt" }));
    put(ce, inst(el("context-compression"), { strategy: "hierarchical", threshold: 85 }));
    put(ce, inst(el("context-isolation")));
    const ts = put(harness, inst(el("tool-system")));
    const toolMgr = put(ts, inst(el("tool-manager")));
    const perm = put(ts, inst(el("permission-policy")));
    put(ts, inst(el("sandboxing")));
    put(ts, inst(el("mcp-gateway")));
    const state = put(harness, inst(el("state-management")));
    put(state, inst(el("checkpoint")));
    put(state, inst(el("session-persistence")));
    const recovery = put(harness, inst(el("error-recovery")));
    put(recovery, inst(el("timeout-guard")));
    put(recovery, inst(el("retry-policy"), { maxRetries: 2 }));
    put(recovery, inst(el("idempotency")));
    put(recovery, inst(el("fault-diagnosis")));
    const gate = put(harness, inst(el("verification-gate")));
    const obs = put(harness, inst(el("observability")));
    const trace = put(obs, inst(el("trace")));
    put(obs, inst(el("metrics")));
    put(obs, inst(el("audit-log")));

    const intel = inst(el("intelligence"));
    put(intel, inst(el("reasoning-paradigm"), { strategy: "plan-and-execute" }));
    const models = put(intel, inst(el("model-integration")));
    put(models, inst(el("model-routing"), { strategy: "cost-based" }));
    put(models, inst(el("output-guard"), { mode: "reject-retry" }));
    const ps = put(intel, inst(el("planning-system")));
    put(ps, inst(el("plan-validation")));
    put(ps, inst(el("replan-policy"), { trigger: "on-failure" }));

    const gov = inst(el("governance"));
    const cost = put(gov, inst(el("cost-control")));
    const policy = put(gov, inst(el("policy-engine")));
    put(gov, inst(el("identity-auth")));
    put(gov, inst(el("data-governance")));
    put(gov, inst(el("performance-targets")));

    const agents = inst(el("agents"));
    const planner = put(agents, inst(el("planner-role"), {}, "查询规划 Planner"));
    const worker = put(agents, inst(el("worker-role"), { specialty: "generic" }, "SQL 执行 Worker"));
    const reviewer = put(agents, inst(el("reviewer-role"), {}, "结果校验 Reviewer"));
    const monitor = put(agents, inst(el("monitor-role"), {}, "查询运行 Monitor"));
    const hitl = inst(el("hitl"));
    const approval = put(hitl, inst(el("human-approval"), { scope: "all-writes" }));
    const evaluation = inst(el("evaluation"));
    const evalStrategy = put(evaluation, inst(el("eval-strategy"), { strategy: "golden-set" }));

    const relations = [
      makeRelation(planner.id, worker.id, "produces", "Planner 产出查询计划与 SQL 任务"),
      makeRelation(eventLoop.id, scheduler.id, "calls", "事件循环驱动生成、执行、校验和纠错"),
      makeRelation(scheduler.id, worker.id, "routes", "调度器按数据源和资源配额路由查询"),
      makeRelation(worker.id, toolMgr.id, "uses", "Worker 通过工具管理器访问批准的数据源"),
      makeRelation(reviewer.id, worker.id, "consumes", "Reviewer 消费查询结果做验证"),
      makeRelation(perm.id, toolMgr.id, "controls", "数据访问按最小权限策略裁决"),
      makeRelation(cost.id, toolMgr.id, "observes", "查询与 token 成本归因"),
      makeRelation(gate.id, worker.id, "controls", "结果验证不通过阻断交付"),
      makeRelation(policy.id, approval.id, "controls", "写操作和敏感数据访问进入人工审批"),
      makeRelation(monitor.id, trace.id, "reads", "Monitor 读取查询链路和资源消耗"),
      makeRelation(evalStrategy.id, gate.id, "observes", "标准指标问题集持续评估结果正确性"),
    ];
    return { nodes: [paradigm, runtime, intel, harness, agents, hitl, gov, evaluation], relations };
  }

  if (templateId !== "rag") throw new Error(`模板 ${templateId} 不存在（可用: blank / multi-agent / rag / coding-agent / research-agent / data-agent）`);
  const paradigm = inst(el("paradigm"));
  put(paradigm, inst(el("agent-paradigm"), { paradigm: "human-guided" }));
  put(paradigm, inst(el("workflow-pattern"), { pattern: "dag" }));

  const rag = inst(el("rag"));
  const ingestion = put(rag, inst(el("rag-ingestion")));
  const chunking = put(ingestion, inst(el("rag-chunking")));
  const retrieval = put(rag, inst(el("rag-retrieval"), { strategy: "hybrid", bm25Enabled: true, denseModel: "bge-m3", fusionMethod: "rrf" }));
  const embedding = put(rag, inst(el("rag-embedding")));
  const vectorDb = put(rag, inst(el("rag-vector-db")));
  const reranker = put(rag, inst(el("rag-reranker")));
  const generation = put(rag, inst(el("rag-generation"), { citeSources: true, maxContextDocs: 5, grounding: "strict" }));
  const provenance = put(rag, inst(el("knowledge-provenance")));

  const harness = inst(el("harness"));
  const context = put(harness, inst(el("context-engineering")));
  put(context, inst(el("context-assembly"), { allocation: "dynamic-budget" }));
  put(context, inst(el("context-compression"), { strategy: "semantic-compression", threshold: 85 }));
  put(context, inst(el("context-isolation")));
  const state = put(harness, inst(el("state-management")));
  put(state, inst(el("checkpoint")));
  put(state, inst(el("session-persistence")));
  const recovery = put(harness, inst(el("error-recovery")));
  put(recovery, inst(el("timeout-guard")));
  put(recovery, inst(el("retry-policy"), { maxRetries: 3 }));
  put(recovery, inst(el("circuit-breaker")));
  put(recovery, inst(el("fallback-strategy"), { fallbackAction: "degrade-task" }));
  const gate = put(harness, inst(el("verification-gate")));
  const obs = put(harness, inst(el("observability")));
  const trace = put(obs, inst(el("trace")));
  put(obs, inst(el("metrics")));
  put(obs, inst(el("audit-log")));

  const intelligence = inst(el("intelligence"));
  const models = put(intelligence, inst(el("model-integration")));
  put(models, inst(el("model-routing"), { strategy: "cost-based" }));
  put(models, inst(el("output-guard"), { mode: "reject-retry" }));
  const confidence = put(intelligence, inst(el("confidence-gate")));

  const agents = inst(el("agents"));
  const reviewer = put(agents, inst(el("reviewer-role"), {}, "引用与答案 Reviewer"));
  const monitor = put(agents, inst(el("monitor-role"), {}, "知识新鲜度 Monitor"));
  const hitl = inst(el("hitl"));
  const escalation = put(hitl, inst(el("human-escalation")));
  const governance = inst(el("governance"));
  const policy = put(governance, inst(el("policy-engine")));
  put(governance, inst(el("identity-auth")));
  const dataGovernance = put(governance, inst(el("data-governance")));
  put(governance, inst(el("performance-targets")));
  const evaluation = inst(el("evaluation"));
  const evalStrategy = put(evaluation, inst(el("eval-strategy"), { strategy: "golden-set" }));

  const relations = [
    makeRelation(ingestion.id, chunking.id, "calls", "入库管线解析、清洗并切分知识单元"),
    makeRelation(chunking.id, embedding.id, "produces", "切分结果进入向量化"),
    makeRelation(ingestion.id, vectorDb.id, "produces", "入库管线产出向量索引"),
    makeRelation(retrieval.id, embedding.id, "depends", "检索依赖查询向量化"),
    makeRelation(retrieval.id, vectorDb.id, "depends", "检索依赖向量库"),
    makeRelation(retrieval.id, reranker.id, "produces", "混合检索候选集进入精排"),
    makeRelation(generation.id, reranker.id, "consumes", "生成消费精排后的高质证据"),
    makeRelation(generation.id, provenance.id, "writes", "生成答案写入来源引用和证据定位"),
    makeRelation(gate.id, generation.id, "controls", "忠实度和引用完整性未通过时阻断答案"),
    makeRelation(reviewer.id, provenance.id, "reads", "Reviewer 抽检引用和原文的一致性"),
    makeRelation(monitor.id, trace.id, "reads", "Monitor 观察召回、延迟和知识新鲜度"),
    makeRelation(dataGovernance.id, ingestion.id, "controls", "数据治理控制入库范围、保留和脱敏"),
    makeRelation(policy.id, retrieval.id, "controls", "策略引擎按用户身份过滤可检索知识"),
    makeRelation(confidence.id, escalation.id, "routes", "低置信或无充分证据时转人工"),
    makeRelation(evalStrategy.id, gate.id, "observes", "问答基准集持续评估召回、忠实度与引用正确性"),
  ];
  return { nodes: [paradigm, rag, intelligence, harness, agents, hitl, governance, evaluation], relations };
}
