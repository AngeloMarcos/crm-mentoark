# Prompt para Claude Code — Organizar Tudo em um Painel Único de Status

Cole este prompt inteiro no Claude Code (CLI). Já existem vários arquivos soltos na raiz do repo de sessões anteriores (`PROMPT_CLAUDE_CODE_*.md`, `DIAGNOSTICO_WHATSAPP_PROMPT.md`, `AUDITORIA_*.md`, `INVENTARIO_VPS.md`). Objetivo desta sessão: organizar tudo isso em uma estrutura clara + criar um arquivo único de status que qualquer pessoa (ou sessão futura do Claude Code) abre e sabe **na hora** o que está funcionando, o que está quebrado, e o que está pendente — sem precisar reler todo o histórico de conversas.

---

## FASE 1 — ORGANIZAR OS ARQUIVOS (mover, não apagar nada)

```bash
mkdir -p diagnosticos
git mv PROMPT_CLAUDE_CODE_WHATSAPP_SYNC.md diagnosticos/ 2>/dev/null
git mv PROMPT_CLAUDE_CODE_AUDITORIA_WHATSAPP.md diagnosticos/ 2>/dev/null
git mv PROMPT_CLAUDE_CODE_RASTREIO_MENSAGENS.md diagnosticos/ 2>/dev/null
git mv PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md diagnosticos/ 2>/dev/null
git mv PROMPT_CLAUDE_CODE_SETUP_GRAFANA.md diagnosticos/ 2>/dev/null
git mv PROMPT_CLAUDE_CODE_ALERTA_WHATSAPP.md diagnosticos/ 2>/dev/null
git mv PROMPT_CLAUDE_CODE_RELATORIO_VPS.md diagnosticos/ 2>/dev/null
git mv PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md diagnosticos/ 2>/dev/null
git mv PROMPT_CLAUDE_CODE_OPENCLAW.md diagnosticos/ 2>/dev/null
git mv DIAGNOSTICO_WHATSAPP_PROMPT.md diagnosticos/ 2>/dev/null
git mv PROMPT_CLAUDE_CODE.md diagnosticos/ 2>/dev/null
git mv AUDITORIA_PROTOCOLO.md diagnosticos/ 2>/dev/null
git mv AUDITORIA_LOG.md diagnosticos/ 2>/dev/null
git mv INVENTARIO_VPS.md diagnosticos/ 2>/dev/null
```
Se algum `git mv` falhar por o arquivo não existir (nem todos foram necessariamente criados), ignorar e seguir. Não mover `CLAUDE.md` — ele continua na raiz, é o arquivo de instruções principal do projeto.

## FASE 2 — RE-VERIFICAR O ESTADO ATUAL (não confiar só no que foi relatado em conversas anteriores — checar ao vivo antes de preencher o status)

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'EOF'
echo "=== CONTAINERS ==="
docker ps --format "table {{.Names}}\t{{.Status}}"
echo ""
echo "=== EVOLUTION: erro Prisma nas últimas 2h? ==="
docker logs evolution --since 2h 2>&1 | grep -ci "prisma"
echo ""
echo "=== EVOLUTION: retry do Webhook-Global ainda ativo? ==="
docker logs evolution --since 15m 2>&1 | grep -c "Webhook-Global"
echo ""
echo "=== CRM-API: entity.too.large ainda ocorrendo? ==="
docker logs crm-api --since 1h 2>&1 | grep -c "entity.too.large"
echo ""
echo "=== DISCO ==="
df -h /
EOF
```

## FASE 3 — CRIAR `STATUS.md` NA RAIZ DO REPO

Este é o arquivo "bater o olho". Curto, direto, sem prosa — uma tabela de status + uma lista do que fazer a seguir. Usar os resultados reais da Fase 2 (não os números de sessões passadas, que podem estar desatualizados) para preencher a coluna Status.

```md
# STATUS — CRM Mentoark

> Atualizado em: <DATA_HORA_ATUAL>. Este arquivo é o ponto de partida de qualquer sessão nova — ler antes de qualquer outro arquivo em `diagnosticos/`.

## Núcleo CRM

| Serviço    | Status | Detalhe                                      | Diagnóstico/Fix relacionado |
|------------|--------|-----------------------------------------------|------------------------------|
| crm-api    | 🟢/🟡/🔴 | <preencher com achado real da Fase 2>         | `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` (payload grande) |
| crm        | 🟢     | Sem problema conhecido                        | — |
| postgres   | 🟢     | 14MB, saudável                                | — |
| evolution  | 🟢/🟡/🔴 | <preencher: Prisma ok? Webhook-Global ainda em retry?> | `diagnosticos/PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md`, `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` |

## Observabilidade

| Serviço | Status | Detalhe |
|---------|--------|---------|
| grafana | 🟢 | `grafana.mentoark.com.br`, dashboard "Mentoark - Logs dos Containers" ativo |
| loki    | 🟢 | Recebendo logs de crm-api, evolution, crm, n8n |
| alloy   | 🟢 | Coletando logs via docker.sock |

## Em standby (não mexer sem pedido explícito)

| Serviço | Status | Nota |
|---------|--------|------|
| n8n     | ⚪ | `DB_TYPE=mysqldb` inválido, caindo em SQLite silenciosamente — sinalizado, não investigado |

## Pendências abertas (ordem de prioridade)

1. <preencher com o que a Fase 2 confirmar como ainda quebrado — ex: "Webhook-Global do Evolution ainda em retry, aplicar `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md`">
2. Alerta WhatsApp via n8n — aguardando número de destino do usuário (`diagnosticos/PROMPT_CLAUDE_CODE_ALERTA_WHATSAPP.md`)
3. Limpeza de disco opcional (~10GB recuperável, `diagnosticos/INVENTARIO_VPS.md`)
4. n8n `DB_TYPE` inválido — investigar quando sair do standby

## Regra para sessões futuras

Toda vez que um prompt de `diagnosticos/` for executado (diagnóstico rodado, bug corrigido, ou descartado), atualizar a tabela acima e a data no topo. Este arquivo nunca deve ficar desatualizado — se um Claude Code terminar uma tarefa e não atualizar o `STATUS.md`, a tarefa não está completa.
```

## FASE 4 — ATUALIZAR O `CLAUDE.md`

Adicionar uma linha no topo do `CLAUDE.md` (logo após o título, antes de "## Produto") apontando pro `STATUS.md`:

```md
> **Antes de qualquer coisa, leia `STATUS.md`** — painel de status atual de todos os serviços e pendências abertas.
```

## FASE 5 — COMMIT

```bash
git add -A && git commit -m "chore: organizar diagnosticos/ e criar STATUS.md como painel único"
```

---

## AO FINALIZAR, REPORTAR

- Quantos arquivos movidos para `diagnosticos/`.
- O conteúdo real preenchido nas células `<preencher>` do `STATUS.md` (o que a Fase 2 encontrou de fato).
- Confirmação do commit.
