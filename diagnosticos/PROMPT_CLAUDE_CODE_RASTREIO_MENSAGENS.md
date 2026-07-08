# Prompt para Claude Code — Rastreio Completo: Mensagens Novas Não Atualizam Após Conectar

Cole este prompt inteiro no Claude Code (CLI). Siga `AUDITORIA_PROTOCOLO.md` (tags `[AUDITORIA] LÓGICA/BUG/FIX APLICADO/FIX PENDENTE`, critério de corrigir vs. deixar pendente, commits por arquivo, `AUDITORIA_LOG.md`). Este prompt é uma continuação da auditoria do módulo WhatsApp já em andamento — não recomece do zero, construa em cima do que já foi encontrado.

---

## SITUAÇÃO ATUAL

QR code agora conecta corretamente (bug resolvido em sessão anterior). Mas mensagens novas que chegam **depois** de conectar não atualizam na tela do CRM. Preciso rastrear a lógica **desde o banco até a tela**, camada por camada, com comentário de auditoria em cada uma, corrigindo o que for seguro e deixando `FIX PENDENTE` com instruções claras pro que não for.

## JÁ ENCONTRADO NA SESSÃO ANTERIOR (não redescobrir — usar como ponto de partida)

Em `backend/src/routes/whatsapp.ts`, função `getEvolutionConfig()` (linha ~79-91), já existe um comentário `[AUDITORIA] FIX PENDENTE` descrevendo:
- `cfg.instancia` (vem do banco: `integracoes_config` → fallback `agentes` → fallback `stableInstancia` computado) pode divergir de `cfg.stableInstancia` (`crm_<12-chars-do-userId>`).
- Isso pode fazer `/send`, `/connect`, `/evo/status`, `/disconnect` operarem sobre uma instância errada.
- Existe uma linha órfã confirmada em `agent_configs` com `instancia='teste'` que `/disconnect` e `DELETE /instances/:name` nunca limpam.
- A ação pendente que ficou registrada: rodar uma query em produção pra ver se existe overlap real (usuário com `agent_configs` preenchido mas sem `integracoes_config`/`agentes` correspondente).

**Primeira tarefa deste prompt: execute essa query pendente antes de seguir**, porque o resultado dela decide se essa divergência é (ou não) a causa do problema atual:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT ac.user_id, ac.evolution_instancia AS instancia_agent_configs,
          ic.instancia AS instancia_integracoes_config,
          ag.evolution_instancia AS instancia_agentes
   FROM agent_configs ac
   LEFT JOIN integracoes_config ic ON ic.user_id = ac.user_id AND ic.tipo = '"'"'evolution'"'"'
   LEFT JOIN agentes ag ON ag.user_id = ac.user_id AND ag.ativo = true
   WHERE ac.evolution_instancia IS NOT NULL;"'
```

Se alguma linha mostrar `instancia_agent_configs` diferente de `instancia_integracoes_config`/`instancia_agentes` (ou uma das duas vazia), documente isso no `[AUDITORIA] FIX PENDENTE` existente com o resultado real, e considere se é a causa do usuário atual antes de aplicar qualquer fix ali — não altere `getEvolutionConfig()` sem confirmar que esse é o usuário afetado.

---

## RASTREIO CAMADA POR CAMADA (adicionar `[AUDITORIA] LÓGICA` em cada ponto abaixo)

### Camada 1 — Escrita no banco (webhook recebe a mensagem)

Arquivo: `backend/src/routes/webhook.ts`. Confirmar com um teste ao vivo (mandar mensagem de WhatsApp real após conectar):

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs -f crm-api 2>&1 | grep --line-buffered -E "WH:|WEBHOOK_REJECT|INSERT whatsapp_messages"'
```

e em paralelo:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT created_at, user_id, instance_name, remote_jid, from_me, left(content,50) FROM whatsapp_messages ORDER BY created_at DESC LIMIT 5;"'
```

Confirmar: a mensagem de teste aparece no banco com `created_at` recente e o `user_id` correto (o mesmo usuário logado no CRM)? Se **não** aparecer, o problema é na Camada 1 (webhook não processa) — voltar para `PROMPT_CLAUDE_CODE_WHATSAPP_SYNC.md` (investigação de webhook/instância órfã), esse prompt não se aplica.

Se aparecer corretamente → Camada 1 está OK, comentar `[AUDITORIA] LÓGICA` confirmando isso e seguir.

### Camada 2 — Leitura via API (o que o frontend consulta)

Arquivo: `backend/src/routes/whatsapp.ts`, rotas `GET /conversas` (linha ~284) e `GET /conversas/:phone` (linha ~343 — ler o corpo completo, ainda não lido nesta auditoria).

Ponto já confirmado nesta sessão: `GET /conversas` filtra **só por `user_id`**, não por `instance_name` (a query usa `WHERE m.user_id = $1`, sem filtro de instância) — ou seja, divergência de nome de instância (Camada 0) não deveria impedir a mensagem de aparecer na lista, DESDE QUE o `user_id` gravado esteja certo. Comentar isso como `[AUDITORIA] LÓGICA` na rota.

Testar a rota isoladamente com o token JWT real do usuário (pegar do `localStorage.crm_access_token` no navegador, ou gerar um via login):

```bash
curl -s https://api.mentoark.com.br/api/whatsapp/conversas \
  -H "Authorization: Bearer <TOKEN_JWT_DO_USUARIO>" | python3 -m json.tool | head -60
