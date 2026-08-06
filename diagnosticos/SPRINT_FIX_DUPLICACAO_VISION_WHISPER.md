# Sprint — Corrigir duplicação Whisper/Vision entre webhook.ts e agentEngine.ts

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Achado já confirmado em sessão anterior (`STATUS.md`, 2026-08-04: "Duplicação Vision/Whisper... reconfirmada no código atual — ainda não corrigida") e reconfirmado agora, com um detalhe novo que muda a prioridade — ver seção final.

---

## Contexto (confirmado por leitura direta do código local)

Toda mensagem de áudio/imagem recebida passa por dois pontos que chamam OpenAI de forma independente:

1. **`backend/src/routes/webhook.ts`** (~linha 1080-1160): se `!fromMe && tipo === 'audio'/'image' && userId && OPENAI_API_KEY`, baixa a mídia decriptografada via `baixarMidiaDecriptografada()` (endpoint de decrypt da Evolution, `POST /chat/getBase64FromMediaMessage`) e chama `transcreverAudio()`/`analisarImagem()` (`utils/transcribe.ts`/`utils/vision.ts`). Resultado vira `texto = "[Áudio Transcrito: \"...\"]"` ou `"[Mídia - Imagem: \"...\"]"`, que É passado adiante pra `processarComDebounce()` como `entrada.texto` (~linha 1614-1624, `midiaUrl: midia.url`, `texto`).
2. **`backend/src/services/agentEngine.ts`** (~linha 663-677): quando a IA está ativa (não pausada), recebe esse `entrada` já com `texto` pronto — mas, se `entrada.tipo === 'audio'`, chama sua **própria** função local `transcreverAudio(entrada.midiaUrl, ...)` (~linha 162, arquivo `agentEngine.ts`, função diferente da de `utils/transcribe.ts` usada pelo webhook) de novo; se `entrada.tipo === 'image'`, chama sua própria `analisarImagem(entrada.midiaUrl, ...)` (~linha 212) e **descarta completamente** o `entrada.texto` que já veio pronto do webhook (`textoFinal = await analisarImagem(...)`, sobrescreve sem aproveitar nada).

Ou seja: hoje, toda mensagem de áudio/imagem recebida com a IA ativa gera **duas** chamadas de Whisper/Vision pra descrever a mesma mídia — uma no webhook (correta, usa mídia decriptografada), outra no agentEngine (usa `entrada.midiaUrl`, que é a URL crua do CDN do WhatsApp).

## Achado novo desta sessão — pode ser mais grave que só custo duplicado

As duas funções locais de `agentEngine.ts` (`transcreverAudio`/`analisarImagem`, linhas 162 e 212) fazem `fetch(url, ...)` **diretamente** sobre `entrada.midiaUrl` — que, seguindo `extrairMidia()` em `webhook.ts` (~linha 236-242, `url: src.url` direto do `imageMessage`/`audioMessage` do protocolo WhatsApp), é a **URL crua e criptografada** do CDN da Meta, a mesma que o próprio `webhook.ts` documenta explicitamente (comentário ~linha 1086-1090) que "baixá-la direto renderia bytes cifrados... não decriptografaria nada" — motivo pelo qual o webhook usa `baixarMidiaDecriptografada()` (endpoint específico da Evolution) em vez de um fetch direto.

**Não confirmar isto como certeza absoluta sem testar** — é possível que exista alguma particularidade (ex: certas mensagens vêm com URL já acessível, ou o fetch direto falha de um jeito que não foi notado) que este diagnóstico via leitura de código não capture. Mas se a hipótese se confirmar, o impacto é maior que "gasta token à toa": em `agentEngine.ts` (~linha 667), se `transcreverAudio()` retornar `null` (o que aconteceria com bytes cifrados/ilegíveis), o código faz `return` e a IA **nunca responde** àquela mensagem de áudio — mesmo o webhook já tendo transcrito com sucesso segundos antes. Pra imagem (~linha 676), não há esse `return` guardião, mas `textoFinal` pode virar uma descrição sem sentido gerada a partir de bytes cifrados, substituindo a descrição boa que já existia.

## O que fazer

1. **Confirmar o comportamento real antes de decidir a correção** — checar logs de produção reais (`RASTREIO IA`/logs de erro do Whisper/Vision em `agentEngine.ts`) pra ver se a segunda chamada (dentro do agentEngine) está de fato falhando silenciosamente hoje, ou se por algum motivo funciona. Isso determina se o bug real é "só" custo duplicado ou também mensagens de áudio sem resposta da IA.
2. **Fix recomendado, independente do resultado do item 1**: em `agentEngine.ts` (~linha 663-677), quando `entrada.texto` já vier preenchido com o padrão `[Áudio Transcrito: "..."]` ou `[Mídia - Imagem: "..."]` (produzido pelo webhook), usar esse texto diretamente como `textoFinal` — **não** chamar `transcreverAudio()`/`analisarImagem()` de novo. Só cair no fluxo próprio do `agentEngine.ts` (as duas funções locais, linhas 162/212) como **fallback**, para o caso do webhook não ter processado a mídia (ex: `OPENAI_API_KEY` ausente no momento, falha silenciosa lá, ou tipo de mídia que o webhook não cobre) — nesse caso de fallback, usar `baixarMidiaDecriptografada()` (já importada em `webhook.ts`, ver se faz sentido mover pra um util compartilhado) em vez de `fetch(entrada.midiaUrl)` direto, corrigindo também o problema do item anterior se ele se confirmar.
3. Decidir (e documentar a decisão) se as duas funções locais duplicadas de `agentEngine.ts` (`transcreverAudio`/`analisarImagem`, diferentes das de `utils/transcribe.ts`/`utils/vision.ts` usadas pelo webhook) devem ser unificadas num único util compartilhado, ou mantidas separadas só como fallback do item 2 — evitar ter duas implementações divergentes do "mesmo" recurso se não for necessário.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (backend). Testar em homolog com dado real: mandar um áudio de teste real pro número de homolog com a IA ativa — confirmar (via log) que só UMA chamada a Whisper acontece (não duas), e que a IA responde normalmente baseada no texto transcrito. Repetir com uma imagem de teste. Testar também o caminho de fallback (ex: simular `entrada.texto` vazio/sem o prefixo esperado) pra confirmar que a IA ainda consegue processar mídia se o webhook não tiver processado antes.

## AO FINALIZAR, REPORTAR

- Veredito do item 1: a segunda chamada (dentro do agentEngine) estava de fato falhando/gerando lixo, ou funcionava por algum motivo não previsto nesta leitura de código?
- Confirmação real (via log, não só leitura de código) de que agora só 1 chamada de Whisper/Vision acontece por mensagem de áudio/imagem, com a IA respondendo corretamente.
- Se havia mensagens de áudio sem resposta da IA por causa deste bug, estimar (se der pra checar em `whatsapp_messages`/logs) há quanto tempo isso acontece e se afeta alguma conta específica.
- Decisão tomada no item 3 (unificar utils ou manter fallback separado) e por quê.
- Build do backend limpo.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md` — esta é a confirmação final de um achado que já estava registrado como pendente há multiplas sessões.
