## Objetivo
Alinhar a distribuição de cores do CRM (light mode) ao padrão "Smart Point Of Sale" — fundos claros e limpos, cards em branco puro, melhor separação visual entre superfícies, mantendo a identidade azul→roxo da marca.

## O que muda
Apenas tokens visuais em `src/index.css`. Nenhum componente, lógica ou backend é alterado. Dark mode preservado (já está alinhado ao PDV).

### Light mode — novos valores
Espelha a paleta neutra do PDV (cinza-azulado quase branco), mas mantém o primary azul atual do CRM como cor da marca:

```
--background:        210 17% 98%   (#F8F9FA — antes era 230 40% 97%)
--foreground:        240 25% 14%
--card:              0   0% 100%   (branco puro)
--popover:           0   0% 100%
--secondary:         210 16% 95%
--muted:             210 16% 96%
--muted-foreground:  210 10% 38%
--border:            210 14% 91%   (#E9ECEF — linha sutil cinza)
--input:             210 14% 83%
--sidebar-background: 210 14% 96%  (#F1F3F5 — cinza claríssimo, contrastando com cards brancos)
--sidebar-accent:     210 16% 92%
--sidebar-border:     210 14% 88%
```

Resultado:
- Fundo da página = cinza-azulado bem claro
- Sidebar = cinza um tom mais escuro (cria hierarquia)
- Cards = branco puro com leve borda cinza (destaque limpo)
- Mesma sensação "PDV": muito branco, sombras leves, sem azul puxando o fundo

### Light mode — aurora ambiente
O `body::before` atual injeta blobs azul/roxo no fundo claro, "sujando" o branco. Vou:
- Reduzir a opacidade dos blobs no light (de 0.10 → 0.04) para o fundo ficar realmente branco/cinza
- Manter dark mode intacto (blobs continuam ricos)

### Mantido sem alteração
- `--primary` 226 95% 55% (azul vibrante da marca CRM)
- `--accent` 265 90% 60% (roxo neon)
- Todos os utilitários: `.gradient-brand`, `.glass`, `.glow-*`, `.btn-gradient`, animações
- Dark mode completo
- `tailwind.config.ts` (já consome via tokens HSL)

## Arquivo afetado
- `src/index.css` — apenas bloco `:root` (light tokens) e `body::before` light

## Como validar
Após aplicar, navegar por Dashboard, Leads, WhatsApp e Configurações IA no modo claro: cards devem ficar branco puro sobre um fundo cinza-claro neutro, sidebar levemente mais escura que o conteúdo — mesma sensação de "respiro branco" do Smart POS.
