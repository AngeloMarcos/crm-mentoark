# Prompts — CRM Chat igual ao WhatsApp
## Ordem: Lovable (frontend) → Claude Code (backend + banco)

---

## FASE 1 — LOVABLE (pequenos, um de cada vez)

---

### PROMPT 1 — Separadores de data entre mensagens

```
No componente src/components/WhatsAppInterface.tsx, adicione separadores de data entre as mensagens no chat, igual ao WhatsApp.

Regras:
- Entre mensagens de dias diferentes, exibir uma pílula centralizada com a data
- Formato: "Hoje", "Ontem", ou "DD/MM/AAAA" para datas mais antigas
- A pílula deve ter fundo levemente transparente (como o WhatsApp)
- Não exibir separador antes da primeira mensagem se for hoje

No array activeChat.messages.map(...), antes de renderizar cada mensagem,
verifique se o dia é diferente do anterior e insira o separador.

Função auxiliar para determinar o label:
- Se for hoje → "Hoje"
- Se for ontem → "Ontem"  
- Senão → formatar como "05/06/2026"

Use o campo timestamp da mensagem para comparar.
```

---

### PROMPT 2 — Status de entrega das mensagens (✓ ✓✓ azul)

```
No componente src/components/WhatsAppInterface.tsx, melhore os ícones de status das mensagens enviadas (from_me=true).

Status possíveis vindos da API (campo status):
- "sent" ou undefined → um ✓ cinza
- "SERVER_ACK" → um ✓ cinza mais forte  
- "DELIVERY_ACK" → dois ✓✓ cinza
- "READ" ou "PLAYED" → dois ✓✓ azul (#53BDEB)

O código atual já tem parte disso. Ajuste para:
1. Usar SVG de checkmark duplo real (não texto) igual ao WhatsApp
2. Adicionar animação suave de transição entre estados
3. Exibir tooltip ao passar o mouse mostrando o status em português:
   "Enviado", "Entregue ao servidor", "Entregue", "Lido"
```

---

### PROMPT 3 — Botão "rolar para baixo" com contador de não lidas

```
No componente src/components/WhatsAppInterface.tsx, adicione um botão flutuante
"rolar para baixo" igual ao WhatsApp.

Comportamento:
- Aparece quando o usuário sobe o scroll e não está no final
- Exibe um badge com o número de mensagens não lidas (prop unread do chat)
- Clicar rola suavemente até o final do chat
- Desaparece quando está no final

Implementação:
- Use um ref no ScrollArea para detectar posição do scroll
- Use IntersectionObserver no messagesEndRef para saber se está visível
- Botão: ícone ChevronDown, círculo, sombra, posição absolute bottom-24 right-6
- Badge verde com número se unread > 0
```

---

### PROMPT 4 — Indicador "digitando..." 

```
No componente src/components/WhatsAppInterface.tsx, adicione indicador
de "digitando..." no cabeçalho da conversa ativa, igual ao WhatsApp.

O backend vai expor via polling GET /api/whatsapp/typing/:phone que retorna
{ typing: boolean }. Por enquanto, simule com estado local.

UI:
- No cabeçalho da conversa, abaixo do nome do contato, alterne entre:
  - Número do telefone (estado normal)
  - "digitando..." em verde animado com 3 pontinhos pulsando (estado typing)
- Animação: 3 círculos pequenos que aparecem sequencialmente (CSS animation)
- O estado de typing some após 3 segundos sem atualização
```

---

### PROMPT 5 — Responder mensagem específica (quote/reply)

