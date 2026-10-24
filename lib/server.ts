import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addChecklistItem,
  createTask,
  dateOnly,
  getChecklist,
  getLists,
  getTask,
  getTasks,
  resolveList,
  setChecklistItem,
  summarize,
  toDue,
  toReminder,
  todayLocal,
  updateTask,
} from "./todo.js";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD");
const DATETIME = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "Use AAAA-MM-DDTHH:mm");

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

/** Executa o corpo da ferramenta e devolve erros legíveis ao Claude em vez de derrubar a chamada. */
async function run(fn: () => Promise<ReturnType<typeof json>>) {
  try {
    return await fn();
  } catch (e) {
    return {
      content: [{ type: "text" as const, text: `Erro: ${e instanceof Error ? e.message : String(e)}` }],
      isError: true,
    };
  }
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "microsoft-todo", version: "0.1.0" });

  server.registerTool(
    "listar_listas",
    {
      title: "Listar listas do To Do",
      description: "Lista todas as listas de tarefas do Microsoft To Do do usuário (nome e id).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => {
      const lists = await getLists(true);
      return json(
        lists.map((l) => ({
          id: l.id,
          nome: l.displayName,
          compartilhada: l.isShared,
          especial: l.wellknownListName !== "none" ? l.wellknownListName : null,
        }))
      );
    })
  );

  server.registerTool(
    "listar_tarefas",
    {
      title: "Listar tarefas de uma lista",
      description:
        "Lista as tarefas de uma lista do To Do. Aceita o nome da lista (ou parte dele) ou o id. Por padrão traz só as pendentes.",
      inputSchema: {
        lista: z.string().describe("Nome ou id da lista, ex.: 'Trabalho'"),
        incluir_concluidas: z.boolean().optional().describe("Incluir tarefas concluídas (padrão: false)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ lista, incluir_concluidas }) => run(async () => {
      const list = await resolveList(lista);
      const tasks = await getTasks(list.id, incluir_concluidas ?? false);
      return json({ lista: list.displayName, lista_id: list.id, total: tasks.length, tarefas: tasks.map((t) => summarize(t)) });
    })
  );

  server.registerTool(
    "tarefas_do_dia",
    {
      title: "Tarefas do dia",
      description:
        "Varre todas as listas e devolve as tarefas pendentes que vencem na data informada (padrão: hoje no fuso local) e, opcionalmente, as atrasadas.",
      inputSchema: {
        data: DATE.optional().describe("Data AAAA-MM-DD (padrão: hoje)"),
        incluir_atrasadas: z.boolean().optional().describe("Incluir pendentes com vencimento anterior (padrão: true)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ data, incluir_atrasadas }) => run(async () => {
      const day = data ?? todayLocal();
      const withOverdue = incluir_atrasadas ?? true;
      const lists = await getLists(true);
      const perList = await Promise.all(
        lists.map(async (l) => ({ list: l, tasks: await getTasks(l.id) }))
      );

      const doDia: ReturnType<typeof summarize>[] = [];
      const atrasadas: ReturnType<typeof summarize>[] = [];
      for (const { list, tasks } of perList) {
        for (const t of tasks) {
          const due = dateOnly(t.dueDateTime);
          if (!due) continue;
          if (due === day) doDia.push(summarize(t, list));
          else if (withOverdue && due < day) atrasadas.push(summarize(t, list));
        }
      }
      const byImportance = (a: { importante: boolean }, b: { importante: boolean }) =>
        Number(b.importante) - Number(a.importante);
      doDia.sort(byImportance);
      atrasadas.sort((a, b) => (a.vencimento ?? "").localeCompare(b.vencimento ?? ""));

      return json({ data: day, do_dia: doDia, ...(withOverdue ? { atrasadas } : {}) });
    })
  );

  server.registerTool(
    "ver_tarefa",
    {
      title: "Ver detalhes de uma tarefa",
      description: "Mostra os detalhes de uma tarefa, incluindo anotações e etapas (checklist) com seus ids.",
      inputSchema: {
        lista: z.string().describe("Nome ou id da lista"),
        tarefa_id: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ lista, tarefa_id }) => run(async () => {
      const list = await resolveList(lista);
      const [task, etapas] = await Promise.all([getTask(list.id, tarefa_id), getChecklist(list.id, tarefa_id)]);
      return json({
        ...summarize(task, list),
        notas: task.body?.content?.trim() || null,
        etapas: etapas.map((e) => ({ id: e.id, nome: e.displayName, concluida: e.isChecked })),
        criada_em: task.createdDateTime,
      });
    })
  );

  server.registerTool(
    "criar_tarefa",
    {
      title: "Criar tarefa",
      description: "Cria uma tarefa em uma lista do To Do, com vencimento, lembrete, importância, notas e etapas opcionais.",
      inputSchema: {
        lista: z.string().describe("Nome ou id da lista"),
        titulo: z.string().min(1),
        vencimento: DATE.optional().describe("AAAA-MM-DD"),
        lembrete: DATETIME.optional().describe("AAAA-MM-DDTHH:mm no horário local"),
        importante: z.boolean().optional(),
        notas: z.string().optional(),
        etapas: z.array(z.string().min(1)).optional().describe("Etapas (checklist) da tarefa"),
      },
    },
    async ({ lista, titulo, vencimento, lembrete, importante, notas, etapas }) => run(async () => {
      const list = await resolveList(lista);
      const body: Record<string, unknown> = { title: titulo };
      if (vencimento) body.dueDateTime = toDue(vencimento);
      if (lembrete) {
        body.reminderDateTime = toReminder(lembrete);
        body.isReminderOn = true;
      }
      if (importante) body.importance = "high";
      if (notas) body.body = { content: notas, contentType: "text" };

      const task = await createTask(list.id, body);
      const created = [];
      for (const nome of etapas ?? []) created.push(await addChecklistItem(list.id, task.id, nome));

      return json({ criada: summarize(task, list), etapas: created.map((e) => ({ id: e.id, nome: e.displayName })) });
    })
  );

  server.registerTool(
    "atualizar_tarefa",
    {
      title: "Atualizar ou concluir tarefa",
      description:
        "Altera uma tarefa: concluir/reabrir, renomear, mudar vencimento (null remove), importância ou notas. Concluir uma tarefa recorrente gera a próxima ocorrência no To Do.",
      inputSchema: {
        lista: z.string().describe("Nome ou id da lista"),
        tarefa_id: z.string(),
        concluida: z.boolean().optional(),
        titulo: z.string().min(1).optional(),
        vencimento: DATE.nullable().optional().describe("AAAA-MM-DD, ou null para remover"),
        importante: z.boolean().optional(),
        notas: z.string().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ lista, tarefa_id, concluida, titulo, vencimento, importante, notas }) => run(async () => {
      const list = await resolveList(lista);
      const body: Record<string, unknown> = {};
      if (concluida !== undefined) body.status = concluida ? "completed" : "notStarted";
      if (titulo) body.title = titulo;
      if (vencimento !== undefined) body.dueDateTime = vencimento === null ? null : toDue(vencimento);
      if (importante !== undefined) body.importance = importante ? "high" : "normal";
      if (notas !== undefined) body.body = { content: notas, contentType: "text" };
      if (Object.keys(body).length === 0) throw new Error("Nada para atualizar.");

      const task = await updateTask(list.id, tarefa_id, body);
      return json({ atualizada: summarize(task, list) });
    })
  );

  server.registerTool(
    "marcar_etapa",
    {
      title: "Marcar etapa da tarefa",
      description: "Marca ou desmarca uma etapa (checklist) de uma tarefa. Use ver_tarefa para obter os ids das etapas.",
      inputSchema: {
        lista: z.string().describe("Nome ou id da lista"),
        tarefa_id: z.string(),
        etapa_id: z.string(),
        concluida: z.boolean(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ lista, tarefa_id, etapa_id, concluida }) => run(async () => {
      const list = await resolveList(lista);
      const item = await setChecklistItem(list.id, tarefa_id, etapa_id, concluida);
      return json({ etapa: { id: item.id, nome: item.displayName, concluida: item.isChecked } });
    })
  );

  return server;
}
