# Prompt para Claude Code — Auditoria Completa: Módulo WhatsApp

Cole este prompt inteiro no Claude Code (CLI), dentro da pasta do projeto. Antes de começar, leia `AUDITORIA_PROTOCOLO.md` na raiz do projeto — ele define as regras de comentário, quando corrigir vs. deixar pendente, e o formato do log. Este prompt é só o "kickoff" do módulo WhatsApp; o protocolo vale igual para os próximos módulos.

---

## ESCOPO — MÓDULO WHATSAPP COMPLETO

### Arquivos já identificados (comece por eles, nesta ordem — do mais crítico pro mais periférico):

**Backend (core):**
1. `backend/src/routes/webhook.ts` — recebe eventos da Evolution, decide dono da mensagem, salva no banco
2. `backend/src/routes/whatsapp.ts` — todas as rotas REST (conectar, enviar, listar conversas, etc.)
3. `backend/src/services/agentEngine.ts` — motor de IA que responde as mensagens
4. `backend/src/services/humanizationService.ts` — humanização de resposta da IA

**Backend (já suspeitos de serem código morto — confirmar e marcar, não deletar sem confirmar):**
5. `backend/src/services/whatsapp.ts` — **não é importado em nenhum lugar** (já verificado: nenhum `import` referencia este arquivo). Confirmar de novo e marcar como candidato a remoção no log.
6. `backend/src/services/webhook.ts` — mesma situação do item 5, confirmar e marcar.

**Frontend (core):**
7. `src/pages/WhatsApp.tsx`
8. `src/components/WhatsAppInterface.tsx` (arquivo grande, ~2800 linhas — dividir a leitura em blocos, não pular partes)
9. `src/services/evolutionService.ts`
10. `src/components/whatsapp/InstanceManagementPanel.tsx`
11. `src/components/whatsapp/TesteInstancias.tsx`

**Frontend (ferramentas de diagnóstico — auditar também, são código real em produção):**
12. `src/pages/admin/DiagnosticoWhatsApp.tsx`
13. `src/pages/MonitorWhatsApp.tsx`
14. `src/pages/SimuladorWebhook.tsx`

### Depois de cobrir a lista acima, rode uma busca lateral para achar o que ficou de fora:

```bash
git grep -rli "whatsapp\|evolution" -- '*.ts' '*.tsx' | sort
```

Compare com a lista dos 14 arquivos acima. Qualquer arquivo que apareça na busca e não esteja na lista, avalie: se for genuinamente parte do fluxo do WhatsApp (não uma menção incidental em outro módulo), adicione à auditoria e ao log.

---

## CONTEXTO JÁ CONHECIDO (não redescobrir, só validar rapidamente se ainda procede)

- `PROMPT_CLAUDE_CODE_WHATSAPP_SYNC.md` (mesma pasta) — diagnóstico de instância órfã/webhook não registrado. Se ainda não foi rodado, essa investigação de produção continua separada e não faz parte desta auditoria de código estático.
- `DIAGNOSTICO_WHATSAPP_PROMPT.md` — diagnóstico antigo; vários itens já foram corrigidos (rotas que faltavam, UPSERT de contato). Ao auditar `whatsapp.ts` e `webhook.ts`, confirme item por item se cada ponto levantado ali já está mesmo resolvido e atualize/apague o que estiver obsoleto nesse arquivo.
- `agent_configs` guarda 1 instância Evolution ativa por usuário (`UNIQUE(user_id)`); `agentes` permite várias por usuário (`UNIQUE(user_id, evolution_instancia)`). Isso já foi confirmado nas migrations — não precisa reconfirmar, só ter em mente ao ler código que usa essas tabelas.

---

## EXECUÇÃO

1. Ler `AUDITORIA_PROTOCOLO.md` por completo.
2. Criar/atualizar `AUDITORIA_LOG.md` com uma linha por arquivo da lista acima, status inicial "em progresso".
3. Processar os arquivos na ordem listada, um de cada vez, seguindo o processo de 8 passos do protocolo (ler completo → comentar lógica → investigar suspeitas → corrigir ou marcar pendente → build → commit → atualizar log).
4. Não pular para o próximo módulo sem terminar a lista + a busca lateral.
5. Não fazer deploy (scp/docker) em nenhum momento desta auditoria — só commits locais.

## AO FINALIZAR, REPORTAR

- Total de arquivos revisados.
- Lista de bugs corrigidos (arquivo + resumo de 1 linha cada).
- Lista de `FIX PENDENTE` com motivo (o que falta decidir/confirmar).
- Confirmação se `services/whatsapp.ts` e `services/webhook.ts` são mesmo mortos, com recomendação de remoção ou não.
- Sugestão do próximo módulo a auditar (ex: Kanban, Catálogo, Disparos).
