# Baileys / Evolution API — problemas técnicos 2025-2026 (desconexão, instabilidade, risco de ban) e correções

Contexto: Evolution API v2.3.7 (`evoapicloud/evolution-api:v2.3.7`, Baileys 7.0.0-rc.9). Sintomas: (1) reconexão a cada ~50 min com `stream:error` / `ack class=status type=media`, depois 428; (2) dispositivo aparece como "Evolution API, Chrome, <kernel>"; (3) 401 em número novo após envio; (4) 440 com o mesmo número em duas instâncias.

## 1. Stream error `ack class="status" type="media"` a cada ~50 min: é bug conhecido? Como corrigir?

### Takeaway
SIM, está confirmado como problema conhecido e muito recente. A issue WhiskeySockets/Baileys #2858, aberta em 14/10/2026 com **Evolution API 2.3.7 / Baileys rc.9 exatamente como o nosso**, descreve o mesmo quadro: o WhatsApp passou a entregar status (stories) de contatos como stanza `<status>` de nível superior, o Baileys não tem handler para essa tag e nunca manda o ack, e ~50 min depois o servidor derruba o stream. `readStatus`/`shouldIgnoreJid` NÃO resolvem. A correção é registrar um handler `CB:status` que manda o ack (`class: 'status'`). Ela existe em forks e no whatsmeow, mas ainda NÃO foi incorporada ao Baileys upstream nem à Evolution.

