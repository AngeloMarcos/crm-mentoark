# Sprint 5 — Auditoria: Marketing — OAuth CSRF + Token Facebook em URL + Verify Token hardcoded
**Arquivo:** `backend/src/routes/marketing.ts`
**Severidade:** 🔴 CRÍTICO

---

## Problemas encontrados

### 1. OAuth state sem proteção CSRF — sequestro de sessão possível
O `state` do OAuth é apenas `base64({"user_id": "..."})`.
Não há nonce aleatório — um atacante pode:
1. Iniciar o OAuth com o `user_id` de outra vítima
2. Usar a URL de callback para vincular a conta Meta de outra pessoa à vítima
Isso permite trocar a conta Meta de qualquer usuário sem sua permissão.

### 2. Access token Facebook no URL das chamadas à Graph API
```typescript
const url = `...&access_token=${conta.access_token}`;
await fetch(`...?status=PAUSED&access_token=${conta.access_token}`, {...});
```
Tokens na URL aparecem nos logs do servidor, logs de proxy (Nginx/Cloudflare)
e no histórico do browser. O padrão correto é usar o header `Authorization`.

### 3. Webhook verify token hardcoded no código
```typescript
if (mode === "subscribe" && token === "mentoark-lead-webhook") {
```
O segredo do webhook está visível no código. Deve estar em variável de ambiente.

### 4. `postMessage('meta_connected', '*')` — origem muito permissiva
O `*` permite que qualquer site receba o evento de conexão.
Deve ser restrito à origem do CRM.

### 5. Access token Meta armazenado em texto plano no banco
A coluna `facebook_contas.access_token` guarda o token sem criptografia.
Se o banco vazar, todos os tokens Meta ficam expostos.

---

## Fixes

### `backend/src/routes/marketing.ts`

#### Fix 1 — State OAuth com nonce para proteção CSRF

```typescript
import crypto from 'crypto';

// GET /api/marketing/facebook/auth
protectedRouter.get("/facebook/auth", async (req: AuthRequest, res: Response) => {
  try {
    // Gerar nonce aleatório — armazena na sessão do usuário
    const nonce = crypto.randomBytes(16).toString('hex');

    // Salvar nonce no banco com TTL de 10 minutos
    await pool.query(`
      INSERT INTO oauth_state (user_id, nonce, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
      ON CONFLICT (user_id) DO UPDATE SET nonce=$2, expires_at=NOW() + INTERVAL '10 minutes'
    `, [req.userId, nonce]);

    const state = Buffer.from(JSON.stringify({ user_id: req.userId, nonce })).toString("base64");
    // ... resto igual, usando a nova state
```

No callback, verificar o nonce:
```typescript
publicRouter.get("/facebook/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query as { code: string; state: string };
    if (!state) return res.status(400).send("State missing");

    const { user_id, nonce } = JSON.parse(Buffer.from(state, "base64").toString());
    if (!user_id || !nonce) return res.status(400).send("State inválido");

    // Verificar nonce no banco
    const { rows } = await pool.query(`
      SELECT user_id FROM oauth_state
      WHERE user_id = $1 AND nonce = $2 AND expires_at > NOW()
    `, [user_id, nonce]);

    if (!rows.length) {
      return res.status(403).send("CSRF detectado ou sessão expirada. Tente conectar novamente.");
    }

    // Limpar nonce usado
    await pool.query('DELETE FROM oauth_state WHERE user_id = $1', [user_id]);

    // ... resto do callback igual
```

Adicionar à migration (`migrations.ts`):
```typescript
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_state (
      user_id    UUID PRIMARY KEY,
      nonce      TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
```

#### Fix 2 — Token no header Authorization (não na URL)

```typescript
// ANTES (INSEGURO — token na URL):
const url = `https://graph.facebook.com/v19.0/${conta.ad_account_id}/campaigns?fields=...&access_token=${conta.access_token}`;
const r = await fetch(url);

// DEPOIS (SEGURO — token no header):
const url = `https://graph.facebook.com/v19.0/${conta.ad_account_id}/campaigns?fields=...`;
const r = await fetch(url, {
  headers: { Authorization: `Bearer ${conta.access_token}` }
});
```

Aplicar o mesmo padrão em todos os `fetch` para a Graph API:
- `GET /campanhas`
- `POST /campanhas/:id/pausar`
- `POST /campanhas/:id/reativar`
- `GET /me?fields=...` no callback

#### Fix 3 — Webhook verify token via env

```typescript
// ANTES:
if (mode === "subscribe" && token === "mentoark-lead-webhook") {

// DEPOIS:
const WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'mentoark-lead-webhook';
if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
```

Adicionar ao `.env` do VPS:
```
META_WEBHOOK_VERIFY_TOKEN=<gerar: openssl rand -hex 16>
```

#### Fix 4 — postMessage com origem restrita

```typescript
// ANTES:
res.send(`<script>window.opener?.postMessage('meta_connected','*'); window.close();</script>`);

// DEPOIS:
const CRM_ORIGIN = process.env.CRM_ORIGIN || 'https://crm.mentoark.com.br';
res.send(`<script>
  window.opener?.postMessage('meta_connected', ${JSON.stringify(CRM_ORIGIN)});
  window.close();
</script>`);
```

Adicionar ao `.env`:
```
CRM_ORIGIN=https://crm.mentoark.com.br
```

---

## Relatório solicitado ao final

Após aplicar, informe:
1. State OAuth agora contém nonce? Tabela `oauth_state` criada?
2. Token removido das URLs — está no header Authorization?
3. Verify token do webhook está em variável de ambiente?
4. `postMessage` usa origem restrita?
5. Quantas chamadas à Graph API foram atualizadas?
