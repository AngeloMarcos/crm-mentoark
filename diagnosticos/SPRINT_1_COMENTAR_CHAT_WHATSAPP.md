# Sprint 1 — Comentar a Lógica do Módulo Chat/WhatsApp no Próprio Código

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro (agora com duas seções novas: "Absorver e excluir documentos de diagnóstico" e "Relatório prospectivo ao final de cada sprint" — seguir as duas à risca nesta sprint).

**Mudança de método a partir de agora:** nada de novos arquivos `PROMPT_CLAUDE_CODE_*.md`/`DIAGNOSTICO_*.md` soltos. Todo entendimento sobre o que funciona, o que não funciona, e por quê, vira comentário `[AUDITORIA]` no arquivo de código exato. Documentos antigos que já explicam algo são lidos, absorvidos pro código, e apagados.

---

## GROUND TRUTH JÁ CONFIRMADO — NÃO REDESCOBRIR (vem de `STATUS.md`, atualizado 2026-07-08)

Usar isso como ponto de partida, não como suspeita a reverificar do zero:

1. **`crm-api` rejeita payload do Evolution acima de 1MB** (`PayloadTooLargeError`, limite atual 1.048.576 bytes, payload real chegando com 1.391.947 bytes) — 14 ocorrências na última 1h confirmadas ao vivo. Isso devolve erro pro Evolution, que entra em retry no `Webhook-Global`. **Este é hoje o candidato mais forte pra explicar "mensagem enviada mas não recebida de volta pelo CRM"** quando a mensagem envolve mídia (imagem/áudio/documento facilmente passam de 1MB em base64).
2. **Evolution ainda emite erro Prisma `P2010`** (`io.updateChatUnreadMessages`) — 5x nas últimas 2h. A troca de versão da imagem feita anteriormente **não resolveu**. Ainda é bug upstream do Evolution v2.3.7.
3. OpenClaw já foi removido por completo e confirmado sem dependência em produção — não precisa reabrir esse assunto.

## TAREFA A — APLICAR O FIX DO PAYLOAD (já diagnosticado, seguro, pequeno e isolado — aplicar direto, sem duvidar)

Em `backend/src/index.ts`, achar `app.use(express.json({ limit: '1mb' }));` e aumentar o limite (ex: `'5mb'` — ajustar conforme o tamanho real de payload observado, com margem). Comentar com `[AUDITORIA] FIX APLICADO` explicando o valor exato (1.39MB observado, 5MB de folga) e citando os 14 eventos/1h como evidência. Isso ainda precisa ser deployado depois — não fazer o deploy dentro desta sprint sem confirmação do usuário, só deixar a mudança pronta localmente.

## TAREFA B — DOCUMENTOS A ABSORVER E APAGAR NESTA SPRINT (só os de chat/WhatsApp — não mexer nos outros módulos)

Para cada um: ler, mapear os achados pro código correspondente, comentar com `[AUDITORIA]`, verificar contra o sistema real antes de marcar `FIX APLICADO`, apagar o documento.

- `backend/DIAGNOSTICO-EVOLUTION.md`
- `PROMPTS_WHATSAPP_UI.md`
- `PROMPTS_WHATSAPP_20.md`
- `.lovable/plan.md`
- `prompts/SPRINT_1_whatsapp_fix.md`
- `prompts/claude_code_fix_whatsapp.md`
- `prompts/claudecode_prompt3_fix_supabase_para_api.md` (checar se é sobre WhatsApp ou geral — só absorver a parte relevante se for módulo misto, deixar o resto pra sprint de outro módulo)
- `prompts/auditoria_sprint4_whatsapp_chave_hardcoded.md` (atenção: pode descrever uma chave hardcoded ainda presente no código — se confirmar que ainda existe, é achado de segurança sério, tratar como `BUG` de prioridade alta, não só nota histórica)
- `diagnosticos/PROMPT_CLAUDE_CODE.md`
- `diagnosticos/PROMPT_CLAUDE_CODE_OPENCLAW.md` (histórico — OpenClaw já removido e confirmado, absorver como registro do que foi removido e por quê, depois apagar)
- `diagnosticos/PROMPT_CLAUDE_CODE_WHATSAPP_SYNC.md`
- `diagnosticos/PROMPT_CLAUDE_CODE_AUDITORIA_WHATSAPP.md`
- `diagnosticos/PROMPT_CLAUDE_CODE_RASTREIO_MENSAGENS.md` (se existir)
- `diagnosticos/PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md` — **atenção: o achado 2 do Ground Truth acima mostra que o fix descrito aqui não resolveu.** Absorver o histórico (o que foi tentado, por que não foi suficiente) e deixar um `[AUDITORIA] FIX PENDENTE` claro em `backend/src/routes/webhook.ts` (ou onde fizer mais sentido) descrevendo as opções ainda não tentadas (trocar `DATABASE_PROVIDER`, fixar versão anterior do Evolution, aguardar patch upstream) — isso é uma decisão do usuário, não decidir sozinho.
- `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` — depois que a Tarefa A for aplicada, este documento fica redundante (conteúdo já absorvido no comentário do Passo A) — apagar.