### Cited Findings
- Issue #2858 (aberta em 14/10/2026, status Open, sem resposta de mantenedor): o WhatsApp às vezes entrega o status de um contato como stanza `<status>` de nível superior, e não como `<message from="status@broadcast">`. O Baileys não tem handler, então nunca manda o ack. Cerca de 50 min depois o servidor fecha o stream citando o ack pendente, e o Baileys mapeia isso para `badSession` (500). No reconnect o servidor reentrega o mesmo status e o ciclo se repete. — [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858)
- Dados do reporter em #2858: em 16 dias de uma conta, 335 stream errors desde 28/09/2026; 286 deles ocorreram **exatamente 50 min após abrir a conexão**; ~90 IDs de status distintos, a maioria `type="media"` (267) e o restante `type="text"` (68); o mesmo ID foi cobrado até 23 vezes seguidas. Outras 7 contas no mesmo build não foram afetadas, o que sugere rollout gradual do lado do servidor. `readStatus`/`shouldIgnoreJid` não fizeram diferença. — [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858)
- Ambiente do reporter: Baileys 7.0.0-rc.9 via **Evolution API 2.3.7**, Node 24. Ele também testou rc14 e o master (0af2386), e o bug continua neles. — [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858)
- Workaround do reporter: um listener `CB:status` que chama `sendMessageAck` com `class: 'status'`, preserva `type`, `participant` e `recipient` e não manda código de erro. Depois do deploy a conexão passou dos 50 min e os erros `class="status"` sumiram. Ele avisa que um NACK mantém a stanza pendente (ref. #2779). — [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858)
- O whatsmeow (Go) já trata a tag `status` com um ack simples desde o commit a238105488 (20/07/2026). — citado em [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858)
- Fork admin-nocnok/Baileys, PR #10 (merge em 08/10/2026): registra o handler `CB:status`. O ack sai com `id`, `to: status@broadcast`, `class: "status"`, `participant` e `type`, e a stanza é descartada sem decodificar. Medições do autor numa frota de 650 sessões em 48h: 214 eventos "stream errored out" com `ack class="status"`, 22 sessões afetadas, 33% dos fechamentos das 10 sessões que mais reconectavam. No canário os erros pararam, enquanto os nós sem o fix continuaram com eles. — [admin-nocnok/Baileys PR #10](https://github.com/admin-nocnok/Baileys/pull/10)
- Outro fork tem um commit "fix: ack do stanza <status> de topo" (erickythierry/WSocket, 0545280, 15/10/2026). — citado em [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858)
- Há bugs irmãos com o mesmo mecanismo de "ack pendente → derrubada": #1910 (`class="message"`, "Stream Errored (ack)" após envio de mídia, out/2025, só resolvido com novo QR) e #2450 (`class="receipt"`). — [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858); [Baileys #1910](https://github.com/WhiskeySockets/Baileys/issues/1910)
- Um bug separado (envio, não recebimento): `status@broadcast` é rejeitado com ack error=479 em contas migradas para LID. — [Baileys #2794](https://github.com/WhiskeySockets/Baileys/issues/2794)
- Issue #2249 (jan/2026, rc.9) trata de loops de 428 "Connection Closed" após horas de funcionamento. Os usuários relataram melhora ao **remover a linha `browser` customizada**, usar keepAliveIntervalMs 20000 e retryRequestDelayMs 5000 e adicionar `shouldIgnoreJid` para broadcast/newsletter/grupos. Relatos posteriores dizem que o problema voltou a ocorrer para alguns. Não houve resposta de mantenedor. — [Baileys #2249](https://github.com/WhiskeySockets/Baileys/issues/2249)

### Inferences
- O nosso sintoma (ack `class=status type=media`, período de ~50 min) bate 1:1 com #2858. É quase certamente o mesmo bug. O 428 que vemos depois deve ser o código do close/reconnect que a Evolution registra após o stream:error. Em #2858 o mapeamento citado foi 500/badSession; a diferença provavelmente está no wrapper de reconexão da Evolution, mas isso não foi verificado.
- Atualizar só o Baileys (rc14) ou só a Evolution (2.4.0-rc) NÃO corrige, porque o master do Baileys ainda não tem o handler. A correção prática hoje é um patch local: adicionar `ws.on('CB:status', node => sendMessageAck(node))` no `messages-recv` do Baileys dentro da imagem, via patch-package ou build próprio. A alternativa é esperar o merge upstream ou migrar para um engine baseado em whatsmeow.
- Mitigação parcial sem patch: a conta afetada é a que tem contatos postando status. Isso não pode ser desligado do lado do cliente, porque o servidor empurra o stanza de qualquer forma.

### Gaps
- Não há PR upstream nem merge no WhiskeySockets/Baileys até 17/10/2026, e não houve resposta de mantenedor.
- Não confirmei a linha exata da Evolution 2.3.7 que converte esse close em 428.

## 2. Versões da Evolution API depois da 2.3.7: vale atualizar? O que quebra?

### Takeaway
A v2.3.7 (5/dez/2025) continua sendo a última release ESTÁVEL. A 2.4.0 existe só como pre-release (rc1 de 6/mai/2026, rc2 de 17/mai/2026), e a rc1 traz um **breaking change: ativação de licença obrigatória** (endpoints retornam 503 `LICENSE_REQUIRED`). Nenhuma delas corrige o bug do `<status>`. Não recomendo atualizar para resolver estabilidade agora.

### Cited Findings
- Página de releases: v2.3.7 marcada como "Latest" (5/dez). 2.4.0-rc2 (17/mai/2026) é pre-release "for validation only, not for production". — [Evolution releases](https://github.com/evolution-foundation/evolution-api/releases)
- 2.4.0-rc1: **ativação de licença obrigatória**, com endpoints de negócio retornando 503 `LICENSE_REQUIRED` até a ativação. Também traz Manager v2, evento `messaging-history.set`, mapeamento LID↔telefone com cache e filtro de JID no `markMessageAsRead` (cobre broadcast). — [Evolution releases](https://github.com/evolution-foundation/evolution-api/releases)
- 2.4.0-rc2: contatos `@lid` deixam de falhar no `onWhatsApp` (que causava erros de envio/presence) e há auto-ativação de licença headless via variável de ambiente. — [Evolution releases](https://github.com/evolution-foundation/evolution-api/releases)
- Itens da v2.3.7 relevantes para estabilidade: eventos de mensagem recebida corrigidos após reconnect; chaves de auth no Redis removidas no logout e chaves velhas não recarregadas no reconnect; correção do "waiting for message"; upload de mídia via proxy corrigido (agente compatível com Undici); Baileys 7.0.0-rc.9. — [Evolution releases](https://github.com/evolution-foundation/evolution-api/releases)
- v2.3.2 adicionou proxy SOCKS. v2.3.1 **removeu `CONFIG_SESSION_PHONE_VERSION`**. Desde a v2.3.0 a versão mais recente do WhatsApp Web é detectada automaticamente quando a variável não está definida. — [Evolution releases](https://github.com/evolution-foundation/evolution-api/releases)
- Nas notas visíveis não há nada sobre nome do dispositivo/browser nem sobre tratamento de 428/440/401. — [Evolution releases](https://github.com/evolution-foundation/evolution-api/releases)
- Issue conhecido na 2.3.7: botões/listas falham com "this.isZero is not a function" (funcionavam na 2.3.6). — [Evolution #2390](https://github.com/evolution-foundation/evolution-api/issues/2390)
- Releases do Baileys: a última é v7.0.0-rc14 (29/07/2026). rc10 (06/05/2026) trouxe "Fix connection deadlocks", correções de memory leak, "Proper ack handling", mapeamentos LID↔PN e tratamento do erro 463 ("Reachout Timelock"). rc12 é patch de segurança (GHSA-qvv5-jq5g-4cgg). rc13 corrige regressão do `fromMe`. Ainda não existe 7.0.0 final. — [Baileys releases](https://github.com/WhiskeySockets/Baileys/releases)
- Evolution Go: implementação em Go sobre whatsmeow, da Evolution Foundation (Apache 2.0 com condições de marca). Também exige ativação de licença (503 até ativar), usa `.env` próprio e não declara compatibilidade drop-in com os endpoints da v2. — [evolution-go](https://github.com/evolution-foundation/evolution-go)

### Inferences
- A 2.3.7 roda Baileys rc.9 (nov/2025). Ela não tem as correções de deadlock/ack/LID/463 da rc10+ nem o patch de segurança da rc12. Um caminho intermediário seria fazer o build da 2.3.7 com Baileys rc14 + patch `CB:status`, mas isso não foi testado e o risco de incompatibilidade de API é real.
- Atualizar para 2.4.0-rc implica licença e pre-release em produção. Não é recomendável até sair uma versão estável.

### Gaps
- Não encontrei changelog completo da 2.4.0 (notas truncadas) nem data prevista de release estável.
- A versão atual do Evolution Go e a paridade de features dele não foram verificadas.

## 3. CONFIG_SESSION_PHONE_CLIENT / NAME / VERSION: valores recomendados e efeito em ban

### Takeaway
Os defaults (`CLIENT=Evolution API`, `NAME=Chrome`) fazem o aparelho listar "Evolution API" em Aparelhos conectados, o que é um fingerprint explícito para o dono do número e não ajuda em nada. `CONFIG_SESSION_PHONE_VERSION` foi removida na 2.3.1 (a versão é detectada automaticamente). Não achei evidência primária de que o tuple de browser cause ban. A única evidência empírica (#2249) é de que um browser customizado/incoerente piorou loops de 428.

### Cited Findings
- `.env.example` da Evolution: `CONFIG_SESSION_PHONE_CLIENT=Evolution API` ("Name that will be displayed on smartphone connection") e `CONFIG_SESSION_PHONE_NAME=Chrome` ("Browser Name = Chrome | Firefox | Edge | Opera | Safari"). O comentário "Whatsapp Web version for baileys channel" aparece sem variável abaixo dele. — [.env.example](https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/.env.example)
- Presets do Baileys (`[OS, Browser, Version]`): `ubuntu` → `['Ubuntu', b, '22.04.4']`; `macOS` → `['Mac OS', b, '14.4.1']` (default do Baileys é `Browsers.macOS('Chrome')`); `windows` → `['Windows', b, '10.0.22631']`; `baileys` → `['Baileys', b, '6.5.0']`; `appropriate` usa o SO atual (em Linux vira Ubuntu). A doc recomenda manter o mesmo browser entre reconexões e diz que configurações "Desktop" recebem mais histórico. — [Baileys Browsers docs (mirror)](https://mintlify.wiki/whiskeysockets/Baileys/api/browsers)
- Em #2249, a config que estabilizou os loops de 428 incluía "remove browser line" (o browser customizado era `["Chrome","Windows","124.0.6367.207"]`), e o usuário diz que essa foi a mudança-chave. Isso é relato de usuário, sem confirmação de mantenedor. — [Baileys #2249](https://github.com/WhiskeySockets/Baileys/issues/2249)
- `CONFIG_SESSION_PHONE_VERSION` foi removida na v2.3.1, e a versão é auto-detectada (v2.3.0). — [Evolution releases](https://github.com/evolution-foundation/evolution-api/releases)

### Inferences
- Pelo que conheço do código da Evolution (não verificado nesta pesquisa), o tuple é montado como `[CLIENT, NAME, os.release()]`. É por isso que aparece o kernel Linux como "versão". Isso cria uma combinação incoerente ("Evolution API" como SO + Chrome + versão de kernel Linux). Uma escolha mais coerente seria `CLIENT=Mac OS` (ou `Windows`) com `NAME=Chrome` (ou `Desktop`), mas a versão continuaria sendo o kernel do container, a não ser que se aplique um patch no código. Isso é especulação a ser confirmada no fonte (`whatsapp.baileys.service.ts`, procurar `browser:`).
- O browser é enviado no pareamento. Mudar a variável provavelmente só afeta sessões novas ou repareadas. Sessões já pareadas mantêm o nome registrado no celular. Isso não foi confirmado em fonte, e trocar o browser de uma sessão existente pode até provocar instabilidade (cf. "keep same browser name across reconnections").
- Não há evidência sólida de que o nome "Evolution API" cause ban. O ganho é discrição e coerência, não uma redução comprovada de ban.

### Gaps
- Não encontrei fonte oficial (Meta ou mantenedor) ligando o tuple de browser a ban.
- Não confirmei se a Evolution permite sobrescrever a "versão" do tuple.

## 4. Códigos DisconnectReason: significado e quais reconectar

### Takeaway
401 (loggedOut) nunca deve reconectar: é preciso limpar a sessão e parear de novo. 440 (connectionReplaced) indica outra sessão com as mesmas credenciais, e reconectar automaticamente gera ping-pong entre as instâncias, então a regra é não reconectar sem intervenção (bate com a causa dos nossos banimentos). 428, 408, 503 e 515 reconectam, com backoff e limite. 500 (badSession) pode exigir re-auth, mas no bug do `<status>` é falso positivo.

### Cited Findings
- Tabela (mirror da doc do Baileys): 401 `loggedOut` → "Do NOT reconnect"; 428 `connectionClosed` → reconectar; 408 `connectionLost`/`timedOut` → reconectar/retry; 440 `connectionReplaced` → "Another device took over. Reconnect carefully"; 515 `restartRequired` → reconectar imediatamente; 500 `badSession` → pode exigir re-autenticação; 411 `multideviceMismatch` → atualizar a lib; 403 `forbidden` → acesso negado; 503 `unavailableService` → tentar mais tarde. — [Baileys connection docs (mirror)](https://mintlify.wiki/whiskeysockets/Baileys/concepts/connection)
- `markOnlineOnConnect: true` faz o celular não receber notificações enquanto o Baileys está conectado. — [Baileys connection docs (mirror)](https://mintlify.wiki/whiskeysockets/Baileys/concepts/connection)
- Relato de terceiros (Hermes Agent): loops 428/503 com `/health` reportando "connected" nas janelas curtas e perda silenciosa de mensagens. A correção foi deixar closes que não são loggedOut seguirem o caminho normal de reconnect mantendo as credenciais. — [hermes-agent #63277](https://github.com/NousResearch/hermes-agent/issues/63277)
- Um close 500 "Stream Errored (ack)" tratado como sessão não pareada bloqueava o reconnect. A correção foi checar `creds.me` em vez de `creds.registered`. — [resenhazord2 PR #192](https://github.com/sandrosmarzaro/resenhazord2/pull/192)
- #1625: sessões caindo com 428 a cada ~24h com multi-file auth state, terminando em logout e limpeza de credenciais. — [Baileys #1625](https://github.com/WhiskeySockets/Baileys/issues/1625)
- #2095: depois da rc.8, conexões novas não conseguiam enviar e recebiam 428. Voltar para a rc.6 resolveu. — [Baileys #2095](https://github.com/WhiskeySockets/Baileys/issues/2095)
- rc10 do Baileys: tratamento do erro 463 ("Reachout Timelock", limite de contato com desconhecidos) e menção a "random logouts" entre os problemas enfrentados. — [Baileys releases](https://github.com/WhiskeySockets/Baileys/releases)

### Inferences
- Política sugerida para o CRM: 401 → marcar a instância como deslogada, sem retry, alertar. 440 → parar o retry e alertar "número conectado em outro lugar", porque reconectar derruba a outra sessão e o loop aumenta o risco. 428/408/503/515 → retry com backoff exponencial + jitter e limite por hora. 500 → retry limitado antes de exigir novo pareamento.
- O 401 logo após envios em número novo é coerente com remoção do dispositivo pelo servidor (restrição/ban de número novo enviando para desconhecidos). O 463 (reachout timelock) da rc10 indica que o WhatsApp tem um mecanismo explícito de limitar contato inicial de contas novas, e a rc.9 da Evolution 2.3.7 não trata esse erro. Isso é inferência, sem fonte direta sobre o 401.

### Gaps
- Não achei issue específica de "401 após envio em número novo" em 2025-2026, porque a busca não retornou resultados relevantes.

## 5. Outras configurações anti-ban (Baileys/Evolution)

### Takeaway
Há pouca evidência primária. Os consensos são: `markOnlineOnConnect=false`, não sincronizar histórico completo, manter o browser estável, ignorar broadcast/newsletter quando não forem necessários, e principalmente o padrão de uso (taxa de envio, proporção de respostas, IP). Fixar manualmente a versão do WA Web não é mais possível nem recomendado na Evolution ≥2.3.1.

### Cited Findings
- Config relatada como estável em #2249: sem `browser` customizado, `keepAliveIntervalMs: 20000`, `retryRequestDelayMs: 5000`, `shouldIgnoreJid` filtrando broadcast, newsletter, Meta AI e grupos. — [Baileys #2249](https://github.com/WhiskeySockets/Baileys/issues/2249)
- `markOnlineOnConnect: true` suprime as notificações no celular. — [Baileys connection docs (mirror)](https://mintlify.wiki/whiskeysockets/Baileys/concepts/connection)
- A versão do WA Web é auto-detectada na Evolution ≥2.3.0, e a variável de versão foi removida na 2.3.1. — [Evolution releases](https://github.com/evolution-foundation/evolution-api/releases)
- Blogs de fornecedores (fonte secundária, não verificada) citam como sinais de detecção: baixa taxa de resposta, mensagens para desconhecidos distantes no grafo, timing robótico, IP de datacenter/VPS e mensagens sem resposta em 48h numa janela de 30 dias. — [adviseai.in](https://www.adviseai.in/blog/whatsapp-automation-ban-risk); [openclaw-easy](https://openclaw-easy.com/blog/whatsapp-ai-bot-ban-risk.html)
- Middleware comunitário baileys-antiban: rate limit com jitter gaussiano, warmup de 7 dias e monitoramento de saúde da sessão. Projeto autopublicado, sem validação independente. — [kobie3717/baileys-antiban](https://github.com/kobie3717/baileys-antiban)

### Inferences
- Na Evolution, os equivalentes por instância são: `alwaysOnline=false`, `readMessages` moderado, `readStatus=false` (não resolve o bug #2858, mas evita tráfego desnecessário), `groupsIgnore=true` para números de disparo e `syncFullHistory=false`. Esses mapeamentos vêm do conhecimento da API da Evolution e não foram reverificados nesta pesquisa.
- Não achei fonte sobre `fireInitQueries`, `emitOwnEvents` ou `generateHighQualityLinkPreview` afetarem ban.

### Gaps
- Não há dados oficiais de efeito de cada flag sobre ban.

## 6. A Meta detecta o Baileys especificamente? Alternativas (whatsmeow, Evolution Go, WAHA)

### Takeaway
Não encontrei anúncio ou evidência primária de detecção específica do Baileys em 2025-2026. As alegações vêm de blogs. Há evidência indireta de que o servidor mudou o protocolo (stanza `<status>`, mudanças de node na rc13, 463) e de que o whatsmeow acompanha essas mudanças mais rápido: o handler de `status` entrou no whatsmeow em jul/2026, e no Baileys ainda não entrou até out/2026. Um cliente que não responde (ack) a stanzas novas é, em tese, distinguível do cliente oficial (especulação).

### Cited Findings
- whatsmeow tratou a tag `status` em jul/2026 (commit a238105488), e o Baileys ainda não tratou. — [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858)
- A rc13 do Baileys corrigiu uma regressão causada porque "WhatsApp changed node behavior". — [Baileys releases](https://github.com/WhiskeySockets/Baileys/releases)
- Engines do WAHA: WEBJS/WPP (Puppeteer com WhatsApp Web real; a doc diz que isso ajuda "to avoid getting blocked", ao custo de CPU/RAM), NOWEB (Node/WebSocket, mais leve) e GOWS (Go/WebSocket, "future replacement for NOWEB"). — [WAHA engines](https://waha.devlike.pro/docs/how-to/engines/)
- Evolution Go usa whatsmeow e exige licença. — [evolution-go](https://github.com/evolution-foundation/evolution-go)
- Fontes secundárias afirmam que o WhatsApp faz fingerprint de como o cliente fala o protocolo e que bans de clientes não oficiais são permanentes. Não há confirmação oficial, e as estatísticas citadas (ex.: "2-8 semanas até detecção") não são verificáveis. — [adviseai.in](https://www.adviseai.in/blog/whatsapp-automation-ban-risk); [whatsapp.checkleaked.cc](https://whatsapp.checkleaked.cc/blog/what-is-baileys)

### Inferences
- Para estabilidade de protocolo, engines baseados em whatsmeow (Evolution Go, WAHA GOWS) parecem acompanhar mudanças do servidor mais rápido. Para minimizar o fingerprint, engines com navegador real (WAHA WEBJS/WPP) são, em teoria, os mais parecidos com o cliente oficial. Nenhum dos dois tem dados públicos comparativos de taxa de ban.
- A única forma sem risco de ban é a Cloud API oficial da Meta. A Evolution 2.3.7 já tem endpoints de template Meta.

### Gaps
- Não há estudo comparativo de taxa de ban entre Baileys, whatsmeow e WebJS.
- Não há posição oficial da Meta sobre detecção de bibliotecas específicas.
