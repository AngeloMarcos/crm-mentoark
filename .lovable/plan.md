## Correção de 3 bugs em produção

### BUG 1 — Tipo `atendimento_ia` (boolean → string)

**src/pages/ContatoDetalhe.tsx**
- Linha 209: `atendimento_ia: boolean | null` → `atendimento_ia: string | null`
- Linha 360: `const iaAtiva = contato.atendimento_ia === true` → `const iaAtiva = contato.atendimento_ia === 'ativo' || contato.atendimento_ia === 'reativada'`

**src/pages/Contatos.tsx**
- Interface `DadoCliente.atendimento_ia` já está tipado como `boolean | string | null` — restringir para `string | null`.
- O helper `getIaStatus` já trata strings corretamente, mas remover os ramos `=== true` / `=== false` por consistência com o novo schema.

### BUG 2 — Tabela errada em `Contatos.tsx`

**src/pages/Contatos.tsx** (linhas ~80-90, dentro de `fetchContatos`):
- Trocar `api.from("contatos").select("*")` por `api.from("dados_cliente").select("id, user_id, nomewpp, telefone, \"Setor\", atendimento_ia, created_at")`.
- Manter `navigate(\`/contatos/${c.id}\`)` (já está assim).
- A query atual não filtra por `user_id` — manter como está (backend filtra via JWT, conforme regra do projeto).

### BUG 3 — `toggleIA` envia boolean para campo TEXT

**src/pages/ContatoDetalhe.tsx** (função `toggleIA`, linhas 310-335):
- Remover o bloco `api.from("dados_cliente").update({ atendimento_ia: active })`.
- Substituir por `fetch` PATCH para `/api/contatos/:id/pausa-ia` com body `{ acao: active ? "reativar" : "pausar", duracaoMinutos: 30 }`.
- Importar `authHeader` de `@/lib/api-token` (ainda não importado).
- Usar a constante `API_BASE` já definida na linha 25.
- Após sucesso, atualizar `setContato({ ...contato, atendimento_ia: data.atendimento_ia })`.

Nenhuma alteração de feature, apenas correção de tipos, tabela e endpoint.
