# Prompt para Claude Code — Remover OpenClaw Completamente + Expandir Grafana

Cole este prompt inteiro no Claude Code (CLI). Seguir `AUDITORIA_PROTOCOLO.md` (ou `diagnosticos/AUDITORIA_PROTOCOLO.md`, se o prompt de organização já tiver movido os arquivos pra pasta `diagnosticos/` — checar qual caminho existe) — comentar, não deixar bug solto, `PARAR E CONFIRMAR` antes de deploy em produção. Duas partes independentes: remover o OpenClaw inteiro do sistema, e completar o setup de observabilidade que tinha ficado reduzido.

---

## PARTE 1 — REMOVER OPENCLAW POR COMPLETO

O agente admin com acesso a shell na VPS (`/openclaw` no frontend, `/api/openclaw` no backend) já causou um bug severo (documentado nesta sessão: sequestrava o envio de mensagens do WhatsApp, consumindo crédito da OpenAI à toa) e não tem mais uso — o Grafana assume o papel de observabilidade/operação da VPS a partir de agora.

### Passo 1 — Verificar se algum agente de IA em produção depende do motor OpenClaw (checagem obrigatória antes de remover)

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT user_id, nome, motor_ia FROM agentes WHERE motor_ia = '"'"'openclaw'"'"';
   SELECT user_id, motor_ia FROM agent_configs WHERE motor_ia = '"'"'openclaw'"'"';"'
```

Se alguma linha voltar, **PARAR E CONFIRMAR com o usuário** o que fazer (provável: resetar `motor_ia` para `NULL`/padrão nessas linhas, já que o fallback do `agentEngine.ts` cai automaticamente pro fluxo normal quando OpenClaw falha — só formalizar isso antes de apagar o código). Se vier vazio, seguir direto.

### Passo 2 — Remover do backend

- Deletar `backend/src/routes/openclaw.ts`.
- Em `backend/src/index.ts`: remover `import { makeOpenClawRouter } from './routes/openclaw';` e a linha `app.use('/api/openclaw', makeOpenClawRouter(pool));`.
- Em `backend/src/services/agentEngine.ts`: remover `import { chamarOpenClawAgent } from '../routes/openclaw';` e todo o bloco `usarOpenClaw`/chamada a `chamarOpenClawAgent` (a condição `if (!usarOpenClaw || !respostaFinal)` que envolve o fluxo normal deve virar incondicional, já que só existe um caminho agora — cuidado para não quebrar a indentação/lógica do restante da função ao simplificar).

### Passo 3 — Remover do frontend

- Deletar `src/pages/OpenClaw.tsx`.
- Deletar a pasta `src/components/openclaw/` inteira (`ChatMessage.tsx`, `StatusCard.tsx`, `FileConfigCard.tsx`).
- Em `src/App.tsx`: remover `import OpenClawPage from "./pages/OpenClaw";` e a rota `<Route path="/openclaw" ...>`.
- Em `src/components/AppSidebar.tsx`: remover o item de menu `"OpenClaw Admin"`.
- Em `src/services/evolutionService.ts`: os comentários `[AUDITORIA]` nas linhas ~4 e ~36 mencionam `OpenClaw.tsx` como consumidor — atualizar esses comentários já que o arquivo deixará de existir (não é bug, só limpeza de comentário desatualizado).

### Passo 4 — Build local (confirmar que compila sem os arquivos removidos) antes de cogitar deploy

```bash
npm run build        # frontend
cd backend && npm run build   # backend
```

### Passo 5 — Limpeza opcional no `.env` da VPS (não obrigatório, só limpeza)

`OPENCLAW_ADMIN_KEY` e `OPENCLAW_PROXY_URL` podem ficar órfãs no `.env` — remover é cosmético, não é preciso fazer agora. Marcar como `FIX PENDENTE` se não for mexer.

### Passo 6 — Deploy

**PARAR E CONFIRMAR com o usuário antes deste passo** (reinicia frontend e backend em produção):

```bash
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no -r \
  src/ backend/src/ root@147.93.9.172:/opt/crm/   # ajustar path exato conforme estrutura real do /opt/crm

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/crm && docker compose build --no-cache crm && docker compose up -d crm && \
   cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'
```

### Passo 7 — Validar

- `/openclaw` no CRM deve dar 404 (rota removida).
- Sidebar não mostra mais "OpenClaw Admin".
- Enviar mensagem de WhatsApp normal continua funcionando (confirma que a remoção não quebrou o fluxo principal).
- Se algum agente usava `motor_ia='openclaw'` (Passo 1), confirmar que ele agora responde pelo fluxo normal.

---

## PARTE 2 — COMPLETAR O SETUP DO GRAFANA (Prometheus + node-exporter + cAdvisor, que tinham ficado de fora por RAM)

Como o OpenClaw sai (não rodava como container próprio, mas simplifica a superfície do backend), e o Grafana passa a ser a ferramenta principal de operação/observabilidade, completar o que ficou pendente na primeira instalação.

### Passo 1 — Reconferir RAM livre agora

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'free -h && df -h /'
```

Se ainda estiver apertado, avisar o usuário antes de prosseguir — os 3 serviços novos consomem RAM adicional (leve, mas soma).

### Passo 2 — Adicionar ao `/opt/observability/docker-compose.yml` existente

Adicionar os serviços `prometheus`, `node-exporter`, `cadvisor` (specificação completa já está em `PROMPT_CLAUDE_CODE_SETUP_GRAFANA.md` — ou `diagnosticos/PROMPT_CLAUDE_CODE_SETUP_GRAFANA.md` se já movido —, seção da Fase 1 — reaproveitar exatamente aquele bloco, com a rede `observability` que já existe). Confirmar as versões estáveis atuais de cada imagem antes de fixar a tag (não usar `latest`).

O datasource Prometheus já deve estar provisionado desde a instalação original (`grafana/provisioning/datasources/datasources.yaml` já tinha as duas fontes) — só confirmar que ainda aponta certo depois de subir os containers novos.

### Passo 3 — Subir e validar

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/observability && docker compose up -d && docker compose ps'
```

No Grafana → Explore → datasource Prometheus, confirmar métricas de `node_memory_MemAvailable_bytes` e `container_cpu_usage_seconds_total` retornando dados.

### Passo 4 — Importar dashboards prontos via provisioning (mesmo padrão do dashboard de logs já feito)

Adicionar ao provisioning de dashboards os dois dashboards comunitários de referência: **Node Exporter Full** (ID 1860) e um de métricas por container (ID 893). Baixar os JSONs oficiais (`https://grafana.com/api/dashboards/1860/revisions/latest/download` e equivalente para 893), ajustar a variável de datasource pro Prometheus provisionado, e colocar em `/opt/observability/grafana/provisioning/dashboards/`.

---

## AO FINALIZAR, REPORTAR

- Confirmação de que nenhum agente de produção dependia do motor OpenClaw (ou o que foi feito se dependia).
- Lista de arquivos removidos.
- Resultado do build local antes do deploy.
- Status do deploy (se já confirmado pelo usuário) e validação pós-deploy.
- Prometheus/node-exporter/cAdvisor no ar e dashboards importados.
- Atualizar `STATUS.md`: remover linha do OpenClaw (se existir) e marcar observabilidade como completa (logs + métricas).
