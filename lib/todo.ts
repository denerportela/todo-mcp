import { env } from "./env.js";
import { graph, graphAll, type ChecklistItem, type TodoList, type TodoTask } from "./graph.js";

const enc = encodeURIComponent;

// ---------- datas ----------

/** Data local de hoje em YYYY-MM-DD. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: env("LOCAL_TZ", "America/Sao_Paulo") }).format(new Date());
}

/** Parte da data (YYYY-MM-DD). Com o header Prefer, o Graph já devolve no fuso local. */
export function dateOnly(dt?: { dateTime: string } | null): string | undefined {
  return dt?.dateTime?.slice(0, 10);
}

function graphTz() {
  return env("GRAPH_TIMEZONE", "E. South America Standard Time");
}

export function toDue(date: string) {
  return { dateTime: `${date}T00:00:00`, timeZone: graphTz() };
}

export function toReminder(dateTime: string) {
  const dt = dateTime.length === 16 ? `${dateTime}:00` : dateTime; // aceita YYYY-MM-DDTHH:mm
  return { dateTime: dt, timeZone: graphTz() };
}

// ---------- listas ----------

let listsCache: { at: number; lists: TodoList[] } | null = null;

export async function getLists(fresh = false): Promise<TodoList[]> {
  if (!fresh && listsCache && Date.now() - listsCache.at < 5 * 60_000) return listsCache.lists;
  const lists = await graphAll<TodoList>("/me/todo/lists");
  listsCache = { at: Date.now(), lists };
  return lists;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Aceita id, nome exato ou parte do nome (sem acento/maiúscula). */
export async function resolveList(nameOrId: string): Promise<TodoList> {
  const lists = await getLists();
  const byId = lists.find((l) => l.id === nameOrId);
  if (byId) return byId;

  const q = norm(nameOrId);
  const exact = lists.filter((l) => norm(l.displayName) === q);
  if (exact.length === 1) return exact[0];

  const partial = lists.filter((l) => norm(l.displayName).includes(q));
  if (partial.length === 1) return partial[0];

  const names = (partial.length ? partial : lists).map((l) => `"${l.displayName}"`).join(", ");
  throw new Error(
    partial.length
      ? `Mais de uma lista corresponde a "${nameOrId}": ${names}. Seja mais específico.`
      : `Lista "${nameOrId}" não encontrada. Listas disponíveis: ${names}.`
  );
}

// ---------- tarefas ----------

export async function getTasks(listId: string, includeCompleted = false): Promise<TodoTask[]> {
  const filter = includeCompleted ? "" : `&$filter=${enc("status ne 'completed'")}`;
  return graphAll<TodoTask>(`/me/todo/lists/${enc(listId)}/tasks?$top=100${filter}`, includeCompleted ? 300 : 1000);
}

/** Roda `fn` em cada item com no máximo `limit` de cada vez (evita rajadas no Graph). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function getTask(listId: string, taskId: string): Promise<TodoTask> {
  return graph<TodoTask>(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`);
}

export async function getChecklist(listId: string, taskId: string): Promise<ChecklistItem[]> {
  return graphAll<ChecklistItem>(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems`);
}

export async function createTask(listId: string, body: Record<string, unknown>): Promise<TodoTask> {
  return graph<TodoTask>(`/me/todo/lists/${enc(listId)}/tasks`, { method: "POST", body: JSON.stringify(body) });
}

export async function updateTask(listId: string, taskId: string, body: Record<string, unknown>): Promise<TodoTask> {
  return graph<TodoTask>(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function addChecklistItem(listId: string, taskId: string, displayName: string): Promise<ChecklistItem> {
  return graph<ChecklistItem>(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems`, {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
}

export async function setChecklistItem(
  listId: string,
  taskId: string,
  itemId: string,
  isChecked: boolean
): Promise<ChecklistItem> {
  return graph<ChecklistItem>(
    `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems/${enc(itemId)}`,
    { method: "PATCH", body: JSON.stringify({ isChecked }) }
  );
}

// ---------- formatação para o Claude ----------

const RECURRENCE: Record<string, string> = {
  daily: "diária",
  weekly: "semanal",
  absoluteMonthly: "mensal",
  relativeMonthly: "mensal",
  absoluteYearly: "anual",
  relativeYearly: "anual",
};

export function summarize(t: TodoTask, list?: TodoList) {
  const p = t.recurrence?.pattern;
  return {
    id: t.id,
    titulo: t.title,
    ...(list ? { lista: list.displayName, lista_id: list.id } : {}),
    concluida: t.status === "completed",
    importante: t.importance === "high",
    vencimento: dateOnly(t.dueDateTime) ?? null,
    lembrete: t.isReminderOn && t.reminderDateTime ? t.reminderDateTime.dateTime.slice(0, 16) : null,
    recorrencia: p?.type ? `${RECURRENCE[p.type] ?? p.type}${p.interval && p.interval > 1 ? ` (a cada ${p.interval})` : ""}` : null,
  };
}
