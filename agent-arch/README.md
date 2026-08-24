# AgentArch — 企业级 Agent 架构设计平台

> Agent 架构 CAD / Enterprise Agent Design Tool。设计构想见 [../思路.md](../思路.md)。

**解决的真问题：企业知道怎么部署 Agent，但不知道怎么设计 Agent。**

平台不运行 Agent、不生成代码——它让架构师在受约束的**架构语言（Ontology）**上协作设计 Agent 系统架构，产出**分层规范蓝图**（结构 = MUST / 参数 = MAY）。不是流程图工具，也不是风险扫描器。

## v16：企业设计闭环与边界加固

- **Architecture Brief** 成为蓝图一等对象：业务目标、关键用例、约束/假设、数据分级、信任边界、合规、自治程度、人工监督、NFR、预算和验收标准
- Brief 驱动上下文检查：机密数据缺数据治理、高自治缺 HITL、声明预算缺成本控制会形成明确架构建议
- Blueprint schema 1.2：补组织/项目作用域与 Brief；旧数据读取时兼容归一化
- API 深度校验节点/关系/Brief，限制 2 MiB、500 节点、20 层、2000 关系；校验成功后才原子落盘
- 乐观并发：Web 保存/状态迁移携带 `expectedVersion`，过期版本返回 409
- 可配置身份与 RBAC：admin / architect / reviewer / viewer；组织与项目范围隔离蓝图、评论、审计和企业 Ontology
- 企业扩展批准前必须携带结构化证据；新增 `pnpm audit:evidence` 显示结构化/旧式/缺失/过期证据覆盖
- MCP 同步使用深度导入校验，并新增 `set_architecture_brief`

## v15：主路径 —— 给架构一个阅读顺序

> 用户打开图的第一眼不应该迷路。架构设计有阅读顺序：一个请求从进入系统到产出结果的完整路径。

- **主路径视图（默认落地页）**：纵向泳道给出 8 阶段阅读顺序——**用户输入 → ① 入口与范式 → ② 运行时 → ③ 智能层 → ④ Harness → ⑤ Agent 角色 → ⑥ 协作拓扑 → ⑦ 能力域（工具/技能/RAG） → ⑧ 治理与保障 → 产出/交付**
- 每阶段卡片内列出该环节的已设计组件（绿色 chips），**未设计阶段红色虚线 + "未设计"标签**——打开即知从哪读、缺什么
- **归属规则（特异性优先）**：实例沿祖先链向上，第一个命中阶段声明的祖先决定归属——tool-manager 归"能力域"而非笼统的"Harness"；企业扩展等无匹配组件进"其他"泳道
- 点阶段卡片跳转架构图谱对应组件；`paths.json` 数据驱动（可定义多条路径），加载时引用强校验
- 四视图体系成型：**主路径（读顺序）/ 架构图谱（看关系）/ 循环视图（看闭环）/ 编辑器（改结构）**

## v14：架构世界表达 —— 覆盖缺失红标 / Runtime 提升 / 循环视图

> 后端模型（Ontology/Blueprint/Constraint/Risk）已完备，本版把"架构世界"在前端表达出来——K8s Dashboard 式体验，不只是组件列表。

- **Architecture Coverage（P0）**：图谱新增「覆盖缺失」图层（默认开）——分区内**该设计而未设计的能力以红色虚线节点**呈现（○ 未设计：状态管理 / 运行时层…），点击弹卡：为什么需要（价值/常见考量）+ **一键添加**或忽略。克制的红标规则：互斥选项组（拓扑/记忆选型）不标、多实例角色不标、族不支持的元素不标——只提醒真缺失
- **Runtime 提升（P1）**：新根分区**运行时层**（事件循环/调度器/工作者管理，带族约束：event-loop 不适用于 DAG 等）；蓝图没有 runtime 实例时根级红标提醒"执行模型未设计"
- **Harness 补全**：+ **Agent 循环**（执行骨架，引入失控循环风险）与 **插件系统**（目录 §9.2/§9.3）；harness 下的能力域缺口都会被 Coverage 红标暴露
- **循环视图（P2）**：新页面视图（图谱/循环/编辑器三切换）——`loops.json` 定义三大架构闭环（**推理循环**：感知→推理→规划→执行→行动；**恢复环**：失败→诊断→降级→重试；**学习环**：反馈→评估→整理→沉淀），环形布局渲染，环节**绿色=已设计 / 红色=未设计**，覆盖率百分比直读——Agent 架构的动态特征（闭环）首次成为一等视图

