# Scripts utilitários — VPS de produção

Esses arquivos NÃO rodam no build do frontend. São scripts para a VPS
`147.93.9.172` (`crm.mentoark.com.br`).

---

## monitor-crm.sh (Sprint 8)

Monitora RAM, CPU, disco, containers Docker e health do backend.
Adaptado pro stack Docker (sem PM2).

### Deploy

```bash
# Copiar pra VPS
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  scripts/monitor-crm.sh root@147.93.9.172:/root/monitor-crm.sh

# Conectar
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172
```

### Na VPS

```bash
chmod +x /root/monitor-crm.sh

# Teste manual
bash /root/monitor-crm.sh
tail -30 /root/monitor-crm.log

# Adicionar ao cron (a cada 5 min)
(crontab -l 2>/dev/null | grep -v monitor-crm; \
 echo "*/5 * * * * /root/monitor-crm.sh") | crontab -
crontab -l

# Ver histórico depois
tail -50 /root/monitor-crm.log
```

### O que checa

| Métrica | Limite alerta |
|---|---|
| RAM usada | > 90% |
| CPU | > 90% |
| Disco / | > 90% |
| Container parado/missing | sempre |
| Container `unhealthy` | sempre |
| Container com > 10 restarts | sempre |
| `https://api.mentoark.com.br/health` ≠ 200 | sempre |
| Postgres `SELECT 1` falha | sempre |

Logs em `/root/monitor-crm.log` (auto-rotaciona em 2000 linhas).

---

## sprint9-fix-modulos.sql (Sprint 9)

Ativa os 7 módulos padrão para `gkl15.working@gmail.com` e
`grotheraphael@gmail.com`.

### Importante antes de rodar

O backend já tem **fallback automático** (`backend/src/routes/modulos.ts`
linha 49-51): se um usuário não tem nenhum registro em `user_modulos`,
ele recebe os 7 módulos padrão de qualquer forma.

Esse SQL só ajuda se o problema for:
- Registros com `ativo=false` que silenciam o fallback
- Necessidade de fixar explicitamente os módulos no banco

Se mesmo assim os usuários não veem os módulos, o bug é em outro lugar
(role no JWT, frontend, etc) — me chame antes de rodar.

### Como rodar

**Opção A — psql na VPS:**
```bash
sshpass -p 'Mentoark@2025' ssh root@147.93.9.172 \
  'docker exec -i crm-api sh -c "psql \$DATABASE_URL" < /dev/stdin' \
  < scripts/sprint9-fix-modulos.sql
```

**Opção B — pgAdmin:**
1. Abrir `https://pgadmin.mentoark.com.br`
2. Conectar ao banco `crm`
3. Abrir Query Tool
4. Colar conteúdo de `sprint9-fix-modulos.sql`
5. Rodar parte 1 (diagnóstico) → confirmar → rodar partes 2 e 3

### Resultado esperado

Cada usuário deve ter `modulos_ativos = {contatos, dashboard, discagem,
disparos, funil, leads, whatsapp}`.