```
No componente src/components/WhatsAppInterface.tsx, adicione funcionalidade
de responder a uma mensagem específica, igual ao WhatsApp.

UI necessária:
1. Ao passar o mouse em qualquer mensagem, mostrar menu com ícone de resposta (Reply)
2. Ao clicar em responder, exibir um painel acima do input com:
   - Barra colorida lateral (verde para mensagens do cliente, azul para do agente)
   - Nome do remetente
   - Preview do texto (máximo 2 linhas, truncado)
   - Botão X para cancelar a resposta
3. O campo de texto ganha foco automaticamente
4. O estado replyTo: { id, content, senderName, role } controla o painel

Ao enviar, incluir no body do POST /api/whatsapp/send:
  { ..., replyToMessageId: replyTo?.message_id }

No banco a mensagem vai ter o campo reply_to_message_id.
Na exibição, mensagens com reply mostram o quote acima do texto principal.
```

---

### PROMPT 6 — Enviar imagem/arquivo do CRM

```
No componente src/components/WhatsAppInterface.tsx, adicione botão de anexo
(clipe) na área de input para enviar imagens e arquivos, igual ao WhatsApp.

UI:
1. Ícone Paperclip já existe no código — conecte-o a um input file hidden
2. Ao selecionar arquivo, exibir preview antes de enviar:
   - Imagem: thumbnail com botão X para cancelar
   - Arquivo: nome + ícone + tamanho + botão X
3. Input aceita: image/*, audio/*, video/*, application/pdf, .docx, .xlsx
4. Limite visual de 16MB (validar no frontend antes de enviar)
5. Ao clicar em enviar com anexo, chamar POST /api/whatsapp/send com:
   { phone, instancia, mediaUrl: <base64 ou URL>, mediaType, mediaCaption: texto }

Por ora use base64 para enviar a imagem inline.
O backend já tem suporte para mediaUrl e mediaType no endpoint /send.
```

---

### PROMPT 7 — Pesquisa de mensagens dentro da conversa

```
No componente src/components/WhatsAppInterface.tsx, adicione busca de mensagens
dentro da conversa ativa, igual ao WhatsApp.

UI:
1. Botão Search no cabeçalho da conversa (ícone lupa)
2. Ao clicar, um painel de busca desliza de cima com input
3. Enquanto digita, filtrar as mensagens no frontend (busca local nas mensagens já carregadas)
4. Destacar o termo buscado em amarelo nas mensagens que contêm
5. Mostrar contador "X de Y resultados" e setas para navegar entre eles
6. Ao navegar, o scroll vai até a mensagem correspondente
7. ESC ou X fecha a busca e remove os highlights

Use estado local searchTerm, searchResults (array de índices), currentSearchIndex.
```

---

### PROMPT 8 — Marcar conversa como não lida / arquivar / fixar

```
No componente src/components/WhatsAppInterface.tsx, adicione menu de contexto
ao clicar com o botão direito (ou segurar) em uma conversa na lista lateral.

Menu com opções:
- "Marcar como não lida" → adiciona badge unread na conversa
- "Fixar conversa" → move para o topo da lista com ícone de pin
- "Arquivar" → remove da lista principal (vai para aba Arquivadas)
- "Silenciar" → ícone de sino riscado na conversa

Por ora implemente o menu visual e os estados locais (useState para pinned, archived, muted, unread).
O backend será implementado na fase Claude Code.

Use um DropdownMenu do shadcn/ui trigado por onContextMenu na div da conversa.
```

---

### PROMPT 9 — Perfil do contato expandido (painel direito)

```
No componente src/components/WhatsAppInterface.tsx, melhore o painel direito
"Detalhes do Contato" para ser mais completo, igual ao WhatsApp.

Adicione seções:
1. Foto de perfil clicável (já existe) + nome editável (já existe)
2. Sobre: campo de bio/status do WhatsApp (buscar de push_name)
3. Telefone formatado com botão de copiar
4. Botões de ação rápida: 
   - "Abrir no CRM" (já existe)
   - "Pausar IA" (mover toggle daqui para o painel)
   - "Silenciar" com seletor de duração
5. Mídia compartilhada: grid 3x2 com as últimas 6 mídias reais 
   (filtrar activeChat.messages onde tipo !== 'text')
6. Arquivos compartilhados: lista dos documentos
7. Seção "Etiquetas" com badges coloridos (tags do contato)
```

