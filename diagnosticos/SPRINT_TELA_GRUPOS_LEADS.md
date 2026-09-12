# Sprint — Aba "Grupos" dedicada: listar grupos, prévia de membros, importar como leads prontos pra Disparos

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Testar em homolog antes de produção, sempre.

---

## Contexto (confirmado no código atual)

Hoje a única forma de importar contatos de um grupo é abrir a conversa do grupo específico no chat (`WhatsAppInterface.tsx`) e clicar "Baixar contatos do grupo" no painel de detalhes — um grupo por vez, sem visão geral de quantos grupos existem, quantos já foram importados, ou prévia de quem está no grupo antes de importar. Objetivo do usuário: usar grupos como fonte de captação de leads pra campanhas de Disparos — isso pede uma tela própria, não um botão escondido numa conversa.

Decisões já tomadas pelo usuário:
- **Localização**: nova aba "Grupos" dentro de `src/pages/WhatsApp.tsx` (mesmo padrão de `Tabs`/`TabsTrigger` já usado ali pras abas Conversas/Instâncias/Diagnóstico, ~linha 38-49).
- **Destino do import**: cada grupo importado cria (ou reaproveita, se já existir) **sua própria Lista**, nomeada com o `subject` do grupo — fica pronta pra selecionar direto no passo "Por Lista" de Disparos, sem passo manual extra.

Backend hoje só busca info de **um** grupo por vez (`GET /group/findGroupInfos/{instance}?groupJid=X`, `buscarInfoGrupo()` em `utils/whatsappMediaStorage.ts`) — não existe nenhuma chamada que liste **todos** os grupos da instância. A importação atual (`POST /grupos/:groupJid/importar-contatos`, `routes/whatsapp.ts` ~linha 495-556) não grava `lista_id` nenhum no contato — cai sem lista, exigindo o operador achar/filtrar depois manualmente.

## O que fazer

### 1. Confirmar (não assumir) que a Evolution suporta listar todos os grupos

Antes de construir a tela, testar de verdade contra a Evolution real (mesmo rigor já usado quando `findGroupInfos` foi confirmado — ver comentário em `whatsappMediaStorage.ts` ~linha 207-213, que cita documentação oficial + issue do GitHub): o endpoint esperado é `GET /group/fetchAllGroups/{instance}?getParticipants=true` (padrão Evolution API v2). Testar contra a instância de homolog primeiro. **Se não existir ou não funcionar** nessa versão da Evolution, documentar isso claramente e usar um fallback: derivar a lista de grupos a partir de `whatsapp_messages`/tabela de conversas já existente (`WHERE remote_jid LIKE '%@g.us'`, agrupado por `remote_jid`) — menos completo (só grupos com histórico de mensagem já salvo), mas não depende de endpoint não confirmado. Documentar qual caminho foi usado e por quê.

### 2. Migration — vincular Lista a um grupo de origem

```sql
ALTER TABLE listas ADD COLUMN IF NOT EXISTS grupo_jid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_listas_user_grupo_jid
  ON listas(user_id, grupo_jid) WHERE grupo_jid IS NOT NULL;
```
Garante que reimportar o mesmo grupo sempre reaproveita a mesma Lista (idempotente — não cria "VIPS: Negócios (2)", "VIPS: Negócios (3)" a cada nova importação do mesmo grupo).

### 3. Backend — endpoint de listagem

`GET /api/whatsapp/grupos` — usa `resolverConfigGrupoAtivo()` (já existe, ~linha 435 de `routes/whatsapp.ts`) pra pegar a config da instância ativa, chama o endpoint confirmado no item 1, e pra cada grupo retorna: `jid`, `subject`, `pictureUrl`, `totalMembros`. Cruzar com o banco local (`listas WHERE grupo_jid = X`, se existir, `JOIN` com `contatos` pra contar quantos já foram importados) pra devolver também `jaImportados` e `listaId` (se já existe). Cache de poucos minutos em memória (mesmo espírito de outras chamadas Evolution já cacheadas no sistema) — listar todos os grupos pode ser uma chamada pesada se a conta estiver em muitos grupos; não refazer a cada render da tela, só quando o operador clicar "Atualizar".

### 4. Backend — prévia de membros antes de importar

`GET /api/whatsapp/grupos/:groupJid/membros` — reaproveita `buscarInfoGrupo()` (já existe) e devolve a lista de `participantes` (telefone + admin) crua, pra tela mostrar uma prévia (nome não vem da Evolution, só telefone — deixar claro na UI) antes do operador confirmar a importação, parecido com o painel nativo do WhatsApp que o usuário mostrou (print: 544 membros, admins destacados, telefone visível).

### 5. Backend — importação passa a usar/criar a Lista do grupo

Em `POST /grupos/:groupJid/importar-contatos` (~linha 495-556): antes do loop de inserção, `SELECT id FROM listas WHERE user_id=$1 AND grupo_jid=$2` — se não existir, `INSERT INTO listas (user_id, nome, grupo_jid) VALUES ($1, info.subject || groupJid, $2) RETURNING id`. Adicionar `lista_id` no `INSERT INTO contatos` (hoje ausente) usando esse id. Não mudar nenhuma outra regra já existente (não sobrescreve contato existente, `origem='Grupo WhatsApp'`, filtro de `phoneNumber` resolvido, etc.).

### 6. Frontend — nova aba "Grupos"

`src/components/whatsapp/GruposLeads.tsx` (novo componente) + registrar em `WhatsApp.tsx` (`VALID_TABS`, novo `TabsTrigger`/`TabsContent`, ícone sugerido `UsersRound` do `lucide-react`, mesmo padrão dos outros). Tela: grid/lista de cards de grupo — foto, nome, `jaImportados / totalMembros`, botão "Importar"/"Atualizar" (texto muda se `listaId` já existir), botão secundário "Ver membros" que expande/abre um preview (telefone + badge de admin, usando o endpoint do item 4) antes de confirmar a importação de verdade — decisão deliberada do usuário antes de trazer gente pro CRM, não automático. Após importar, toast com o resumo que o endpoint já devolve (`novos`/`jaExistiam`/`descartados`/`semNumeroResolvido`) e um link/aviso indicando que a lista já está pronta pra usar em Disparos.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend e backend). Testar em homolog com grupo real: listar grupos reais da instância de teste, conferir contagem de membros bate com o WhatsApp real; prévia de membros mostra telefone/admin corretos; importar um grupo pela primeira vez cria a Lista nova; importar o MESMO grupo de novo reaproveita a mesma Lista (não duplica) e reporta `jaExistiam` alto na segunda vez; a Lista criada aparece corretamente selecionável no passo "Por Lista" de uma campanha de Disparos de teste.

## AO FINALIZAR, REPORTAR

- Qual caminho foi usado pra listar todos os grupos (endpoint confirmado, ou fallback via `whatsapp_messages`) e evidência de que funciona com dado real.
- Confirmação de que reimportar o mesmo grupo reaproveita a Lista (idempotente), com teste real (2 importações seguidas do mesmo grupo).
- Confirmação de que a Lista criada aparece e funciona no passo "Por Lista" de Disparos.
- Tempo real de resposta do endpoint de listagem de grupos (se a conta de teste tiver vários grupos) — avaliar se o cache é suficiente ou se precisa de mais alguma otimização.
- Build limpo nos dois lados.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
- Deixar registrado como pendência relacionada (não implementar agora, fora de escopo): `contatos.is_group` — coluna recomendada em `SPRINT_GRUPOS_DIAGNOSTICO_COMPLETO.md`, ainda não implementada, complementaria esta sprint mas é mudança separada.
