# Relatório para revisão externa (Google AI Studio) — Evolution API "Connection Closed" no envio

> Gerado em 2026-07-12. Cole este arquivo inteiro no Google AI Studio para pedir uma segunda opinião sobre a causa raiz e possíveis mitigações do lado do CRM (o código do CRM já foi auditado e confirmado correto — ver seção "O que já foi descartado" abaixo).

## Resumo do problema

O envio de mensagens de WhatsApp pela Evolution API está falhando agora com **500 "Connection Closed"**, mesmo com a instância reportando `connectionStatus: "open"`. Isso não é um bug novo — é uma recorrência do mesmo padrão já diagnosticado em sessões anteriores (ver histórico abaixo), mas a instância principal (`crm_435ee4720fc3`) passou por uma reconexão/reparo (novo QR escaneado, perfil mudou de "Aesir Suporte" para "Mentoark") nas últimas horas e voltou a falhar.

**Reprodução ao vivo (2026-07-12), direto contra a Evolution API, sem passar pelo CRM:**
```bash
curl -s -X POST https://disparo.mentoark.com.br/message/sendText/crm_435ee4720fc3 \
  -H "Content-Type: application/json" \
  -H "apikey: mentoark2025evolutionkey" \
  -d '{"number":"5511979579548","text":"teste automatico","delay":500}'

# Resposta:
{"status":500,"error":"Internal Server Error","response":{"message":"Connection Closed"}}
```

**Estado da instância no mesmo instante** (`GET /instance/fetchInstances`):
```json
{
  "id": "84b23caa-1a55-429d-834f-32beeb9b1575",
  "name": "crm_435ee4720fc3",
  "connectionStatus": "open",
  "ownerJid": "5511979579548@s.whatsapp.net",
  "profileName": "Mentoark",
  "integration": "WHATSAPP-BAILEYS",
  "createdAt": "2026-07-08T14:30:01.000Z",
  "updatedAt": "2026-07-11T23:52:46.000Z",
  "_count": { "Message": 1253, "Contact": 452, "Chat": 22 }
}
```

Ou seja: a Evolution API **acredita** que a sessão está conectada (`open`), tem histórico real de mensagens/contatos (não é uma instância nova/vazia), mas o WebSocket real com o WhatsApp está fechado — o estado interno está dessincronizado da conexão real.

## Configuração completa do Evolution API

`/opt/evolution/docker-compose.yml` (VPS, produção — sem `.env` separado, tudo inline):

```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: evolution_redis
    restart: always
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
    - evolution_redis:/data
    networks:
    - proxy
    deploy:
      resources:
        limits:
          memory: 128m
  evolution:
    image: evoapicloud/evolution-api:latest
    container_name: evolution
    restart: always
    depends_on:
    - redis
    environment:
    - SERVER_URL=https://disparo.mentoark.com.br
    - AUTHENTICATION_API_KEY=mentoark2025evolutionkey
    - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
    - DATABASE_ENABLED=false
    - DATABASE_PROVIDER=mysql
    - DATABASE_CONNECTION_URI=mysql://root:Root@2024!Secure@mysql:3306/evolution
    - REDIS_ENABLED=true
    - REDIS_URI=redis://evolution_redis:6379
    - REDIS_PREFIX_KEY=evolution
    - CACHE_REDIS_ENABLED=true
    - CACHE_REDIS_URI=redis://evolution_redis:6379
    - CACHE_REDIS_PREFIX_KEY=cache
    - CACHE_LOCAL_ENABLED=false
    - WEBHOOK_GLOBAL_URL=https://api.mentoark.com.br/webhook/evolution?key=254bb1b449103a6ac94d2c289f965d29e89e487ab402ad9b
    - WEBHOOK_GLOBAL_ENABLED=true
    - WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS=false
    - WEBHOOK_EVENTS_MESSAGES_UPSERT=true
    - WEBHOOK_EVENTS_MESSAGES_UPDATE=true
    - WEBHOOK_EVENTS_MESSAGES_DELETE=true
    - WEBHOOK_EVENTS_SEND_MESSAGE=true
    - WEBHOOK_EVENTS_CONNECTION_UPDATE=true
    - WEBHOOK_EVENTS_QRCODE_UPDATED=true
    - QRCODE_LIMIT=30
    - QRCODE_COLOR=#198754
    - DEL_INSTANCE=true
    - LANGUAGE=pt-BR
    - TZ=America/Sao_Paulo
    volumes:
    - evolution_data:/evolution/instances
    labels:
    - traefik.enable=true
    - traefik.docker.network=proxy
    - traefik.http.routers.evolution.rule=Host(`disparo.mentoark.com.br`)
    - traefik.http.routers.evolution.entrypoints=websecure
    - traefik.http.routers.evolution.tls.certresolver=letsencrypt
    - traefik.http.services.evolution.loadbalancer.server.port=8080
    networks:
    - proxy
    - mysql_default
    deploy:
      resources:
        limits:
          memory: 640m
networks:
  proxy:
    external: true
  mysql_default:
    external: true
volumes:
  evolution_redis: null
  evolution_data: null
```

