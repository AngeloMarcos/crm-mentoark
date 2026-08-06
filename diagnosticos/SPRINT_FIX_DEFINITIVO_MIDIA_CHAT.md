# Sprint — Causa raiz real de "mídia não aparece no chat, só a descrição da IA" (achado novo, não reabrir tentativas anteriores às cegas)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Contexto importante**: o usuário já pediu correção deste problema de mídia por volta de 5 vezes em sessões anteriores, sem sucesso — o que foi corrigido antes (volume Docker de `/app/wa-media`, decrypt via Evolution) era real e necessário, mas não era a causa completa. Esta sprint encontrou uma causa raiz **diferente e específica**, ainda não tocada em nenhuma tentativa anterior — ler o achado abaixo com atenção antes de mexer em qualquer coisa, pra não repetir uma correção que já foi feita.

---

## Achado (evidência direta no código, não suposição de leitura superficial)

Print real do usuário: uma mensagem de imagem recebida aparece no chat do CRM como texto puro — `[Mídia - Imagem: "Imagens de caixas de smartphones da Apple..."]` — em vez de mostrar a imagem. Isso é literalmente a descrição gerada pela Vision API (`webhook.ts`, ~linha 1146-1152: `texto = "[Mídia - Imagem: \"" + descricaoGerada + "\"]"`), exibida como se fosse o conteúdo de texto da mensagem porque **a imagem de verdade nunca chega a ser salva**.

**A causa raiz é uma condição de guarda desnecessária que impede a persistência da mídia:**

`webhook.ts` ~linha 1227:
```ts
if (MIDIA_TIPOS.has(tipo) && midia.url) {
  void (async () => {
    const localUrl = await salvarMidiaWhatsapp({ evoUrl, apiKey, instancia, messageId, remoteJid, fromMe, userId, tipo, ... });
    if (localUrl) await pool.query(`UPDATE whatsapp_messages SET media_url = $1 WHERE message_id = $2 AND instance_name = $3`, ...);
  })();
}
```

Essa condição exige `midia.url` (a URL crua do CDN do WhatsApp, extraída de `payload.data` por `extrairMidia()`) truthy pra sequer TENTAR salvar a mídia local. **Mas `salvarMidiaWhatsapp()` (`whatsappMediaStorage.ts` ~linha 131-152) não usa `midia.url` em NENHUM momento internamente** — ela chama `baixarMidiaDecriptografada({ evoUrl, apiKey, instancia, messageId, remoteJid, fromMe })`, que decripta via `messageId` direto na Evolution (`POST /chat/getBase64FromMediaMessage`), sem depender do campo `url` do payload.

**Prova de que isso é o problema, não só teoria**: o bloco de Vision (~linha 1131-1160), que gera a descrição usada no print do usuário, usa exatamente o mesmo `baixarMidiaDecriptografada()` — **sem exigir `midia.url`** (a condição dele é só `!fromMe && tipo === 'image' && userId && OPENAI_API_KEY`, ~linha 1131). Ou seja: sempre que `midia.url` vier vazio/ausente no payload da Evolution (comportamento real observado, provavelmente em certos formatos/variantes de mensagem — encaminhada, citada, etc., ainda não confirmado exatamente qual padrão dispara isso), a Vision **consegue** decriptar e descrever a imagem (não depende de `midia.url`), mas a persistência da imagem de verdade (`salvarMidiaWhatsapp`) **nunca roda**, porque sua condição de entrada exige um campo que o mecanismo por baixo nem usa. `media_url` fica com o valor cru inicial (a própria `midia.url`, que se é falsy vira `null` no INSERT, ~linha 1211) — e o frontend (`WhatsAppInterface.tsx` ~linha 3256) só renderiza `<img>` quando `m.tipo === 'image' && m.midia_url` — sem `midia_url`, cai no fallback de texto (~linha 3280, `m.content && <p>...`), mostrando a descrição da IA como se fosse a mensagem.

