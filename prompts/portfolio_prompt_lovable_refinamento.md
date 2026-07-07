# Prompt 2 — Refinamento anti-cara-de-IA

> Use este prompt DEPOIS que o Lovable gerar a primeira versão a partir do prompt 1. Cole na mesma conversa (não crie projeto novo), pra ele revisar o que já foi gerado.

---

## Cole no Lovable a partir daqui

Revise o que você gerou. Mesmo seguindo minhas instruções, você provavelmente caiu em alguns padrões que entregam "feito por IA" de longe. Vá section por section e corrija especificamente isto:

**1. Botões e cards idênticos entre sections.** Se o `<Button>` e o `<Card>` do shadcn estão com a mesma forma, mesmo radius, mesma sombra e mesmo hover (`scale-105` ou `translate-y` genérico) nas 5 sections, isso é o maior tell de IA. Cada section precisa de um tratamento de botão próprio: advocacia com cantos quase retos e sem animação de escala; corretor com hover que muda a cor de fundo, não escala; estética com transição mais lenta e sombria; dentista com borda ao invés de sombra. Pare de reusar o mesmo componente visual com só a cor trocada.

**2. Ritmo de espaçamento igual em todas as sections.** Se todas usam o mesmo `py-24`/`gap-8` sistemático, fica com cara de grid gerado. Quebre o ritmo: alguma section com hero colado (pouco respiro), outra com muito espaço negativo. Isso é decisão de design, não bug.

**3. Blocos clichê de IA — procure e elimine:**
   - Qualquer "Nossos Diferenciais" ou "Por que nos escolher" com 3 cards de ícone + título + texto curto.
   - Barra de estatísticas genérica ("+500 clientes", "98% satisfação") sem contexto real do negócio.
   - Lista de benefícios com ícone de check verde repetido.
   - Card de depoimento igual nas 5 sections (avatar redondo + 5 estrelas + aspas).
   - Rodapé de 4 colunas de links genéricas ("Sobre", "Serviços", "Contato", "Redes Sociais") copiado e colado.
   Se algum desses blocos existir, redesenhe do zero — não só troque o texto.

**4. Ícones da Lucide repetidos com a mesma cor de destaque.** Se o ícone de check, seta ou estrela aparece igual (mesmo peso, mesmo tamanho) nas 5 sections, isso denuncia biblioteca genérica. Use ícones com moderação, e onde usar, varie peso/tamanho por section.

**5. Cópia (texto) ainda genérica.** Releia cada headline e CTA. Se dá pra colar a mesma frase em qualquer negócio do Brasil sem soar estranho, ela é genérica demais. Reescreva com detalhes específicos e concretos do nicho e do cliente fictício (nome do bairro, tipo de imóvel, nome do procedimento, número da OAB, etc.), não adjetivos vazios tipo "excelência", "qualidade", "compromisso".

**6. Fotos.** Confira se as imagens batem exatamente com o termo de busca pedido para cada nicho. Se alguma foto parece "pessoa genérica sorrindo pro banco de imagens" sem relação direta com a cena descrita (ex: médico de verdade num consultório, não um ator em fundo branco), troque.

**7. Assimetria e imperfeição proposital.** Design que parece "gerado" tende a ser perfeitamente simétrico e centralizado em tudo. Em pelo menos 3 das 5 sections, desalinhe intencionalmente algum elemento do hero (texto deslocado do centro óptico, imagem sangrando pra fora do container, elemento sobreposto quebrando o grid).

**8. Tipografia.** Confirme que as 5 sections realmente usam pares de fonte diferentes entre si (conforme especificado no prompt 1) e que o peso/tracking dos títulos não está todo igual. Se todos os `h1` estão com `font-bold tracking-tight` idêntico, ajuste peso e letter-spacing por section.

Depois de aplicar essas correções, me mostre um resumo curto do que mudou em cada section.

---

## Fim do prompt de refinamento