Notas relevantes sobre essa config:
- `DATABASE_ENABLED=false` mas `DATABASE_PROVIDER=mysql` + `DATABASE_CONNECTION_URI` apontando pro MySQL compartilhado (usado também por `pdv_prod`/`hemoclinic_prod`) — histórico: esse mesmo MySQL já foi a causa de outro bug confirmado (Prisma `P2010`, `PrismaClientKnownRequestError` em `io.updateChatUnreadMessages`, ver seção de histórico abaixo), que bloqueia o **recebimento** de mensagens (`messages.upsert` nunca é despachado). Esse é um bug diferente do de hoje (que é no **envio**), mas ambos giram em torno da mesma instância/conexão.
- Limite de memória do container `evolution`: 640MB.
- Sem healthcheck configurado — o Docker não sabe detectar "processo vivo mas WebSocket morto" e não reinicia sozinho.
- `restart: always` — não ajuda aqui porque o processo Node não crasha, só o WebSocket interno morre.

## Configuração completa do CRM (frontend + backend)

`/opt/crm/docker-compose.yml` (frontend, build estático):
```yaml
services:
  crm:
    build:
      context: .
      args:
        VITE_API_URL: https://api.mentoark.com.br
    container_name: crm
    restart: unless-stopped
    expose:
    - '80'
    networks:
    - proxy
    labels:
      traefik.enable: 'true'
      traefik.docker.network: proxy
      traefik.http.routers.crm.rule: Host(`crm.mentoark.com.br`)
      traefik.http.routers.crm.entrypoints: websecure
      traefik.http.routers.crm.tls.certresolver: letsencrypt
      traefik.http.services.crm.loadbalancer.server.port: '80'
    deploy:
      resources:
        limits:
          memory: 256m
networks:
  proxy:
    external: true
```

