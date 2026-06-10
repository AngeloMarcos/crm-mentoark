# 20 Prompts Lovable — CRM igual ao WhatsApp
## Cole um por vez. Espere o resultado antes do próximo.

---

## PROMPT 1 — Separadores de data entre mensagens

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, adicione separadores de data entre mensagens no chat, exatamente como o WhatsApp faz.

Dentro do .map() que renderiza activeChat.messages, antes de cada mensagem verifique se o dia mudou em relação à mensagem anterior. Se mudou, renderize um separador:

<div className="flex justify-center my-3">
  <span className="bg-muted/60 text-muted-foreground text-[11px] font-medium px-3 py-1 rounded-full">
    {label}
  </span>
</div>

Lógica do label:
- Se for hoje → "Hoje"
- Se for ontem → "Ontem"
- Senão → "DD/MM/AAAA" usando toLocaleDateString('pt-BR')

Use o campo timestamp da mensagem para calcular. Compare usando toDateString().
```

---

## PROMPT 2 — Status de entrega com ícones SVG corretos

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, substitua os ícones de status de mensagem enviada por SVGs corretos iguais ao WhatsApp.

Crie uma função StatusIcon({ status }: { status: string }) que retorna:

- "sent": um ✓ simples cinza (SVG path de checkmark único)
- "SERVER_ACK": um ✓ cinza levemente mais escuro
- "DELIVERY_ACK": dois ✓✓ cinza lado a lado
- "READ" ou "PLAYED": dois ✓✓ na cor #53BDEB (azul WhatsApp)
- undefined/null: relógio pequeno (ícone Clock do lucide, h-3 w-3, opacity-50)

Substitua o bloco que exibe os status no render de cada mensagem (isOut && <span title={m.status}>...</span>) por <StatusIcon status={m.status} />.

Adicione um Tooltip mostrando: "Enviado" / "No servidor" / "Entregue" / "Lido" ao passar o mouse.
```

---

## PROMPT 3 — Scroll para baixo com badge de não lidas

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, adicione um botão flutuante de "rolar para o final" dentro da área de mensagens, igual ao WhatsApp.

Implemente:
1. Um ref chamado scrollAreaRef no elemento ScrollArea das mensagens
2. Estado: showScrollBtn (boolean), inicialmente false
3. useEffect que observa o scroll: se o usuário estiver a mais de 200px do final, showScrollBtn = true; senão false
4. O botão aparece com animação fade quando showScrollBtn = true:
   - Posição: absolute bottom-4 right-4 dentro da área de mensagens
   - Estilo: círculo branco/card com sombra, ícone ChevronDown
   - Se activeChat.unread > 0: badge verde com o número no topo direito do botão
5. Ao clicar: messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })

Não quebre nenhum comportamento de scroll existente.
```

---

## PROMPT 4 — Responder mensagem específica (quote/reply)

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, implemente resposta a mensagem específica igual ao WhatsApp.

Estados necessários:
  const [replyTo, setReplyTo] = useState<Message | null>(null);

1. Em cada mensagem renderizada, ao passar o mouse apareça um botão Reply (ícone CornerUpLeft do lucide) no canto superior direito da bolha.

2. Ao clicar em Reply, setReplyTo(mensagem).

3. Quando replyTo !== null, exibir um painel ACIMA do textarea de input:
   - Fundo levemente colorido, borda esquerda de 3px (verde se role=user, azul se role=assistant)
   - Linha 1: nome do remetente em negrito (replyTo.senderName)
   - Linha 2: preview do conteúdo (máximo 80 chars, truncado com ...)
   - Botão X no canto direito que faz setReplyTo(null)

4. Ao enviar a mensagem, incluir no body do POST /api/whatsapp/send:
   replyToMessageId: replyTo?.message_id

5. Após enviar, fazer setReplyTo(null).

6. Mensagens que têm reply (campo reply_to_content ou reply_to_message_id vindos da API) exibem o quote acima do texto:
   - Fundo levemente mais escuro dentro da bolha
   - Texto em itálico pequeno com a mensagem citada
```

