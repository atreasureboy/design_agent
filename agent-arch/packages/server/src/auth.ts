import type { IncomingMessage } from "node:http";

export type Role = "admin" | "architect" | "reviewer" | "viewer";
export interface Principal { id: string; role: Role; organizationId: string; projectId: string }

interface ConfiguredIdentity extends Principal { token: string }
let cachedRaw: string | undefined;
let cachedIdentities: ConfiguredIdentity[] | null = null;

function configuredIdentities(): ConfiguredIdentity[] | null {
  const raw = process.env.AGENT_ARCH_IDENTITIES;
  if (!raw) return null;
  if (raw === cachedRaw) return cachedIdentities;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("AGENT_ARCH_IDENTITIES 必须是 JSON 数组");
  for (const [index, item] of parsed.entries()) {
    if (typeof item !== "object" || item === null) throw new Error(`AGENT_ARCH_IDENTITIES[${index}] 非法`);
    const identity = item as Partial<ConfiguredIdentity>;
    if (!identity.token || !identity.id || !identity.organizationId || !identity.projectId || !identity.role || !["admin", "architect", "reviewer", "viewer"].includes(identity.role)) {
      throw new Error(`AGENT_ARCH_IDENTITIES[${index}] 缺少 token/id/role/organizationId/projectId 或 role 非法`);
    }
  }
  cachedRaw = raw;
  cachedIdentities = parsed as ConfiguredIdentity[];
  return cachedIdentities;
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

export function authenticate(req: IncomingMessage): Principal {
  const identities = configuredIdentities();
  if (identities) {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const identity = identities.find((x) => x.token === token);
    if (!identity) throw new AuthError(401, "需要有效的 Bearer 身份令牌");
    return { id: identity.id, role: identity.role, organizationId: identity.organizationId, projectId: identity.projectId };
  }
  const role = String(req.headers["x-agentarch-role"] ?? "admin") as Role;
  if (!["admin", "architect", "reviewer", "viewer"].includes(role)) throw new AuthError(401, "身份角色非法");
  return {
    id: String(req.headers["x-agentarch-user"] ?? "local-admin"), role,
    organizationId: String(req.headers["x-agentarch-org"] ?? "local"), projectId: String(req.headers["x-agentarch-project"] ?? "default"),
  };
}

export function requireRole(principal: Principal, roles: Role[]): void {
  if (!roles.includes(principal.role)) throw new AuthError(403, `角色 ${principal.role} 无权执行此操作`);
}
