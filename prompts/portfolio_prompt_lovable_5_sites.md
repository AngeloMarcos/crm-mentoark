# Prompt Lovable — Portfólio Mentoark: 5 Sites em 1 Projeto

> Copie tudo abaixo (a partir de "Cole no Lovable a partir daqui") e cole direto no chat do Lovable, num projeto novo.

---

## Cole no Lovable a partir daqui

Quero um site de portfólio em página única (long scroll), sem menu de navegação fixo, que funciona como uma vitrine de 5 sites diferentes — um site completo de verdade por nicho, empilhados um abaixo do outro. A pessoa rola a página e vive a sensação de visitar 5 sites reais e distintos, não 5 variações do mesmo template.

**Regra mais importante do projeto: nada pode parecer feito por IA.** Isso significa, especificamente:

- Nunca repetir a mesma estrutura de bloco nas 5 sections (não pode ser sempre: hero centralizado → 3 cards com ícone → depoimentos → CTA → footer). Cada section tem sua própria composição de layout.
- Proibido bloco genérico "Por que nos escolher" com 3 ícones da Lucide idênticos em cards iguais.
- Proibido gradiente roxo/azul de SaaS genérico dominando o design. Gradiente e glow só aparecem como assinatura pontual da Mentoark (explico abaixo), nunca como fundo do site inteiro de um advogado ou dentista.
- Textos 100% em PT-BR, com nomes fantasia, endereços, CRECI/CRM/OAB fictícios mas formatados corretamente — nunca "Lorem Ipsum" nem frases genéricas tipo "excelência no atendimento" repetidas nas 5 sections.
- Fotos: busque por termos específicos do nicho (ex: "brazilian lawyer office", "dental clinic brazil interior"), nunca fotos-pose genéricas de banco de imagem sorrindo pra câmera.
- Varie tipografia, paleta, densidade e raio de borda entre as 5 sections. Elas devem parecer 5 clientes diferentes, não 5 skins da mesma paleta trocando só a cor primária.

### Stack técnica

React + Vite + TypeScript + Tailwind CSS + shadcn/ui + lucide-react. Um projeto só, uma página só (`App.tsx`), 5 componentes de section importados em sequência (`SectionAdvocacia`, `SectionMedico`, `SectionCorretor`, `SectionDentista`, `SectionEstetica`). Sem rotas, sem menu fixo — scroll contínuo. Cada section é `min-h-screen`, com um divisor fino entre elas (só uma linha de 1px com gradiente sutil azul→laranja, nada mais).

### Assinatura Mentoark (a única coisa que se repete nas 5 sections)

No canto inferior direito de cada section, um badge discreto e pequeno: "Site por Mentoark" com um ponto ou ícone com gradiente `linear-gradient(135deg, hsl(217 91% 45%), hsl(24 95% 48%))`. É a única cor de marca Mentoark visível dentro do design de cada nicho — o resto da paleta de cada section é própria do nicho. Use estas cores exatas nesse badge (não em mais nada dentro das sections):

