# Evolution v2.3.7 + patch Baileys #2858 (ack de `<status>`)

**Problema:** números que recebem status (stories) com mídia caem a cada ~50 min
(`stream:error` com `ack class=status type=media` → 428 → reconexão). O WhatsApp passou a
entregar status como stanza `<status>` de nível superior e o Baileys 7.0.0-rc.9 não manda o ack.
Ver https://github.com/WhiskeySockets/Baileys/issues/2858 e o relatório em
`reports/Maturação WhatsApp e proxy 2026.md`.

**Correção:** `aplicar-patch.cjs` registra `ws.on('CB:status', node => sendMessageAck(node))` em
`baileys/lib/Socket/messages-recv.js`. O build falha se a âncora não existir (versão diferente).

Na VPS (`/opt/evolution/patch-status-ack/`):

```bash
docker build -t mentoark/evolution-api:v2.3.7-status-ack .
```

- `docker-compose.teste.yml` → `/opt/evolution-teste/` (Evolution de teste, banco `evolution_teste`,
  sem webhook, só `127.0.0.1:8099`). Nunca parear ali número que esteja em outra instância.
- Produção: trocar `image:` em `/opt/evolution/docker-compose.yml` para
  `mentoark/evolution-api:v2.3.7-status-ack`. Rollback: voltar para `evoapicloud/evolution-api:v2.3.7`.
- Linha de base (Pessoal, 5511991909106): 21–27 reconexões/dia (14–16/10/2026).
