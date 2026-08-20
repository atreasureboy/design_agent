# design_agent

> Agent 架构领域的 Kubernetes API + Dashboard —— 企业级 Agent 架构设计平台的设计与实现。

**解决的真问题：现在企业知道怎么部署 Agent，但不知道怎么设计 Agent。**

本仓库包含：

- **[思路.md](思路.md)** — 完整设计构想（v5）：定位、Ontology 壁垒、类型/实例分离、风险双向绑定、分层交付语义、Runtime 族、Core/企业两层、演进路线
- **[agent-arch/](agent-arch/)** — v1 实现：Core Ontology（Multi-Agent 基座，46 元素 / 15 风险 / 3 Runtime 族）+ 约束引擎 + 审批门禁 + web 设计面板

核心概念：

| 概念 | 一句话 |
|---|---|
| Ontology | Agent 世界的 Pod/Service/Deployment —— 平台的核心壁垒 |
| Blueprint | 架构蓝图：结构 = MUST（偏离需重审），参数 = MAY（实现可调） |
| 风险双向绑定 | 挂元素即消解风险；高危未消解阻断审批 |
| Runtime 族 | 设计时锁能力族不锁实现，蓝图运行时无关 |

## 快速开始

```sh
cd agent-arch
pnpm install
pnpm build
pnpm start          # http://127.0.0.1:4020
pnpm test           # 15 项单元测试
pnpm smoke          # 23 项端到端冒烟
```

## 范围纪律（v1 不做）

可运行工程编译、运行观察、反向 MCP、Architecture MCP、多 Ontology 目标 —— 详见思路.md 第十节。

## License

MIT
