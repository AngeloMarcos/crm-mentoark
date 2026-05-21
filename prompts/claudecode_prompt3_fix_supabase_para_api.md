# Claude Code — Prompt 3: Fix Frontend — Trocar `supabase` por `api`
**Arquivos:** `src/pages/Tags.tsx`, `src/pages/Funil.tsx`, `src/pages/Disparos.tsx`, `src/components/FollowUpModal.tsx`
**Prioridade:** 🔴 CRÍTICO — Estas páginas usam o cliente Supabase real em vez do cliente da API própria, fazendo todas as operações falharem silenciosamente

---

## Contexto

O projeto usa um cliente HTTP customizado em `src/integrations/database/client.ts` (exportado como `api`) que redireciona todas as chamadas para o backend Express próprio em vez do Supabase. Porém, algumas páginas ainda importam e usam o cliente `supabase` diretamente para tabelas que só existem no banco próprio — causando erros 404 silenciosos.

**Regra geral:** Se a tabela está no backend Express (`tags`, `funil_estagios`, `follow_ups`, etc.), use `api.from(...)`. O `supabase` só deve ser usado se realmente houver uma integração Supabase real (que neste projeto não há).

---

## Fix 1 — `src/pages/Tags.tsx`

### Passo 1: Trocar o import

Localizar no topo do arquivo:
```typescript
import { supabase } from "@/integrations/supabase/client";
```

Substituir por:
```typescript
import { api } from "@/integrations/database/client";
```

### Passo 2: Substituir todas as chamadas `supabase.from(...)` por `api.from(...)`

O arquivo Tags.tsx tem 5 ocorrências de `supabase.from(...)`. Substitua **todas**:

```typescript
// ANTES:
const { data, error } = await supabase.from("tags" as any).select("*")...
// DEPOIS:
const { data, error } = await api.from("tags").select("*")...

// ANTES:
const { error } = await supabase.from("tags" as any).insert([{ ...newTag, user_id: user?.id }]);
// DEPOIS:
const { error } = await api.from("tags").insert([{ ...newTag, user_id: user?.id }]);

// ANTES:
const { data, error } = await supabase.from("funil_estagios" as any).select("*")...
// DEPOIS:
const { data, error } = await api.from("funil_estagios").select("*")...

// ANTES:
const { error } = await supabase.from("funil_estagios" as any).insert([{...}]);
// DEPOIS:
const { error } = await api.from("funil_estagios").insert([{...}]);

// ANTES:
const { error } = await supabase.from("funil_estagios" as any).delete().eq("id", id);
// DEPOIS:
const { error } = await api.from("funil_estagios").delete().eq("id", id);

// ANTES:
const { error } = await supabase.from("funil_estagios" as any).upsert(updates);
// DEPOIS:
const { error } = await api.from("funil_estagios").upsert(updates);
```

Remover também o cast `as any` onde aparece — não é necessário com o cliente `api`.

---

## Fix 2 — `src/pages/Funil.tsx`

### Passo 1: Remover o import do supabase

Localizar:
```typescript
import { supabase } from "@/integrations/supabase/client";
```

Remover essa linha (o arquivo já importa `api`).

### Passo 2: Substituir o uso de supabase

Localizar (por volta da linha 153):
```typescript
const { data: stageData, error: stageError } = await supabase
  .from("funil_estagios" as any)
  .select("*")
  .order("ordem", { ascending: true });
```

Substituir por:
```typescript
const { data: stageData, error: stageError } = await api
  .from("funil_estagios")
  .select("*")
  .order("ordem", { ascending: true });
```

---

## Fix 3 — `src/pages/Disparos.tsx`

### Passo 1: Verificar se o import do supabase pode ser removido

Localizar no topo:
```typescript
import { supabase } from "@/integrations/supabase/client";
```

Procurar todas as ocorrências de `supabase` no arquivo. Há pelo menos 4:
- linha ~98: `supabase.from("tags")`
- linha ~99: `supabase.from("funil_estagios")`
- linha ~299: `supabase.from("agentes")`
- linha ~452: `supabase.from("disparos")`

### Passo 2: Substituir todas

```typescript
// ANTES (linha ~98-99):
const { data: tagsData } = await supabase.from("tags").select("*");
const { data: estagiosData } = await supabase.from("funil_estagios").select("*");

// DEPOIS:
const { data: tagsData } = await api.from("tags").select("*");
const { data: estagiosData } = await api.from("funil_estagios").select("*");

// ANTES (linha ~299):
const { data } = await supabase.from("agentes").select("*").not("evolution_instancia", "is", null);

// DEPOIS:
const { data } = await api.from("agentes").select("*");
// (O filtro .not("evolution_instancia", "is", null) não é suportado no cliente api;
//  filtrar no frontend: data?.filter(a => a.evolution_instancia != null) )

// ANTES (linha ~452):
const { data, error } = await supabase.from("disparos").insert(payload as any).select().single();

// DEPOIS:
const { data, error } = await api.from("disparos").insert(payload);
```

### Passo 3: Se supabase não tiver mais nenhuma chamada, remova o import

Se após as substituições não houver mais `supabase.` no arquivo, remova a linha de import.

---

## Fix 4 — `src/components/FollowUpModal.tsx`

### Passo 1: Trocar o import

Localizar:
```typescript
import { supabase } from "@/integrations/supabase/client";
```

Substituir por:
```typescript
import { api } from "@/integrations/database/client";
```

### Passo 2: Substituir a chamada

Localizar (por volta da linha 49):
```typescript
const { error } = await supabase.from("follow_ups").insert([
  {
    user_id: user?.id,
    contato_id: contatoId,
    data_retorno: new Date(dataRetorno).toISOString(),
    motivo,
    observacao,
    status: "pendente",
  },
]);
```

Substituir por:
```typescript
const { error } = await api.from("follow_ups").insert([
  {
    user_id: user?.id,
    contato_id: contatoId,
    data_retorno: new Date(dataRetorno).toISOString(),
    motivo,
    observacao,
    status: "pendente",
  },
]);
```

---

## Verificação após aplicar

1. Abra o console do browser (F12) e acesse cada página
2. Não deve haver erros de rede para `/api/tags`, `/api/funil_estagios`, `/api/follow_ups`
3. Teste criando uma tag em `/tags-funil` — deve salvar e reaparecer na lista
4. Teste criando uma resposta rápida em `/respostas-rapidas` — deve funcionar
5. Acesse `/funil` — as colunas do kanban devem aparecer (busca os estágios do banco)

---

## Relatório solicitado ao final

Informe:
1. Quantos arquivos foram modificados?
2. O import do `supabase` foi removido de quais arquivos?
3. A página `/tags-funil` consegue criar tags e estágios?
4. A página `/funil` carrega as colunas do kanban?
5. A página `/respostas-rapidas` consegue criar e listar respostas?
6. O modal de follow-up salva corretamente?
7. Houve algum erro de TypeScript após as substituições?
