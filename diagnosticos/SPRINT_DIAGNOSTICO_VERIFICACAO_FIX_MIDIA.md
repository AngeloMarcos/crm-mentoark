# Sprint — Diagnóstico de verificação independente: o fix de mídia do chat resolveu de verdade?

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Contexto crítico**: este é o 6º ciclo sobre o mesmo problema ("mídia não aparece no chat, IA gasta token descrevendo em texto") — as 5 tentativas anteriores relataram sucesso e o problema voltou a aparecer (print real do usuário). Esta sprint não é implementação — é auditoria cética do que foi feito em `SPRINT_FIX_DEFINITIVO_MIDIA_CHAT.md`, pra confirmar com evidência real, não com a palavra do relatório anterior.

---

## Regra pra esta sprint

**Não aceitar "já foi corrigido" de nenhum relatório anterior (inclusive o desta própria sprint de fix) sem reproduzir a evidência você mesmo.** Mesmo padrão do incidente do spintax em produção (2026-08-06): um relatório afirmou algo que não era verdade no ambiente que dizia ser. Todo item abaixo exige prova direta (leitura de código atual, query no banco, teste real com envio de mensagem) — não vale citar o que a sprint anterior disse ter feito.

## O que verificar

### 1. O fix de código foi realmente aplicado?

- Ler `backend/src/routes/webhook.ts` linha por linha na região do bloco de persistência de mídia (era ~linha 1227) — confirmar que a condição `&& midia.url` foi removida de verdade, não só comentada ou parcialmente alterada.
- Confirmar se o mesmo problema foi corrigido também no bloco de mensagens `fromMe=true` (item 3 da sprint original) — ou se ficou de fora, documentar isso claramente.
- `git log`/`git diff` confirmando o que realmente mudou nesse arquivo hoje.

### 2. Está deployado onde diz que está?

- Comparar hash do arquivo local contra `/opt/crm-homolog/backend/src/routes/webhook.ts` e `/opt/crm/backend/src/routes/webhook.ts` na VPS — confirmar homolog e produção, não assumir.

### 3. Teste real, com mensagens novas, cobrindo variação

Mandar mensagens de teste reais (ambiente homolog) cobrindo o máximo de variantes possível, não só uma imagem simples:
- Imagem enviada direta.
- Imagem encaminhada (forward).
- Imagem com legenda.
- Resposta/citação (reply) a uma mensagem anterior contendo imagem.
- Sticker.
- Documento (PDF/etc).
- Áudio.

Pra cada uma, confirmar por leitura direta no banco (`SELECT media_url, message_type FROM whatsapp_messages WHERE message_id = ...`) que `media_url` foi preenchido com uma URL local válida (`local://...`), não nula nem a URL crua da Evolution. Depois, confirmar visualmente (print ou describir) que a mídia aparece renderizada de verdade na tela de Conversas do CRM, não como texto.

### 4. Extensão real do problema histórico

Query em produção: `SELECT count(*), message_type FROM whatsapp_messages WHERE message_type IN ('image','audio','video','document','sticker') AND (media_url IS NULL OR media_url NOT LIKE 'local://%') GROUP BY message_type` — isso dá o tamanho real do estrago acumulado até agora. Cruzar com a data das mensagens pra saber quantas ainda teriam chance real de backfill (mais recentes) vs. quantas provavelmente já expiraram no CDN.

### 5. O padrão que causa `midia.url` vazio foi identificado?

A sprint anterior pediu pra tentar identificar qual variante de mensagem faz `midia.url` vir vazio no payload da Evolution. Confirmar se isso foi investigado e documentado, ou se ficou em aberto — se ficou em aberto, tentar agora com as variantes de teste do item 3 (forward, reply, sticker são os candidatos mais prováveis).

### 6. O polish do item 5 da sprint anterior (esconder texto cru de legenda) foi feito?

Confirmar se a mudança de UI foi aplicada, e se sim, se ficou boa (imagem real aparecendo sem o texto `[Mídia - Imagem: "..."]` duplicado embaixo).

## PROCESSO

Investigação e teste real — não é pra corrigir nada novo aqui, só verificar e reportar com precisão. Se encontrar que o fix está incompleto ou não resolve algum caso real, **não tentar corrigir na hora** — documentar exatamente o que falta, pra virar uma sprint de continuação clara, sem misturar com esta auditoria.

## AO FINALIZAR, REPORTAR

Formato direto, sem suavizar:
- O fix está aplicado em produção? (sim/não, com evidência)
- Funciona pra quais variantes de mensagem testadas, e falha pra quais (se alguma)?
- Tamanho real do problema histórico (quantas mensagens afetadas, quantas recuperáveis).
- Se o padrão causador de `midia.url` vazio foi identificado.
- Lista clara e honesta do que ainda falta, se houver algo — este é o item mais importante do relatório, dado o histórico de 5 tentativas anteriores que disseram "resolvido" sem estar.
- Atualizar `STATUS.md` com o resultado real desta verificação (não repetir a mesma reportagem otimista de antes sem prova).
