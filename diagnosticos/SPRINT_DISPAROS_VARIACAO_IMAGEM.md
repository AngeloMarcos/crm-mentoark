# Sprint — Variação de imagem por envio em campanhas de mídia (anti-fingerprint)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Pedido do usuário: campanhas com `tipo_midia='imagem'` mandam o exato mesmo arquivo pra todos os destinatários — mesmo hash de arquivo repetido centenas/milhares de vezes é um sinal de spam que a Meta/WhatsApp pode usar pra bloquear. Usuário pediu pra usar IA "do próprio CRM" pra variar a imagem a cada envio.

---

## Contexto técnico (já confirmado)

`disparoProcessor.ts` hoje usa `garantirMidiaEstavel(url_midia)` (`whatsappMediaStorage.ts`) **uma vez por campanha**, cacheia o resultado (`urlMidiaEstavelPorCampanha`) e reaproveita a mesma URL pra todos os envios daquela campanha — rápido e eficiente, mas significa literalmente o mesmo arquivo (mesmo hash) pra cada destinatário.

Não existe hoje nenhuma biblioteca de manipulação de imagem no backend (`sharp`/`jimp`/etc não estão no `package.json`).

## Decisão de abordagem — recomendação, não travar nisso

Duas formas de "variar a imagem", com trade-off bem diferente de custo/latência:

1. **Regeneração real via IA (ex: variar a imagem com um modelo de imagem)** — cada envio teria uma imagem visualmente diferente de verdade. Caro (chamada de API de imagem por mensagem, multiplicado pelo tamanho da campanha) e lento (adiciona segundos de latência por mensagem dentro do loop já sequencial de disparo, que já tem delay de segurança entre mensagens — isso empilharia em cima).
2. **Perturbação leve do arquivo (recomendado)** — o objetivo real pra evitar bloqueio é o arquivo ter um **hash diferente a cada envio**, não necessariamente parecer visualmente diferente pro destinatário. Aplicar uma variação mínima e imperceptível (ruído aleatório em poucos pixels, ajuste de brilho/compressão em <1%, ou metadata aleatória) já muda o hash do arquivo, é praticamente instantâneo, e não tem custo de API de IA.

**Recomendação: implementar a opção 2 (perturbação leve) como padrão desta sprint.** Adicionar `sharp` como dependência nova do backend (leve, rápida, padrão de mercado pra isso em Node). Deixar a opção 1 (regeneração real via IA) documentada como `FIX PENDENTE`/decisão de produto futura, não implementar agora — é bem mais cara e o ganho de anti-fingerprint já é resolvido pela opção 2.

## O que fazer

1. Nova função em `backend/src/utils/whatsappMediaStorage.ts` (ou arquivo novo, `imageVariation.ts`, se fizer mais sentido separar): `gerarVariacaoImagem(buffer: Buffer): Promise<Buffer>` — usa `sharp` pra aplicar uma perturbação leve e aleatória (ex: `.modulate({ brightness: 1 + (Math.random() * 0.02 - 0.01) })` + inserir um pixel de ruído aleatório em posição aleatória, ou reencodar com qualidade levemente variável) — resultado visualmente idêntico ao original pro olho humano, mas com hash de arquivo diferente a cada chamada.
2. Em `disparoProcessor.ts`, no bloco de transição de campanha (onde `garantirMidiaEstavel` já roda uma vez por campanha), **não** reaproveitar o mesmo arquivo perturbado pra todos — chamar `gerarVariacaoImagem()` **por mensagem individual** (não por campanha), gerando um arquivo levemente diferente a cada envio. Isso só deve rodar quando `tipo_midia === 'imagem'` (documento/áudio não fazem sentido pra essa técnica — variar hash de PDF/áudio da mesma forma arriscaria corromper o arquivo).
3. Persistir cada variação temporariamente (mesmo padrão de storage já usado — `UPLOADS_DIR`/`WHATSAPP_MEDIA_DIR`) e limpar depois de um tempo razoável (ex: 24h) pra não acumular lixo em disco — ou, se mais simples, gerar em memória e fazer upload direto pra Evolution sem persistir em disco a longo prazo (avaliar qual é mais barato dado o que `garantirMidiaEstavel`/Evolution já esperam como input).
4. Adicionar um toggle na tela (`StepMessage` ou `StepAntiBan`, decisão de UI — sugiro perto de "Humanizar com IA" já que é o mesmo conceito de anti-fingerprint) — "Variar imagem a cada envio", opt-in ou opt-out por padrão (decisão do Claude Code, documentar qual escolheu e por quê). Só aparece quando `tipo_midia === 'imagem'`.
5. Latência: medir o tempo real que `sharp` leva pra processar uma imagem típica de campanha (JPEG/PNG de alguns 100KB-poucos MB) — deve ser milissegundos, não segundos; se não for, repensar a abordagem antes de deployar (não pode competir com o delay anti-ban já existente entre mensagens).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (backend e frontend) depois da mudança. Testar em homolog: campanha de teste com imagem, "Variar imagem" ligado, mandar pra 3+ contatos de teste, confirmar visualmente que a imagem chega normal (sem corrupção) em todos, e confirmar via hash (`sha256sum` dos arquivos gerados, se persistidos, ou log do tamanho/hash gerado por envio) que cada envio produziu um arquivo diferente do anterior.

## AO FINALIZAR, REPORTAR

- Confirmação de que a variação de imagem funciona (hash diferente por envio, confirmado de verdade, não só por leitura de código) e não corrompe a imagem (teste visual real em homolog).
- Latência medida por variação — se ficou dentro de milissegundos ou se virou um problema de performance.
- Onde ficou o toggle na tela e se veio ligado ou desligado por padrão, com a justificativa.
- Build do frontend e do backend passaram.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`, deixando documentada a opção de regeneração real via IA como possível evolução futura (não implementada agora).
