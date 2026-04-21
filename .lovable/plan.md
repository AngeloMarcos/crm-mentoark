

## Correções de segurança, bugs e UX

Seis correções pontuais cobrindo filtro de tenant, lógica do funil, validação de campanha, padronização de confirmação de delete, error boundary global e utilitário de telefone.

### Status prévio detectado

- **Funil — filtro `user_id` + guard**: já estão aplicados (linhas 80 e 85 de `Funil.tsx`). Nenhuma alteração necessária aqui.
- **Funil — `proximaEtapa`**: bug confirmado na linha 68 (`>= etapas.length - 2`) — vai ser corrigido.

### Alterações por arquivo

**1. `src/pages/WhatsApp.tsx`** — adicionar comentário acima da query do `n8n_chat_histories` (linha ~64) explicando que a tabela não tem coluna `user_id` e o acesso é controlado pela RLS `Authenticated can read chat histories`. Mesma nota acima da segunda query (linha ~123). Nenhuma mudança lógica.

**2. `src/pages/Dashboard.tsx`** — adicionar comentário `// tabela sem user_id — dados globais` acima do `supabase.from("n8n_chat_histories")` (linha ~167).

**3. `src/pages/Funil.tsx`** — corrigir `proximaEtapa` (linhas 66-70):

```ts
function proximaEtapa(status: string): FunilStatus | null {
  if (status === "fechado" || status === "perdido") return null;
  const idx = etapas.indexOf(status as FunilStatus);
  return idx === -1 || idx >= etapas.length - 1 ? null : etapas[idx + 1];
}
```

Isso permite "agendado" → "fechado" (hoje retorna null indevidamente).

**4. `src/pages/Campanhas.tsx`** — duas mudanças:

- Em `salvar()` (linha 160), antes de `setSalvando(true)`, validar:
  ```ts
  if (form.cliques > form.impressoes && form.impressoes > 0) {
    toast.error("Cliques não podem ser maiores que impressões.");
    return;
  }
  ```
- Substituir `confirm()` nativo na função `remover` por `AlertDialog`. Mudanças:
  - Importar `AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle` de `@/components/ui/alert-dialog`.
  - Adicionar state `const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);`.
  - Refatorar `remover` para receber só `id: string` e remover o `confirm()`; o botão da tabela passa a chamar `setConfirmDeleteId(c.id)`.
  - Adicionar `<AlertDialog>` no final do JSX (antes do fechamento do `<CRMLayout>`), com título "Excluir campanha?", descrição mencionando que a ação é irreversível, e action chamando `confirmDeleteId && remover(confirmDeleteId)` seguido de `setConfirmDeleteId(null)`.

**5. `src/components/ErrorBoundary.tsx`** (novo) — class component padrão com `getDerivedStateFromError` + `componentDidCatch`. Fallback UI centralizado com:
- Card com `glass` + `card-gradient-border`
- Ícone `AlertTriangle` em círculo `bg-destructive/15 text-destructive`
- Título "Algo deu errado" e mensagem de erro
- Botão "Recarregar página" que reseta state e chama `window.location.reload()`

(O snippet recebido tinha JSX vazio por renderização — vou reconstruir com classes consistentes ao tema azul-roxo já aplicado.)

**6. `src/components/CRMLayout.tsx`** — importar `ErrorBoundary` e envolver `{children}` no `<main>`:

```tsx
<main className="flex-1 overflow-auto p-6">
  <ErrorBoundary>{children}</ErrorBoundary>
</main>
```

**7. `src/lib/utils.ts`** — adicionar ao final:

```ts
/** Formata telefone para padrão WhatsApp: DDI55 + 10-11 dígitos */
export function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return null;
  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    digits = "55" + digits;
  }
  return digits.length >= 12 ? digits : null;
}
```

Sem remover duplicatas em outros arquivos (consolidação fica para depois).

### Arquivos tocados

```text
NOVO:
  src/components/ErrorBoundary.tsx

EDITADO:
  src/pages/WhatsApp.tsx        (apenas comentários)
  src/pages/Dashboard.tsx       (apenas comentário)
  src/pages/Funil.tsx           (proximaEtapa)
  src/pages/Campanhas.tsx       (validação CTR + AlertDialog delete)
  src/components/CRMLayout.tsx  (envolver children com ErrorBoundary)
  src/lib/utils.ts              (append formatPhone)
```

Nenhuma migration, nenhuma mudança em RLS, nenhuma alteração em outras páginas ou componentes.

