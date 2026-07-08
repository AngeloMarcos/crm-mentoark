# Prompt para Claude Code — Corrigir Causa Raiz: Bug do Evolution API v2.3.7 (mensagens não despacham webhook)

Cole este prompt inteiro no Claude Code (CLI). Continuação direta do rastreio anterior — a causa raiz já foi confirmada (Camada 0, fora do código do CRM). Este prompt é só sobre a correção; não repita o diagnóstico.

---

## CORREÇÃO: NÃO TROCAR O BANCO DO EVOLUTION

O plano anterior era trocar `DATABASE_PROVIDER` do Evolution de MySQL para PostgreSQL. **Não fazer isso.** Pesquisa no repositório oficial do Evolution API (`evolution-foundation/evolution-api`) encontrou o issue [#2495](https://github.com/evolution-foundation/evolution-api/issues/2495): o mesmo tipo de erro do Prisma na v2.3.7, rodando em PostgreSQL — não é um problema do driver MySQL, é um bug de código na função `whatsappNumber()` (usada tanto para marcar chat como não-lido quanto para arquivar conversas), presente na versão 2.3.7 independente do banco. Já existe um PR ([#2515](https://github.com/evolution-foundation/evolution-api/pull/2515)) corrigindo exatamente esse ponto, e o changelog recente já lista correções relacionadas em `getLastMessage`/`markMessageAsRead`.

Trocar o banco: (a) provavelmente não resolveria, já que o bug é de código; (b) é arriscado — o Evolution guarda a sessão autenticada do WhatsApp (Baileys) no próprio banco, então migrar de MySQL para Postgres pode exigir reconectar (reescanear QR) de todas as instâncias, derrubando o WhatsApp de produção durante a migração.

## PLANO CORRIGIDO: ATUALIZAR A IMAGEM DO EVOLUTION

### Passo 1 — Confirmar a versão atual e a imagem exata em uso

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cat /opt/evolution/docker-compose.yml | grep -A2 image:'

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker inspect evolution --format "{{.Config.Image}}"'
```

### Passo 2 — Checar no GitHub (evolution-foundation/evolution-api) qual é a versão estável mais recente que já inclui a correção de #2495/#2515, e quais outras mudanças ela traz (ler o CHANGELOG.md e as release notes da versão candidata) antes de decidir o upgrade. Confirmar também se o formato do payload de webhook (`webhookByEvents`, `webhookBase64`, nomes de eventos) mudou entre a versão atual e a nova — se mudou, é preciso ajustar `backend/src/routes/whatsapp.ts` (`webhookInner()`) antes do deploy do Evolution novo.

### Passo 3 — Backup antes de qualquer coisa

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec postgres pg_dump -U mentoark crm > /root/backup_crm_pre_evolution_upgrade_$(date +%Y%m%d).sql
   # Se o Evolution usa MySQL, fazer backup do banco dele também — identificar o container/credenciais primeiro:
   docker ps --format "table {{.Names}}\t{{.Image}}" | grep -i mysql'
```

**PARAR E CONFIRMAR com o usuário** antes do Passo 4 — isso reinicia o serviço de WhatsApp em produção, com risco de precisar reconectar instâncias.

### Passo 4 — Atualizar a tag da imagem no `docker-compose.yml` do Evolution e subir

```bash
# Editar a linha "image:" em /opt/evolution/docker-compose.yml para a versão escolhida no Passo 2
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/evolution && docker compose pull && docker compose up -d'
```

### Passo 5 — Validação (repetir exatamente o teste do rastreio anterior)

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs -f evolution 2>&1 | grep -iE "error|prisma"' &
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs -f crm-api 2>&1 | grep --line-buffered "WH:"'
```

Enviar mensagem de teste real para a instância conectada. Confirmar: (1) nenhum erro Prisma nos logs do Evolution, (2) `[WH:...]` aparece nos logs do `crm-api`, (3) mensagem aparece em `whatsapp_messages` no banco, (4) mensagem aparece na tela do CRM.

Se a instância cair/precisar de novo QR após o upgrade, avisar o usuário antes de reconectar (ação manual dele, escanear o QR).

### Passo 6 — Se a instância exigir reconexão

Documentar isso claramente no relatório final — não é um erro do upgrade, é esperado dependendo de como o Evolution armazena a sessão entre versões.

---

## AO FINALIZAR, REPORTAR

- Versão antiga → versão nova.
- Se precisou reconectar (reescanear QR) alguma instância.
- Resultado do teste de validação do Passo 5.
- Se o formato do webhook mudou e se `whatsapp.ts` precisou de ajuste.
