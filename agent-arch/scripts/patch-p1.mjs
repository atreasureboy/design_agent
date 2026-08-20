import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ontDir = join(here, "../ontology/core");

const P = {
  harness: {
    implementations: [
      { name: "DeepSeek Harness", note: "一切皆插件，Cordis 组合式内核" },
      { name: "Claude Code 内核", note: "商用闭环参考" },
      { name: "LangGraph runtime", note: "图执行 + 检查点" }
    ],
    useCases: ["任何需要工具编排/状态/恢复的 Agent 系统"],
    pros: ["模型/工具/状态解耦，可独立演进", "插件化组合抗需求变化"],
    cons: ["自研成本高（建议复用成熟 harness）", "抽象层次多，调试链路长"],
    commonIssues: ["harness 与 runtime 边界模糊", "插件版本兼容矩阵爆炸"],
    relations: { allowedSiblings: ["multi-agent", "rag"] }
  },
  "context-engineering": {
    implementations: [
      { name: "dsh compaction + context", note: "压缩与请求上下文分包" },
      { name: "显式上下文组装层", note: "自研时按信息类型分区组装" }
    ],
    useCases: ["长会话", "多 Agent 信息流管控"],
    pros: ["上下文质量可工程化管理", "token 成本可控"],
    cons: ["组装规则需要持续维护", "过度设计拖慢迭代"],
    commonIssues: ["上下文无限增长", "外部内容注入面扩大"],
    relations: { allowedSiblings: ["error-recovery", "observability"] }
  },
  "tool-system": {
    implementations: [
      { name: "dsh tool catalog", note: "集中注册 + 策略管控" },
      { name: "MCP 接入", note: "标准化工具协议，动态发现" }
    ],
    useCases: ["需要外部能力（文件/shell/web）的 Agent"],
    pros: ["能力可扩展", "权限与审计集中"],
    cons: ["工具越多选择错误率越高", "描述质量决定调用质量"],
    commonIssues: ["工具爆炸", "工具描述与现实不符"],
    relations: { allowedSiblings: ["state-management", "error-recovery"] }
  },
  "tool-manager": {
    implementations: [
      { name: "集中注册路由", note: "dsh tool-catalog 模式" },
      { name: "动态发现", note: "MCP list_tools 按需挂载" }
    ],
    useCases: ["工具超过 10 个需要路由与限额"],
    pros: ["统一鉴权与审计", "运行时扩工具"],
    cons: ["路由层增加延迟", "中间层故障影响全部工具"],
    commonIssues: ["工具选择精度下降", "参数校验缺失"],
    references: ["dsh docs/tool-catalog", "MCP 规范"],
    alternatives: ["agent 直接绑定固定工具集（小规模）"],
    relations: { allowedParents: ["tool-system"] }
  },
  "state-management": {
    implementations: [
      { name: "dsh session", note: "会话事件流 + 投影" },
      { name: "LangGraph checkpointer", note: "图状态快照" }
    ],
    useCases: ["需要崩溃恢复或回放的任务"],
    pros: ["故障可恢复", "支持时间旅行调试"],
    cons: ["存储成本", "快照一致性设计复杂"],
    commonIssues: ["状态膨胀", "检查点粒度两难"],
    relations: { allowedSiblings: ["observability"] }
  },
  "session-persistence": {
    implementations: [
      { name: "会话事件流落盘", note: "dsh session log，追加写 + 版本号" },
      { name: "全量 JSON 快照", note: "实现简单，体积大" }
    ],
    useCases: ["跨天长任务", "审计回放"],
    pros: ["完整可回放", "审计友好"],
    cons: ["存储大", "敏感信息需脱敏"],
    commonIssues: ["回放不一致（模型非确定性）", "日志格式版本兼容"],
    references: ["dsh SESSION_FORMAT_VERSION 机制"],
    alternatives: ["checkpoint（轻量快照，只存关键点）"],
    relations: { allowedParents: ["state-management"], allowedSiblings: ["checkpoint"] }
  },
  "error-recovery": {
    implementations: [{ name: "重试+超时+降级组合拳", note: "三层防线分级兜底" }],
    useCases: ["生产环境可用性保障"],
    pros: ["弹性分层", "故障隔离"],
    cons: ["每层策略都需调参", "组合路径测试成本高"],
    commonIssues: ["重试风暴", "降级路径从未被演练"],
    relations: { allowedSiblings: ["observability"] }
  },
  "retry-policy": {
    implementations: [
      { name: "指数退避", note: "失败后指数级拉长间隔" },
      { name: "固定次数重试", note: "简单直接，适合幂等操作" }
    ],
    useCases: ["网络抖动", "限流 429 场景"],
    pros: ["实现简单", "对瞬时故障有效"],
    cons: ["要求操作幂等", "重试放大下游压力"],
    commonIssues: ["非幂等操作重试导致重复副作用", "重试风暴拖垮下游"],
    references: ["指数退避实践（AWS Architecture Blog）"],
    alternatives: ["fallback-strategy（快速切换代替重试）"],
    relations: { allowedParents: ["error-recovery"], allowedSiblings: ["timeout-guard"] }
  },
  observability: {
    implementations: [{ name: "轨迹+指标+日志三支柱", note: "trace/metrics/log 互补" }],
    useCases: ["生产运维", "质量回归分析"],
    pros: ["问题可定位", "为架构迭代提供数据"],
    cons: ["数据量与存储成本", "口径设计费心"],
    commonIssues: ["采样策略难定", "敏感信息混入观测数据"],
    references: ["OpenTelemetry GenAI 语义约定"],
    relations: { allowedSiblings: [] }
  },
  metrics: {
    implementations: [{ name: "用量/成功率/时延统计", note: "dsh session telemetry 聚合" }],
    useCases: ["成本监控", "SLA 度量"],
    pros: ["量化运营", "异常早发现"],
    cons: ["指标口径需要治理", "维度爆炸"],
    commonIssues: ["小样本指标噪声", "token 成本归因不清"],
    references: ["dsh session telemetry", "OpenTelemetry"],
    relations: { allowedParents: ["observability"], allowedSiblings: ["trace", "audit-log"] }
  },
  "multi-agent": {
    implementations: [
      { name: "dsh subagent", note: "委托式子 Agent" },
      { name: "AutoGen GroupChat", note: "群聊式协作" }
    ],
    useCases: ["任务可并行分解", "需要专业化分工"],
    pros: ["吞吐提升", "角色专业化质量更高"],
    cons: ["协调成本高", "上下文同步复杂"],
    commonIssues: ["角色职责重叠", "通信开销失控"],
    relations: { allowedSiblings: ["harness", "rag"] }
  },
  topology: {
    implementations: [{ name: "星型/层级/点对点三选一", note: "按规模与耦合度选择" }],
    useCases: ["3 个以上 Agent 协作时必答"],
    pros: ["拓扑决定通信复杂度上界", "显式化便于评审"],
    cons: ["选错拓扑重构成本高"],
    commonIssues: ["规模增长后拓扑不匹配", "隐性点对点绕过拓扑约束"],
    references: ["Conway's Law：组织结构与系统拓扑"],
    relations: { allowedSiblings: ["communication", "lifecycle", "memory"] }
  },
  communication: {
    implementations: [{ name: "总线/直连/黑板/共享状态四模式", note: "按耦合度与实时性取舍" }],
    useCases: ["Agent 间信息交换的通道设计"],
    pros: ["信息流显式化", "可审计"],
    cons: ["模式过多难维护", "通道选择争议"],
    commonIssues: ["隐式信息流绕过通道", "消息无 schema 导致解析歧义"],
    references: ["dsh event-producer-consumer"],
    relations: { allowedSiblings: ["topology", "lifecycle"] }
  },
  "direct-messaging": {
    implementations: [{ name: "Agent 点对点直呼", note: "类似函数调用" }],
    useCases: ["2 个 Agent 紧密协作"],
    pros: ["延迟低", "实现简单"],
    cons: ["O(n²) 信道增长", "无全局视角"],
    commonIssues: ["两两对话死循环", "第三方信息缺失"],
    references: ["AutoGen 两两对话模式"],
    alternatives: ["message-bus（解耦广播）", "supervisor 汇聚（星型收敛）"],
    relations: { allowedParents: ["communication"], allowedSiblings: ["budget-caps"] }
  },
  lifecycle: {
    implementations: [{ name: "生成/托管/销毁三段式", note: "spawn → manage → destroy" }],
    useCases: ["动态子 Agent 场景"],
    pros: ["资源用量可控", "故障定位清晰"],
    cons: ["管理器自身复杂度", "暂停/恢复语义难实现"],
    commonIssues: ["孤儿 Agent 泄漏", "僵尸进程占预算"],
    relations: { allowedSiblings: ["topology", "communication"] }
  },
  "subagent-spawn": {
    implementations: [{ name: "裸 spawn", note: "按需生成，不做托管" }],
    useCases: ["偶发的轻量子任务"],
    pros: ["零管理成本"],
    cons: ["泄漏风险", "失败无兜底"],
    commonIssues: ["父任务先死子任务仍在跑", "并发 spawn 失控"],
    references: ["dsh packages/subagent"],
    alternatives: ["lifecycle-manager（统一托管）"],
    relations: { allowedParents: ["lifecycle"] }
  },
  memory: {
    implementations: [{ name: "向量/情景/角色分区组合", note: "按记忆生命周期分层" }],
    useCases: ["跨会话经验复用", "组织知识沉淀"],
    pros: ["历史可复用", "长任务连贯"],
    cons: ["检索质量决定可用性", "陈旧经验干扰"],
    commonIssues: ["记忆污染", "记忆权限边界模糊"],
    references: ["MemGPT", "Letta"],
    relations: { allowedSiblings: ["topology", "communication"] }
  },
  "shared-memory": {
    implementations: [{ name: "全局记忆区", note: "所有 Agent 读写同一存储" }],
    useCases: ["小团队强共享场景"],
    pros: ["信息即时可见", "实现简单"],
    cons: ["并发写冲突", "污染全局传播"],
    commonIssues: ["记忆碰撞互相覆盖", "职责不清导致垃圾记忆"],
    references: ["MemGPT 共享记忆"],
    alternatives: ["role-based-memory（按角色分区）"],
    relations: { allowedParents: ["memory"], incompatibleWith: ["role-based-memory"] }
  },
  "vector-memory": {
    implementations: [{ name: "向量库语义检索", note: "与 rag-vector-db 复用基础设施" }],
    useCases: ["长期知识记忆", "文档型经验"],
    pros: ["语义泛化好", "可增量更新"],
    cons: ["精确匹配弱", "嵌入计算成本"],
    commonIssues: ["检索噪声", "删除不彻底（向量化残留）"],
    references: ["pgvector", "MemGPT"],
    alternatives: ["episodic-memory（时间线回忆）"],
    relations: { allowedParents: ["memory"] }
  },
  agents: {
    implementations: [{ name: "角色实例清单", note: "dsh preset agent composition" }],
    useCases: ["定义团队组成与分工"],
    pros: ["角色显式化便于评审", "职责边界清晰"],
    cons: ["角色划分易有争议"],
    commonIssues: ["角色重叠", "缺 Reviewer 导致质量无闭环"],
    references: ["dsh packages/preset"],
    relations: { allowedSiblings: ["harness", "multi-agent"] }
  },
  "supervisor-role": {
    implementations: [
      { name: "裁决型", note: "汇总子结果并做最终决策" },
      { name: "路由型", note: "只分派不汇总" }
    ],
    useCases: ["星型拓扑的中心节点"],
    pros: ["全局视角", "进度集中可见"],
    cons: ["吞吐瓶颈", "自身上下文易膨胀"],
    commonIssues: ["supervisor 上下文溢出", "派发粒度过细"],
    references: ["LangGraph supervisor 模式"],
    alternatives: ["hierarchical（分层监督分散压力）"],
    relations: { allowedParents: ["agents"] }
  },
  "planner-role": {
    implementations: [
      { name: "一次性规划", note: "任务开始产出完整计划" },
      { name: "动态重规划", note: "执行中按反馈调整（replan）" }
    ],
    useCases: ["长任务、多步骤任务"],
    pros: ["步骤显式可审", "失败可定位到步骤"],
    cons: ["计划赶不上变化", "过度规划浪费时间"],
    commonIssues: ["规划与执行脱节", "计划粒度过粗/过细"],
    references: ["dsh plan mode", "Plan-and-Execute 论文"],
    alternatives: ["worker 自主规划（小任务免专职 planner）"],
    relations: { allowedParents: ["agents"] }
  },
  "reviewer-role": {
    implementations: [
      { name: "评审循环", note: "review → 返工 → 再 review" },
      { name: "门禁式", note: "不通过则阻断下游" }
    ],
    useCases: ["质量敏感的产出（代码/文档）"],
    pros: ["质量闭环", "标准显式化"],
    cons: ["增加轮次与成本", "标准漂移"],
    commonIssues: ["reviewer 过严导致死循环", "评审意见不可执行"],
    references: ["dsh packages/guard", "代码评审实践"],
    alternatives: ["自动化测试代替评审角色"],
    relations: { allowedParents: ["agents"] }
  },
  "context-isolation": {
    alternatives: ["context-gateway（集中裁剪代替物理隔离）"],
    relations: { allowedParents: ["context-engineering"], allowedSiblings: ["context-compression"] }
  },
  "context-gateway": {
    references: ["Multi-Agent 编排上下文管控实践"],
    relations: { allowedParents: ["context-engineering"], allowedSiblings: ["context-isolation"] }
  },
  "injection-defense": {
    relations: { allowedParents: ["context-engineering"] }
  },
  "objective-anchor": {
    references: ["Plan-and-Execute", "ReWoo"],
    relations: { allowedParents: ["context-engineering"] }
  },
  "permission-policy": {
    alternatives: ["sandboxing（隔离代替确认）"],
    relations: { allowedParents: ["tool-system"], allowedSiblings: ["sandboxing"] }
  },
  "timeout-guard": {
    alternatives: ["budget-caps（限总量代替限单次）"],
    relations: { allowedParents: ["error-recovery"], allowedSiblings: ["retry-policy"] }
  },
  "fallback-strategy": {
    references: ["多供应商容灾实践"],
    relations: { allowedParents: ["error-recovery"], allowedSiblings: ["retry-policy"] }
  },
  trace: {
    relations: { allowedParents: ["observability"], allowedSiblings: ["metrics", "audit-log"] }
  },
  "audit-log": {
    references: ["SOC 2 审计留存要求"],
    relations: { allowedParents: ["observability"], allowedSiblings: ["metrics", "trace"] }
  },
  hierarchical: {
    alternatives: ["supervisor-worker（单层，规模小时更简单）"]
  },
  "message-bus": {
    alternatives: ["direct-messaging（低延迟点对点）"]
  },
  "role-based-memory": {
    alternatives: ["shared-memory（全局共享免同步）"],
    references: ["Letta 角色记忆"]
  },
  "shared-blackboard": {
    references: ["黑板架构（Blackboard System）"],
    relations: { allowedParents: ["communication"] }
  },
  "worker-role": {
    references: ["dsh preset worker 组合"],
    alternatives: ["supervisor 兼职执行（极小规模）"],
    relations: { allowedParents: ["agents"] }
  },
  rag: {
    alternatives: ["模型微调（知识内化，更新贵）"],
    relations: { allowedSiblings: ["harness", "multi-agent"] }
  },
  "rag-ingestion": {
    alternatives: ["实时逐条入库（牺牲批量效率换实时性）"],
    relations: { allowedParents: ["rag"] }
  },
  "rag-chunking": {
    alternatives: ["fixed（最简单，语义完整性差）"],
    relations: { allowedParents: ["rag-ingestion"] }
  },
  "rag-retrieval": {
    alternatives: ["纯 dense / 纯 bm25（更简单但各有盲区）"],
    relations: { allowedParents: ["rag"] }
  },
  "rag-embedding": {
    alternatives: ["商用 API（免运维，数据外发）"],
    relations: { allowedParents: ["rag"] }
  },
  "rag-vector-db": {
    alternatives: ["专用向量库（milvus，大规模）"],
    relations: { allowedParents: ["rag"] }
  },
  "rag-reranker": {
    alternatives: ["提高召回 topK 粗排（省一跳延迟）"],
    relations: { allowedParents: ["rag"] }
  },
  "rag-generation": {
    alternatives: ["loose grounding（灵活但不可溯源）"],
    relations: { allowedParents: ["rag"] }
  }
};

const files = readdirSync(ontDir).filter((x) => x === "elements.json" || x.endsWith("-elements.json"));
let total = 0;
for (const f of files) {
  const p = join(ontDir, f);
  const els = JSON.parse(readFileSync(p, "utf8"));
  let n = 0;
  for (const el of els) {
    const patch = P[el.id];
    if (patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (k === "relations" && el.relations) {
          el.relations = { ...v, ...el.relations, allowedParents: el.relations.allowedParents ?? v.allowedParents };
        } else {
          el[k] = v;
        }
      }
      n += 1;
      delete P[el.id];
    }
  }
  writeFileSync(p, JSON.stringify(els, null, 2) + "\n");
  total += n;
  console.log(`${f}: patched ${n}`);
}
const leftover = Object.keys(P);
if (leftover.length > 0) console.log(`WARN unmatched patch keys: ${leftover.join(", ")}`);
console.log(`total patched: ${total}`);