规模：**114 元素 / 35 风险 / 22 规则 / 3 循环 / 5 族 / 10 根分区**。

## v13：交互式架构图谱 —— 设计器从"表单树"进化为"节点画布"

设计器新增（默认视图）**整页架构图谱**（React Flow 画布，企业级架构的完整画布空间）：

- **节点 = 蓝图组件**：按根分区着色（harness 蓝 / 多 Agent 橙 / 角色 紫 / RAG 绿…），节点上带决策 ● / 职责 ■ / 契约 ◆ 徽章与风险 ▲/✓ 计数
- **三类边**：
  - 分类树边（灰色实线）
  - 架构关系边（14 类型彩色虚线，显式声明）
  - **推断边**（点线，`core/inference.ts` 推理引擎）：本体语义在实例图上的投影——**推断依赖**（requires/dependsOn/suggests 实例间投影）、**契约匹配**（A 的 outputs 与 B 的 inputs 术语对齐 → 产出→消费）、**风险消解**（引入方→消解方）；三个图层可独立开关，点推断边可**一键固化为正式架构关系**或忽略，显式关系自动抑制同向推断
- **点节点 → 右侧浮出完整 Inspector**（知识卡/参数/决策+权衡/职责/契约/关系编辑器）
- **拖线建关系**：从节点圆点拖到另一节点，弹出 14 类型选择器（经约束引擎校验）
- 顶部统计胶囊（节点/关系/error 计数）、右下角浮动调色板、「编辑器」标签保留三栏视图

同时补目录叶节点深度：推理范式 5→10、模型路由 4→8、压缩策略 4→6（对齐目录 §1.2/§2.2/§4.3 的枚举清单）。

## v12：覆盖收官 —— 能力域补全 / 反模式收尾 / 蓝图导入

| 目录内容 | 落点 |
|---|---|
| §38 / §39 / §40 | 工具能力域三元素：**模态路由**（多模态）、**浏览器自动化**（引入提示注入风险→防注入对冲）、**计算机操作**（引入权限升级风险→沙箱+审批对冲） |
| §4.2 Context Construction | **上下文组装**（选择/过滤/排序/预算分配，与压缩互补，共同消解上下文超限） |
| §12.1 Agent Protocol | **A2A 互操作**（跨系统 Agent 标准化通信） |
| §31 反模式收尾 | **Agent Explosion**（节点级：角色实例 > 8）、**Hidden Global State**（规则：共享状态无可观测） |
| §56 Blueprint Import | `POST /api/blueprints {import: {nodes, relations}}` + MCP `import_blueprint`（导入即校验） |

最终规模：**108 元素 / 35 风险 / 22 规则 / 5 族 / 9 根分区 / 6 模板 / 19 MCP 工具**。

反模式检测覆盖（§31 的 16 项）：11 项可检测已实现（Unbounded Retry / Prompt Monolith / Unrecoverable Workflow / God Agent / Agent Explosion / Hidden Global State / Shared Context Everywhere / Shared Memory Everywhere / Infinite Delegation / Unobservable Agent / 群体无预算）；剩余 5 项（Tool Explosion / No State Ownership / Tight Runtime Coupling / Framework Lock-In / Everything-as-Agent）需要实例计数之外的语义或属设计元判断，留白。

## v11：目录全覆盖 —— 每章有落点，Runtime 族扩容

三波接入后目录 62 章全部有落点（设计可落点 ≠ 全量节点搬运，纯知识概念仍以知识卡承载）：