---

## PROMPT 5 — Enviar imagens e arquivos pelo chat

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, implemente envio de arquivos e imagens pelo CRM.

O ícone Paperclip já existe na área de input. Conecte-o assim:

1. Adicione um <input type="file" ref={fileInputRef} className="hidden" accept="image/*,audio/*,video/*,application/pdf,.docx,.xlsx" onChange={handleFileSelect} />

2. Ao clicar no Paperclip, dispare fileInputRef.current?.click()

3. Estado: mediaPreview: { file: File; url: string; type: string } | null

4. handleFileSelect: ao selecionar arquivo:
   - Se > 16MB: toast.error("Arquivo muito grande. Máximo 16MB")
   - Senão: criar URL.createObjectURL, setMediaPreview({ file, url, type })

5. Quando mediaPreview !== null, exibir preview ACIMA do textarea:
   - Imagem: thumbnail 80x80 com rounded-lg
   - Áudio/vídeo: ícone + nome do arquivo
   - Documento: ícone FileText + nome + tamanho formatado
   - Botão X para cancelar (setMediaPreview(null))

6. handleSendMessage: se mediaPreview, converter para base64 e incluir no body:
   { phone, text: messageInput || '', mediaUrl: base64string, mediaType: tipo, mediaCaption: messageInput }

7. Após enviar, setMediaPreview(null).

O backend em /api/whatsapp/send já suporta mediaUrl e mediaType.
```

---

## PROMPT 6 — Gravar e enviar áudio (microfone)

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, implemente gravação de áudio igual ao WhatsApp.

O ícone Mic já existe. Implemente:

Estados:
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

1. Ao PRESSIONAR e SEGURAR o botão Mic (onMouseDown / onTouchStart):
   - Pedir permissão: navigator.mediaDevices.getUserMedia({ audio: true })
   - Iniciar MediaRecorder
   - setRecording(true)
   - Iniciar contador de segundos com setInterval

2. Ao SOLTAR o botão (onMouseUp / onTouchEnd):
   - Parar MediaRecorder
   - setRecording(false)
   - Converter chunks para Blob (audio/ogg)
   - Converter para base64
   - Enviar automaticamente via POST /api/whatsapp/send com mediaType: 'audio'
   - Limpar estados

3. Durante a gravação, substituir a área de input por:
   - Fundo vermelho suave
   - Ícone de microfone pulsando (animate-pulse)
   - Contador de tempo: "0:05" formatado
   - Texto "Solte para enviar • Deslize para cancelar"

4. Se o usuário deslizar para a esquerda durante gravação (onMouseMove), cancelar sem enviar.

5. Se a gravação durar menos de 1 segundo, ignorar e não enviar.
```

---

## PROMPT 7 — Emoji picker no input

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, adicione um emoji picker acessível pelo botão de emoji (ícone Smile do lucide) na área de input.

1. Adicione o ícone Smile antes do Zap (respostas rápidas) na barra de botões do input.

2. Estado: showEmojiPicker (boolean)

3. Crie um componente EmojiPicker simples inline (sem biblioteca externa):
   - Um grid de emojis organizados por categoria
   - Categorias: Rostos 😊😂❤️😍🥰😘😭😱🤣, Gestos 👍👎🙏🤝✌️👏🤜, Objetos 🎉🔥⭐💯✅❌🚀💪
   - Pelo menos 40 emojis no total
   - Layout: popover acima do botão, fundo card, sombra, bordas arredondadas
   - Grid 8 colunas, cada emoji é um botão 32x32 com hover

4. Ao clicar em emoji: inserir no messageInput na posição do cursor, fechar picker.

