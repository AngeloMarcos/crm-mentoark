# Prompt para Claude Code — Relatório e Organização Geral da VPS

Cole este prompt inteiro no Claude Code (CLI). Objetivo: um raio-x completo de tudo que roda na VPS hoje, pra organizar prioridades. **Este prompt é só leitura/relatório — não mexer, não reiniciar, não deletar nada.** Prioridade de atenção: módulo CRM (crm, crm-api, postgres, evolution) primeiro. **n8n entra só no inventário, sem aprofundar nem mexer — fica em standby para uma sessão futura.**

---

## FASE 1 — INVENTÁRIO BRUTO (somente leitura)

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'EOF'
echo "=== CONTAINERS (todos, incluindo parados) ==="
docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "=== USO DE RECURSOS POR CONTAINER (live, 1 amostra) ==="
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

echo ""
echo "=== DISCO: RESUMO GERAL DOCKER ==="
docker system df -v

echo ""
echo "=== DISCO: HOST ==="
df -h /

echo ""
echo "=== MEMÓRIA: HOST ==="
free -h

echo ""
echo "=== VOLUMES DOCKER ==="
docker volume ls

echo ""
echo "=== IMAGENS NÃO USADAS (dangling) ==="
docker images -f dangling=true

echo ""
echo "=== COMPOSE FILES EXISTENTES EM /opt ==="
find /opt -maxdepth 3 -iname "docker-compose*.yml" 2>/dev/null

echo ""
echo "=== CRONTAB DO ROOT ==="
crontab -l 2>/dev/null || echo "(sem crontab)"

echo ""
echo "=== REDES DOCKER ==="
docker network ls
EOF
```

## FASE 2 — CRUZAR COM O QUE JÁ ESTÁ DOCUMENTADO

Comparar a saída acima com a tabela "Serviços e Domínios" do `CLAUDE.md` (raiz do repo). Para cada container encontrado na Fase 1, verificar:
- Está na tabela do `CLAUDE.md`? Se não, é candidato a documentar (ou é lixo/teste esquecido — investigar antes de decidir).
- Algo que está documentado no `CLAUDE.md` mas não aparece rodando? Marcar como possível divergência (serviço caiu, ou doc desatualizada).

## FASE 3 — FICHA POR SERVIÇO (priorizar nesta ordem)

Para cada um dos serviços abaixo, produzir um resumo curto: propósito, status, criticidade, uso de recursos (da Fase 1), última atividade relevante nos logs, e link pros arquivos de diagnóstico já existentes nesta pasta quando aplicável.

**Prioridade 1 — Núcleo do CRM (aprofundar de verdade):**
1. `crm` (frontend)
2. `crm-api` (backend) — referenciar `AUDITORIA_LOG.md` e os prompts já rodados (`PROMPT_CLAUDE_CODE_WHATSAPP_SYNC.md`, `PROMPT_CLAUDE_CODE_RASTREIO_MENSAGENS.md`) pra não repetir diagnóstico.
3. `postgres` — versão, tamanho do banco (`SELECT pg_size_pretty(pg_database_size('crm'));`), espaço em disco do volume.
4. `evolution` — versão atual (deve refletir o upgrade feito em `PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md`), confirmar se ainda tem erros Prisma nos logs.

**Prioridade 2 — Observabilidade (já configurada, só confirmar saúde):**
5. `grafana`, `loki`, `alloy` — confirmar os 3 rodando, sem reiniciar.

**Prioridade 3 — Inventariar só de leve, não aprofundar:**
6. `n8n` — só registrar: está rodando? Quantos workflows ativos? Quando foi o último deploy/alteração? **Não abrir investigação de bugs aqui.**
7. `pgadmin`, `open-webui`, `traefik`, e qualquer outro container que apareceu na Fase 1 e ainda não foi mencionado — mesma regra: só inventariar (nome, propósito, status), sem aprofundar.

## FASE 4 — SINALIZAR OPORTUNIDADES DE LIMPEZA (sem executar)

Com base em `docker system df -v` e nas imagens dangling da Fase 1: quanto espaço em disco poderia ser recuperado com `docker image prune` / `docker volume prune`? **Listar o que seria removido, não remover.** Isso vira um item de decisão do usuário, não uma ação automática.

## FASE 5 — PRODUZIR O RELATÓRIO

Criar `INVENTARIO_VPS.md` na raiz do repo (mesmo padrão dos outros arquivos desta pasta) com:
- Tabela: Container | Propósito | Status | Criticidade (Núcleo CRM / Observabilidade / Standby) | Observações
- Seção "Divergências encontradas" (Fase 2)
- Seção "Limpeza possível" (Fase 4, só como sugestão)
- Seção "Recomendação de próximos passos", já ordenada por prioridade — CRM primeiro, n8n por último, explicitando que n8n foi deixado em standby por decisão do usuário nesta sessão.

Se a tabela do `CLAUDE.md` estiver desatualizada em relação ao que foi encontrado, atualizar essa tabela também (só ela, não reescrever o resto do arquivo).

---

## AO FINALIZAR, REPORTAR (resumo curto no chat, o relatório completo fica no arquivo)

- Quantos containers encontrados, quantos já documentados vs. novos.
- As 3 coisas mais importantes pra decidir agora sobre o núcleo CRM.
- Espaço em disco recuperável, se houver.
- Confirmação de que `n8n` foi só inventariado, sem investigação.