```

A mensagem de teste aparece na resposta, com `ultima_atividade` batendo com o horário do teste? Se não aparecer aqui mas aparecer no banco (Camada 1 OK) → bug está na query SQL da rota (Camada 2) — investigar a CTE `ranked`/`contato_unico` a fundo, com atenção a: filtro `is_archived`, o `JOIN` com `contatos` (pode estar descartando a linha se `contato_unico` não tiver entrada pro telefone), e o `LIMIT 300`.

Ler também `GET /conversas/:phone` (mensagens de uma conversa específica) e repetir o mesmo teste isolado via curl para o número de teste, comentando a lógica da query.

### Camada 3 — Fetch no frontend

Arquivo: `src/components/WhatsAppInterface.tsx`, funções `fetchConversas` (linha ~492) e `fetchMensagens` (linha ~580 — ler o corpo completo, ainda não lido nesta auditoria).

Ponto já confirmado nesta sessão: `fetchConversas` já tem lógica de detecção de mensagens novas (`isNew`, `newArrivals`, comparando `row.ultima_atividade` com um `Map` em `prevUltimaAtividadeRef`) e há `console.log('[WA] ...')` em pontos-chave. **Aproveitar esse log existente**: pedir para o usuário (ou você mesmo, se tiver acesso ao navegador) abrir o DevTools Console na aba `/whatsapp` durante o teste ao vivo e observar:
- `[WA] fetchConversas OK — linhas: N` — o `N` aumenta/o array contém a conversa de teste após mandar a mensagem?
- `[WA] Chat <id>: isNew=..., fromClient=..., notActive=...` — esses valores fazem sentido pro chat de teste?

Se a Camada 2 confirmou que a API retorna a mensagem nova mas o `console.log` mostra que o array não contém/não atualiza — o bug está entre a resposta do fetch e o `setChats()` (ler o restante de `fetchConversas`, linha ~518 em diante, e `fetchMensagens` inteira). Comentar a lógica de merge de estado e procurar por: comparação de referência que impede re-render, `key` de lista React desalinhada, ou early-return que descarta a atualização.

### Camada 4 — Agendamento do polling (existem 3 intervals concorrentes, comentar todos)

No mesmo arquivo, linhas ~720-730, ~782-788 e ~823-847: há três `useEffect`/`setInterval` diferentes chamando `fetchConversas`/`fetchMensagens` com frequências distintas (5s combinado, 2s/5s só conversas, 3s só mensagens da conversa aberta). Comentar `[AUDITORIA] LÓGICA` explicando o propósito de cada um e avaliar como `BUG` (impacto: requests redundantes, possível race condition entre os três atualizando o mesmo estado ao mesmo tempo) — se for seguro consolidar em um único polling sem mudar comportamento visível, aplicar como `FIX APLICADO`; se não tiver certeza do impacto em outras partes do componente, `FIX PENDENTE`.

Verificar também: todos os intervals checam `document.hidden`/`document.visibilityState` antes de rodar — confirmar que a aba realmente não está sendo considerada "hidden" incorretamente durante o teste (isso pausaria todo o polling silenciosamente).

### Camada 5 — Render

Se as camadas 1-4 passarem (dado chega atualizado em `setChats`/`setMessages`), mas a tela visualmente não atualiza, procurar por `useMemo`/`React.memo` com dependências erradas nos componentes de lista de chat e de mensagens que consomem esse estado.

---

## EXECUÇÃO

1. Rodar a query de overlap pendente (início deste prompt) e documentar o resultado no `[AUDITORIA] FIX PENDENTE` já existente em `getEvolutionConfig()`.
2. Fazer o teste ao vivo (mensagem de WhatsApp real) uma única vez, capturando evidência das Camadas 1, 2 e 3 no mesmo teste (logs + SQL + curl + console do navegador, se possível).
3. Percorrer as camadas 1→5 na ordem, comentando com as tags do protocolo, corrigindo o que for seguro.
4. Atualizar `AUDITORIA_LOG.md` com os arquivos/linhas tocados.
5. Não fazer deploy — só commits locais, como de costume.

## AO FINALIZAR, REPORTAR

- Em qual camada exata (1-5) está a causa raiz confirmada por evidência (não suposição).
- O que foi corrigido vs. o que ficou `FIX PENDENTE` e por quê.
- Resultado do teste de validação: mensagem de teste apareceu na tela do CRM sem refresh manual, dentro de quantos segundos.
