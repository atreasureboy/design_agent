import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "../ontology/core/elements.json");
const elements = JSON.parse(readFileSync(file, "utf8"));

const cards = {
  "context-compression": {
    implementations: [
      { name: "summary", note: "LLM 摘要压缩历史，保留语义骨架" },
      { name: "sliding-window", note: "保留最近 K 轮，机械但可控" },
      { name: "hierarchical", note: "分层摘要：近期原文 + 远期摘要，信息保留最好" },
      { name: "selective-drop", note: "按类型丢弃（如旧工具输出），成本最低" }
    ],
    useCases: ["长会话成本控制", "逼近窗口上限前主动触发"],
    pros: ["token 成本显著下降", "会话可长期持续"],
    cons: ["信息丢失风险", "摘要质量依赖模型能力"],
    commonIssues: ["压缩后关键事实丢失", "历史漂移（早期语境被过度概括）"]
  },
  "context-isolation": {
    implementations: [
      { name: "独立会话空间", note: "每 Agent 独立 messages，物理隔离" },
      { name: "命名空间标记", note: "同一存储内按 namespace 逻辑隔离" }
    ],
    useCases: ["多 Agent 协作", "子 Agent 任务下发"],
    pros: ["彻底杜绝互串", "角色边界清晰"],
    cons: ["上下文重复构建，token 成本上升", "跨 Agent 共享需显式通道"],
    commonIssues: ["隔离后子 Agent 缺全局信息", "共享白板与隔离的边界设计"]
  },
  "context-gateway": {
    implementations: [{ name: "Supervisor 裁剪下发", note: "统一收集-过滤-分发上下文" }],
    useCases: ["Supervisor-Worker 拓扑", "敏感信息集中管控"],
    pros: ["信息流集中可审计", "按角色最小化下发"],
    cons: ["增加一跳延迟", "裁剪逻辑本身成为复杂度中心"],
    commonIssues: ["裁剪规则维护成本", "网关单点"]
  },
  "injection-defense": {
    implementations: [
      { name: "内容打标隔离", note: "外部内容以 data 块包裹并与指令分离" },
      { name: "工具输出过滤", note: "白名单/截断/脱敏后入上下文" }
    ],
    useCases: ["带 web 检索的 Agent", "处理用户上传文件的 Agent"],
    pros: ["结构性防御提示注入", "审计可追溯"],
    cons: ["部分合法指令可能被误拦", "增加管线复杂度"],
    commonIssues: ["打标绕过（外部内容伪装系统指令）", "多级转发的标记丢失"]
  },
  "objective-anchor": {
    implementations: [{ name: "目标重注入", note: "每轮把原始目标+当前计划注入系统区" }],
    useCases: ["长任务链（>10 轮）", "多 Agent 任务传递"],
    pros: ["显著抑制目标漂移", "实现简单"],
    cons: ["占用固定上下文窗口", "目标变更时需同步更新锚点"],
    commonIssues: ["锚点与子目标冲突", "锚点过长稀释注意力"]
  },
  "supervisor-worker": {
    implementations: [
      { name: "dsh subagent delegation", note: "Supervisor 持有会话，按需 spawn 子 Agent" },
      { name: "LangGraph supervisor", note: "图编排：supervisor 节点路由到 worker 节点" }
    ],
    useCases: ["任务可并行拆解", "需要集中裁决与汇总"],
    pros: ["责任分离清晰", "星型拓扑控制消息复杂度 O(n)"],
    cons: ["Supervisor 吞吐瓶颈", "派发粒度设计难（过细则开销大）"],
    commonIssues: ["Supervisor 上下文膨胀", "Worker 结果汇总时信息过载"]
  },
  "hierarchical": {
    implementations: [{ name: "多层 supervisor 嵌套", note: "每层管理 5-9 个下属，控制跨度" }],
    useCases: ["大规模 Agent 团队（>10 worker）", "任务天然分层（领域→子任务）"],
    pros: ["可扩展性好", "每层上下文可控"],
    cons: ["层级延迟叠加", "跨层信息失真"],
    commonIssues: ["层数过深导致指令失真", "跨层协调死角"]
  },
  "peer-to-peer": {
    implementations: [{ name: "Agent 直接对话", note: "无中心，Agent 互发消息协商" }],
    useCases: ["小规模对等协作（2-3 Agent）", "辩论式推理"],
    pros: ["无单点", "灵活性高"],
    cons: ["消息量 O(n²) 增长", "全局视角缺失"],
    commonIssues: ["死循环对话", "责任归属模糊"]
  },
  "message-bus": {
    implementations: [
      { name: "发布订阅", note: "按主题广播，收发解耦" },
      { name: "事件流", note: "dsh event producer/consumer 模式" }
    ],
    useCases: ["多 Agent 异步协作", "插件化事件驱动架构"],
    pros: ["收发解耦", "天然支持审计与回放"],
    cons: ["消息顺序与幂等需额外处理", "调试链路变长"],
    commonIssues: ["消息风暴", "订阅者处理滞后导致积压"]
  },
  "shared-blackboard": {
    implementations: [{ name: "共享工作区", note: "Agent 异步读写同一结构化工作区" }],
    useCases: ["知识聚合任务", "异步协作（时区/节奏不同）"],
    pros: ["异步解耦", "中间产物可视"],
    cons: ["并发写冲突", "脏数据传播"],
    commonIssues: ["写写冲突需锁或版本化", "黑板结构设计（schema）前期成本"]
  },
  "shared-state": {
    implementations: [{ name: "全局状态对象", note: "LangGraph StateGraph 模式，实时同步" }],
    useCases: ["流水线式多步处理", "状态需要强一致"],
    pros: ["实时一致", "调试直观"],
    cons: ["并发写冲突", "状态 schema 变更影响所有节点"],
    commonIssues: ["状态膨胀", "记忆碰撞（互相覆盖字段）"]
  },
  "lifecycle-manager": {
    implementations: [
      { name: "统一托管", note: "管理器负责 spawn/pause/resume/destroy 全生命周期" },
      { name: "引用计数回收", note: "父任务结束自动回收子 Agent" }
    ],
    useCases: ["长时会话", "高频 spawn 的批处理"],
    pros: ["杜绝孤儿进程", "资源用量可控"],
    cons: ["管理器自身需高可用", "暂停/恢复语义实现复杂"],
    commonIssues: ["管理器崩溃时的接管", "子 Agent 卡死的判定阈值"]
  },
  "budget-caps": {
    implementations: [{ name: "全局预算帽", note: "maxSubagents × maxTurns 双重上限" }],
    useCases: ["生产环境成本控制", "无人值守任务"],
    pros: ["费用失控的硬保险", "实现简单"],
    cons: ["预算内完不成需人工介入", "阈值拍脑袋"],
    commonIssues: ["预算切分策略（每任务 vs 全局）", "触顶时的优雅降级"]
  },
  "checkpoint": {
    implementations: [
      { name: "dsh session 持久化", note: "会话事件流落盘，可回放恢复" },
      { name: "LangGraph checkpointer", note: "图状态快照，支持分支回放" }
    ],
    useCases: ["长任务容错", "需要回放调试的场景"],
    pros: ["崩溃恢复", "支持时间旅行调试"],
    cons: ["写盘开销", "快照一致性设计"],
    commonIssues: ["检查点粒度（每步 vs 每阶段）", "恢复后上下文重建"]
  },
  "timeout-guard": {
    implementations: [{ name: "工具级超时", note: "单次工具调用限时强停" }, { name: "循环步数护栏", note: "loop hygiene：连续无进展步数上限" }],
    useCases: ["执行外部命令", "web 请求"],
    pros: ["失控循环的硬止损", "保护下游资源"],
    cons: ["慢任务需要合理阈值", "误杀长任务"],
    commonIssues: ["超时后资源清理不彻底", "阈值与任务类型不匹配"]
  },
  "fallback-strategy": {
    implementations: [
      { name: "switch-model", note: "主模型失败切备用模型" },
      { name: "degrade-task", note: "降级为更简单的任务形态（如去掉工具）" },
      { name: "abort", note: "快速失败并上报" }
    ],
    useCases: ["生产可用性要求高", "多供应商依赖"],
    pros: ["避免单点失败", "可用性提升"],
    cons: ["降级产出质量下降", "fallback 路径测试成本"],
    commonIssues: ["主备模型能力差异导致行为不一致", "降级链过深难以排查"]
  },
  sandboxing: {
    implementations: [
      { name: "云沙箱", note: "dsh e2b：独立云容器执行" },
      { name: "本地沙箱", note: "landlock/seccomp 限制系统调用" }
    ],
    useCases: ["执行不可信代码", "Agent 操作文件系统"],
    pros: ["权限升级的结构性防御", "爆炸半径可控"],
    cons: ["冷启动延迟", "沙箱内环境差异"],
    commonIssues: ["沙箱逃逸面评估", "网络策略（禁网/白名单）"]
  },
  "permission-policy": {
    implementations: [
      { name: "路径白名单", note: "限定可读写目录（dsh fs policy）" },
      { name: "确认制", note: "高危操作人工确认（ask-user）" }
    ],
    useCases: ["读写用户文件", "git 操作/部署类动作"],
    pros: ["最小权限原则落地", "合规可审计"],
    cons: ["交互确认打断自动化", "策略维护成本"],
    commonIssues: ["策略过严阻塞正常任务", "确认疲劳导致无脑放行"]
  },
  "episodic-memory": {
    implementations: [{ name: "情景存储+检索", note: "被裁剪内容入库，按需语义检索找回" }],
    useCases: ["与 context-compression 配套", "跨会话经验复用"],
    pros: ["信息丢失的兜底", "长任务经验积累"],
    cons: ["检索延迟", "存储成本"],
    commonIssues: ["检索时机（被动 vs 主动）", "陈旧经验干扰当前任务"]
  },
  "role-based-memory": {
    implementations: [{ name: "按角色命名空间", note: "每个 Agent 角色独立记忆区" }],
    useCases: ["多 Agent 并发写同一记忆系统"],
    pros: ["消除并发写冲突", "权限边界与记忆边界一致"],
    cons: ["跨角色共享需显式同步", "命名空间膨胀"],
    commonIssues: ["角色重定义后记忆迁移", "共享记忆的权限升级"]
  },
  trace: {
    implementations: [{ name: "全链路轨迹", note: "dsh session telemetry：每步决策与工具调用留痕" }],
    useCases: ["生产排障", "质量回溯"],
    pros: ["问题可回溯", "为评估提供数据"],
    cons: ["存储成本", "敏感信息脱敏"],
    commonIssues: ["轨迹过载（记录粒度）", "跨 Agent 轨迹关联"]
  },
  "audit-log": {
    implementations: [{ name: "决策审计", note: "关键决策（权限/花钱/破坏性操作）单独留档" }],
    useCases: ["合规审计", "事故复盘"],
    pros: ["满足合规", "责任可追溯"],
    cons: ["日志膨胀", "审计口径设计"],
    commonIssues: ["审计与轨迹的边界", "日志篡改防护"]
  },
  "worker-role": {
    implementations: [
      { name: "按专长分工", note: "coding/testing/research 等专长 worker" },
      { name: "通用 worker", note: "不分工，任务描述驱动" }
    ],
    useCases: ["并行子任务执行", "专业领域深度处理"],
    pros: ["专业提示词与工具集可定制", "并行加速"],
    cons: ["分工过细增加协调成本", "worker 间依赖需排序"],
    commonIssues: ["任务描述歧义", "worker 间重复劳动"]
  }
};

let patched = 0;
for (const el of elements) {
  const card = cards[el.id];
  if (card) {
    Object.assign(el, card);
    patched += 1;
  }
}
writeFileSync(file, JSON.stringify(elements, null, 2) + "\n");
console.log(`patched ${patched}/${elements.length} elements with knowledge cards`);