5. Fechar o picker ao clicar fora (useEffect com listener de click no document).
```

---

## PROMPT 8 — Reações em mensagens (❤️ 👍 etc)

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, implemente reações em mensagens igual ao WhatsApp.

1. Em cada mensagem, ao passar o mouse apareça um botão de reação (ícone SmilePlus do lucide, pequeno, transparente) no canto da bolha.

2. Ao clicar, abrir um popover com 6 emojis rápidos: ❤️ 👍 😂 😮 😢 🙏

3. Estado local por mensagem: reactions: Record<string, string[]> onde a chave é o message_id e o valor é array de emojis

4. Ao clicar em emoji:
   - Adicionar ao estado local reactions
   - Chamar POST /api/whatsapp/send com { phone, reaction: emoji, reactionMessageId: message_id }
   - O backend vai enviar via Evolution (endpoint sendReaction da Evolution API)

5. Exibir reações abaixo de cada mensagem que tem reactions:
   - Pílulas com emoji + contagem: [❤️ 2] [👍 1]
   - Clicar em uma pílula remove a reação

6. Se a mensagem já tem reactions vindas da API (campo reactions no objeto Message), exibi-las também.
```

---

## PROMPT 9 — Menu de contexto nas mensagens (clique direito)

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, adicione menu de contexto ao clicar com botão direito em qualquer mensagem, igual ao WhatsApp.

Use o componente DropdownMenu do shadcn/ui em modo contextual:

1. Envolva cada bolha de mensagem com um onContextMenu que abre o menu na posição do clique e previne o menu padrão do browser.

2. Opções do menu:
   - "Responder" → setReplyTo(mensagem) — só se não for nota
   - "Copiar" → navigator.clipboard.writeText(m.content)
   - "Encaminhar" → abre modal de seleção de contato (implementar modal simples)
   - "Marcar com estrela" → adiciona/remove estrela local (estado starredMessages: Set<string>)
   - "Excluir mensagem" → modal de confirmação com opções "Excluir para mim" e "Excluir para todos"

3. "Excluir para mim": remove do estado local messages array sem chamar API
4. "Excluir para todos": chama DELETE /api/whatsapp/messages/:message_id com body { forEveryone: true, instancia, remoteJid }

5. Mensagens com estrela mostram um ⭐ pequeno no canto.

6. O menu fecha automaticamente ao mover o mouse ou pressionar ESC.
```

---

## PROMPT 10 — Menu de contexto nas conversas (fixar/arquivar/silenciar)

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, adicione menu de contexto ao clicar com botão direito em uma conversa na lista lateral, igual ao WhatsApp.

1. Envolva cada item da lista de conversas com onContextMenu + DropdownMenu.

2. Opções:
   - "Marcar como não lida" → adiciona badge unread visual (estado local)
   - "Fixar conversa" → move para o topo e exibe ícone Pin
   - "Arquivar" → remove da lista (adiciona a uma lista arquivadas oculta)
   - "Silenciar" → submenu: "8 horas", "1 semana", "Sempre" + ícone de sino riscado
   - "Excluir conversa" → confirmação + remove do estado local

3. Implemente estado:
   pinnedChats: Set<string>
   archivedChats: Set<string>
   mutedChats: Map<string, Date | null>
   
4. Conversas fixadas ficam no topo da lista com ícone Pin pequeno.

5. Adicionar link "Arquivadas (X)" no rodapé da lista quando há arquivadas. Clicar mostra as arquivadas substituindo a lista principal.

6. Chamar PATCH /api/whatsapp/chat-prefs/:phone com o estado ao alterar (fire-and-forget).
```

---

## PROMPT 11 — Galeria de mídia da conversa

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, implemente a galeria de mídia no painel direito de detalhes do contato.

A seção "Mídia Recente" já existe mas mostra ícones de placeholder. Substitua por:

1. Filtrar activeChat.messages onde tipo é 'image', 'video' ou 'document'
2. Pegar as últimas 6 (para o grid 3x2)
3. Exibir:
   - Imagem/vídeo: thumbnail real usando a midia_url da mensagem (img com object-cover)
   - Documento: ícone FileText + nome truncado (midia_nome)
   - Loading skeleton enquanto carrega

