import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { secretMatches } from "../../lib/env.js";
import { authorizeUrl } from "../../lib/msauth.js";

// Uso: abra https://SEU-DOMINIO/api/auth/login?key=<MCP_SECRET> uma vez.
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!secretMatches(req.query.key)) {
    res.status(404).send("Not found");
    return;
  }
  const state = randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `ms_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=600`
  );
  res.redirect(302, authorizeUrl(state));
}