---

### PROMPT 10 — Modo de seleção múltipla de mensagens

```
No componente src/components/WhatsAppInterface.tsx, adicione modo de seleção
múltipla de mensagens, igual ao WhatsApp.

Ativação: clicar longo (ou checkbox) em qualquer mensagem entra no modo de seleção.

UI no modo de seleção:
1. Cabeçalho muda para: X mensagens selecionadas + botões: Encaminhar, Deletar, Copiar, Fechar
2. Cada mensagem mostra checkbox à esquerda
3. Clicar em mensagem adiciona/remove da seleção
4. ESC ou botão X sai do modo de seleção

Ações:
- Copiar: copia todos os textos selecionados concatenados
- Deletar: chama DELETE /api/whatsapp/messages (backend a implementar)
- Encaminhar: abre modal de seleção de contato para encaminhar

Por ora implemente apenas o UI e as ações de copiar e deletar local.
```

---

---

## FASE 2 — CLAUDE CODE (backend + banco)

---

### PROMPT CC-1 — Reply to message (banco + endpoint)

```
Você está em /opt/crm/backend na VPS.

Implemente suporte a responder mensagens específicas (quote/reply).

PASSO 1 — Migração do banco:
docker exec -i postgres psql -U mentoark -d crm << 'SQL'
ALTER TABLE whatsapp_messages 
  ADD COLUMN IF NOT EXISTS reply_to_message_id TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_content TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_sender TEXT;
CREATE INDEX IF NOT EXISTS idx_wamsg_reply ON whatsapp_messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
SQL

PASSO 2 — Backend (src/routes/whatsapp.ts):
No endpoint POST /api/whatsapp/send, extraia do body:
  const { replyToMessageId } = req.body;

Ao salvar em whatsapp_messages, também salve:
  reply_to_message_id = replyToMessageId || null

Ao enviar via Evolution, inclua no payload quando houver reply:
  quoted: { key: { id: replyToMessageId } }

PASSO 3 — Endpoint GET /api/whatsapp/conversas/:phone:
No SELECT, adicione os campos de reply:
  m.reply_to_message_id,
  m.reply_to_content,
  m.reply_to_sender

E no map de mensagens, incluir esses campos no retorno.

PASSO 4 — Webhook (src/routes/webhook.ts):
Ao salvar mensagem recebida, extrair do payload Evolution:
  const replyToId = payload.data?.contextInfo?.statedMessage?.key?.id || null;
  const replyToContent = payload.data?.contextInfo?.statedMessage?.message?.conversation || null;
  const replyToSender = payload.data?.contextInfo?.statedMessage?.key?.fromMe ? 'assistant' : 'user';

Salvar esses campos no INSERT de whatsapp_messages.

Deploy após as mudanças.
```

---

### PROMPT CC-2 — Unread count real por conversa

```
Você está em /opt/crm/backend na VPS.

Implemente contagem real de mensagens não lidas por conversa.

PASSO 1 — Banco:
docker exec -i postgres psql -U mentoark -d crm << 'SQL'
ALTER TABLE whatsapp_messages 
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_wamsg_unread 
ON whatsapp_messages(user_id, remote_jid, is_read, from_me) 
WHERE is_read = false AND from_me = false;
SQL

PASSO 2 — GET /api/whatsapp/conversas (whatsapp.ts):
No CTE do SELECT, adicione:
  COUNT(*) FILTER (WHERE NOT m.from_me AND NOT m.is_read) 
    OVER (PARTITION BY RIGHT(split_part(m.remote_jid,'@',1), 11)) AS unread_count

No map de conversas, retornar unread: Number(row.unread_count).

PASSO 3 — Endpoint PATCH /api/whatsapp/conversas/:phone/read:
Marcar todas as mensagens de um telefone como lidas:
  UPDATE whatsapp_messages 
  SET is_read = true 
  WHERE split_part(remote_jid,'@',1) = $phone 
    AND user_id = $userId 
    AND from_me = false 
    AND is_read = false

Chamar esse endpoint quando o usuário abre uma conversa no frontend.

PASSO 4 — Webhook (webhook.ts):
Quando receber evento MESSAGES_UPDATE com status READ:
  UPDATE whatsapp_messages SET is_read = true WHERE message_id = $messageId

Deploy após as mudanças.
```

