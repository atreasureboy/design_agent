# AgentArch — 企业级 Agent 架构设计平台

> Agent 架构 CAD / Enterprise Agent Design Tool。设计构想见 [../思路.md](../思路.md)。

**解决的真问题：企业知道怎么部署 Agent，但不知道怎么设计 Agent。**

平台不运行 Agent、不生成代码——它让架构师在受约束的**架构语言（Ontology）**上协作设计 Agent 系统架构，产出**分层规范蓝图**（结构 = MUST / 参数 = MAY）。不是流程图工具，也不是风险扫描器。

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
├── ontology/core/          # Core Ontology（Multi-Agent 基座 + RAG 族）
│   ├── elements.json       #   46 个 multi-agent/harness 元素
│   ├── rag-elements.json   #   8 个 RAG 族元素
│   ├── risks.json          #   18 个工程风险（双向绑定）
│   └── families.json       #   3 个 Runtime 能力族（设计时约束，不锁实现）
├── packages/
│   ├── core/               # 领域内核（零运行时依赖，纯 TS）
│   │   ├── types.ts        #   Ontology/Blueprint/Risk/Decision/Responsibility 类型
│   │   ├── ontology.ts     #   加载 + 自校验（双向绑定、关系引用、环检测）
│   │   ├── constraints.ts  #   Constraint Engine：requires/relations/taxonomy/参数/族 + 门禁
│   │   ├── risk.ts         #   风险激活/消解（附属视图，非阻断）
│   │   ├── blueprint.ts    #   蓝图操作 + 受约束调色板 + 职责模板预填
│   │   ├── diff.ts         #   分级 diff（structural=major / parameter·decision·responsibility=minor）
│   │   ├── export.ts       #   分层导出（MUST/MAY YAML + decisions + responsibilities）
│   │   └── templates.ts    #   架构模板（blank / multi-agent / rag）
│   ├── server/             # API 服务（node:http，零框架）
│   │   └── api.ts          #   蓝图 CRUD + 模板实例化 + 状态机 + 门禁 + 评论 + diff + 导出
│   └── web/                # 设计面板（Vite + React）
│       └── Designer.tsx    #   Ontology Explorer / 蓝图树 / Inspector（知识卡+决策+职责）
├── data/                   # 蓝图与评论存储（JSON 文件，git 忽略）
└── scripts/                # audit-ontology（完整度审计）/ patch-*（数据打磨）/ smoke
```

## 快速开始

```sh
pnpm install
pnpm build          # core → server → web
pnpm start          # http://127.0.0.1:4020
pnpm test           # core 单元测试（29 项，含 Ontology 质量门）
pnpm smoke          # 端到端冒烟（28 项，临时数据目录，不污染 data/）
```

开发模式（热更新 web）：

```sh
pnpm start                    # 终端 1：API + 静态托管
pnpm dev:web                  # 终端 2：Vite dev（/api 代理到 4020）
```

环境变量：`AGENT_ARCH_PORT`（默认 4020）、`AGENT_ARCH_DATA_DIR`（默认 `./data`）。

## 核心概念与落地对照

| 思路.md 中的设计 | 实现 |
|---|---|
| Ontology（类型）/ Blueprint（实例）分离 | `ontology/core/*.json` vs `data/blueprints/*.json`，互不污染 |
| 架构关系模型 | `relations: allowedParents/allowedSiblings/incompatibleWith/dependsOn`，加载时引用强校验，lint 强制执行 |
| Decision Record | `decision: chosen/alternatives/rejectedReason`，导出 `decisions:` 段，decision 缺失 info 提醒 |
| Responsibility 边界 | `responsibility: owns/not`，角色元素预填模板，导出 `responsibility:` 段 |
| 风险双向绑定（附属视图） | `mitigates ↔ mitigations` 强校验；风险为 Architecture Notes，**warning 级，不阻断审批** |
| Constraint Engine | requires/dependsOn/forbids/incompatibleWith/taxonomy/族过滤/参数 schema |
| 分层交付语义 | 导出 YAML 显式 MUST/MAY 分段；diff 区分 structural（bump sv）/ parameter·decision·responsibility（minor） |
| 审批门禁 | **仅硬约束 error**（依赖缺失/互斥/族不可用/参数越界/taxonomy）阻断 approved（HTTP 422） |
| 多人协作 | 状态机（draft/in-review/approved/rejected）+ 审批前撤回 + 节点级评论 + 只读保护 |
| Runtime 族（不锁实现） | 蓝图只记录 `runtimeFamily`，族过滤元素可用性 |
| 架构浏览器 | 左侧双视图：蓝图树 / Ontology Explorer（Agent Architecture Tree）；Inspector 只读知识卡 |
| 架构模板（正向设计起点） | blank / multi-agent / rag 三模板，`POST /api/blueprints {template}` 实例化 |
| Ontology 完整度门 | 全元素必须有知识卡六件套 + relations + 枚举元素必须有 alternatives + 角色必须有职责模板（质量门单测守护） |

## API 一览

```
GET    /api/ontology                      # 本体（元素/风险/族）
GET    /api/blueprints                    # 蓝图列表
POST   /api/blueprints                    # 创建
GET    /api/blueprints/:id                # 详情 + 评论
PUT    /api/blueprints/:id                # 保存（draft/rejected 可写；自动 diff + 版本/结构版本 bump）
POST   /api/blueprints/:id/transition     # 状态机 {to, actor}；approved 前过门禁
POST   /api/blueprints/:id/validate       # lint + gate + 风险报告
GET    /api/blueprints/:id/diff           # 最近两次保存的分级 diff
GET    /api/blueprints/:id/export         # 分层交付 YAML
GET/POST /api/blueprints/:id/comments     # 节点级评审评论
POST   /api/blueprints/:id/comments/:cid/toggle  # 评论标记解决/重开
GET    /api/extensions                    # 扩展点清单 + 企业元素清单
POST   /api/extensions                    # 在扩展点上创建企业元素（CRD）
DELETE /api/extensions/:id                 # 删除企业元素
```

## v1 明确不做（范围纪律，见思路.md 第十节）

可运行工程编译、运行观察、反向 MCP、Architecture MCP（AI 搭积木）、多 Ontology 目标。
