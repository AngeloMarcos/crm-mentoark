# Claude Code — Prompt 2: Registrar Novas Tabelas nas Rotas
**Arquivo:** `backend/src/index.ts`
**Prioridade:** 🟠 ALTO — Sem isso, as APIs de tags/funil_estagios/follow_ups retornam 404

---

## Contexto

O arquivo `backend/src/index.ts` registra as tabelas no array `SIMPLE_TABLES`. As tabelas listadas lá ganham automaticamente os endpoints CRUD:
- `GET /api/{tabela}` → listar
- `POST /api/{tabela}` → criar
- `PUT /api/{tabela}/:id` → atualizar
- `DELETE /api/{tabela}/:id` → deletar

As tabelas `tags`, `funil_estagios` e `follow_ups` foram adicionadas ao banco (Prompt 1) mas ainda **não estão registradas** no Express — as chamadas da API retornam 404.

---

## Tarefa

No arquivo `backend/src/index.ts`, localize o array `SIMPLE_TABLES`:

```typescript
const SIMPLE_TABLES = [
  'listas',
  'chamadas',
  'timeline_eventos',
  'tarefas',
  'campanhas',
  'disparo_logs',
  'agentes',
  'conhecimento',
  'integracoes_config',
  'catalogos',
  'produtos',
  'produto_imagens',
  'dados_cliente',
  'chat_messages',
  'chats',
  'respostas_rapidas',
];
```

**Adicione as 3 novas tabelas ao final da lista:**

```typescript
const SIMPLE_TABLES = [
  'listas',
  'chamadas',
  'timeline_eventos',
  'tarefas',
  'campanhas',
  'disparo_logs',
  'agentes',
  'conhecimento',
  'integracoes_config',
  'catalogos',
  'produtos',
  'produto_imagens',
  'dados_cliente',
  'chat_messages',
  'chats',
  'respostas_rapidas',
  // Novas tabelas adicionadas no sprint de funcionalidades
  'tags',
  'funil_estagios',
  'follow_ups',
];
```

---

## Por que estas tabelas não estavam lá?

- `tags` e `funil_estagios` — o código antigo do frontend usava Supabase direto (bug),
  então nunca foram registradas no backend próprio. Agora o frontend foi corrigido para usar
  o cliente `api` correto (Prompt 3), então o backend precisa expô-las.
- `follow_ups` — tabela nova adicionada junto com a funcionalidade de follow-up.

---

## Verificação após aplicar

Após reiniciar o servidor, teste:

```bash
# Deve retornar [] (ou lista vazia se não houver dados)
curl -H "Authorization: Bearer <token>" https://crm.mentoark.com.br/api/tags
curl -H "Authorization: Bearer <token>" https://crm.mentoark.com.br/api/funil_estagios
curl -H "Authorization: Bearer <token>" https://crm.mentoark.com.br/api/follow_ups
```

Todos devem retornar status 200, não 404.

---

## Relatório solicitado ao final

Informe:
1. As 3 tabelas foram adicionadas ao `SIMPLE_TABLES`?
2. O servidor reiniciou sem erros?
3. Os endpoints `/api/tags`, `/api/funil_estagios` e `/api/follow_ups` respondem 200?