- Azul Mentoark: `hsl(217, 91%, 45%)` (~#0B5FDB)
- Laranja Mentoark: `hsl(24, 95%, 48%)` (~#F2740A)

No topo da página, antes da primeira section, um cabeçalho bem enxuto (não é menu, não é fixo): título curto "Portfólio de Sites — Mentoark" + subtítulo de uma linha "5 nichos, 5 identidades, 5 sites reais". Fundo escuro `hsl(232, 45%, 5%)` com o efeito aurora sutil (blobs radiais azul/laranja em baixa opacidade) — esse é o único trecho da página inteira onde a estética "produto Mentoark" pode aparecer plena.

---

## Section 1 — Advocacia

**Cliente fictício:** Bragança & Ferreira Advogados

**Paleta:** azul-marinho profundo (#0B1B33), dourado/champagne (#C9A66B), branco (#FAFAF8). Sem gradiente, sem glow.

**Tipografia:** títulos em serifada clássica (Playfair Display ou Fraunces), corpo em sans discreta (Inter).

**Layout:** hero dividido — texto sóbrio à esquerda (nome do escritório, frase de posicionamento, OAB), foto de fachada/sala de reunião à direita. Áreas de atuação em lista numerada vertical (não cards com ícone). Seção "Sócios" com fotos quadradas em preto e branco. Depoimentos como citação grande com aspas tipográficas, sem foto de avatar genérica. CTA final "Agende uma consulta" — botão sólido dourado, cantos quase retos (radius pequeno), nada de gradiente vivo.

**Evitar:** ícone de balança da justiça repetido, qualquer cor viva, linguagem informal.

---

## Section 2 — Médico / Clínica

**Cliente fictício:** Clínica Vitalis

**Paleta:** azul clínico claro (#E8F1FB), branco, verde-água (#4FB8A8) como destaque pontual.

**Tipografia:** títulos em Manrope (peso 600-700), corpo em Inter.

**Layout:** hero com foto real de atendimento (médico + paciente, ambiente clínico), não pose de banco de imagem. Especialidades em grid assimétrico (um item grande + quatro pequenos, não 3x1 igual). Seção "Corpo clínico" com fotos redondas e CRM visível. Bloco de agendamento com seletor de data/hora simulado. Selos de convênios aceitos no rodapé da section.

**Evitar:** cruz médica genérica como ícone central, texto "cuidamos de você com excelência".

---

## Section 3 — Corretor de Imóveis

**Cliente fictício:** Renata Duarte Imóveis

**Paleta:** preto (#1A1A1A), branco, terracota (#B5603F) como destaque.

**Tipografia:** títulos em sans condensada bold (Archivo ou Big Shoulders), corpo em Inter.

**Layout:** hero full-bleed com imóvel de destaque (foto + preço + metragem sobrepostos). Grid de 4-6 imóveis com filtro simulado (bairro/tipo/valor). Seção pessoal da corretora (foto profissional + CRECI + bio curta). Depoimentos de quem comprou, com nome e bairro. Botão flutuante de WhatsApp fixo só dentro dessa section, estilo corretagem ("Fale agora sobre este imóvel").

**Evitar:** prédio genérico de banco de imagem óbvio, frase "seu sonho, sua casa".

---

## Section 4 — Dentista

**Cliente fictício:** Espaço Sorriso Odontologia

**Paleta:** branco, verde-menta (#8FD4C1), coral suave (#F28B6B) como destaque.

**Tipografia:** títulos em Poppins (peso 600), corpo em Inter — amigável mas profissional, sem parecer infantil.

**Layout:** hero com foto close de sorriso real. Timeline horizontal de tratamentos (não cards iguais). Slider comparativo de antes/depois. Bloco de convênios aceitos. Botão de agendamento via WhatsApp fixo na lateral, discreto.

**Evitar:** ilustração de dente com carinha, excesso de espaço em branco vazio sem textura.

---

## Section 5 — Clínica de Estética

**Cliente fictício:** Bellamore Estética Avançada

*(Escolhi este 5º nicho de propósito: clínicas de estética convertem majoritariamente por WhatsApp e são um público natural para depois virar cliente do CRM da Mentoark — encaixa bem com o objetivo comercial do portfólio.)*

**Paleta:** rosa nude (#E8D3CC), dourado rosé (#C9A08A), preto (#1A1A1A).

**Tipografia:** títulos em serifada fina e elegante (Cormorant ou Marcellus), corpo em sans leve (Inter ou Manrope light).

**Layout:** hero editorial estilo revista (foto de tratamento em destaque, tipografia grande sobreposta). Grid estilo Instagram (quadrados) com procedimentos. Antes/depois em carrossel. Bloco de "vagas do mês" com contador simples (sem exagero). CTA de WhatsApp com senso de urgência sutil, sem parecer promoção de liquidação.

**Evitar:** emoji de coraçãozinho em excesso, gradiente rosa-roxo genérico.

---

## Checklist final antes de fechar o projeto

- As 5 sections têm 5 paletas visivelmente diferentes entre si?
- As 5 sections têm 5 estruturas de hero diferentes (nenhuma repetida)?
- O único lugar com gradiente/glow azul-laranja da Mentoark é o badge de assinatura e o cabeçalho do topo?
- Nenhum texto genérico tipo "excelência", "compromisso com a qualidade" repetido entre sections?
- Todas as fotos pedidas são específicas do nicho, não genéricas?

---

## Fim do prompt para colar no Lovable
