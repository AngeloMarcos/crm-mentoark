# Sprint Atendimento v1 — a conversa vira um atendimento (modelo Cubo)

Data: 2026-11-04 · Origem: `engenharia_reversa_suite/RELATORIO_LACUNAS_CUBO_2026-11-04.md`, Prioridade 1.
Status: **EM ANDAMENTO**. Fases 1 e 2 em homolog desde 2026-11-09 (teste de ponta a ponta: 11/11 e 51/51), ainda não commitadas nem em produção.

Acréscimos da Fase 2: tabela `atendimento_config` (`motivo_obrigatorio`, por conta, com `GET/PUT /api/atendimentos/config`); excluir motivo só desativa, para os padrões não voltarem.

Ajustes feitos na Fase 1 em relação ao plano abaixo:
- Humano responder conversa em `aguardando` devolve para `aberto` (senão a fila "Aguardando humano" nunca esvazia).
- Resposta pelo celular é atribuída ao dono da conta; a primeira resposta de pessoa também conta em `primeira_resposta_em`.
- Backfill usa `origem='migracao'` (os relatórios podem excluir) e só roda com a tabela vazia.
- Trigger em `contatos` apaga `ia_pausada_ate` quando a pausa é desligada, seja por qual rota for.
- Entrada pela API oficial (`metaWebhookProcessor`) também abre atendimento.
- `routes/contatos.ts` não mudou: criada a coluna `contatos.atribuido_a` que faltava em prod (o papel `membro` vê só o que estiver atribuído a ele).

## Objetivo

Hoje a conversa do WhatsApp não tem dono nem ciclo de vida: a IA está ligada ou desligada para sempre, e a
única anotação é um texto por contato. No fim da sprint, toda conversa terá:

- um **atendimento** com estado (aberto, aguardando humano, resolvido) e atendente;
- botões **atribuir, transferir, resolver e reabrir**, com motivo cadastrado;
- **IA pausada por tempo** (30 min, 1 h, 4 h ou até devolver) e o botão **devolver à IA**;
- **notas internas** na linha do tempo, que o cliente não vê;
- o histórico de tudo isso (base dos relatórios da próxima sprint).

## Estado de hoje (medido em prod, 2026-11-04)

- `whatsapp_conversations` é uma VIEW (instância + jid). Não há tabela de conversa em prod.
- Pausa da IA = `contatos.atendente_pausou_ia` (boolean, sem prazo). **1.048 contatos estão pausados**, sem prazo.
- Equipe = `users.owner_id`. **0 sub-usuários em prod**: hoje toda conta tem um atendente só. A atribuição já nasce
  pronta para equipes, mas o valor imediato é estado, pausa com prazo, notas e motivos.
- 2.667 conversas individuais com mensagem nos últimos 30 dias.
- Sprints A–D (jul/26): a tabela `conversations` com trigger em `whatsapp_messages` existe **só em `crm_hml`**,
  `InboxPanel.tsx` não está em nenhuma rota, e `/api/conversas` está montado em prod sobre uma tabela que não existe.
- Bug achado: `routes/contatos.ts:26` filtra `atribuido_a` para quem tem papel `membro`, mas essa coluna não
  existe em `contatos` em prod (a consulta dá erro para esse papel).

## Decisões (padrão proposto, mude se discordar)

1. **Não reaproveitar a `conversations` das Sprints A–D.** Ela tem uma linha por conversa, então perde o histórico de
   cada atendimento (sem ele não há "tempo até resolver" nem "reaberturas"), e depende de um trigger em toda mensagem
   gravada. O código A–D é descartado na Fase 4.
2. **Resolver devolve à IA.** Ao resolver, a pausa termina e a próxima mensagem do cliente abre um atendimento novo
   já com a IA. A opção fica no diálogo ("manter a IA pausada"), desligada por padrão.
3. **Motivo opcional** na transferência e na resolução, com um ajuste por conta para torná-lo obrigatório.
4. **Os 1.048 contatos pausados continuam pausados sem prazo.** Nada muda para eles até alguém mexer.
5. Grupos ficam de fora (só conversas individuais).

## Modelo de dados

