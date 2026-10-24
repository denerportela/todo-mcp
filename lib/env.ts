import { timingSafeEqual } from "node:crypto";

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

/** Compara segredos em tempo constante. */
export function secretMatches(received: unknown): boolean {
  const expected = process.env.MCP_SECRET;
  if (!expected || typeof received !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