| 目录内容 | 落点 |
|---|---|
| §8 Runtime 族 | **3→5**：新增 `dag-runtime`（DAG 编排）/ `actor-runtime`（Actor 模型）；族限制元素（状态三件套）自动兼容 |
| §1.1 / §1.3 范式 | 新根 **范式层**：Agent 范式（reactive/deliberative/autonomous/human-guided…）+ 工作流范式（8 种编排形态枚举） |
| §2.5 / §48 / §45-47 | 多模型投票（消解幻觉）、置信度门禁（低置信不硬答）、反馈闭环 |
| §11 / §17 / §18 / §23 | 技能系统、死信队列、幂等设计、限流、故障诊断（补全 §61 兜底链：检测→诊断→恢复→降级→升级→终止） |
| §22 / §26 | 数据脱敏（观测引入敏感泄漏风险）、身份与认证、数据治理（分级/驻留） |
| §33-37 | 性能目标、扩展策略、部署形态、数据治理 —— 治理层五件套 |
| §14.7 / §49 | 知识溯源（幻觉引用风险的对冲） |
| §24 错误体系（续） | +7 风险：工具幻觉/长上下文退化/中段丢失/重复执行/敏感泄漏/幻觉引用/数据外泄（全部双向绑定） |

规模：**103 元素 / 35 风险 / 21 规则 / 5 族 / 9 根分区 / 6 模板**。

仍不进蓝图（设计时工具的本体纪律）：模型参数细项（运行时配置）、指标数值清单（观测实现）、§58-60 远景（编译/控制面）。§38-40 多模态/浏览器/Computer-Use 属工具能力域，由工具系统 + 企业扩展点承接。

## v10：知识图谱对齐第二波 —— Prompt 层 / 角色补全 / 反模式检测 / 领域模板

| 目录内容 | 落点 |
|---|---|
| §3 Prompt Engineering | harness 下新增 **Prompt 工程** 分区：Prompt 层级（优先级裁决）、Prompt 组装（static/dynamic/chained）；新风险 instruction-collision |
| §13.2 Roles 补全 | 新角色 **Judge / Router / Monitor / Critic**（均带职责模板 + 契约模板，质量门守护） |
| §13.1 Topology 补全 | 新拓扑 **流水线 / 群体**（流水线消解通信爆炸，群体引入通信爆炸 — 双向绑定） |
| §5.4 Memory 策略 | **程序记忆**（技能/套路）、**记忆整理**（反思/衰减/归档/摘要）；新风险 memory-pollution / stale-memory |
| §13.5 问题 | 新风险 supervisor-bottleneck（星型引入，层级消解） |
| §31 反模式（续） | 规则 +4：Prompt 单体 / 不可恢复工作流 / 群体无预算 / 辩论无裁决者；**节点级检查** God Agent（单角色 + 工具系统） |
| §42 / §43 领域模板 | **research-agent**（检索-取证-核验闭环，Reflexion + uses 关系）、**data-agent**（查询-验证闭环，最小权限 controls + 成本 observes） |

规模：**85 元素 / 28 风险 / 18 规则 / 6 模板**。反模式检测全部为建议级（info/warning），不阻断门禁。

未接入（刻意）：§8 Runtime 族扩容与 §1.3 Workflow 范式属于抽象层决策待拍板；§33-36 性能/部署/基础设施为运行时关注点；§45-49 学习/策略/置信度研究性过强。

## v9：知识图谱对齐 —— 接入《Agent Architecture Knowledge Graph》目录

[../目录.md](../目录.md) 是 62 章、覆盖 Agent 系统设计全知识面的目录（节点/属性/问题/兜底）。接入原则：**目录 ≠ 全部塞进可设计元素**，每类知识落到正确的模型层：

