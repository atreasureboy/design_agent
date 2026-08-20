# AgentArch — 企业级 Agent 架构设计平台

> Agent 架构领域的 Kubernetes API + Dashboard。设计构想见 [../思路.md](../思路.md)。

**解决的真问题：企业知道怎么部署 Agent，但不知道怎么设计 Agent。**

平台不运行 Agent、不生成代码——它让架构师在受约束的本体树（Ontology）上协作设计 Agent 系统架构，产出**分层规范蓝图**（结构 = MUST / 参数 = MAY），配合风险消解系统与审批门禁。

## 架构

```
agent-arch/
├── ontology/core/          # Core Ontology v0（Multi-Agent 基座）
│   ├── elements.json       #   46 个架构元素（harness/上下文工程/拓扑/生命周期/角色…）
│   ├── risks.json          #   15 个工程风险（双向绑定消解手段）
│   └── families.json       #   3 个 Runtime 能力族（设计时约束，不锁实现）
├── packages/
│   ├── core/               # 领域内核（零运行时依赖，纯 TS）
│   │   ├── types.ts        #   Ontology/Blueprint/Risk/Comment/LintIssue 类型系统
│   │   ├── ontology.ts     #   加载 + 自校验（含双向绑定一致性、环检测）
│   │   ├── constraints.ts  #   Constraint Engine：requires/forbids/taxonomy/参数/族 + 审批门禁
│   │   ├── risk.ts         #   风险激活/消解计算（双向绑定）
│   │   ├── blueprint.ts    #   蓝图操作 + 受约束调色板（paletteFor）
│   │   ├── diff.ts         #   分级 diff（structural=major / parameter=minor）
│   │   └── export.ts       #   分层导出（MUST/MAY 语义 YAML）
│   ├── server/             # API 服务（node:http，零框架）
│   │   └── api.ts          #   蓝图 CRUD + 状态机 + 门禁 + 评论 + diff + 导出
│   └── web/                # 设计面板（Vite + React）
│       └── Designer.tsx    #   三栏设计器：架构树 / 调色板+详情 / 风险·校验·评论·diff·导出
├── data/                   # 蓝图与评论存储（JSON 文件，git 忽略）
└── scripts/smoke.mjs       # 端到端冒烟（23 项）
```

## 快速开始

```sh
pnpm install
pnpm build          # core → server → web
pnpm start          # http://127.0.0.1:4020
pnpm test           # core 单元测试（15 项）
pnpm smoke          # 端到端冒烟（23 项，临时数据目录，不污染 data/）
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
| 风险双向绑定 | 元素 `mitigates` ↔ 风险 `mitigations`，加载时强校验；面板一键挂载消解元素 |
| Constraint Engine | requires / forbids / suggests / taxonomy（父子关系）/ runtime 族过滤 / required 子项 / 参数 schema |
| 分层交付语义（结构 MUST / 参数 MAY） | 导出 YAML 显式分段；diff 区分 structural（bump sv，重审）/ parameter（minor） |
| 审批门禁 | error 级问题（含高危风险未消解）阻断 approved 转移（HTTP 422） |
| 多人协作 | 蓝图状态机（draft/in-review/approved/rejected）+ 节点级评论 + 只读保护 + 当前用户切换 |
| Runtime 族（不锁实现） | 蓝图只记录 `runtimeFamily`，族作为约束来源过滤元素可用性 |
| 企业扩展点（CRD 模式） | `extensionPoint: true` 的元素已标记（tool-system/observability/multi-agent/agents） |
| Core Ontology v1 范围纪律 | 只含 Multi-Agent 通用基座，46 元素 / 15 风险 / 3 族 |

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
```

## v1 明确不做（范围纪律，见思路.md 第十节）

可运行工程编译、运行观察、反向 MCP、Architecture MCP（AI 搭积木）、多 Ontology 目标。
