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

/** Chamada ao Graph. `path` pode ser relativo (/me/...) ou URL absoluta (nextLink). */
export async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Devolve datas já no fuso local, em vez de UTC.
      Prefer: `outlook.timezone="${env("GRAPH_TIMEZONE", "E. South America Standard Time")}"`,
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message ?? text;
    } catch {}
    throw new Error(`Microsoft Graph ${res.status}: ${msg}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
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