**Por que as tentativas anteriores não resolveram**: elas corrigiram problemas reais e relacionados (persistência do volume Docker de `/app/wa-media`, o próprio mecanismo de decrypt via Evolution) — mas essa condição específica (`&& midia.url`) nunca foi tocada, porque só se manifesta quando o payload da Evolution não inclui a URL crua (um subconjunto dos casos, não todos — por isso o bug pareceu "consertado" às vezes e "voltou" outras).

## O que fazer

1. **Confirmar com dado real antes de aplicar o fix** — checar em produção quantas linhas de `whatsapp_messages` têm `message_type` num tipo de mídia (`image`/`audio`/`video`/`document`/`sticker`) e `media_url` nulo ou igual à URL crua nunca substituída (comparar contra o padrão de URL da Evolution) — isso dá a real extensão do problema, não só o exemplo do print.
2. **Aplicar o fix**: remover `&& midia.url` da condição em `webhook.ts` ~linha 1227 — deixar só `if (MIDIA_TIPOS.has(tipo)) { ... }`. `salvarMidiaWhatsapp()` já lida sozinha com falha (retorna `null`, não quebra nada, mesmo padrão do bloco de Vision ao lado).
3. **Repetir a mesma checagem pro fluxo de mensagens ENVIADAS** (`fromMe=true`, se existir um bloco parecido de persistência de mídia própria mais abaixo no arquivo, ~linha 1861 área) — confirmar se sofre do mesmo problema e aplicar o mesmo fix lá, se aplicável.
4. **Backfill dos casos já quebrados, com expectativa realista**: pra mensagens já recebidas com `media_url` nulo/cru, tentar rodar `salvarMidiaWhatsapp()` de novo agora (script único, não automático) — mas **documentar claramente que mídia antiga pode já ter expirado** no CDN da Evolution/WhatsApp (mesmo padrão já visto antes nesta sessão: "imagens já enviadas antes do fix continuam irrecuperáveis" foi verdade pra Galeria, pode ser verdade aqui também pra mensagens mais antigas). Rodar o backfill só pras mensagens mais recentes (ex: últimos 2-3 dias) tem mais chance real de sucesso.
5. **Polish, já que está mexendo aqui mesmo (opcional, baixo custo)**: hoje, mesmo depois do fix, uma imagem recebida vai mostrar a imagem real E, embaixo, o texto cru `[Mídia - Imagem: "..."]` como se fosse legenda (são dois blocos de renderização independentes em `WhatsAppInterface.tsx`, ~linha 3256 e ~linha 3280 — o segundo não sabe que o primeiro já mostrou a mídia). Avaliar esconder esse texto colchetes-e-aspas do operador (ele existe pra alimentar a IA de atendimento, não pra ser lido por humano) — trocar por um rótulo discreto tipo "Descrição gerada por IA" (expansível/tooltip) em vez do texto cru como legenda principal.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (backend). Testar em homolog com envio real: mandar uma imagem de teste pro número de homolog, especialmente tentando reproduzir um caso onde `midia.url` viria vazio se possível (mensagem encaminhada, ou citação, testar algumas variantes) — confirmar que `media_url` é preenchido corretamente e a imagem aparece de verdade no chat do CRM, não só a descrição em texto.

## AO FINALIZAR, REPORTAR

- Confirmação real (dado do banco) de quantas mensagens estavam afetadas antes do fix.
- Confirmação de que o fix resolve o caso do print do usuário — teste real, imagem aparecendo no chat.
- Se foi possível identificar exatamente qual variante/formato de mensagem faz `midia.url` vir vazio (documentar pra entender o padrão, não só o sintoma).
- Resultado do backfill (quantas mensagens antigas foram recuperadas vs. quantas já tinham expirado).
- Decisão sobre o item 5 (polish do texto de legenda).
- Build limpo.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md` — deixar bem registrado este achado específico, já que é a 6ª tentativa de resolver o mesmo problema reportado pelo usuário; documentação clara aqui evita repetir investigação do zero de novo.
