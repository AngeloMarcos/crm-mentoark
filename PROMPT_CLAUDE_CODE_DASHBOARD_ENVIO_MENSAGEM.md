# Prompt para Claude Code — Rastrear Envio de Mensagem Ainda Falhando + Dashboard Dedicado no Grafana

Cole este prompt inteiro no Claude Code (CLI). Sintoma atual: mensagem ainda não envia, mesmo depois das correções anteriores (Invalid Date, remoção do OpenClaw do fluxo de envio, upgrade do Evolution, ajuste do payload). Proceder com cautela: **não assumir qual fix já está no ar — confirmar cada um antes de investigar algo novo.** Seguir `AUDITORIA_PROTOCOLO.md`.

---

## FASE 0 — CONFIRMAR O QUE JÁ ESTÁ REALMENTE EM PRODUÇÃO (antes de investigar bug novo)

As correções de `WhatsAppInterface.tsx` (Invalid Date, remoção do OpenClaw do envio) e a remoção completa do OpenClaw só existem no repo local até serem deployadas. Confirmar se isso já foi feito:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec crm sh -c "grep -c \"Invalid Date\\|formatTime(m.timestamp)\" /usr/share/nginx/html/assets/*.js 2>/dev/null || echo checar-manualmente"'

# Mais confiável: comparar data de build da imagem com a hora do commit local
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker inspect crm --format "{{.Created}}"; docker inspect crm-api --format "{{.Created}}"'
```

Se os containers foram criados/buildados **antes** das correções desta sessão terem sido commitadas localmente, **nenhuma delas está em produção ainda** — isso sozinho explica por que o sintoma persiste. Se for o caso, rodar o deploy (frontend e backend, comandos padrão do `CLAUDE.md`) antes de qualquer investigação nova, e testar de novo. Só seguir pra Fase 1 se o envio ainda falhar depois de confirmar que os fixes estão realmente no ar.

## FASE 1 — TESTE AO VIVO COM RASTREIO COMPLETO (Loki + logs simultâneos)

Abrir 2 streams de log em paralelo e mandar UMA mensagem de teste pelo CRM:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs -f crm-api 2>&1 | grep --line-buffered -E "WHATSAPP|WH:|send|erro|Erro"' &

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs -f evolution 2>&1 | grep --line-buffered -iE "error|send|message"'
```

No navegador: abrir DevTools → aba Network, filtrar por `send`, mandar a mensagem, e capturar: status HTTP da resposta de `POST /api/whatsapp/send`, o corpo da resposta (JSON de erro, se houver), e o payload enviado.

Documentar exatamente qual dos três pontos falha:
- Requisição nem chega no `crm-api` (erro de rede/CORS no navegador) → investigar frontend/proxy.
- Chega no `crm-api` mas retorna erro antes de chamar a Evolution (ex: instância não encontrada, config ausente) → ler a rota `POST /send` em `backend/src/routes/whatsapp.ts` (linha ~1060) por completo — ainda não foi lida a fundo nesta auditoria.
- Chega na Evolution mas ela recusa/erra o envio → ver o erro exato nos logs do `evolution`.

## FASE 2 — LER A ROTA `/send` A FUNDO (ainda não auditada em detalhe)

`backend/src/routes/whatsapp.ts`, `router.post('/send', ...)` (linha ~1060): ler o corpo inteiro, comentar a lógica com `[AUDITORIA] LÓGICA`, prestando atenção especial em:
- Como ela resolve `instancia` (via `getEvolutionConfig` — lembrar da divergência `cfg.instancia` vs `cfg.stableInstancia` já documentada em outra sessão).
- Tratamento de erro da chamada à Evolution (`fetch` para `/message/sendText/:instancia` ou equivalente) — o erro real está sendo repassado pro frontend de forma legível, ou é engolido/genérico?

Corrigir o que for seguro corrigir; deixar `FIX PENDENTE` com o log exato da Fase 1 anexado no comentário se precisar de decisão do usuário.

---

## FASE 3 — DASHBOARD DEDICADO "WhatsApp — Envio e Recebimento" NO GRAFANA

Criar um novo dashboard provisionado (mesmo padrão do "Mentoark - Logs dos Containers" já existente), só que focado no fluxo de mensagens, com estes painéis:

1. **Taxa de erro do envio** — Loki query: `sum(count_over_time({container="crm-api"} |~ "POST /api/whatsapp/send" [5m]))` cruzada com `|~ "erro|Erro|500|502|503"` (ajustar a query real depois de ver o formato exato do log de `/send` na Fase 2 — os logs devem ter um padrão de linha por requisição; se não tiverem, é um `FIX PENDENTE` adicional: adicionar log estruturado na rota `/send` pra viabilizar esse painel).
2. **Stream ao vivo de envio** — logs de `{container="crm-api"} |~ "WHATSAPP.*send|POST /api/whatsapp/send"`.
3. **Stream ao vivo do webhook (recebimento)** — logs de `{container="crm-api"} |~ "WH:"`.
4. **Stream de erros da Evolution** — `{container="evolution"} |~ "(?i)error"`.
5. **Contagem de mensagens salvas por minuto** (se der pra expor uma métrica via Postgres exporter — se não houver `postgres_exporter` configurado ainda, deixar como `FIX PENDENTE`, não instalar um exporter novo dentro deste prompt sem confirmar com o usuário primeiro).

Salvar como `/opt/observability/grafana/provisioning/dashboards/whatsapp-envio-recebimento.json`, mesmo mecanismo de provisioning já usado.

## FASE 4 — VALIDAÇÃO

Repetir o teste de envio da Fase 1 olhando agora só pelo dashboard novo (sem precisar abrir terminal/SSH) — confirmar que dá pra ver, só de bater o olho no Grafana, se a mensagem passou ou travou e em qual camada.

---

## AO FINALIZAR, REPORTAR

- Se os fixes anteriores já estavam mesmo em produção antes desta sessão (Fase 0) — isso é crítico, reportar primeiro.
- Causa raiz exata do envio ainda falhando, com o log/evidência da Fase 1.
- O que foi corrigido vs. `FIX PENDENTE`.
- Link/nome do novo dashboard e confirmação de que ele mostra o problema (ou a ausência dele) de forma clara.
- Atualizar `STATUS.md` com o resultado.
