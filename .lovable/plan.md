# Diagnóstico: mensagens não atualizam automaticamente

O código de polling na `WhatsAppInterface.tsx` está correto:
- `fetchConversas` roda a cada 2s (chat aberto) ou 5s
- `fetchMensagens` roda a cada 3s quando há chat ativo
- Usa refs (`activeChatIdRef`, `prevUltimaAtividadeRef`) para evitar stale closures
- `setChats` usa updater funcional

Se mesmo assim nada aparece, o problema **não é no frontend** — é em uma destas 3 camadas. Preciso verificar cada uma antes de mexer em código.

## Hipóteses a investigar (em ordem)

### 1. Webhook não está gravando para esse usuário
A mensagem chega no Evolution, mas a rota `/webhook/evolution` no backend pode estar derrubando o evento (sem `user_id` resolvido, instância sem agente vinculado, dedupe agressivo, etc.).
- **Verificação:** abrir `/admin/diagnostico-whatsapp`, buscar `11991909106` e ler `log_geral.txt` — checar se aparece `WEBHOOK_DROP` ou se a mensagem foi inserida em `whatsapp_messages`.

### 2. Mensagem está no banco, mas `/api/whatsapp/conversas` não devolve
A query agrupa por `session_id` e filtra por `user_id` (do JWT). Se a mensagem foi gravada com `user_id` diferente do logado, nunca aparece na listagem.
- **Verificação:** no diagnóstico, comparar `user_id` salvo na linha de `whatsapp_messages` com o `user_id` do usuário logado no CRM.

### 3. Frontend está buscando, mas a resposta está vazia / com erro
O `fetchConversas` engole erros silenciosamente (`} catch {}`). Se a API retornar 401/500, o usuário não vê nada.
- **Verificação:** abrir DevTools → Network, filtrar `whatsapp/conversas`, ver status e payload da resposta.

## Plano de ação

1. **Adicionar logs temporários** em `fetchConversas` e `fetchMensagens` (console.warn em erro, console.debug a cada poll com nº de linhas retornadas) — só no frontend, sem mexer no backend.
2. **Pedir ao usuário** para abrir a aba Conversas, enviar 1 mensagem do `11991909106`, esperar 10s e me mandar:
   - O que aparece no console do navegador
   - O que aparece na aba Network para `/api/whatsapp/conversas`
   - O resultado do `/admin/diagnostico-whatsapp` para esse número
3. Com base nos 3 sinais, fica claro **em qual camada** está a falha — e aí faço o fix correto (webhook, query do backend ou render do frontend).

## Por que não chuto um fix agora

Já fizemos 3 ciclos de mudanças (webhook logging, dedupe por instância, polling adaptativo, toasts). Se ainda não funciona, o problema está num lugar específico que precisa ser confirmado com dado real — não com mais mudanças no escuro.

Posso iniciar adicionando os logs temporários quando você aprovar.
