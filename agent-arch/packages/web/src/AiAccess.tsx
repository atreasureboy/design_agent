import { useState } from "react";

const serverRoot = "/project/design_agent/agent-arch";
const mcpEntry = `${serverRoot}/packages/mcp/dist/main.js`;

const configs = [
  {
    id: "codex-local",
    label: "Codex · 服务器内",
    note: "Codex 与项目运行在同一台服务器时，直接注册 STDIO MCP。",
    code: `codex mcp add agent-arch -- node ${mcpEntry}\ncodex mcp list`,
  },
  {
    id: "claude-local",
    label: "Claude Code · 服务器内",
    note: "保存为项目根目录 .mcp.json；仓库已内置这份配置。",
    code: JSON.stringify({ mcpServers: { "agent-arch": { command: "node", args: [mcpEntry] } } }, null, 2),
  },
  {
    id: "codex-remote",
    label: "Codex · Windows 经 SSH",
    note: "MCP 的 stdin/stdout 走 SSH，不需要开放新的公网端口。请替换 Windows 用户名。",
    code: `[mcp_servers.agent_arch]\ncommand = "ssh"\nargs = ["-i", "C:\\\\Users\\\\YOUR_NAME\\\\.ssh\\\\id_ed25519_la_fortress", "root@146.71.98.11", "cd ${serverRoot} && exec node packages/mcp/dist/main.js"]\nstartup_timeout_sec = 20\ntool_timeout_sec = 120`,
  },
  {
    id: "claude-remote",
    label: "Claude Code · Windows 经 SSH",
    note: "放进本机 Claude Code 的 MCP 配置；请替换 Windows 用户名。",
    code: JSON.stringify({ mcpServers: { "agent-arch": { command: "ssh", args: ["-i", "C:\\Users\\YOUR_NAME\\.ssh\\id_ed25519_la_fortress", "root@146.71.98.11", `cd ${serverRoot} && exec node packages/mcp/dist/main.js`] } } }, null, 2),
  },
];

const delegationPrompt = `使用 AgentArch MCP 设计本系统的 Agent 架构：
1. 先读取模板、Runtime 族和已有蓝图；
2. 填写 Architecture Brief，明确目标、用例、约束、数据分级、自治程度、NFR 与验收标准；
3. 创建或导入蓝图，并根据 get_design_guidance 逐项补齐；
4. 每次修改前读取蓝图最新 version，并把它作为 expectedVersion；冲突时重新读取，不覆盖他人修改；
5. 补齐组件关系、职责、契约和关键决策；
6. 最后执行 validate_blueprint，通过后导出并总结仍需人工裁决的权衡。`;

export function AiAccess({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => current === id ? null : current), 1600);
  };

  return (
    <div className="ai-access-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ai-access" role="dialog" aria-modal="true" aria-label="AI 接入中心">
        <header className="ai-access-head">
          <div><span>AGENT DELEGATION</span><h2>把架构设计委托给 Claude Code / Codex</h2><p>MCP 负责 Agent 的语义化操作，HTTP API 继续服务 Web 与企业集成；二者共享同一份蓝图和约束引擎。</p></div>
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </header>

        <div className="ai-access-flow">
          <div><strong>01</strong><span>连接 MCP</span><small>STDIO 或 SSH-STDIO</small></div><i>→</i>
          <div><strong>02</strong><span>交代设计任务</span><small>目标、约束、验收</small></div><i>→</i>
          <div><strong>03</strong><span>受约束修改</span><small>版本冲突不会覆盖</small></div><i>→</i>
          <div><strong>04</strong><span>回到 Web 评审</span><small>校验、图谱、导出</small></div>
        </div>

        <div className="ai-access-grid">
          {configs.map((config) => (
            <article className="ai-config-card" key={config.id}>
              <div className="ai-config-title"><div><strong>{config.label}</strong><p>{config.note}</p></div><button className="btn small" onClick={() => copy(config.id, config.code)}>{copied === config.id ? "已复制" : "复制"}</button></div>
              <pre>{config.code}</pre>
            </article>
          ))}
        </div>

        <article className="ai-prompt-card">
          <div className="ai-config-title"><div><strong>推荐委托提示词</strong><p>把需求文档或仓库上下文附在这段话后面。</p></div><button className="btn small primary" onClick={() => copy("prompt", delegationPrompt)}>{copied === "prompt" ? "已复制" : "复制提示词"}</button></div>
          <pre>{delegationPrompt}</pre>
        </article>
      </section>
    </div>
  );
}
