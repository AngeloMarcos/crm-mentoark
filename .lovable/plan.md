## Diagnóstico
A tela está "muito branca" porque:
1. `--background` está em 98% de luminosidade (quase branco) e `--card` em 100% (branco puro). Os dois praticamente se fundem — não há respiro visual entre fundo e cards.
2. A faixa decorativa de partículas no topo do header (vista no screenshot) está com aspecto pesado/quebrado sobre o fundo claro.
3. O cabeçalho da página não tem nenhuma faixa/banner como o "Nova Venda" do Smart POS, então o topo fica visualmente vazio.

Comparando com o Smart POS light: lá o fundo é cinza-claro real (#F8F9FA com leve azul), os cards ficam brancos puros e há um **hero card lavanda/pêssego** no topo dando peso visual. Quem segura a composição é o hero, não as superfícies.

## O que ajustar (apenas tokens e header, sem mexer em lógica)

### 1. Dessaturar o branco — `src/index.css`
- `--background`: 210 17% 98% → **220 16% 95%** (cinza-azulado mais perceptível, padrão Smart POS de fundo)
- `--card`: 0 0% 100% → **0 0% 100%** (mantém branco puro — agora destaca do fundo)
- `--secondary`: 210 16% 95% → **220 14% 92%**
- `--muted`: 210 16% 96% → **220 14% 93%**
- `--border`: 210 14% 91% → **220 13% 87%** (bordas levemente mais visíveis)
- `--sidebar-background`: 210 14% 96% → **220 15% 93%** (sidebar acompanha)
- `--sidebar-accent`: → **220 14% 88%**

Resultado: o fundo passa a ser claramente cinza, cards continuam brancos puros, sidebar fica um tom abaixo do fundo — exatamente a hierarquia do Smart POS.

### 2. Aurora ambiente mais visível mas suave
Subir levemente a opacidade dos blobs no light para 0.07/0.06/0.04 (estavam 0.05/0.04/0.03). Em cima do fundo agora mais escuro, isso vira uma sutil aura roxo-pêssego que dá vida sem poluir.

### 3. Particles do header
A faixa de partículas em `AppHeader` está incomodando no light mode. Vou ocultá-la apenas no light (`dark:block hidden` ou desligar opacity no light) — no dark continua intacta.

### 4. Hero card no Dashboard (opcional, recomendado)
Adicionar acima dos 4 KPIs um card hero compacto estilo Smart POS: gradiente lavanda→pêssego (`gradient-brand-subtle` ou similar), ícone à esquerda, título "Resumo do dia" + subtítulo, e botão "Ver Funil" à direita. Isso ancora visualmente o topo e remove a sensação de "vazio claro".

## Arquivos afetados
- `src/index.css` — tokens light + opacidade aurora (~10 linhas)
- `src/components/AppHeader.tsx` — esconder particles no light (1 linha)
- `src/pages/Dashboard.tsx` — adicionar hero card acima dos KPIs (~15 linhas)

Nada de backend, nada de lógica, dark mode preservado.

## Pergunta opcional
Posso adicionar o hero card no Dashboard, ou prefere só ajustar a paleta e manter o layout atual?
