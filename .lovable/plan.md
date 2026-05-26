## Diagnóstico

Auditei toda a cadeia: botão → modal → backend `/api/whatsapp/connect` → Evolution API → webhook → tabela `whatsapp_messages` → tela de conversas. Quatro problemas independentes impedem o fluxo de funcionar:

1. **Aba "Instâncias" existe mas é invisível.** A página `/whatsapp` já tem a aba (`WhatsApp.tsx`), mas o sidebar só leva para `/whatsapp` (aba Conversas padrão) — não há entrada direta para Instâncias. O botão "Conectar WhatsApp" no empty state só abre um modal local, não leva à aba de gerenciamento.

2. **Token JWT errado na chamada do Evolution.** `evolutionService.ts` (linha 5) e `WhatsAppInterface.tsx` (linha 28) leem `localStorage.getItem('access_token')`, mas a chave real salva pelo login é `crm_access_token` (já há helper `getAuthToken()` em `src/lib/api-token.ts`). Resultado: `/api/whatsapp/status` e `/api/whatsapp/connect` recebem 401 silencioso → status sempre fica "close" → QR nunca aparece pra alguns usuários.

3. **Webhook nunca é registrado no Evolution.** Em `backend/src/routes/whatsapp.ts`, o `/api/whatsapp/connect` chama `/instance/create` sem passar `webhook`, e nunca chama `/webhook/set/:instance`. Sem isso o Evolution recebe as mensagens do WhatsApp mas não envia pra `https://api.mentoark.com.br/webhook/evolution` — por isso `whatsapp_messages` fica vazia mesmo com a instância conectada.

4. **Painel "Instâncias" só lista, não cria.** `InstanceManagementPanel.tsx` só renderiza agentes que já têm `evolution_instancia`. Não tem botão "+ Nova instância", então mesmo achando a aba o usuário não consegue iniciar uma conexão por ali.

## Fluxo desejado

```text
Sidebar → WhatsApp ▸ Instâncias
       ↓
[Tab Instâncias] → botão "+ Conectar nova"
       ↓
Modal (nome + país + telefone)
       ↓
POST /api/whatsapp/connect  (com Bearer correto)
       ↓
Backend: cria instância + REGISTRA WEBHOOK no Evolution
       ↓
Modal QR Code (polling a cada 3s no /api/whatsapp/status)
       ↓
state=open → toast "Conectado!" → fecha modal
       ↓
WhatsApp escaneado → Evolution envia messages.upsert
       ↓
/webhook/evolution grava em whatsapp_messages
       ↓
Tab Conversas mostra a conversa nova
```

## Alterações

### Frontend

**`src/services/evolutionService.ts`**
- Trocar `localStorage.getItem('access_token')` por `getAuthToken()` do `@/lib/api-token`.

**`src/components/WhatsAppInterface.tsx`**
- Mesma troca do token (linha 28).
- No empty state, transformar o botão "Conectar WhatsApp" em link para `/whatsapp?tab=instancias` (mantendo o modal inline como atalho secundário).

**`src/pages/WhatsApp.tsx`**
- Ler `?tab=` via `useSearchParams` e usar como `value` controlado das tabs (sidebar já manda `/whatsapp?tab=caixa` — vai passar a funcionar de verdade).
- Aceitar valores: `conversas`, `caixa`, `instancias`, `diagnostico`.

**`src/components/AppSidebar.tsx`**
- Adicionar item "Instâncias" no subgrupo "WhatsApp Chat" apontando para `/whatsapp?tab=instancias` com ícone `Smartphone`.

**`src/components/whatsapp/InstanceManagementPanel.tsx`**
- Adicionar botão "+ Conectar nova instância" no header.
- Adicionar `<Dialog>` com formulário (nome + país + telefone opcional) que reusa `createInstance()` do `evolutionService`.
- Adicionar `<Dialog>` para mostrar QR Code + Pairing Code com botão "Atualizar".
- Após `createInstance`, iniciar polling a cada 3s em `fetchConnectionStatus()` até `state === 'open'` (timeout 2min); ao conectar, fechar modal, toast de sucesso e recarregar lista.
- Adicionar botão "Desconectar" em cada card existente (chama `disconnectInstance`).

### Backend

**`backend/src/routes/whatsapp.ts`** — função `/api/whatsapp/connect`:
- Adicionar a env `EVOLUTION_WEBHOOK_URL` (default: `https://api.mentoark.com.br/webhook/evolution`).
- No payload do `/instance/create`, incluir bloco `webhook` (Evolution API v2 aceita inline):
  ```ts
  webhook: {
    url: WEBHOOK_URL,
    byEvents: false,
    base64: true,
    events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
  }
  ```
- Como fallback para Evolution que ignora webhook inline, chamar logo depois `POST {base}/webhook/set/{instancia}` com o mesmo payload (idempotente — pode rodar sempre).
- Quando reaproveitar instância já existente (branch "already exists" + reconnect), também rodar `/webhook/set` para garantir que está configurado.

**Sem migração de banco** — `whatsapp_messages`, `agentes` e `webhook_mensagens_processadas` já têm as colunas necessárias.

## Validação após implementar

1. Login → sidebar mostra "WhatsApp ▸ Instâncias" → clica → cai direto na aba certa.
2. Aba Instâncias vazia mostra botão "+ Conectar nova" no topo.
3. Clicar → modal nome/país/telefone → "Gerar QR Code" → modal QR aparece.
4. Escanear no celular → toast "Conectado!" em até ~10s, modal fecha, card aparece no painel com status verde.
5. Mandar mensagem do celular pro número → após ~5s aparece em /whatsapp (aba Conversas).
6. Conferir no Evolution (`disparo.mentoark.com.br`) que a instância está com webhook setado para `api.mentoark.com.br/webhook/evolution`.

## Notas

- O backend roda em produção (`api.mentoark.com.br`). As mudanças em `backend/src/routes/whatsapp.ts` precisam ser deployadas com o procedimento do `CLAUDE.md` (scp + docker rebuild) — isso fica fora do que o Lovable faz no preview. Aviso isso quando terminar.
- Nada de mudar `supabase/client.ts`, criar tabelas novas, nem mexer no Postgres.