```sql
atendimentos (
  id uuid pk, user_id uuid  -- conta (owner)
  instance_name text, remote_jid text, telefone text, contato_id uuid null,
  estado text  -- 'aberto' | 'aguardando' (pediu humano) | 'resolvido'
  atendente_id uuid null references users, departamento_id uuid null,
  origem text  -- 'cliente' | 'atendente' | 'api' | 'disparo'
  reaberto_de uuid null  -- atendimento resolvido há menos de 24h
  aberto_em, primeira_resposta_em, primeira_resposta_humana_em, resolvido_em timestamptz,
  resolvido_por uuid null, motivo_resolucao_id uuid null,
  created_at, updated_at
)
-- no máximo um não resolvido por conversa:
UNIQUE (user_id, instance_name, remote_jid) WHERE estado <> 'resolvido'

atendimento_eventos (
  id, atendimento_id, user_id,
  tipo text   -- aberto | atribuido | transferido | aguardando | resolvido | reaberto | ia_pausada | ia_retomada | nota
  origem text -- humano | ia | sistema | api
  autor_id uuid null, de_atendente uuid null, para_atendente uuid null,
  motivo_id uuid null, texto text null, ate timestamptz null,  -- ate = fim da pausa
  created_at
)

motivos (id, user_id, tipo text /* transferencia | resolucao | pausa | perda */, nome, ativo, ordem)
-- 'perda' já entra aqui para o funil usar na sprint seguinte (Ganhar/Perder com motivo).

contatos.ia_pausada_ate timestamptz null
```

A IA está pausada quando `atendente_pausou_ia = true` e (`ia_pausada_ate` é nulo ou fica no futuro). Um cron de
1 minuto encerra as pausas vencidas (zera as duas colunas e grava `ia_retomada` com origem `sistema`).

Migração inicial: cria um atendimento `aberto` para cada conversa individual com mensagem do cliente nos últimos
7 dias (idempotente). As mais antigas ganham atendimento quando o cliente escrever de novo.

## Ciclo de vida

| Gatilho | Efeito |
|---|---|
| Cliente manda mensagem e não há atendimento aberto | abre (`origem=cliente`); se o último foi resolvido há < 24h, grava `reaberto_de` |
| IA responde | marca `primeira_resposta_em` (se vazio) |
| Humano responde pelo CRM ou pelo celular | marca `primeira_resposta_humana_em`; sem atendente → atribui a quem respondeu |
| IA chama "transferir para humano" | estado `aguardando`, evento com origem `ia` (pausa como hoje) |
| Atendente atribui/transfere | troca `atendente_id`, evento com de/para e motivo; volta para `aberto` |
| Resolver | `resolvido`, motivo, `resolvido_por`; termina a pausa (decisão 2) |
| Reabrir | volta para `aberto`, evento `reaberto` |
| Pausar IA por X min | `atendente_pausou_ia=true`, `ia_pausada_ate=now()+X`, evento `ia_pausada` |
| Devolver à IA | zera as duas colunas, evento `ia_retomada` |

Regra do caminho quente: tudo isso roda **depois** de a mensagem ser gravada, em `try/catch` e sem `await` no
fluxo do webhook. Uma falha no atendimento nunca impede gravar mensagem nem a IA de responder.

## Fases (cada uma: homolog → validar → prod)

### Fase 1 — Banco e ciclo automático (backend, invisível na tela)
- Migração: `atendimentos`, `atendimento_eventos`, `motivos`, `contatos.ia_pausada_ate`, índices, backfill de 7 dias.
- `services/atendimento.ts`: funções puras (decidir abrir/reabrir, calcular estado, vencimento da pausa) com
  testes em `tests/atendimento.test.ts`, mais `registrarEntrada`, `registrarSaida`, `encerrarPausasVencidas`.
- Ganchos em `routes/webhook.ts` (entrada e saída) e no envio pelo CRM (`/api/whatsapp/send`).
- `agentEngine.ts`: respeitar `ia_pausada_ate`; "transferir para humano" grava `aguardando`.
- Corrigir o filtro `atribuido_a` de `routes/contatos.ts` (bug acima).
- **Aceite:** uma conversa simulada em homolog abre, recebe a 1ª resposta, vai para aguardando e pausa com prazo. A pausa
  vence sozinha. Os tempos de resposta do webhook não mudam (comparar a mediana antes e depois no log).

