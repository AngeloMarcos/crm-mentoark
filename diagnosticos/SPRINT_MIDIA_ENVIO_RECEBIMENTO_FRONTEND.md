# Sprint — Mídia no Chat: Envio (UI inexistente) e Recebimento (proxy autenticado faltando) em `WhatsAppInterface.tsx`

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Usuário reportou: quando ELE (atendente) envia áudio pelo CRM, a mensagem não aparece no chat; quando o CLIENTE manda áudio, aparece e toca normalmente; foto, vídeo e figurinha não carregam na conversa nem dá pra enviar. Já existe estrutura de backend pronta (storage de mídia, decrypt, `POST /send` aceita `mediaUrl`/`mediaType`) — o problema está concentrado no frontend. Achados abaixo já confirmados lendo o código nesta sessão, não são suposição.

---

## ACHADO A — Não existe UI de envio de mídia no composer (causa raiz do "áudio que eu mando não aparece")

`WhatsAppInterface.tsx`, área do composer (~linha 2762-2798): só existem botão de "Respostas Rápidas" e botão de enviar texto. **Não há botão de anexo nem de gravar áudio** — os ícones `Paperclip`/`Mic` importados no arquivo são usados só como indicadores visuais dentro das bolhas de mensagem (mídia já recebida), nunca como controle funcional no composer. Não existe nenhum `MediaRecorder`, `<input type="file">` ou handler de upload no arquivo inteiro (confirmado por busca no arquivo completo).

**O que fazer:** implementar do zero, seguindo o padrão que já existe pro texto (`handleSendMessage` → `POST /api/whatsapp/send`):
1. Botão de anexo (ícone `Paperclip`) no composer, ao lado do botão de respostas rápidas — abre seletor de arquivo (`<input type="file" accept="image/*,video/*,application/pdf,...">`), mostra preview do arquivo selecionado com opção de cancelar antes de enviar.
2. Botão de gravar áudio (ícone `Mic`) — usa a Web API `MediaRecorder` pra gravar do microfone, mostra indicador de gravação em andamento e duração, permite cancelar, gera um Blob de áudio ao finalizar.
3. Envio: para qualquer um dos dois casos, montar a chamada pra `POST /api/whatsapp/send` com `mediaUrl` (o arquivo/blob convertido pra base64 `data:` URI — o backend já sabe lidar com isso, ver `[AUDITORIA]` em `whatsapp.ts` linha ~1408) e `mediaType` (`'image'|'video'|'audio'|'document'`, mapeado do MIME type do arquivo). Reaproveitar `apiHeaders()`/`getFreshToken()` já usado no resto do arquivo pra autenticação.
4. Respeitar o teto de 5MB já validado no backend (`MAX_OUTBOUND_MEDIA_BYTES`) — mostrar erro amigável no frontend antes de tentar enviar um arquivo maior, não só deixar o backend rejeitar com 413 sem contexto.
5. Depois do envio bem-sucedido, a mensagem deve aparecer na conversa (a resposta de `/send` já inclui `messageId` — usar o mesmo padrão de atualização otimista de UI que o envio de texto já usa, se houver, ou disparar um refresh de `fetchMensagens`).

## ACHADO B — Imagem e figurinha recebidas usam `<img src>` cru, sem passar pelo proxy autenticado (causa raiz de "foto e figurinha não carregam")

Linhas ~2586-2587 (imagem) e ~2605-2606 (figurinha): `<img src={m.midia_url} ...>` usa a URL crua direto. Quando `m.midia_url` é `local://userId/arquivo` (mídia já migrada pro storage privado, ver `whatsappMediaStorage.ts`), isso **não é uma URL real que o navegador consegue buscar** — `local://` não é um esquema HTTP, o `<img>` simplesmente falha em carregar, silenciosamente.

Já existe o padrão certo implementado no mesmo arquivo, só que aplicado só a foto de perfil: `useAuthedImageUrl()` (linha ~159) faz fetch autenticado (`Authorization: Bearer`) contra `/api/whatsapp/media?url=...` e converte pra blob URL — mas **só trata o prefixo `local-pic://`** (linha 164: `if (!rawUrl.startsWith('local-pic://')) { setBlobUrl(rawUrl); return; }`), devolvendo qualquer outra coisa (incluindo `local://` de mídia de mensagem) sem processar.

**Fix:**
1. Generalizar `useAuthedImageUrl()` pra tratar **ambos** os prefixos (`local://` e `local-pic://`) da mesma forma — os dois precisam do mesmo proxy autenticado, só a rota de storage no backend é diferente internamente (já tratado lá, ver `GET /api/whatsapp/media` em `whatsapp.ts`).
2. Aplicar `useAuthedImageUrl(m.midia_url)` na renderização de imagem (linha ~2586) e figurinha (linha ~2605), usando o blob URL resolvido em vez de `m.midia_url` cru.
3. Manter compatibilidade com URLs `http(s)://` antigas (ainda não migradas) — o hook já devolve a URL original nesse caso, comportamento correto, não mudar.

## ACHADO C — Vídeo: monta a URL do proxy certa, mas via `<source src>` sem header de autenticação (mesma causa raiz, sintoma diferente)

Linhas ~2592-2595: `<video><source src="${API_BASE}/api/whatsapp/media?url=..." /></video>`. A URL até está correta (usa o proxy), mas elementos `<video>`/`<source>` nativos do navegador **não conseguem mandar o header `Authorization`** — a requisição do vídeo pro backend provavelmente falha com 401 (rota exige autenticação), então o vídeo nunca carrega, mesmo com a URL "certa" na aparência.

**Fix:** aplicar o mesmo padrão de fetch autenticado + blob URL (via `useAuthedImageUrl()`, que serve pra qualquer mídia binária, não só imagem — considerar renomear o hook se fizer sentido, ex. `useAuthedMediaUrl()`, mas isso é opcional/cosmético) no `src` do `<video>`, no lugar do `<source>` direto.

---

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Depois de cada achado corrigido, `npm run build` (frontend, vite). Testar em homolog: mandar uma imagem/figurinha/vídeo de teste de fora pra confirmar que carregam na tela (Achados B e C), e testar o envio pelo CRM de uma imagem e de um áudio gravado (Achado A) pra um número de teste, confirmando que a mensagem aparece na conversa E chega de verdade no WhatsApp do destinatário. Usar a whitelist de IA de homolog se for testar com número real (ver `[AUDITORIA]` em `webhook.ts`).

## AO FINALIZAR, REPORTAR

- Confirmação de que o composer agora tem anexo de arquivo e gravação de áudio funcionais, com teste real de envio (imagem e áudio, pelo menos).
- Confirmação de que imagem, figurinha e vídeo recebidos carregam na tela em homolog (teste com mídia real recebida de fora).
- Se o hook foi renomeado ou mantido como `useAuthedImageUrl` (decisão de nomenclatura, reportar o que foi feito).
- Build do frontend passou.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