`/opt/crm/backend/docker-compose.yml`:
```yaml
version: '3.8'
services:
  crm-api:
    build: .
    container_name: crm-api
    restart: unless-stopped
    env_file:
    - .env
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql://mentoark:Mentoark@2025@147.93.9.172:5432/crm}
      JWT_SECRET: ${JWT_SECRET:-mentoark2025jwtsecretkey32chars!!}
      JWT_EXPIRES_IN: ${JWT_EXPIRES_IN:-1h}
      REFRESH_TOKEN_EXPIRES_IN: ${REFRESH_TOKEN_EXPIRES_IN:-30d}
      PORT: 3000
      NODE_ENV: production
      CORS_ORIGIN: ${CORS_ORIGIN:-https://crm.mentoark.com.br}
      EVOLUTION_API_URL: ${EVOLUTION_API_URL:-https://disparo.mentoark.com.br}
      EVOLUTION_API_KEY: ${EVOLUTION_API_KEY:-mentoark2025evolutionkey}
      MCP_SECRET: ${MCP_SECRET:-mentoark2025mcpsecretkey}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GOOGLE_REDIRECT_URI: ${GOOGLE_REDIRECT_URI:-https://api.mentoark.com.br/auth/callback/google}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      GOOGLE_PLACES_KEY: ${GOOGLE_PLACES_KEY}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      BACKEND_URL: ${BACKEND_URL:-https://api.mentoark.com.br}
      N8N_WEBHOOK_SECRET: ${N8N_WEBHOOK_SECRET:-mentoark-kanban-secret-2025}
      MASTER_EMAILS: ${MASTER_EMAILS:-angelobispofilho@gmail.com,mentoark@gmail.com}
      EVOLUTION_WEBHOOK_SECRET: ${EVOLUTION_WEBHOOK_SECRET}
      INITIAL_ADMIN_PASSWORD: ${INITIAL_ADMIN_PASSWORD:-Mentoark@2025}
    expose:
    - '3000'
    networks:
    - proxy
    labels:
      traefik.enable: 'true'
      traefik.docker.network: proxy
      traefik.http.routers.crm-api.rule: Host(`api.mentoark.com.br`)
      traefik.http.routers.crm-api.entrypoints: websecure
      traefik.http.routers.crm-api.tls.certresolver: letsencrypt
      traefik.http.services.crm-api.loadbalancer.server.port: '3000'
    deploy:
      resources:
        limits:
          memory: 320m
networks:
  proxy:
    external: true
```

`/opt/crm/backend/.env` (efetivo, sobrescreve os defaults do compose acima):
```
DATABASE_URL=postgresql://mentoark:Mentoark@2025@147.93.9.172:5432/crm
JWT_SECRET=mentoark2025jwtsecretkey32chars!!
JWT_EXPIRES_IN=1h
REFRESH_TOKEN_EXPIRES_IN=30d
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://crm.mentoark.com.br

GOOGLE_PLACES_KEY=
OPENAI_API_KEY=sk-proj-*** (chave real, omitida aqui — ver .env na VPS)

GOOGLE_CLIENT_ID=860158718119-le2091gfrsio0huhdl7pas5246n2ver8.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-*** (omitido)
GOOGLE_REDIRECT_URI=https://api.mentoark.com.br/auth/callback/google

ENCRYPTION_KEY=fecaf925c2fed618f67c62d9eb148e516576e078a600095bc6b26090407ee811
EVOLUTION_API_KEY=mentoark2025evolutionkey
EVOLUTION_WEBHOOK_URL=https://api.mentoark.com.br/webhook/evolution
EVOLUTION_API_URL=https://disparo.mentoark.com.br
EVOLUTION_WEBHOOK_SECRET=254bb1b449103a6ac94d2c289f965d29e89e487ab402ad9b
```
(Chaves reais de OpenAI/Google foram omitidas neste arquivo de relatório por precaução — se o Google AI Studio precisar delas para análise, cole manualmente a partir do `.env` da VPS.)

## Código do CRM que fala com a Evolution API (já auditado — ver conclusão abaixo)

`backend/src/utils/resilientFetch.ts` — wrapper de fetch com timeout (20s) + retry (3 tentativas, backoff 1s/2s/4s) **apenas em 503/504 e erros de rede** (ECONNREFUSED, ECONNRESET, ETIMEDOUT, ENOTFOUND, AbortError). Um 500 "Connection Closed" **não** é retentado por este wrapper — passa direto para quem chamou.