### Fase 2 — Rotas e motivos
- `routes/atendimentos.ts`: `GET /api/atendimentos/conversa?instancia=&jid=` (atual + eventos),
  `POST /:id/atribuir | transferir | resolver | reabrir | pausar-ia {minutos|null} | devolver-ia | notas`,
  `GET /api/atendimentos/atendentes` (usuários da conta).
- CRUD `/api/motivos?tipo=`, com motivos padrão criados na 1ª leitura ("Dúvida resolvida", "Venda feita",
  "Sem resposta do cliente"; "Fora do horário", "Assunto de outro setor").
- `/api/whatsapp/conversas` passa a devolver `atendimento {estado, atendente, ia_pausada_ate}` e aceita
  filtros `estado=`, `meus=1`, `sem_atendente=1`.
- **Aceite:** E2E em homolog cobrindo cada rota, isolamento entre contas (conta B não vê nem mexe no atendimento da A)
  e motivo de outra conta recusado.

### Fase 3 — Tela
- Componentes novos em `src/components/atendimento/` (o `WhatsAppInterface.tsx` já tem 5,8 mil linhas, então só
  recebe os encaixes):
  - `BarraAtendimento`: estado, atendente e os botões Atribuir, Transferir, Resolver e Reabrir;
  - `MenuPausaIA`: 30 min, 1 h, 4 h, até eu devolver, devolver à IA, com o tempo restante visível;
  - `DialogoMotivo`: usado por transferir e resolver;
  - composer com o modo **Nota interna** (fundo amarelo, não é enviada ao cliente).
- Lista de conversas: filtros Abertos · Aguardando humano · Resolvidos · Meus · Sem atendente, com contador.
- Linha do tempo: notas e eventos de atendimento aparecem como faixas, iguais às do funil (`funil_evento`).
- Configurações → Atendimento → Motivos (3 abas: transferência, resolução, pausa) e o ajuste "motivo obrigatório".
- **Aceite:** verificação visual em homolog (Edge headless, ver `reference_verificacao_visual_homolog`), fluxo
  completo de uma conversa, em tela larga e no celular.

### Fase 4 — API, descarte e docs
- API /v1: `POST /v1/conversations/:id/resolve | assign`. No `messages/send` com `sentBy: human`, atribuir ao
  dono da chave e pausar a IA por 1 h (o mesmo que o Cubo faz). Escopo `conversations:update`, OpenAPI atualizado.
- Descarte das Sprints A–D: `routes/conversas.ts`, `InboxPanel.tsx`, `services/kanbanInboxService.ts` e o
  `app.use('/api/conversas')`. As tabelas de `crm_hml` ficam onde estão (sem `DROP` nesta sprint).
- Atualizar `STATUS.md` e a memória.

## Fora desta sprint (vai para as próximas)

- **Relatórios de atendimento** (tempo de 1ª resposta e de resolução, reaberturas, por atendente, ao vivo): a
  próxima sprint, já com dados desta.
- Departamentos e filas com distribuição automática; alertas de SLA.
- Para quem a IA transfere (atendente ou departamento por agente).
- Template no chat, reações e figurinhas.
- Ganhar/Perder no funil com motivo (a tabela `motivos` já nasce pronta para isso).

## Riscos

- **Webhook é caminho quente:** o gancho não bloqueia o fluxo e tem `try/catch`; o índice único parcial evita
  dois atendimentos abertos quando chegam duas mensagens ao mesmo tempo (`ON CONFLICT DO NOTHING`).
- **Variantes de telefone** (com/sem 9º dígito): o atendimento é chaveado por `instance_name + remote_jid`, como a
  VIEW, e não pelo telefone digitado.
- **RLS em `whatsapp_messages` no homolog:** as leituras dessa tabela usam `withTenantContext`.
- **Mesmo contato em dois números** gera dois atendimentos, um por número. É o comportamento do Cubo (canal ↔ conversa).
- **Não editar arquivos enquanto `deploy.sh` roda**, e comparar a árvore com a VPS antes (lições anteriores).