---

### PROMPT CC-3 — Fixar e arquivar conversas

```
Você está em /opt/crm/backend na VPS.

Implemente fixar (pin) e arquivar conversas.

PASSO 1 — Banco:
docker exec -i postgres psql -U mentoark -d crm << 'SQL'
CREATE TABLE IF NOT EXISTS whatsapp_chat_prefs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remote_jid  TEXT NOT NULL,
  pinned      BOOLEAN DEFAULT false,
  archived    BOOLEAN DEFAULT false,
  muted_until TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, remote_jid)
);
CREATE INDEX ON whatsapp_chat_prefs(user_id, pinned) WHERE pinned = true;
CREATE INDEX ON whatsapp_chat_prefs(user_id, archived) WHERE archived = true;
SQL

PASSO 2 — Endpoints em src/routes/whatsapp.ts:

POST /api/whatsapp/chat-prefs/:phone
  Body: { pinned?, archived?, muted_until? }
  Faz UPSERT em whatsapp_chat_prefs

GET /api/whatsapp/conversas — incluir JOIN com whatsapp_chat_prefs:
  LEFT JOIN whatsapp_chat_prefs wcp 
    ON wcp.user_id = m.user_id 
    AND wcp.remote_jid = m.remote_jid
  
  Retornar pinned, archived, muted_until nos campos da conversa.
  Ordenar: pinned=true primeiro, depois por created_at DESC.
  Filtrar: WHERE (archived = false OR archived IS NULL) por padrão.
  
  Query param ?archived=true retorna apenas arquivadas.

Deploy após as mudanças.
```

---

### PROMPT CC-4 — Busca global de mensagens

```
Você está em /opt/crm/backend na VPS.

Implemente endpoint de busca de mensagens.

Em src/routes/whatsapp.ts, adicione:

GET /api/whatsapp/search?q=termo&limit=20

  const q = req.query.q as string;
  if (!q || q.length < 2) return res.json([]);

  const r = await pool.query(
    `SELECT 
       m.id, m.message_id, m.remote_jid,
       split_part(m.remote_jid,'@',1) AS phone,
       m.content, m.from_me, m.timestamp_wa, m.message_type,
       COALESCE(c.push_name, c.nome, split_part(m.remote_jid,'@',1)) AS contact_name,
       COALESCE(c.foto_perfil, c.profile_pic_url) AS profile_pic
     FROM whatsapp_messages m
     LEFT JOIN contatos c 
       ON c.user_id = m.user_id 
       AND c.telefone ILIKE '%' || RIGHT(split_part(m.remote_jid,'@',1), 11)
     WHERE m.user_id = $1
       AND m.content ILIKE $2
       AND m.message_type = 'text'
     ORDER BY m.timestamp_wa DESC
     LIMIT $3`,
    [userId, `%${q}%`, limit]
  );

  return res.json(r.rows);

No frontend (WhatsAppInterface.tsx), conecte a busca global (ícone de lupa no topo da lista)
a esse endpoint — ao clicar num resultado, abrir a conversa correspondente.

Deploy após as mudanças.
```

---

### PROMPT CC-5 — Deletar mensagem (para mim / para todos)