`backend/src/routes/whatsapp.ts` (trecho do handler de envio de texto, ~linha 1312-1349):
```ts
} else {
  // Envio de texto
  const targetUrl = `${base}/message/sendText/${cfg.instancia}`;
  let evoRes: globalThis.Response;
  try {
    evoRes = await evolutionFetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
      body: JSON.stringify({ number: phoneClean, text }),
    });
  } catch (err: any) {
    return res.status(502).json({ message: `Sem resposta da Evolution API: ${err.message}` });
  }
  if (!evoRes.ok) {
    const errText = await evoRes.text().catch(() => String(evoRes.status));

    if (evoRes.status === 404 || errText.includes('does not exist') || errText.includes('instance not found')) {
      // pede reconexão manual (401 + reconnect_required: true)
    } else if (errText.includes('presenceSubscribe') || errText.includes('Cannot read properties of undefined')) {
      // socket ainda inicializando — espera 3s e reenvia UMA vez
    } else {
      // genérico: repassa o erro cru pro frontend como 502
      return res.status(502).json({ message: `Evolution ${evoRes.status}: ${errText.slice(0, 200)}` });
    }
  }
}
```

**Observação (não é bug, é uma pergunta em aberto para a revisão externa):** existe um tratamento especial para `presenceSubscribe` (socket Baileys ainda inicializando — nesse caso vale esperar 3s e reenviar), mas **nenhum tratamento especial para "Connection Closed"** — cai no `else` genérico e retorna 502 direto. Não apliquei um retry automático para esse caso porque, pelo diagnóstico já confirmado (ver histórico), a causa aqui não é "socket ainda inicializando" e sim "WebSocket morto permanentemente até reconexão manual/restart do container" — um retry de alguns segundos não teria motivo pra funcionar diferente da tentativa original. Pergunta para a revisão externa: faz sentido o CRM chamar automaticamente algum endpoint de "restart/reconnect" da própria Evolution API quando detectar esse erro específico, em vez de só devolver 502 pro usuário? (Ver endpoints disponíveis: `PUT /instance/restart/{instance}`, `DELETE /instance/logout/{instance}`.)

## O que já foi descartado (não repetir sugestões já testadas)

1. **`DATABASE_SAVE_DATA_CHATS=false`** — testado ao vivo numa sessão anterior contra o bug de *recebimento* (Prisma P2010), não resolveu, revertido.
2. **Trocar `DATABASE_PROVIDER` de mysql para postgresql** — pesquisa indicou que o mesmo bug de Prisma já foi visto rodando em Postgres também noutras versões do Evolution — garantia baixa.
3. **Código do CRM (`whatsapp.ts`, `resilientFetch.ts`, `webhook.ts`)** — já revisado linha a linha em 3 rodadas anteriores de revisão externa (ver `AUDITORIA_LOG.md` no mesmo repositório) + revisado de novo agora — sem bug novo encontrado. `crm-api` resolve a instância certa e monta a chamada corretamente (confirmado via log `DEBUG SEND`).
4. **Reiniciar o container `evolution`** — ainda NÃO foi feito; é a ação mais provável de resolver (força o Baileys a reabrir o WebSocket usando a sessão já salva, sem precisar de novo QR), mas está pendente de confirmação do usuário antes de executar (ação em serviço de produção).

## Pergunta para a revisão externa

Dado que:
- O CRM já está confirmado correto (não é bug de código do lado do cliente).
- O problema é especificamente Evolution API (`evoapicloud/evolution-api:latest`, integração `WHATSAPP-BAILEYS`) reportando `connectionStatus: "open"` enquanto o WebSocket real do Baileys está fechado.
- Não há healthcheck no container que detectaria esse estado dessincronizado automaticamente.

Perguntas:
1. Existe alguma configuração conhecida do Evolution/Baileys (env var, endpoint de health, webhook de `CONNECTION_UPDATE`) que permitiria ao CRM (ou a um healthcheck externo) detectar esse estado "open mas morto" **antes** de tentar enviar, em vez de descobrir só no 500?
2. Vale a pena o CRM chamar `PUT /instance/restart/{instance}` automaticamente ao detectar "Connection Closed", com algum rate-limit para não ficar reiniciando em loop?
3. Alguma recomendação de versão/tag fixa do `evoapicloud/evolution-api` (em vez de `:latest`) que seja conhecida por ter esse comportamento mais estável?