| 目录内容 | 落点 |
|---|---|
| §29.2 Architecture Relation（14 类型） | `RelationType` 词汇表 7→14（补 uses/calls/routes/reads/writes/publishes/subscribes） |
| §2 模型层 / §1.2 推理范式 / §6 规划 | 新根 **intelligence**：推理范式、模型接入（路由/输出护栏/升降级）、规划系统（计划校验/重规划） |
| §19 Human-in-the-Loop | 新根 **hitl**：人工审批门、人工升级 |
| §27 治理 / §32 成本 | 新根 **governance**：策略引擎、成本控制 |
| §20 评估 | 新根 **evaluation**：评估策略（黄金集/LLM Judge/影子/A-B） |
| §21 验证 / §23 可靠性 / §12 协议 | 既有分区扩展：验证门禁、熔断器、MCP 网关 |
| §24 错误体系 + 各章问题清单 | `risks.json` 18→24（无效输出/重试风暴/委派死循环/不可执行计划/重复劳动/评审偏差，双向绑定） |
| §31 反模式 | **pattern rules** 编码（v8 引擎即反模式检测器）：无界重试（参数级）/无人审批/级联无升降级/Judge 未校准/MCP 无沙箱，共 14 条规则 |
| §41 Coding Agent | 第 4 模板 **coding-agent**：规划-编码-评审闭环 + 沙箱 + 验证门禁 + 人工审批 + Plan-and-Execute |
| 纯知识概念（指标清单/生命周期状态/部署/基础设施） | 不进蓝图（非可设计组件），留给知识卡与远期域模板 |

规模：74 元素 / 24 风险 / 14 规则 / 4 模板。所有新元素过完整度质量门（知识卡六件套 + relations + 枚举带 alternatives）。

## v8：从树到图 —— Architecture Relation / Pattern Rule / Contract / Trade-off

v7 的抽象模型是树（分类关系），但 Agent 架构天然是图（架构关系）。v8 把架构语言补完整：**树负责分类，图负责架构**。

```
Blueprint（实例层）
  ├── nodes: 分类树（Harness → Context Engineering → ...）
  ├── relations: ArchitectureRelation[]  ← 树之外的图语义
  │     source —type→ target
  │     type ∈ contains | depends | communicates | produces | consumes | controls | observes
  │     例: Supervisor —controls→ Worker；Planner —produces→ 任务定义 ←consumes— Worker
  └── node.decision.tradeoffs / node.contract  ← ADR 权衡 + 组件契约

Constraint（不允许）与 Rule（建议考虑）分离
  ├── Constraint Engine（v7）: requires/forbids/taxonomy/族/参数 —— error 级，阻断审批
  └── Architecture Pattern Rules（v8，ontology/core/rules.json）:
        when: { allOf: [multi-agent, shared-memory], noneOf: [context-isolation], params?: [...] }
        then: { advice, level: info|warning, suggest }
        —— 架构推理而非规则匹配（如"多 Agent + 共享记忆 → 建议上下文隔离"），永不阻断
```

配套升级：

- **Decision Record + Trade-off**：`decision.tradeoffs: [{aspect, impact: positive|negative|neutral}]`——不只记录选择，还记录代价（成本↑/延迟↑/复杂度↑）
- **Component Contract**：`contract: {inputs, outputs, guarantees}`，元素带 `contractTemplate`（四个角色已预填），组件为什么连接由接口说明——架构从盒子图变成系统设计
- **图渲染**：SVG diagram 在分类树之上叠加彩色虚线关系边（Architecture View）；Inspector 内可编辑关系/契约/权衡
- **级联一致性**：删节点自动清理悬空关系（pruneRelations）；悬空/自环关系为 lint error，阻断审批；关系变更计 structural（bump sv）
- RuntimeFamily 保持不变（架构层抽象：event-driven / stateful-graph / stateless-loop，不锁实现）

## v7：Ontology 从"知识目录"到"架构语言"

每个架构元素不再是百科条目，而是一套可推理的**架构语义 + 知识卡**：

