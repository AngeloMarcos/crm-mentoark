// Patch Baileys #2858 (2026-10-17, CRM MentoArk): o WhatsApp passou a entregar status (stories)
// de contatos como stanza <status> de nível superior; o Baileys 7.0.0-rc.9 não tem handler e nunca
// manda o ack — o servidor derruba o stream ~50 min depois (stream:error ack class=status
// type=media → 428 → reconexão em loop). Correção: responder com ack (class "status", mantendo
// type/participant via sendMessageAck), sem NACK (NACK mantém a stanza pendente, ver #2779).
const fs = require("fs");
const f = "/evolution/node_modules/baileys/lib/Socket/messages-recv.js";
let src = fs.readFileSync(f, "utf8");
const MARCA = "/* PATCH-MENTOARK-2858 */";
if (src.includes(MARCA)) { console.log("patch já aplicado"); process.exit(0); }
const ANCORA = "    ws.on(\x27CB:ack,class:message\x27, (node) => {";
if (!src.includes(ANCORA) || !src.includes("const sendMessageAck = async")) {
  console.error("ERRO: âncora não encontrada — versão do Baileys mudou, revisar o patch"); process.exit(1);
}
const handler = `    ${MARCA}
    ws.on(\x27CB:status\x27, (node) => {
        sendMessageAck(node).catch(error => onUnexpectedError(error, \x27acking status stanza\x27));
    });
`;
src = src.replace(ANCORA, handler + ANCORA);
fs.writeFileSync(f, src);
console.log("patch aplicado em", f);
