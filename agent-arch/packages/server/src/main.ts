import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./api.js";
import { loadOntology } from "./storage.js";

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, "../../web/dist");

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(pathname: string, res: import("node:http").ServerResponse): boolean {
  let filePath = join(webDist, pathname === "/" ? "index.html" : pathname);
  if (!existsSync(filePath)) {
    filePath = join(webDist, "index.html");
    if (!existsSync(filePath)) return false;
  }
  const type = mime[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  res.end(readFileSync(filePath));
  return true;
}

const ontology = loadOntology();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  try {
    if (await handleApi(req, res, { ontology })) return;
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    }
    return;
  }
  if (serveStatic(url.pathname, res)) return;
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const port = Number(process.env.AGENT_ARCH_PORT ?? 4020);
server.listen(port, () => {
  console.log(`AgentArch server listening on http://127.0.0.1:${port}`);
  console.log(`ontology: ${ontology.elements.length} elements, ${ontology.risks.length} risks, ${ontology.families.length} families`);
});