```
Architecture Element
  ├── 定义 / 层级（parentId + relations.allowedParents）
  ├── 实现方式 / 适用场景 / 优缺点 / 常见考量（Architecture Notes）
  ├── 参数 schema（含枚举选择）
  ├── 关系（relations）：dependsOn / incompatibleWith / allowedSiblings
  ├── 风险关联（mitigates / introduces，双向绑定）
  ├── 替代方案（alternatives，供决策参照）
  └── 参考实现（references）

Blueprint Node（实例）
  ├── 参数 + 设计理由
  ├── Decision Record：chosen / alternatives / rejectedReason（ADR 风格）
  └── Responsibility：owns / not（职责边界）
```

风险是**附属视图**（Architecture Notes），只在违反硬约束（依赖/互斥/族不可用/参数越界）时才阻断审批，不做"消风险式的生成"。

## 架构

```
agent-arch/
├── ontology/core/          # Core Ontology（Multi-Agent 基座 + RAG 族 + 目录对齐扩展）
│   ├── elements.json       #   46 个 multi-agent/harness 元素（角色带 contractTemplate）
│   ├── rag-elements.json   #   8 个 RAG 族元素
│   ├── extended-elements.json # 54 个目录对齐元素（四波：分区/角色/范式/治理/能力域）
│   ├── risks.json          #   35 个工程风险（双向绑定）
│   ├── rules.json          #   22 条架构模式规则（含反模式检测，建议级推理）
│   └── families.json       #   5 个 Runtime 能力族（设计时约束，不锁实现）
├── packages/
│   ├── core/               # 领域内核（零运行时依赖，纯 TS）
│   │   ├── types.ts        #   Ontology/Blueprint/Relation/Contract/Tradeoff/Rule 类型
│   │   ├── ontology.ts     #   加载 + 自校验（双向绑定、关系引用、环检测、规则引用）
│   │   ├── constraints.ts  #   Constraint Engine + 关系校验 + 模式规则评估 + 门禁
│   │   ├── relations.ts    #   ArchitectureRelation：类型词汇表/增删/悬空清理/校验
│   │   ├── rules.ts        #   Architecture Pattern Rules 匹配引擎（allOf/noneOf/params/family）
│   │   ├── risk.ts         #   风险激活/消解（附属视图，非阻断）
│   │   ├── blueprint.ts    #   蓝图操作 + 受约束调色板 + 职责/契约模板预填
│   │   ├── diff.ts         #   分级 diff（节点+关系=structural / 参数·决策·权衡·契约=minor）
│   │   ├── export.ts       #   分层导出（MUST/MAY YAML + relations + decisions/tradeoffs + contracts）
│   │   ├── diagram.ts      #   SVG：分类树 + 关系边叠加（Architecture View）
│   │   └── templates.ts    #   架构模板（blank / multi-agent / rag，返回 {nodes, relations}）
│   ├── server/             # API 服务（node:http，零框架）
│   │   └── api.ts          #   蓝图 CRUD（含 relations）+ 模板实例化 + 状态机 + 门禁 + 评论 + diff + 导出
│   └── web/                # 设计面板（Vite + React）
│       └── Designer.tsx    #   Ontology Explorer / 蓝图树 / Inspector（知识卡+决策+权衡+职责+契约+关系编辑器）
├── data/                   # 蓝图与评论存储（JSON 文件，git 忽略）
└── scripts/                # audit-ontology（完整度审计）/ patch-*（数据打磨）/ smoke
```

## 快速开始

```sh
pnpm install
pnpm build          # core → server → web
pnpm start          # http://127.0.0.1:4020
pnpm test           # core 单元测试（103 项）
pnpm smoke          # 端到端冒烟（128 项，临时隔离数据，不污染仓库）
pnpm audit:ontology # 本体字段完整度
pnpm audit:evidence # 证据覆盖与过期情况
```

开发模式（热更新 web）：

```sh
pnpm start                    # 终端 1：API + 静态托管
pnpm dev:web                  # 终端 2：Vite dev（/api 代理到 4020）
```

