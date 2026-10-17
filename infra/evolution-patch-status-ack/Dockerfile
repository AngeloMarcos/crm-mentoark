# Evolution API v2.3.7 + patch Baileys #2858 (ack de <status>). Ver aplicar-patch.cjs.
FROM evoapicloud/evolution-api:v2.3.7
COPY aplicar-patch.cjs /tmp/aplicar-patch.cjs
RUN node /tmp/aplicar-patch.cjs && grep -q "PATCH-MENTOARK-2858" /evolution/node_modules/baileys/lib/Socket/messages-recv.js
