import { env } from "./env.js";
import { loadRefreshToken, saveRefreshToken } from "./tokens.js";

export const SCOPES = "offline_access User.Read Tasks.ReadWrite";

function authority(): string {
  return `https://login.microsoftonline.com/${env("MS_TENANT", "consumers")}/oauth2/v2.0`;
}

export function redirectUri(): string {
  return `${env("BASE_URL")}/api/auth/callback`;
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env("MS_CLIENT_ID"),
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
  return `${authority()}/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: env("MS_CLIENT_ID"),
    client_secret: env("MS_CLIENT_SECRET"),
    scope: SCOPES,
    ...params,
  });
  const res = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new Error(`Falha no token Microsoft (${json.error}): ${json.error_description ?? res.status}`);
  }
  return json;
}

// Cache em memória: vale enquanto a função serverless estiver "quente".
let cache: { token: string; expiresAt: number } | null = null;

function remember(t: TokenResponse) {
  cache = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });
  remember(t);
  return t;
}

// Um único refresh por vez: chamadas paralelas esperam o mesmo resultado em vez de
// cada uma trocar (e invalidar) o refresh token da outra.
let refreshing: Promise<string> | null = null;

export async function getAccessToken(): Promise<string> {
  if (cache && cache.expiresAt - 60_000 > Date.now()) return cache.token;
  refreshing ??= refreshAccessToken().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = await loadRefreshToken();
  if (!refreshToken) {
    throw new Error(
      "Conta Microsoft ainda não conectada. Abra /api/auth/login?key=<MCP_SECRET> no navegador para autorizar."
    );
  }

  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  // A Microsoft devolve um refresh token novo a cada uso: guardar sempre o mais recente.
  if (t.refresh_token && t.refresh_token !== refreshToken) {
    await saveRefreshToken(t.refresh_token);
  }
  remember(t);
  return t.access_token;
}