环境变量：`AGENT_ARCH_HOST`（默认 `127.0.0.1`，仅回环访问）、`AGENT_ARCH_PORT`（默认 4020）、`AGENT_ARCH_DATA_DIR`（默认 `./data`）、`AGENT_ARCH_ENT_DIR`（企业 Ontology 目录）、`AGENT_ARCH_IDENTITIES`（生产身份配置）。只有在前置认证代理与防火墙已经就绪时，才应显式设置 `AGENT_ARCH_HOST=0.0.0.0`。

生产模式身份示例：

```sh
export AGENT_ARCH_IDENTITIES='[{"token":"replace-with-secret","id":"alice","role":"architect","organizationId":"acme","projectId":"agent-platform"},{"token":"replace-reviewer-secret","id":"bob","role":"reviewer","organizationId":"acme","projectId":"agent-platform"}]'
pnpm start
```

设置该变量后所有 API 都要求 `Authorization: Bearer <token>`。未设置时进入明确的本地开发模式，可用 `X-AgentArch-*` 请求头模拟身份；该模式不应暴露到非可信网络。

## 核心概念与落地对照

| 思路.md 中的设计 | 实现 |
|---|---|
| Ontology（类型）/ Blueprint（实例）分离 | `ontology/core/*.json` vs `data/blueprints/*.json`，互不污染 |
| 架构关系模型 | `relations: allowedParents/allowedSiblings/incompatibleWith/dependsOn`，加载时引用强校验，lint 强制执行 |
| **树负责分类，图负责架构（v8）** | 蓝图 `relations: ArchitectureRelation[]`（14 种类型词汇表）；模板种子关系；悬空/自环在持久化前拒绝；删节点级联清理 |
| **Architecture Pattern Rules（v8）** | `ontology/core/rules.json`：when(allOf/noneOf/params/family) → then(advice/level/suggest)；建议级（info/warning）永不阻断 |
| **Decision + Trade-off（v8）** | `decision: chosen/alternatives/rejectedReason/tradeoffs[{aspect,impact}]`，导出 decisions+tradeoffs 段 |
| **Component Contract（v8）** | `contract: inputs/outputs/guarantees`；角色元素带 contractTemplate 预填；质量门单测守护 |
| Decision Record | `decision: chosen/alternatives/rejectedReason`，导出 `decisions:` 段，decision 缺失 info 提醒 |
| Responsibility 边界 | `responsibility: owns/not`，角色元素预填模板，导出 `responsibility:` 段 |
| 风险双向绑定（附属视图） | `mitigates ↔ mitigations` 强校验；风险为 Architecture Notes，**warning 级，不阻断审批** |
| Constraint Engine | requires/dependsOn/forbids/incompatibleWith/taxonomy/族过滤/参数 schema |
| 分层交付语义 | 导出 YAML 显式 MUST/MAY 分段；diff 区分 structural（节点+关系，bump sv）/ parameter·decision·contract（minor） |
| 审批门禁 | **仅硬约束 error**（依赖缺失/互斥/族不可用/参数越界/taxonomy/悬空关系）阻断 approved（HTTP 422） |
| 多人协作 | 状态机（draft/in-review/approved/rejected）+ 审批前撤回 + 节点级评论 + 只读保护 |
| Runtime 族（不锁实现） | 蓝图只记录 `runtimeFamily`（5 族：event-driven / stateful-graph / stateless-loop / dag-runtime / actor-runtime），族过滤元素可用性 |
| 架构浏览器 | 左侧双视图：蓝图树 / Ontology Explorer（Taxonomy View）；SVG diagram 叠加关系边（Architecture View） |
| 架构模板（正向设计起点） | 6 模板（blank / multi-agent / rag / coding-agent / research-agent / data-agent），`POST /api/blueprints {template}` 实例化（返回 {nodes, relations}） |
| Ontology 完整度门 | 全元素必须有知识卡六件套 + relations + 枚举元素必须有 alternatives + 角色必须有职责模板与契约模板（质量门单测守护） |
| Schema 版本迁移 | `ontology/core/schema.json` 声明 schemaVersion（1.2）+ rename 迁移；蓝图带版本戳，GET 时自动升级并持久化（幂等） |
| 操作审计 | `data/audit.jsonl` 追加留痕（actor/action/target/time）；HTTP 与 MCP 全通道埋点；面板可查 |
| 输入校验 | runtimeFamily/template/Brief/nodes/relations 深度校验；非法输入在持久化前以 4xx 拒绝 |

