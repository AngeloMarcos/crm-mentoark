# Prompt 3 — Menu fixo + Vitrine de Serviços da Mentoark

> Continuação dos prompts 1 e 2, no MESMO projeto Lovable (não crie um projeto novo). Cole na mesma conversa.

---

## Cole no Lovable a partir daqui

Vamos adicionar duas coisas novas ao projeto: um menu fixo de navegação (que antes não existia de propósito) e uma nova seção "Serviços", mostrando que a Mentoark não faz só site — faz criação de BM do Facebook, tráfego pago, disparo em massa via WhatsApp, gestão de IA + secretária virtual e design gráfico. O portfólio de 5 sites que já existe passa a ser uma prova visual de uma dessas frentes (design/desenvolvimento), não o produto inteiro.

**Regra de continuidade:** tudo que já foi definido nos prompts 1 e 2 pras 5 sections de nicho continua valendo — paleta própria de cada uma, sem gradiente/glow da Mentoark dentro delas, sem blocos clichê. O que muda é a estrutura ao redor: agora existe menu fixo, e existe essa seção nova de Serviços entre o cabeçalho e a section de Advocacia.

### 1. Menu fixo no topo

- Fica fixo (`sticky top-0`) durante todo o scroll. Sobre o header escuro inicial, o fundo do menu é transparente; a partir do momento em que o usuário passa da primeira dobra, o fundo vira `hsl(232, 45%, 5%)` a 80% de opacidade com `backdrop-blur`.
- Logo à esquerda: a palavra "Mentoark" com o gradiente `linear-gradient(135deg, hsl(217 91% 45%), hsl(24 95% 48%))` aplicado só no texto (gradient-text).
- Itens do menu, nesta ordem: **Portfólio** · **BM Facebook** · **Tráfego Pago** · **Disparo em Massa** · **IA + Secretária Virtual** · **Design Gráfico** · **Contato**.
- Indicador de item ativo: nada de só `:hover` estático. Use `IntersectionObserver` pra detectar em qual seção/card o usuário está e deslizar um sublinhado (ou ponto) com transição suave até o item correspondente do menu.
- No mobile, o menu abre em tela cheia (não dropdown pequeno no canto), tipografia grande, fundo com o mesmo efeito aurora sutil do header.
- Este menu é a única parte do site (além do header inicial) onde a estética "produto Mentoark" — glass, glow, gradiente azul-laranja — pode aparecer plena. É o chrome do site, não faz parte de nenhum dos 5 nichos.

### 2. Nova seção "Serviços" (entra logo após o header, antes da section de Advocacia)

Título curto, direto, nada de frase de efeito genérica tipo "Soluções completas para o seu negócio". Subtítulo de uma linha deixando claro que o portfólio de sites abaixo é uma amostra de uma das frentes.

**Layout:** nada de grid 5 colunas idênticas — isso é o clichê mais óbvio de seção de serviços gerada por IA. Use um bento grid assimétrico: 1 card grande em destaque (sugiro **Disparo em Massa**, que é o carro-chefe do produto de CRM da Mentoark) + os outros 4 em tamanhos e proporções variadas ao redor.

Cada card tem um `id` próprio pra o menu conseguir dar scroll direto nele, e ao chegar via clique no menu o card recebe um destaque temporário (borda com glow por ~1,5s) confirmando que chegou no lugar certo:

- `id="servico-bm"` — **Criação de BM do Facebook**: verificação de negócio, configuração de pixel, domínio e catálogo pra rodar anúncio sem cair em bloqueio. Resultado fictício: "40+ contas configuradas sem queda de entrega em 2026".
- `id="servico-trafego"` — **Tráfego Pago**: gestão de campanhas Meta Ads focadas em geração de lead qualificado, não só alcance. Resultado fictício: "CPL caiu de R$ 38 pra R$ 14 numa campanha de clínica odontológica em 6 semanas".
- `id="servico-disparo"` — **Disparo em Massa (WhatsApp)**: campanhas de reativação e nutrição via WhatsApp, feitas com tecnologia própria. Resultado fictício: "12.400 contatos reativados numa campanha de carrinho abandonado, 22% de taxa de resposta".
- `id="servico-ia"` — **Gestão de IA + Secretária Virtual**: atendimento automatizado de primeiro contato, qualificação e agenda, 24/7. Resultado fictício: "tempo médio de primeira resposta caiu de 4h pra 38 segundos".
- `id="servico-design"` — **Design Gráfico**: identidade visual, social media e material de campanha. Resultado fictício: "60 peças de social media entregues por mês mantendo identidade consistente".

Cada card: nome do serviço, uma frase objetiva do que é (sem jargão de agência), o resultado fictício com número, e um CTA pequeno "Falar sobre esse serviço" que abre um link `wa.me` com mensagem pré-preenchida específica daquele serviço (não uma mensagem genérica igual nos 5).

Não use o mesmo ícone da Lucide repetido em todos os cards. Cada card tem um elemento visual diferente: um número grande estilizado, um mini-gráfico simples em SVG/CSS mostrando a curva de resultado, um mockup pequeno de tela de WhatsApp, etc. — varie por card.

### 3. Seção "Contato" (âncora final do menu)

Simples: WhatsApp direto como CTA principal, e-mail e Instagram como secundários. Nada de formulário genérico "Nome / E-mail / Mensagem / Enviar" — isso também é clichê de página gerada por IA.

---

## Checklist antes de fechar

- O menu funciona em todas as âncoras (Portfólio + 5 serviços + Contato) com scroll suave?
- O indicador de item ativo do menu realmente acompanha o scroll, não é só hover?
- O bento grid de serviços está assimétrico, não é 5 cards iguais em grid 5 colunas?
- Cada card de serviço tem um elemento visual diferente dos outros (não é ícone+texto repetido)?
- A mensagem do WhatsApp de cada CTA de serviço é específica daquele serviço?
- As 5 sections de nicho continuam sem o gradiente Mentoark dentro delas (regra dos prompts 1 e 2 mantida)?

---

## Fim do prompt 3