4. Ao clicar em uma mídia:
   - Imagem: abrir modal de visualização fullscreen (lightbox simples)
   - Vídeo: abrir modal com player de vídeo
   - Documento: abrir em nova aba (window.open(url))

5. Se há mais de 6 mídias, exibir um botão "Ver todas (X)" que abre um modal com grid maior mostrando todas as mídias, com abas: Fotos, Vídeos, Documentos, Áudios.

6. O lightbox de imagem tem: fundo preto 90% opaco, botões de fechar (X) e navegar (< >) entre mídias.
```

---

## PROMPT 12 — Pesquisa de mensagens dentro da conversa ativa

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, adicione busca de mensagens dentro da conversa ativa, igual ao WhatsApp.

1. Adicione botão Search (ícone lupa) no cabeçalho da conversa, ao lado dos outros botões.

2. Estado: searchActive, searchTerm, searchResults: number[], searchIndex: number

3. Ao clicar em Search, um painel desliza de cima com:
   - Input de busca com autoFocus
   - Contador "2 de 5" à direita
   - Setas ↑ ↓ para navegar entre resultados
   - X para fechar

4. Enquanto digita (mínimo 2 chars):
   - Filtrar mensagens onde content.toLowerCase().includes(term)
   - searchResults = array de índices das mensagens encontradas
   - Destacar o termo em amarelo/negrito dentro do texto de cada mensagem encontrada

5. Ao navegar com setas ou Enter:
   - Scroll automático até a mensagem correspondente usando refs por index
   - Mensagem atual fica com borda destacada

6. ESC ou X fecha a busca e limpa todos os highlights.

7. A busca é 100% local (não chama API), funciona nas mensagens já carregadas.
```

---

## PROMPT 13 — Indicador "digitando..." e online

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, adicione indicadores de status online e "digitando..." no cabeçalho da conversa ativa.

1. Estado: isTyping (boolean), isOnline (boolean)

