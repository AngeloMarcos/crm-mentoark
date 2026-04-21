

## Redesign visual: tema azul-roxo degradê

Aplicação de um redesign visual completo do MentoArk com paleta azul → roxo, glows, orbs de luz ambiente e degradês em sidebar, header, botões e cards. Nenhuma lógica de negócio será tocada.

### Aviso importante

A mensagem original veio com vários blocos JSX **vazios** (todo o conteúdo entre `<` e `>` foi perdido na renderização) nos arquivos `AppSidebar.tsx`, `AppHeader.tsx` e `CRMLayout.tsx`. Não posso copiar-colar literalmente porque o resultado seria componentes em branco que quebram o app.

Vou **reconstruir o JSX desses 3 arquivos** preservando 100% da estrutura/comportamento atual e aplicando as classes novas (degradês, glows, orbs, avatar com iniciais do email, linha degradê no header, etc.) descritas pelos comentários do snippet. Os arquivos onde o conteúdo veio íntegro (`index.css` e `button.tsx`) serão substituídos exatamente como pedido.

Se você quiser revisar os JSX reconstruídos antes da aplicação, me avise — caso contrário, sigo com a interpretação abaixo.

### Alterações por arquivo

**1. `src/index.css`** — substituição completa pelo CSS fornecido (paleta azul/roxo, utilitários `.gradient-brand`, `.gradient-brand-text`, `.gradient-brand-subtle`, `.sidebar-gradient`, `.glow-primary`, `.glow-accent`, `.card-gradient-border`, `.shimmer`, `--radius: 0.75rem`).

**2. `src/components/AppSidebar.tsx`** — mantém imports, lista `items`, lógica de `isAdmin`/`signOut`/`menuItems`. Aplica:
- `<Sidebar>` com classe `sidebar-gradient` e borda degradê
- Header da logo com `gradient-brand` no fundo do quadrado da logo + texto `Mento` normal e `Ark` com `gradient-brand-text`
- Itens ativos com fundo `gradient-brand-subtle` + texto `gradient-brand-text` + barra lateral degradê; hover com `bg-sidebar-accent`
- Detecção de ativo via `location.pathname` (igual ao snippet)
- Footer "Sair" mantém comportamento atual

**3. `src/components/AppHeader.tsx`** — adiciona `useAuth` para extrair iniciais do email (`user.email.slice(0,2).toUpperCase()`, fallback `"U"`). Aplica:
- Linha degradê (1px) na base do header via pseudo/elemento com `gradient-brand`
- Botões `Bell` e toggle de tema mantidos com hover suave
- Avatar circular com `gradient-brand` + iniciais em branco e `glow-primary` discreto

**4. `src/components/CRMLayout.tsx`** — mantém `SidebarProvider` + `AppSidebar` + `AppHeader` + `<main>{children}</main>`. Acrescenta:
- Wrapper com fundo `bg-background` e `relative overflow-hidden`
- 3 orbs de luz ambiente (`absolute`, `rounded-full`, `blur-3xl`, `opacity-20/30`) posicionados em cantos diferentes com cores primary e accent — puramente decorativos, `pointer-events-none`
- Conteúdo principal com `relative z-10` para ficar acima dos orbs

**5. `src/components/ui/button.tsx`** — única mudança: variante `default` do `cva` passa de `bg-primary text-primary-foreground hover:bg-primary/90` para `gradient-brand text-white hover:opacity-90 shadow-sm transition-all duration-200`. Demais variantes intactas.

### Arquivos tocados

```text
EDITADO:
  src/index.css                       (substituição completa)
  src/components/AppSidebar.tsx       (reconstruído com degradês)
  src/components/AppHeader.tsx        (reconstruído com avatar de iniciais + linha degradê)
  src/components/CRMLayout.tsx        (reconstruído com orbs ambiente)
  src/components/ui/button.tsx        (variante default → gradient-brand)
```

Nenhum outro arquivo será modificado. Lógica de auth, rotas, store, páginas e edge functions permanecem idênticas.