**Não apagar:** `STATUS.md`, `AUDITORIA_LOG.md`, `AUDITORIA_PROTOCOLO.md`, `INVENTARIO_VPS.md`, `diagnosticos/PROMPT_CLAUDE_CODE_SETUP_GRAFANA.md`, `diagnosticos/PROMPT_CLAUDE_CODE_ALERTA_WHATSAPP.md`, `diagnosticos/PROMPT_CLAUDE_CODE_RELATORIO_VPS.md`, `diagnosticos/PROMPT_CLAUDE_CODE_ORGANIZAR_STATUS.md`, `diagnosticos/PROMPT_CLAUDE_CODE_REMOVER_OPENCLAW_EXPANDIR_GRAFANA.md` (partes de Grafana ainda pendentes), `diagnosticos/PROMPT_CLAUDE_CODE_RESTAURAR_GRAFANA.md`, `diagnosticos/PROMPT_CLAUDE_CODE_DASHBOARD_ENVIO_MENSAGEM.md` — são tarefas de infra ainda não executadas, não "explicações de problema" a absorver.

## TAREFA C — COMENTAR A LÓGICA COMPLETA DO MÓDULO (ponta a ponta, não só onde já havia documento)

Nesta ordem, mais crítico primeiro. Para cada arquivo: cabeçalho de 3-5 linhas explicando o papel do arquivo, comentário `[AUDITORIA] LÓGICA` em cada trecho não-óbvio, `BUG`/`FIX APLICADO`/`FIX PENDENTE` onde aplicável (várias partes já têm comentários de sessões anteriores — não duplicar, só completar o que falta).

**Backend:**
1. `backend/src/routes/webhook.ts` — dar atenção especial: já tem comentários de auditoria anteriores, completar o que faltar, e é onde o `FIX PENDENTE` do Evolution Prisma deve ficar registrado.
2. `backend/src/routes/whatsapp.ts` — a rota `POST /send` (linha ~1060) ainda não foi lida a fundo em nenhuma sessão anterior — priorizar essa leitura, é o caminho de saída de mensagem.
3. `backend/src/services/agentEngine.ts`
4. `backend/src/services/humanizationService.ts`
5. `backend/src/services/whatsapp.ts` — confirmar de novo se segue morto (não importado); se sim, marcar `🗑️ candidato a remoção` e **perguntar ao usuário antes de apagar o arquivo** (não decidir sozinho).
6. `backend/src/services/webhook.ts` — mesma checagem do item 5.

**Frontend:**
7. `src/pages/WhatsApp.tsx`
8. `src/components/WhatsAppInterface.tsx` — arquivo grande, já tem vários comentários de auditoria de sessões anteriores (Invalid Date, polling, OpenClaw removido do envio) — completar o que faltar, não repetir.
9. `src/services/evolutionService.ts`
10. `src/components/whatsapp/InstanceManagementPanel.tsx`
11. `src/components/whatsapp/TesteInstancias.tsx`
12. `src/pages/admin/DiagnosticoWhatsApp.tsx`
13. `src/pages/MonitorWhatsApp.tsx`
14. `src/pages/SimuladorWebhook.tsx`

Build (`npm run build` frontend e backend) + commit por arquivo/grupo pequeno, como sempre. Atualizar `AUDITORIA_LOG.md` a cada arquivo.

---

## RELATÓRIO PROSPECTIVO (obrigatório, ver regra em `AUDITORIA_PROTOCOLO.md`)

Perto do fim da sprint, antes de fechar, escrever no relatório final (não em arquivo novo):
- O que ainda está `FIX PENDENTE` e por quê (esperado: pelo menos o Evolution Prisma e qualquer achado da chave hardcoded).
- Algum arquivo da lista da Tarefa C que não deu tempo de comentar.
- Qualquer coisa encontrada que aponte pra outro módulo (ex: se a chave hardcoded do `auditoria_sprint4` afetar outro lugar do sistema além do WhatsApp).
- Sugestão de qual deveria ser a Sprint 2.

## AO FINALIZAR, REPORTAR

- Quantos documentos absorvidos e apagados (lista).
- Fix do payload aplicado (Tarefa A) — confirmar.
- Quantos arquivos de código comentados (Tarefa C) de quantos no total.
- O relatório prospectivo acima.
- Atualizar `STATUS.md`.
