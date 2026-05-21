# Sprint 2 — Auditoria: Webhook sem assinatura + Uploads públicos + Tamanho de payload
**Arquivos:** `backend/src/index.ts`, `backend/src/routes/webhook.ts`
**Severidade:** 🔴 CRÍTICO

---

## Problemas encontrados

### 1. Webhook Evolution sem verificação de assinatura — qualquer IP pode postar
`POST /webhook/evolution` aceita qualquer requisição sem verificar se veio
realmente da Evolution API. Um atacante pode enviar mensagens falsas para
o sistema injetando dados no banco e disparando o agente n8n.

A Evolution API envia o header `x-evolution-hmac` com HMAC-SHA256 da requisição.

### 2. `/uploads/*` servido publicamente sem autenticação
Qualquer pessoa com a URL de um arquivo pode acessar imagens, PDFs e áudios
dos usuários sem estar logada. Isso vaza materiais privados de catálogo,
galeria e criativos.

### 3. `express.json({ limit: '10mb' })` em todas as rotas — vetor de DoS
Requisições de 10MB podem ser enviadas para qualquer endpoint, incluindo
endpoints simples de texto. Isso consome memória desnecessariamente.

### 4. Tabela `webhook_mensagens_processadas` não criada nas migrations
O `webhook.ts` faz query nesta tabela mas ela não é criada em `migrations.ts`.
Se o banco for recriado, o webhook para de funcionar com erro 500 silencioso.

### 5. Deduplicação em memória (`processados` Set) se perde no restart
Se o servidor reiniciar no meio de um processamento, a mesma mensagem pode
ser processada duas vezes — duplicando leads, disparos ou respostas do agente.

---

## Fixes

### `backend/src/routes/webhook.ts` — verificação de assinatura HMAC

Adicionar no topo:
```typescript
import crypto from 'crypto';

function verificarAssinaturaEvolution(req: Request, secret: string): boolean {
  const assinaturaRecebida = req.headers['x-evolution-hmac'] as string;
  if (!assinaturaRecebida) return false;

  const body = JSON.stringify(req.body);
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(assinaturaRecebida, 'hex'),
    Buffer.from(hmac, 'hex')
  );
}
```

No handler do webhook, adicionar a verificação logo no início:
```typescript
router.post('/evolution', async (req: Request, res: Response) => {
  // Verificar assinatura se EVOLUTION_WEBHOOK_SECRET estiver configurado
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (webhookSecret) {
    if (!verificarAssinaturaEvolution(req, webhookSecret)) {
      console.warn('[WEBHOOK] Assinatura inválida — requisição rejeitada');
      return res.status(401).json({ error: 'Assinatura inválida' });
    }
  }

  res.status(200).json({ ok: true }); // Responder imediatamente
  // ... resto do handler
```

Adicionar ao `.env` do VPS:
```
EVOLUTION_WEBHOOK_SECRET=<gerar com: openssl rand -hex 32>
```

### `backend/src/migrations.ts` — criar tabela de deduplicação

Adicionar antes do `console.log('[MIGRATIONS] OK')`:
```typescript
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
      message_id TEXT PRIMARY KEY,
      instancia  TEXT,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_webhook_dedup_criado
    ON webhook_mensagens_processadas (criado_em)
  `);

  -- Limpar registros antigos automaticamente (via trigger ou cron)
  -- por ora, a deduplicação já remove do Set em 60s
```

### `backend/src/index.ts` — proteger uploads + limitar payload por rota

#### Reduzir limite padrão e aplicar limite maior só onde necessário:
```typescript
// ── Limite padrão menor: 1mb para texto ──────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Upload routes: limite maior declarado no multer (já configurado) ──────
// Os endpoints de upload usam multer, não o express.json
// Nenhuma mudança necessária neles
```

#### Middleware de auth para /uploads (proteção básica por token):
```typescript
// ── Servir uploads com verificação de token opcional ──────────────────────
// Para proteção total, redirecionar para verificação no backend.
// Solução leve: adicionar verificação por query string para arquivos privados.
// AÇÃO IMEDIATA: pelo menos logar acessos aos uploads para auditoria:
app.use('/uploads', (req, res, next) => {
  // Log de acesso a arquivos (IP + arquivo)
  const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
  console.log(`[UPLOAD_ACCESS] ${new Date().toISOString()} ${ip} ${req.path}`);
  next();
}, express.static(UPLOADS_DIR));
```

> **Nota**: A proteção total de uploads requer uma mudança arquitetural
> (servir via endpoint autenticado em vez de static). Isso é uma melhoria
> futura — o log de auditoria é o passo imediato.

---

## Nova variável de ambiente necessária
```
EVOLUTION_WEBHOOK_SECRET=<gerar com openssl rand -hex 32>
```
Configurar também na Evolution API: Configurações → Webhooks → HMAC Secret.

---

## Relatório solicitado ao final

Após aplicar, informe:
1. Verificação HMAC adicionada ao webhook?
2. Tabela `webhook_mensagens_processadas` criada na migration?
3. Payload JSON reduzido para 1mb no padrão?
4. Log de acesso a uploads ativo?
5. Quantas linhas foram alteradas em cada arquivo?
