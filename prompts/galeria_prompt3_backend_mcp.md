# Prompt 3 — Galeria: Backend — Tool MCP `buscar_midia` + Busca com Descrição

## Objetivo
1. Garantir que a coluna `descricao` existe em `galeria_midias`
2. Melhorar o `GET /api/galeria` para buscar também em `descricao` e `tags`
3. Adicionar a tool `buscar_midia` ao MCP (`backend/src/routes/mcp.ts`)

**Estes são arquivos do servidor VPS — não do Lovable.**

---

## Passo 1 — SQL: adicionar coluna `descricao` se ainda não existe

Rodar direto no PostgreSQL (pode ser via `psql` no VPS ou pelo admin do banco):

```sql
ALTER TABLE galeria_midias
  ADD COLUMN IF NOT EXISTS descricao TEXT;
```

---

## Passo 2 — `backend/src/routes/galeria.ts`

### Melhorar a busca no `GET /api/galeria`

Localizar o bloco de construção do WHERE:

```typescript
if (q) {
  where += ` AND (titulo ILIKE $${idx} OR filename ILIKE $${idx})`;
  params.push(`%${q}%`); idx++;
}
```

Substituir por (busca também em `descricao` e em qualquer elemento do array `tags`):

```typescript
if (q) {
  where += ` AND (
    titulo    ILIKE $${idx} OR
    filename  ILIKE $${idx} OR
    descricao ILIKE $${idx} OR
    EXISTS (
      SELECT 1 FROM unnest(tags) t(tag)
      WHERE t.tag ILIKE $${idx}
    )
  )`;
  params.push(`%${q}%`); idx++;
}
```

> Isso faz com que o simulador da aba "Agente IA" retorne resultados mesmo quando
> o termo de busca aparece só na descrição ou numa tag.

---

## Passo 3 — `backend/src/routes/mcp.ts`

### Adicionar a tool `buscar_midia`

Localizar o comentário `// ── resumo_dashboard` e inserir o bloco abaixo **antes** dele
(ou seja, entre `buscar_conhecimento` e `resumo_dashboard`):

```typescript
  // ── buscar_midia ───────────────────────────────────────────
  server.tool(
    'buscar_midia',
    'Busca na galeria de mídias do usuário (imagens, PDFs, áudios) pelo contexto da conversa. ' +
    'Use quando o cliente pedir catálogo, preços, fotos, áudios, documentos ou qualquer material cadastrado na galeria.',
    {
      user_id: z.string().describe('UUID do usuário dono da galeria'),
      query: z.string().describe(
        'Termo de busca — ex: "catálogo de preços", "foto do imóvel", "áudio de boas-vindas". ' +
        'Será comparado contra título, descrição e tags da mídia.'
      ),
      tipo: z.enum(['imagem', 'pdf', 'audio']).optional().describe(
        'Filtrar por tipo de arquivo. Omitir para buscar em todos os tipos.'
      ),
      tag: z.string().optional().describe(
        'Filtrar por tag exata cadastrada na mídia (ex: "catalogo", "preco").'
      ),
      limit: z.number().int().min(1).max(5).optional().default(1),
    },
    async ({ user_id, query, tipo, tag, limit }) => {
      const params: any[] = [user_id, `%${query}%`];
      let idx = 3;

      // Busca em titulo, descricao e qualquer elemento do array tags
      let where = `
        WHERE user_id = $1
          AND (
            titulo    ILIKE $2 OR
            descricao ILIKE $2 OR
            EXISTS (
              SELECT 1 FROM unnest(tags) t(tag)
              WHERE t.tag ILIKE $2
            )
          )`;

      // Filtro opcional por tipo (imagem/pdf/audio)
      // A coluna media_type armazena 'image' | 'pdf' | 'audio'
      // O parâmetro da tool usa 'imagem' para ficar em português — convertemos aqui
      if (tipo) {
        const dbTipo = tipo === 'imagem' ? 'image' : tipo;
        where += ` AND media_type = $${idx}`;
        params.push(dbTipo); idx++;
      }

      // Filtro opcional por tag exata
      if (tag) {
        where += ` AND $${idx} = ANY(tags)`;
        params.push(tag); idx++;
      }

      const r = await pool.query(
        `SELECT id, url, titulo, filename, tipo, media_type, tags, descricao
         FROM galeria_midias
         ${where}
         ORDER BY
           -- Prioriza mídias que têm descrição (mais contextualizadas para o agente)
           CASE WHEN descricao IS NOT NULL THEN 0 ELSE 1 END,
           created_at DESC
         LIMIT $${idx}`,
        [...params, limit ?? 1],
      );

      if (r.rows.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              encontrado: false,
              mensagem: 'Nenhuma mídia encontrada para este termo. Verifique se há mídias cadastradas com descrição ou tags relacionadas.',
            }),
          }],
        };
      }

      const midias = r.rows.map(m => ({
        id:        m.id,
        url:       m.url,
        titulo:    m.titulo || m.filename,
        tipo:      m.media_type,   // 'image' | 'pdf' | 'audio'
        tags:      m.tags ?? [],
        descricao: m.descricao ?? null,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(
            limit === 1 ? { encontrado: true, midia: midias[0] }
                        : { encontrado: true, midias },
            null, 2
          ),
        }],
      };
    },
  );
```

---

## Como o n8n usa esta tool

No MCP Client do n8n, a Cris chama `buscar_midia` assim:

```json
{
  "user_id": "{{ $vars.USER_ID }}",
  "query": "catálogo de imóveis",
  "tipo": "pdf"
}
```

**Retorno (encontrado):**
```json
{
  "encontrado": true,
  "midia": {
    "id": "uuid",
    "url": "https://api.mentoark.com.br/uploads/g_abc123.pdf",
    "titulo": "Catálogo 2025",
    "tipo": "pdf",
    "tags": ["catalogo", "imoveis"],
    "descricao": "Catálogo completo de imóveis disponíveis com preços e plantas"
  }
}
```

**Retorno (não encontrado):**
```json
{
  "encontrado": false,
  "mensagem": "Nenhuma mídia encontrada para este termo."
}
```

---

## Sugestão de instrução no prompt da Cris

```
Quando o cliente pedir catálogo, tabela de preços, fotos, áudios de apresentação
ou qualquer material visual/documento, use a ferramenta buscar_midia com uma query
relacionada ao pedido do cliente.

Se encontrado (encontrado: true): envie o arquivo pela URL retornada.
Se não encontrado (encontrado: false): informe que não há material disponível
para este assunto no momento.
```

---

## Resumo das alterações

| Arquivo | O que muda |
|---------|-----------|
| PostgreSQL | `ADD COLUMN IF NOT EXISTS descricao TEXT` em `galeria_midias` |
| `galeria.ts` | Busca do `?q=` passa a incluir `descricao` e `tags` (unnest) |
| `mcp.ts` | Nova tool `buscar_midia` inserida antes de `resumo_dashboard` |

## Não alterar
Nenhum outro arquivo do backend.
