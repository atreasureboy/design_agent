# design_agent

> Agent 架构领域的 Kubernetes API + Dashboard —— 企业级 Agent 架构设计平台的设计与实现。

**解决的真问题：现在企业知道怎么部署 Agent，但不知道怎么设计 Agent。**

本仓库包含：

- **[思路.md](思路.md)** — 持续演进的产品与架构构想
- **[agent-arch/](agent-arch/)** — 当前实现：Architecture Copilot 工作台 + Architecture Brief + Core/Enterprise Ontology（114 元素 / 35 风险 / 5 Runtime 族）+ 约束引擎 + RBAC 审批门禁 + Web/MCP 设计面板

核心概念：

| 概念 | 一句话 |
|---|---|
| Ontology | Agent 世界的 Pod/Service/Deployment —— 平台的核心壁垒 |
| Blueprint | 架构蓝图：结构 = MUST（偏离需重审），参数 = MAY（实现可调） |
| 风险双向绑定 | 挂元素即记录风险消解；风险作为架构注记，硬约束才阻断审批 |
| Runtime 族 | 设计时锁能力族不锁实现，蓝图运行时无关 |

默认工作流不再要求用户自己搭架构。Coding Agent 按固定协议主导需求澄清，每轮向 Web 发布 10 道以选择题为主的问题；用户回答持续沉淀为 `session_id（用户回复）.md`。只有 Agent 对需求的理解度达到 95%，才会生成唯一最终产物 `架构.md`；蓝图和图谱是由最终设计派生的审阅视图。

仓库内置 Codex 项目级 [`.codex/config.toml`](.codex/config.toml) 和 Claude Code [`.mcp.json`](.mcp.json)。Web 顶栏的“连接 AI”提供服务器内与 Windows SSH 两种接入配置、可复制委托提示词；MCP 写操作使用 `expectedVersion` 与跨进程原子锁，多个 Agent 不会静默覆盖同一蓝图。

## 快速开始

```sh
cd agent-arch
pnpm install
pnpm build
pnpm start          # http://127.0.0.1:4020
pnpm test           # 106 项核心测试
pnpm smoke          # 143 项端到端冒烟
```

## 当前范围纪律

不负责运行 Agent、生成可运行工程或观测生产运行时；聚焦设计上下文、架构语言、评审治理和结构化交付。

## License

MIT
