import type { VercelRequest, VercelResponse } from "@vercel/node";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { secretMatches } from "../../lib/env.js";
import { buildServer } from "../../lib/server.js";

// URL do conector: https://SEU-DOMINIO/api/mcp/<MCP_SECRET>
// Modo stateless: um servidor novo por requisição (combina com funções serverless).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!secretMatches(req.query.key)) {
    res.status(404).send("Not found");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    return;
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
}
