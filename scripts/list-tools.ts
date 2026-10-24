// Teste local sem rede: conecta um cliente MCP em memória e lista as ferramentas.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../lib/server.js";

const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await buildServer().connect(serverT);
const client = new Client({ name: "teste-local", version: "0.0.1" });
await client.connect(clientT);

const { tools } = await client.listTools();
for (const t of tools) {
  console.log(`- ${t.name}: ${Object.keys((t.inputSchema as any).properties ?? {}).join(", ") || "(sem parâmetros)"}`);
}

// Validação de entrada deve rejeitar data inválida antes de chegar ao Graph:
try {
  const bad = await client.callTool({ name: "tarefas_do_dia", arguments: { data: "24/10/2026" } });
  console.log("\nData inválida ->", JSON.stringify(bad).slice(0, 160));
} catch (e) {
  console.log("\nData inválida -> rejeitada:", e instanceof Error ? e.message.slice(0, 160) : e);
}

await client.close();