2. No cabeçalho, abaixo do nome do contato, exibir:
   - Se isTyping: "digitando..." em verde (#25D366) com animação de 3 pontinhos pulsando
   - Senão se isOnline: "online" em verde claro
   - Senão: número do telefone formatado (já existe)

3. Animação dos pontinhos (typing indicator):
   Três círculos de 4px, cada um com animation-delay diferente (0ms, 150ms, 300ms), fazendo efeito de bounce sequencial.

4. Polling: a cada 4 segundos quando há conversa ativa, fazer:
   GET /api/whatsapp/typing/${activeChatId}
   Se retornar { typing: true }, setIsTyping(true) por 4 segundos; depois false.

5. Para isOnline, usar o campo online do chat (já existe na interface Chat mas não é usado).

6. O indicador de digitando tem prioridade sobre online.
```

---

## PROMPT 14 — Envio de localização

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, adicione opção de enviar localização atual, acessível pelo botão de anexo (Paperclip).

Ao clicar no Paperclip, em vez de abrir o file input diretamente, abrir um menu com opções:
- 📎 Arquivo/Imagem → abre o file input atual
- 📍 Localização → solicita geolocalização e envia

Implementação da localização:
1. Chamar navigator.geolocation.getCurrentPosition()
2. Se permitido, mostrar preview com mapa estático:
   img src={`https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=200x100&markers=${lat},${lng}&key=AIza...`}
   Ou se sem API key, exibir apenas "📍 Latitude: X, Longitude: Y"
3. Botão "Enviar localização" → POST /api/whatsapp/send com:
   { phone, mediaType: 'location', mediaUrl: '', text: `Localização: https://maps.google.com/?q=${lat},${lng}` }
4. Se negado: toast.error("Permissão de localização negada")

O menu de anexo usa um Popover do shadcn/ui abrindo acima do botão Paperclip.
```

---

## PROMPT 15 — Visualização de mensagens deletadas e editadas

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, trate corretamente mensagens deletadas e o campo de mensagens já existente.

1. Mensagens deletadas (message_type === 'deleted' ou content === null):
   - Em vez do conteúdo, exibir: 🚫 "Mensagem apagada" em itálico, cor muted
   - Não mostrar botão de reply nem reação
   - Não mostrar no conteúdo ao copiar

2. No menu de contexto de cada mensagem (implementado no Prompt 9), a opção "Excluir mensagem":
   - Abre um AlertDialog de confirmação
   - Para mensagens enviadas (from_me=true): oferecer "Apagar para mim" e "Apagar para todos"
   - Para mensagens recebidas (from_me=false): apenas "Apagar para mim"
   - "Apagar para mim": remove do array local (setChats com filter)
   - "Apagar para todos": chama DELETE /api/whatsapp/messages/${m.message_id} com body { forEveryone: true, instancia: activeChat.source, remoteJid: activeChat.phone + '@s.whatsapp.net' }; depois remove do array local

3. Mensagens de sistema (message_type === 'system'):
   - Exibir centralizado em cinza, sem bolha: "Fulano entrou no grupo", etc.
```

---

## PROMPT 16 — Encaminhar mensagem para outro contato

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, implemente o encaminhamento de mensagens, acessível pelo menu de contexto (Prompt 9).

1. Estado: forwardMessage: Message | null

2. Ao clicar em "Encaminhar" no menu de contexto, setForwardMessage(mensagem) e abrir modal de encaminhamento.

3. Modal de encaminhamento:
   - Título: "Encaminhar mensagem"
   - Lista de conversas recentes (usar o array chats já existente)
   - Campo de busca para filtrar contatos
   - Cada item: avatar + nome + telefone + checkbox de seleção
   - Seleção múltipla (pode encaminhar para vários)
   - Botão "Encaminhar (X)" ativo quando pelo menos 1 selecionado

4. Ao confirmar:
   - Para cada contato selecionado: POST /api/whatsapp/send com { phone: contato.id, text: forwardMessage.content, instancia: activeChat.source }
   - Toast de sucesso: "Encaminhado para X contatos"
   - Fechar modal, limpar seleção

5. Mensagens encaminhadas exibem um indicador: ↪ "Encaminhada" em itálico pequeno acima do conteúdo (campo forwarded na Message interface).
```

---

## PROMPT 17 — Mensagens com preview de link

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, adicione preview de links dentro das mensagens, igual ao WhatsApp.

1. Crie uma função detectLinks(text: string): string[] que extrai URLs do texto usando regex:
   /(https?:\/\/[^\s]+)/g

2. Para mensagens de texto com URL, exibir um card de preview abaixo do texto:
   - Fundo: levemente diferente da bolha
   - Borda esquerda colorida (2px, cor primária)
   - Ícone de link 🔗 + domínio da URL em negrito pequeno
   - Título da página (se disponível via API)
   - Por enquanto, exibir apenas o domínio extraído da URL sem fazer fetch

3. A URL no texto vira um link clicável (abre em nova aba) e fica sublinhada:
   <a href={url} target="_blank" rel="noopener noreferrer" className="underline">

4. Se o texto tiver apenas a URL (sem outro conteúdo), o card ocupa mais espaço.

5. Para mensagens do tipo 'text' que contêm URLs, aplicar automaticamente.
   Para mensagens de tipo 'image', 'audio', etc., não aplicar.
```

---

## PROMPT 18 — Abas de conversas: Todas, Não Lidas, Grupos

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, melhore as abas de filtro das conversas na lista lateral.

As abas atuais são "Meus", "Fila", "Todos". Substitua por abas mais úteis iguais ao WhatsApp Business:

1. Novas abas:
   - "Todas" → todas as conversas (padrão)
   - "Não lidas" → filtrar onde unread > 0
   - "Grupos" → filtrar onde is_group = true
   - "IA Ativa" → filtrar onde a conversa não está pausada (atendente_pausou_ia = false)

2. Cada aba tem um badge numérico com o total de conversas naquela categoria:
   - "Não lidas (3)" se houver 3 conversas com não lidas

3. A aba ativa tem fundo branco com sombra suave; as inativas são transparentes.

4. Abaixo das abas, adicionar botão de filtro avançado (ícone SlidersHorizontal que já existe):
   - Ao clicar, abrir um Popover com opções de ordenação:
     • Mais recentes primeiro (padrão)
     • Mais antigas primeiro
     • Por nome (A-Z)

5. O filtro de busca (search) já existente continua funcionando em conjunto com a aba ativa.
```

---

## PROMPT 19 — Cabeçalho do chat com ações rápidas

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, melhore o cabeçalho da conversa ativa com mais ações, igual ao WhatsApp.

1. Adicione ao cabeçalho (direita):
   - Botão Search (lupa) → ativa busca na conversa (Prompt 12)
   - Botão de 3 pontinhos verticais (MoreVertical do lucide) → dropdown menu

2. Dropdown menu do botão de 3 pontos:
   - "Ver contato" → abre painel direito (toggle do painel de detalhes)
   - "Buscar mensagens" → ativa busca
   - "Silenciar notificações" → submenu com duração
   - "Limpar conversa" → modal de confirmação que limpa mensagens localmente
   - "Exportar conversa" → baixa as mensagens como .txt
   - "Bloquear" → confirmação + chama POST /api/whatsapp/block/:phone (fire-and-forget)
   - "Denunciar" → toast informativo

3. "Exportar conversa":
   const text = activeChat.messages.map(m => 
     `[${m.timestamp}] ${m.role === 'assistant' ? 'Agente' : activeChat.name}: ${m.content}`
   ).join('\n');
   Criar Blob e disparar download como "conversa-${activeChat.name}-${Date.now()}.txt"

4. O painel direito de detalhes agora pode ser fechado/aberto pelo botão "Ver contato".
   Estado: showContactPanel (boolean), padrão true para telas grandes, false para mobile.
```

---

## PROMPT 20 — Nova mensagem com seleção de instância + template de resposta rápida

Cole no Lovable:

```
No arquivo src/components/WhatsAppInterface.tsx, melhore o fluxo completo de nova mensagem e adicione suporte a selecionar qual instância usar ao enviar.

1. No modal de nova conversa, adicione campo de seleção de instância quando houver mais de uma:
   - Label: "Enviar pelo número"
   - Select com as instâncias disponíveis (buscar de GET /api/whatsapp/evo/status para cada agente)
   - Padrão: a instância do usuário logado

2. Adicione campo "Mensagem inicial" opcional no modal:
   - Textarea para já escrever a primeira mensagem
   - Ao abrir o chat, se tiver mensagem, enviá-la automaticamente

3. Melhore as Respostas Rápidas (o menu / já existente):
   - Exibir em categorias se tiver muitas
   - Mostrar atalho ao lado do nome: /saudacao
   - Preview do texto ao hover em cada resposta
   - Atalho de teclado: Tab seleciona a primeira, Enter aplica

4. Adicione botão "Modelos de mensagem" (ícone FileText) na barra de botões do input:
   - Abre um modal com mensagens pré-definidas hardcoded:
     • "Olá! Como posso te ajudar?"
     • "Obrigado pelo contato! Em breve retornaremos."
     • "Poderia me informar seu nome completo?"
   - Ao clicar em um modelo, insere no textarea

5. No envio de mensagem, se der erro 503 com reconnect_required=true:
   - Exibir toast de erro específico: "WhatsApp desconectado. Reconecte em WhatsApp → Instâncias"
   - Botão no toast: "Ir para Instâncias" que navega para /whatsapp?tab=instancias
```

---

## ORDEM DE EXECUÇÃO RECOMENDADA

Execute nesta sequência — cada um é independente:

1 → 2 → 3 → 5 → 9 → 15 → 11 → 12 → 18 → 19 → 4 → 13 → 6 → 7 → 8 → 10 → 14 → 16 → 17 → 20
