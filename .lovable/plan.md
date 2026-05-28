## Problema

A página `/kanban` está fora do padrão visual do CRM:

1. **Não usa `CRMLayout`** — por isso a sidebar e o header somem, e o fundo branco vaza sobre os orbs ambientes (causando o efeito "fantasma" na imagem).
2. **Cores cruas** (`bg-white`, `bg-slate-*`, `text-slate-*`, `border-slate-200`) em vez dos tokens semânticos (`bg-card`, `bg-muted`, `text-foreground`, `border-border`) — então no tema dark fica ilegível e no light fica destoante.
3. O título "Kanban da Equipe" perde contraste contra os orbs porque o header da página tem `bg-white` sólido mas o texto usa cor padrão sem foreground.

## Plano

### 1. `src/pages/Kanban.tsx`
- Envolver toda a página em `<CRMLayout>` (igual a Equipe, Leads etc.).
- Remover `h-[calc(100vh-64px)]` — o `<main>` do CRMLayout já controla scroll.
- Trocar `bg-white` / `bg-slate-50` / `text-slate-*` / `border-slate-200` por tokens: `bg-card`, `bg-muted/30`, `text-foreground`, `text-muted-foreground`, `border-border`.
- Header da página: `bg-card/60 backdrop-blur` com borda inferior `border-border`.
- Barra de filtros: `bg-muted/30 border-border`, separadores `bg-border`.
- Área do board: `bg-muted/20` (fundo translúcido que deixa os orbs aparecerem suavemente).
- FAB: `bg-primary text-primary-foreground shadow-xl ring-background`.

### 2. `src/components/kanban/KanbanColuna.tsx`
- Container: `bg-card/60 backdrop-blur-sm border-border` (em vez de `bg-slate-100/50`).
- Header da coluna: `bg-card/80 border-border`, título `text-foreground`.
- Contador WIP: `bg-destructive/15 text-destructive` quando estourado, senão `bg-muted text-muted-foreground`.
- Empty state: `border-border text-muted-foreground`.
- Rodapé: `border-border bg-muted/20`.

### 3. `src/components/kanban/KanbanCard.tsx`
- Card: `bg-card border-border hover:border-primary/40` em vez de `bg-white border-slate-200`.
- Título: `text-foreground`.
- Resumo IA: `text-muted-foreground`.
- Tags: `bg-muted text-muted-foreground border-border`.
- Data vencida: `text-destructive`; data normal: `text-muted-foreground`.
- Borda inferior do rodapé: `border-border/50`.
- Avatar: `border-background` (para contrastar com o card no dark).
- Badge IA: trocar `bg-purple-100 text-purple-700` por `bg-accent/15 text-accent` para casar com a paleta MentoArk (laranja).

### 4. Não mexer
- Lógica de filtros, drag-stub, modal, hooks, rotas — nada de comportamento muda.
- KanbanColuna mantém `style={{ backgroundColor: coluna.cor }}` para a bolinha da coluna (cor vem do banco).
- KanbanCard mantém as cores semânticas de prioridade (vermelho/laranja/azul/cinza) na barra lateral — é sinalização, não branding.

## Resultado esperado
Página renderiza dentro do shell padrão (sidebar + header), funciona no tema claro e no escuro, e respeita a identidade visual definida em `index.css` / `tailwind.config.ts`.