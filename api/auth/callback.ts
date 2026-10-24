import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exchangeCode } from "../../lib/msauth.js";
import { saveRefreshToken } from "../../lib/tokens.js";

function page(res: VercelResponse, status: number, title: string, message: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  res
    .status(status)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Set-Cookie", "ms_oauth_state=; Path=/api/auth; Max-Age=0")
    .send(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
        `<title>${esc(title)}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
        `<h1>${esc(title)}</h1><p>${esc(message)}</p></body>`
    );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state, error, error_description } = req.query;

  if (error) return page(res, 400, "Autorização recusada", String(error_description ?? error));
  if (typeof code !== "string" || typeof state !== "string") {
    return page(res, 400, "Requisição inválida", "Faltou o código de autorização.");
  }
  if (!req.cookies?.ms_oauth_state || req.cookies.ms_oauth_state !== state) {
    return page(res, 400, "Sessão expirada", "Abra o link de login de novo e conclua em até 10 minutos.");
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      return page(res, 500, "Sem refresh token", "Confira se a permissão offline_access está no app do Entra.");
    }
    const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => r.json() as Promise<{ displayName?: string; userPrincipalName?: string }>);

    const account = me.displayName ?? me.userPrincipalName ?? "conta Microsoft";
    await saveRefreshToken(tokens.refresh_token, account);
    return page(res, 200, "Conectado ✓", `To Do de ${account} conectado. Pode fechar esta aba.`);
  } catch (e) {
    return page(res, 500, "Erro ao conectar", e instanceof Error ? e.message : String(e));
  }
}
