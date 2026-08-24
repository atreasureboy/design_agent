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

默认工作流不再从“浏览组件目录”开始，而是从业务目标、用例、数据敏感度、自治程度和 NFR 出发。Architecture Copilot 会计算设计就绪度，解释当前最大缺口，并给出可执行的下一步任务；同一建议引擎也通过 MCP 提供给 AI 客户端。

## 快速开始

```sh
cd agent-arch
pnpm install
pnpm build
pnpm start          # http://127.0.0.1:4020
pnpm test           # 103 项核心测试
pnpm smoke          # 128 项端到端冒烟
```

## 当前范围纪律

不负责运行 Agent、生成可运行工程或观测生产运行时；聚焦设计上下文、架构语言、评审治理和结构化交付。

## License

MIT
