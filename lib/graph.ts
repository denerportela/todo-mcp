import { env } from "./env.js";
import { getAccessToken } from "./msauth.js";

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface DateTimeTZ {
  dateTime: string;
  timeZone: string;
}

export interface TodoList {
  id: string;
  displayName: string;
  isOwner: boolean;
  isShared: boolean;
  wellknownListName: "none" | "defaultList" | "flaggedEmails" | string;
}

export interface TodoTask {
  id: string;
  title: string;
  status: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred";
  importance: "low" | "normal" | "high";
  isReminderOn: boolean;
  dueDateTime?: DateTimeTZ | null;
  reminderDateTime?: DateTimeTZ | null;
  completedDateTime?: DateTimeTZ | null;
  recurrence?: { pattern?: { type?: string; interval?: number; daysOfWeek?: string[] } } | null;
  body?: { content: string; contentType: string } | null;
  createdDateTime: string;
  lastModifiedDateTime: string;
}

export interface ChecklistItem {
  id: string;
  displayName: string;
  isChecked: boolean;
}

// ---------- controle de carga ----------
// O To Do roda no serviço do Outlook, que limita pedidos SIMULTÂNEOS por caixa de correio
// (poucos de cada vez). Rajadas em paralelo são a causa típica do 429, então todo acesso
// ao Graph passa por este semáforo.
const MAX_CONCURRENT = Number(env("GRAPH_MAX_CONCURRENT", "2"));
let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  // quem liberou a vaga já a repassou para nós (active não diminuiu)
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

const RETRYABLE = new Set([429, 503, 504]);
const MAX_ATTEMPTS = 5;
// Teto do tempo total de espera, para não estourar o timeout da função na Vercel.
const MAX_TOTAL_WAIT_MS = Number(env("GRAPH_MAX_WAIT_MS", "25000"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quanto esperar: Retry-After do Graph quando vier; senão backoff exponencial com jitter. */
function retryDelay(res: Response | null, attempt: number): number {
  const header = res?.headers.get("Retry-After");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return secs * 1000;
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const base = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s, 8s
  return base + Math.random() * 500;
}

/** Chamada ao Graph. `path` pode ser relativo (/me/...) ou URL absoluta (nextLink). */
export async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  let waited = 0;

  for (let attempt = 1; ; attempt++) {
    const token = await getAccessToken();
    let res: Response | null = null;
    let networkError: unknown = null;

    await acquire();
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          // Devolve datas já no fuso local, em vez de UTC.
          Prefer: `outlook.timezone="${env("GRAPH_TIMEZONE", "E. South America Standard Time")}"`,
        },
      });
    } catch (e) {
      networkError = e;
    } finally {
      release();
    }

    // 429 = pedido recusado, sempre seguro repetir. 503/504/erro de rede num POST podem já
    // ter criado a tarefa, então só repetimos esses casos em leituras e PATCH (idempotentes).
    const method = (init.method ?? "GET").toUpperCase();
    const safeToRepeat = method !== "POST";
    const retryable =
      (res !== null && res.status === 429) ||
      (safeToRepeat && (networkError !== null || (res !== null && RETRYABLE.has(res.status))));
    if (retryable && attempt < MAX_ATTEMPTS) {
      const delay = retryDelay(res, attempt);
      if (waited + delay <= MAX_TOTAL_WAIT_MS) {
        if (res) await res.body?.cancel().catch(() => {});
        console.warn(`Graph ${res?.status ?? "erro de rede"} em ${url}; nova tentativa em ${Math.round(delay)}ms`);
        await sleep(delay);
        waited += delay;
        continue;
      }
    }

    if (networkError) throw networkError;
    res = res as Response;
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).error?.message ?? text;
      } catch {}
      if (res.status === 429) {
        msg += " (o Microsoft To Do continua limitando os pedidos; tente de novo em alguns minutos)";
      }
      throw new Error(`Microsoft Graph ${res.status}: ${msg}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** Segue @odata.nextLink até trazer tudo. */
export async function graphAll<T>(path: string, limit = 1000): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  while (next && out.length < limit) {
    const page: { value: T[]; "@odata.nextLink"?: string } = await graph(next);
    out.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return out;
}
