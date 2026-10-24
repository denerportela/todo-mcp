import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

const TABLE = "ms_todo_tokens";
const ROW_ID = "default";

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  client ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export async function loadRefreshToken(): Promise<string | null> {
  const { data, error } = await db()
    .from(TABLE)
    .select("refresh_token")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data?.refresh_token ?? null;
}

export async function saveRefreshToken(refreshToken: string, accountName?: string): Promise<void> {
  const row: Record<string, string> = {
    id: ROW_ID,
    refresh_token: refreshToken,
    updated_at: new Date().toISOString(),
  };
  if (accountName) row.account_name = accountName;
  const { error } = await db().from(TABLE).upsert(row);
  if (error) throw new Error(`Supabase: ${error.message}`);
}
