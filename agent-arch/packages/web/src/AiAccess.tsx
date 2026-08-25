import { useState } from "react";

const serverRoot = "/project/design_agent/agent-arch";
const mcpEntry = `${serverRoot}/packages/mcp/dist/main.js`;

const configs = [
  {
    id: "codex-local",
    label: "Codex · 服务器内",
    note: "Codex 与项目运行在同一台服务器时，直接注册 STDIO MCP。",
    code: `# 项目已内置 .codex/config.toml，并将实时操作者标记为 Codex\ncodex mcp list`,
  },
  {
    id: "claude-local",
    label: "Claude Code · 服务器内",
    note: "保存为项目根目录 .mcp.json；仓库已内置这份配置。",
    code: JSON.stringify({ mcpServers: { "agent-arch": { command: "node", args: [mcpEntry], env: { AGENT_ARCH_MCP_ACTOR: "Claude Code" } } } }, null, 2),
  },
  {
    id: "codex-remote",
    label: "Codex · Windows 经 SSH",
    note: "MCP 的 stdin/stdout 走 SSH，不需要开放新的公网端口。请替换 Windows 用户名。",
    code: `[mcp_servers.agent_arch]\ncommand = "ssh"\nargs = ["-i", "C:\\\\Users\\\\YOUR_NAME\\\\.ssh\\\\id_ed25519_la_fortress", "root@146.71.98.11", "cd ${serverRoot} && AGENT_ARCH_MCP_ACTOR=Codex exec node packages/mcp/dist/main.js"]\nstartup_timeout_sec = 20\ntool_timeout_sec = 120`,
  },
  {
    id: "claude-remote",
    label: "Claude Code · Windows 经 SSH",
    note: "放进本机 Claude Code 的 MCP 配置；请替换 Windows 用户名。",
    code: JSON.stringify({ mcpServers: { "agent-arch": { command: "ssh", args: ["-i", "C:\\Users\\YOUR_NAME\\.ssh\\id_ed25519_la_fortress", "root@146.71.98.11", `cd ${serverRoot} && AGENT_ARCH_MCP_ACTOR='Claude Code' exec node packages/mcp/dist/main.js`] } } }, null, 2),
  },
];

const delegationPrompt = `使用 AgentArch MCP 主导本系统的 Agent 架构设计。

1. 首先调用 get_clarification_protocol，严格遵守其中的访谈协议；
2. 查找或创建需求澄清会话。没有会话时调用 create_design_session；
3. 每轮调用 publish_question_round 发布恰好 10 道题。优先使用选择题，A/B/C 为可判断的方案，D 固定为可自由补充的“其他”；
4. 发布后停止工作并等待用户在 Web 作答。不要代替用户回答；
5. 用户回答后调用 get_design_session，完整读取 session_id（用户回复）.md，更新已确认事实、矛盾、未知项与理解度；
6. 如果对需求的理解不足 95%，继续发布下一轮 10 题。问题必须针对剩余的高影响缺口，不重复询问已确认内容；
7. 理解度达到 95% 后，调用 finalize_architecture_document 撰写完整的 架构.md。架构.md 是唯一最终产物，必须能够独立指导后续实现，不能用“见会话记录”代替设计内容；
8. 最终文档完成后，才按需把其中的结构同步为蓝图/图谱。图谱是派生视图，不是最终交付物。`;

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
          <div><span>AGENT DELEGATION</span><h2>让 Claude Code / Codex 主导架构访谈</h2><p>Agent 负责每轮出 10 题、持续评估理解度并撰写架构.md；Web 负责低负担答题和保存用户回复。</p></div>
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </header>

        <div className="ai-access-flow">
          <div><strong>01</strong><span>连接 MCP</span><small>STDIO 或 SSH-STDIO</small></div><i>→</i>
          <div><strong>02</strong><span>Agent 每轮出题</span><small>固定 10 题，优先选择</small></div><i>→</i>
          <div><strong>03</strong><span>理解达到 95%</span><small>用户回复持续沉淀</small></div><i>→</i>
          <div><strong>04</strong><span>交付架构.md</span><small>图谱作为派生视图</small></div>
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