## API 一览

```
GET    /api/ontology                      # 本体（元素/风险/族/模式规则）
GET    /api/blueprints                    # 蓝图列表
POST   /api/blueprints                    # 创建：{template} 模板起步 或 {import: {nodes, relations}} 导入既有架构（§56）
GET    /api/blueprints/:id                # 详情 + 评论（含 relations）
PUT    /api/blueprints/:id                # 保存（nodes + relations；draft/rejected 可写；自动 diff + 版本/结构版本 bump）
POST   /api/blueprints/:id/transition     # 状态机 {to, actor}；approved 前过门禁
POST   /api/blueprints/:id/validate       # lint + gate + 风险报告
GET    /api/blueprints/:id/diff           # 最近两次保存的分级 diff
GET    /api/blueprints/:id/export         # 分层交付 YAML
GET    /api/blueprints/:id/diagram        # 蓝图 SVG 图形
GET/POST /api/blueprints/:id/comments     # 节点级评审评论
POST   /api/blueprints/:id/comments/:cid/toggle  # 评论标记解决/重开
GET    /api/extensions                    # 扩展点清单 + 企业元素清单（含 review 状态）
POST   /api/extensions                    # 提交企业元素 → review=pending（不入本体）；可选 actor
POST   /api/extensions/:id/review         # 审批：approved=true 合并入本体 / false 驳回；可选 actor
DELETE /api/extensions/:id                 # 删除企业元素
GET    /api/audit?limit=N                 # 操作审计（actor/action/target/time，最近 N 条）
```

## Architecture MCP（v2：AI 搭积木）

```sh
pnpm mcp            # 启动 stdio MCP 服务（零依赖 JSON-RPC）
```

让 AI（Claude Code / opencode 等）通过 MCP 在**约束引擎的看管下**组装架构。AI 只能选合法节点、填合法参数、建合法关系——不是自由设计，是受约束搭积木，因此不会瞎搞。

23 个工具：

| 类别 | 工具 |
|---|---|
| 知识 | list_templates / list_families / search_elements / get_element（完整知识卡+契约模板）/ list_risks |
| 蓝图 | list_blueprints / create_blueprint（模板起步，含种子关系）/ **import_blueprint**（导入既有架构，§56）/ get_blueprint（节点树 + 架构关系清单 + nodeId） |
| 组装 | **list_palette**（受约束调色板）/ **add_component**（挂载前校验）/ remove_component（级联清理关系）/ set_parameter（schema 校验） |
| 图语义 | **add_relation**（14 种类型，悬空/自环/重复拒绝）/ remove_relation / **set_contract**（inputs/outputs/guarantees） |
| 语义 | set_architecture_brief / set_decision（ADR + tradeoffs）/ set_responsibility（职责边界）/ add_comment |
| 辅助 | **get_design_guidance**（基于 Brief + 当前结构 + lint 给出就绪度和排序后的下一步任务） |
| 交付 | validate_blueprint（门禁）/ export_blueprint（分层 YAML，含 relations/contracts/tradeoffs） |

客户端配置（opencode / Claude Code）：

```json
{
  "mcp": {
    "agent-arch": {
      "type": "local",
      "command": ["node", "/path/to/design_agent/agent-arch/packages/mcp/dist/main.js"]
    }
  }
}
```

MCP 与 web 面板共享同一份数据（`data/` + `ontology/`），AI 搭的蓝图在面板里立即可见。

## 当前明确不做

可运行工程编译、生产 Runtime 观察和反向工程。Architecture MCP 已实现；平台聚焦设计与评审，不承担 Agent 执行控制面。