```
Você está em /opt/crm/backend na VPS.

Implemente deleção de mensagens.

Em src/routes/whatsapp.ts, adicione:

DELETE /api/whatsapp/messages/:messageId
  Body: { forEveryone: boolean, instancia: string, remoteJid: string }

  1. Se forEveryone=true, chamar Evolution API para deletar:
     POST /message/delete/{instancia}
     Body: { id: messageId, remoteJid }

  2. Marcar como deletada no banco (soft delete):
     UPDATE whatsapp_messages 
     SET content = null, 
         message_type = 'deleted',
         deleted_at = NOW()
     WHERE message_id = $messageId AND user_id = $userId
  
  3. Retornar { ok: true }

No webhook.ts, quando receber evento MESSAGES_DELETE:
  UPDATE whatsapp_messages 
  SET content = null, message_type = 'deleted', deleted_at = NOW()
  WHERE message_id = $deletedId AND user_id = $userId

No frontend, mensagens com message_type='deleted' exibem:
  Itálico cinza: "🚫 Mensagem apagada" (igual WhatsApp)

Deploy após as mudanças.
```

---

### PROMPT CC-6 — Typing indicator (digitando...)

```
Você está em /opt/crm/backend na VPS.

Implemente endpoint de typing indicator baseado em eventos da Evolution.

PASSO 1 — Banco:
docker exec -i postgres psql -U mentoark -d crm << 'SQL'
CREATE TABLE IF NOT EXISTS whatsapp_typing (
  user_id    UUID NOT NULL,
  remote_jid TEXT NOT NULL,
  typing     BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, remote_jid)
);
SQL

PASSO 2 — Webhook (webhook.ts):
Quando receber evento PRESENCE_UPDATE da Evolution:
  const presence = payload.data?.presences?.[remoteJid]?.lastKnownPresence;
  if (presence === 'composing' || presence === 'recording') {
    await pool.query(
      `INSERT INTO whatsapp_typing (user_id, remote_jid, typing, updated_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (user_id, remote_jid) DO UPDATE 
       SET typing = true, updated_at = NOW()`,
      [userId, remoteJid]
    );
  } else {
    await pool.query(
      `UPDATE whatsapp_typing SET typing = false, updated_at = NOW()
       WHERE user_id = $1 AND remote_jid = $2`,
      [userId, remoteJid]
    );
  }

PASSO 3 — Endpoint (whatsapp.ts):
GET /api/whatsapp/typing/:phone
  Retorna { typing: boolean } 
  Considera typing=false se updated_at < NOW() - 5 seconds

PASSO 4 — Frontend (WhatsAppInterface.tsx):
No useEffect que faz polling de mensagens a cada 3s,
adicionar também fetch do typing status:
  const typingRes = await fetch(`${API_BASE}/api/whatsapp/typing/${activeChatId}`...);
  const { typing } = await typingRes.json();
  setIsTyping(typing);

Deploy após as mudanças.
```

---

## ORDEM SUGERIDA DE EXECUÇÃO

| # | Prompt | Onde | Prioridade |
|---|--------|------|-----------|
| 1 | Separadores de data | Lovable | Alta |
| 2 | Status ✓✓ azul | Lovable | Alta |
| 3 | Scroll para baixo | Lovable | Média |
| CC-2 | Unread count real | Claude Code | Alta |
| 5 | Reply/quote UI | Lovable | Alta |
| CC-1 | Reply backend | Claude Code | Alta |
| 4 | Typing indicator UI | Lovable | Média |
| CC-6 | Typing backend | Claude Code | Média |
| 6 | Enviar mídia | Lovable | Alta |
| 7 | Busca de mensagens UI | Lovable | Média |
| CC-4 | Busca backend | Claude Code | Média |
| 8 | Menu de contexto chat | Lovable | Média |
| CC-3 | Pin/archive backend | Claude Code | Baixa |
| 9 | Perfil expandido | Lovable | Baixa |
| CC-5 | Deletar mensagem | Claude Code | Baixa |
| 10 | Seleção múltipla | Lovable | Baixa |
