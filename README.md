# todo-mcp

**Conecte o Claude ao seu Microsoft To Do.**
Servidor [MCP](https://modelcontextprotocol.io) remoto, pronto para a Vercel, que permite ao Claude ler, criar e concluir tarefas do Microsoft To Do de uma conta pessoal (outlook.com, hotmail.com, live.com) através da [Microsoft Graph API](https://learn.microsoft.com/graph/api/resources/todo-overview).

> 🇺🇸 *English summary:* a self-hosted remote MCP server (Vercel + Supabase) that gives Claude read/write access to **your own** Microsoft To Do via Microsoft Graph. Each person deploys their own copy with their own Microsoft app registration — no data is shared with anyone else. Tool names and messages are in Portuguese. See [Quick start](#passo-a-passo).

---

## Por que existe

O Microsoft To Do já sincroniza entre celular, computador e web, mas não há um conector oficial para o Claude. Este projeto preenche essa lacuna sem trocar de app de tarefas: você continua usando o To Do normalmente e o Claude passa a enxergar e organizar as mesmas listas.

Exemplos do que dá para pedir ao Claude:

- "Quais são minhas tarefas de hoje e o que está atrasado?"
- "Crie uma tarefa 'Renovar seguro' na lista Pessoal para sexta, com lembrete às 9h."
- "Marque como feita a etapa 'Revisar contrato' da tarefa X."
- "Monte meu plano do dia a partir das tarefas vencendo hoje."

## Como funciona

```
Claude ──(MCP / HTTPS)──▶ Vercel: /api/mcp/<segredo>
                              │
                              ├─▶ Supabase: lê o refresh token da sua conta
                              ├─▶ Microsoft identity: troca por um access token
                              └─▶ Microsoft Graph: /me/todo/lists/...
```

- **Uma instância = uma pessoa.** Cada usuário faz o próprio deploy, com o próprio app no Microsoft Entra e o próprio banco. Nada passa por servidores de terceiros além de Vercel, Supabase e Microsoft.
- **Permissões delegadas.** Contas pessoais da Microsoft não aceitam permissões de aplicativo; o servidor age em seu nome usando o refresh token obtido no login único.
- **Stateless.** Cada chamada MCP cria um servidor novo, o que combina com funções serverless.

## Ferramentas

| Ferramenta | O que faz | Altera dados? |
|---|---|---|
| `listar_listas` | Todas as listas (nome e id) | não |
| `listar_tarefas` | Tarefas de uma lista; aceita nome parcial, sem acento | não |
| `tarefas_do_dia` | Varre todas as listas: o que vence na data (padrão: hoje) + atrasadas | não |
| `ver_tarefa` | Detalhes, notas e etapas (checklist) com ids | não |
| `criar_tarefa` | Cria com vencimento, lembrete, importância, notas e etapas | sim |
| `atualizar_tarefa` | Concluir/reabrir, renomear, mudar vencimento, importância, notas | sim |
| `marcar_etapa` | Marca/desmarca uma etapa de uma tarefa | sim |

Concluir uma tarefa recorrente pelo Graph gera a próxima ocorrência, como no app.
Datas usam o formato `AAAA-MM-DD` e o fuso configurado em `LOCAL_TZ` / `GRAPH_TIMEZONE`.

## Requisitos

- Node.js 20+
- Conta na [Vercel](https://vercel.com) (plano gratuito serve)
- Projeto no [Supabase](https://supabase.com) (plano gratuito serve)
- Conta pessoal da Microsoft com o To Do
- Acesso ao [portal do Azure](https://portal.azure.com) para registrar o app (gratuito)

## Passo a passo

### 1. Clonar e verificar

```bash
git clone https://github.com/<seu-usuario>/todo-mcp.git
cd todo-mcp
npm install
npm run typecheck
npm run test:tools   # lista as ferramentas sem acessar a rede
```

### 2. Criar a tabela no Supabase

Rode [`sql/001_ms_todo_tokens.sql`](sql/001_ms_todo_tokens.sql) no SQL Editor.
A tabela tem RLS ligado e nenhuma policy: só a *service role* (usada pelo backend) acessa.
Recomenda-se um projeto dedicado em vez de reaproveitar o banco de outra aplicação.

### 3. Registrar o app no Microsoft Entra

1. **Microsoft Entra ID → Registros de aplicativo → Novo registro.**
   Se o portal pedir um diretório, crie uma conta Azure gratuita com sua conta Microsoft.
2. **Tipos de conta:** *Somente contas pessoais da Microsoft* (corresponde a `MS_TENANT=consumers`).
3. **URI de redirecionamento:** plataforma *Web*, `https://<seu-dominio>/api/auth/callback`.
4. **Certificados e segredos → Novo segredo do cliente.** Copie o *Valor* (aparece uma única vez).
5. **Permissões de API → Microsoft Graph → Delegadas:** `Tasks.ReadWrite`, `User.Read`, `offline_access`.

### 4. Configurar e publicar na Vercel

Copie [`.env.example`](.env.example) e preencha as variáveis na Vercel (*Settings → Environment Variables*):

| Variável | Descrição |
|---|---|
| `BASE_URL` | URL pública do deploy, sem barra final |
| `MS_CLIENT_ID` | *ID do aplicativo (cliente)* do Entra |
| `MS_CLIENT_SECRET` | Valor do segredo do cliente |
| `MS_TENANT` | `consumers` (contas pessoais) ou `common` |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave *service role* (nunca exponha no front-end) |
| `MCP_SECRET` | Segredo longo e aleatório que protege o endpoint |
| `LOCAL_TZ` | Fuso IANA para calcular "hoje" (ex.: `America/Sao_Paulo`) |
| `GRAPH_TIMEZONE` | Mesmo fuso no formato Windows (ex.: `E. South America Standard Time`) |

Gere o `MCP_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Depois: `vercel deploy --prod` (ou conecte o repositório na Vercel).

### 5. Autorizar sua conta Microsoft (uma vez)

Abra no navegador `https://<seu-dominio>/api/auth/login?key=<MCP_SECRET>`, entre com sua conta e aceite as permissões. A página deve mostrar **Conectado ✓**.

### 6. Adicionar ao Claude

Em **Conectores**, adicione um conector personalizado com a URL:

```
https://<seu-dominio>/api/mcp/<MCP_SECRET>
```

Teste com: *"quais são minhas tarefas de hoje no To Do?"*

## Segurança

- **Nunca faça commit de `.env`.** Ele já está no `.gitignore`; use as variáveis de ambiente da Vercel.
- **A URL do conector contém o segredo** e funciona como uma senha. Se vazar, troque o `MCP_SECRET` e atualize o conector. Requisições com segredo errado recebem `404`.
- **O login OAuth também exige o segredo**, impedindo que outra pessoa conecte a conta dela na sua instância. O parâmetro `state` é validado via cookie.
- **Escopo mínimo:** apenas tarefas (`Tasks.ReadWrite`) e o perfil básico (`User.Read`). Sem acesso a e-mail, arquivos ou calendário.
- **Revogar acesso:** em [account.live.com/consent/Manage](https://account.live.com/consent/Manage) remova o app, ou apague a linha em `ms_todo_tokens`.
- O refresh token expira após longos períodos sem uso; as ferramentas avisam, e basta refazer o passo 5.

Encontrou uma falha? Abra uma *issue* sem incluir tokens, segredos ou dados pessoais.

## Limitações conhecidas

- Uma conta Microsoft por instância.
- Autenticação do conector por segredo na URL; OAuth no próprio conector está no roteiro.
- Recorrência de tarefas é exibida, mas ainda não pode ser criada ou editada pelas ferramentas.
- Listas compartilhadas aparecem normalmente, mas não houve testes extensivos com elas.

## Roteiro

- [ ] OAuth no endpoint MCP (dispensa o segredo na URL)
- [ ] Criar e editar recorrência
- [ ] Mover tarefas entre listas
- [ ] Busca por texto em todas as listas
- [ ] Notificações de mudança via webhooks do Graph

## Estrutura

```
api/mcp/[key].ts       endpoint MCP (Streamable HTTP, stateless)
api/auth/login.ts      inicia o OAuth da Microsoft
api/auth/callback.ts   recebe o código e salva o refresh token
lib/env.ts             variáveis de ambiente e comparação segura do segredo
lib/msauth.ts          troca, renovação e cache de tokens
lib/tokens.ts          leitura/gravação do refresh token no Supabase
lib/graph.ts           cliente HTTP do Microsoft Graph (paginação, erros)
lib/todo.ts            regras do To Do: listas, tarefas, datas, formatação
lib/server.ts          definição das ferramentas MCP
scripts/list-tools.ts  teste local sem rede
sql/                   migrations do Supabase
```

## Contribuindo

Contribuições são bem-vindas. Antes de abrir um PR, rode `npm run typecheck` e `npm run test:tools`. O CI roda os mesmos comandos.

## Licença

[MIT](LICENSE). Projeto independente, sem afiliação com Microsoft ou Anthropic. "Microsoft To Do" é marca da Microsoft.
