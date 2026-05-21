# Sprint 6 — Auditoria: Catálogo — DELETE sem user_id + Limite de contatos + Intervalo
**Arquivo:** `backend/src/routes/catalogo.ts`
**Severidade:** 🔴 CRÍTICO (item 1) / 🟠 ALTO (itens 2, 3)

---

## Problemas encontrados

### 1. DELETE de imagem de produto SEM verificar user_id — BRECHÃO CRÍTICO
```typescript
// LINHA 480 — INSEGURO:
await pool.query('DELETE FROM produto_imagens WHERE id = $1', [req.params.id]);
```
Qualquer usuário autenticado pode deletar a imagem de **outro** usuário
se souber o UUID da imagem. O `SELECT` antes verifica o user_id, mas o
`DELETE` final NÃO inclui a cláusula `AND user_id = $2`.

### 2. Sem limite máximo no array `contatos` — envio em massa descontrolado
```typescript
const { produto_id, contatos, mensagem_extra = '', intervalo_ms = 3500 } = req.body;
```
Não há validação de `contatos.length`. Um request com 10.000 contatos
travaria o servidor por horas (loop síncrono com `await` e delays).

### 3. `intervalo_ms` sem limite mínimo verificado consistentemente
```typescript
await new Promise(r => setTimeout(r, Math.max(2000, Number(intervalo_ms))));
```
O `Math.max(2000, ...)` está correto em alguns lugares mas não em todos.
Em `whatsapp/catalogo`, o delay entre **contatos** usa `setTimeout(r, 5000)`
mas o delay entre **produtos** usa `Math.max(3000, Number(intervalo_ms))`.
Se `intervalo_ms = 0`, o delay entre produtos seria apenas 3000ms, ok.
Mas o código não valida que `intervalo_ms` é um número (poderia ser string `NaN`).

### 4. Sem limite no `max_produtos` da rota de catálogo
```typescript
const { catalogo_id, contatos, intro, intervalo_ms = 4000, max_produtos = 10 } = req.body;
```
`max_produtos` pode ser passado como `999999` — sem cap máximo.
Isso forçaria o servidor a enviar centenas de produtos para cada contato.

### 5. `status = 'conectado'` inconsistente com outros endpoints
Outros endpoints de disparo usam `status IN ('ativo','conectado')` mas
o catálogo usa apenas `status = 'conectado'`. Se a instância estiver
com status `ativo`, o catálogo não funciona mas o disparo funciona.

---

## Fixes

### `backend/src/routes/catalogo.ts`

#### Fix 1 — Corrigir DELETE de imagem (URGENTE)

```typescript
// ANTES (INSEGURO):
await pool.query('DELETE FROM produto_imagens WHERE id = $1', [req.params.id]);

// DEPOIS (SEGURO — verifica user_id):
await pool.query(
  'DELETE FROM produto_imagens WHERE id = $1 AND user_id = $2',
  [req.params.id, req.userId]
);
```

#### Fix 2 — Limitar tamanho do array contatos

No início de ambas as rotas de envio WhatsApp:
```typescript
// POST /whatsapp/produto
const { produto_id, contatos, mensagem_extra = '', intervalo_ms = 3500 } = req.body;

if (!produto_id || !Array.isArray(contatos) || contatos.length === 0) {
  return res.status(400).json({ message: 'produto_id e contatos[] são obrigatórios.' });
}
// NOVO: cap de segurança
if (contatos.length > 100) {
  return res.status(400).json({ message: 'Máximo de 100 contatos por envio. Use disparos para volumes maiores.' });
}
```

Mesma validação em `POST /whatsapp/catalogo`:
```typescript
if (contatos.length > 50) {
  return res.status(400).json({ message: 'Máximo de 50 contatos por envio de catálogo.' });
}
```

#### Fix 3 — Validar e limitar intervalo_ms e max_produtos

```typescript
// Normalizar e validar intervalo_ms
const intervalMs = Math.max(2000, Math.min(30000, Number(intervalo_ms) || 3500));

// Normalizar e limitar max_produtos
const maxProdutos = Math.max(1, Math.min(20, Number(max_produtos) || 10));
```

#### Fix 4 — Corrigir status inconsistente

Substituir em **todos** os `pool.query` que buscam integração Evolution no catálogo:
```typescript
// ANTES:
WHERE user_id = $1 AND tipo = 'evolution' AND status = 'conectado' LIMIT 1

// DEPOIS (consistente com resto do sistema):
WHERE user_id = $1 AND tipo = 'evolution' AND status IN ('ativo','conectado') LIMIT 1
```
Isso afeta 2 lugares: `POST /whatsapp/produto` e `POST /whatsapp/catalogo`.

---

## Relatório solicitado ao final

Após aplicar, informe:
1. DELETE de imagem agora inclui `AND user_id`?
2. Limite de 100 contatos adicionado em `/whatsapp/produto`?
3. Limite de 50 contatos adicionado em `/whatsapp/catalogo`?
4. `max_produtos` limitado a 20?
5. Status `IN ('ativo','conectado')` corrigido em ambas as rotas?
6. Algum outro endpoint sem verificação de user_id foi identificado?
