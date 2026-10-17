# Ferramentas de maturação/aquecimento de chip e APIs não oficiais de WhatsApp (2025-2026, foco Brasil)

Pesquisa feita em 2026-10-17. As fontes são quase todas de fornecedores (páginas de venda, blogs de concorrentes, docs de produto). Não achei medição independente de taxa de ban para nenhuma ferramenta. Tudo que é "resultado declarado" é autodeclarado.

## 1. Ferramentas dedicadas de maturação/aquecimento no Brasil (2025-2026): como funcionam, preço, resultados declarados

### Takeaway
O mercado brasileiro tem três tipos de produto: (a) SaaS na nuvem com conversa chip-a-chip, grupos, status e às vezes um "pool comunitário" entre clientes (ChipFlow, ProtectZap, MaturaGo); (b) softwares desktop/licença para Windows (WaHammer, Maturador QSM, Aquecedor Pro/Auto Robôs, Super Maturador/Multsender); (c) projetos open source que automatizam o WhatsApp Web. Todos prometem cerca de 2 semanas de maturação e nenhum garante proteção contra ban. Os próprios ChipFlow e ProtectZap dizem por escrito que o bloqueio é decisão da Meta.

### Cited Findings
**SaaS na nuvem**
- **ChipFlow** (chipflow.com.br): conversas geradas por IA generativa "em vez de scripts repetidos", áudios com 6 vozes neurais, conversas P2P entre os chips do próprio cliente, status diários e entrada automática em grupos. O painel mostra "Fase 1 de 4 · Entrando em grupos" e progresso do dia 1 ao dia 15. O ritmo se adapta à idade do chip, começando mais lento. Roda na nuvem 24h, reconecta sozinho e lista "Proxy / proteção de IP" sem detalhar. A página não menciona pool compartilhado entre clientes. — [ChipFlow](https://chipflow.com.br/)
- Planos mensais do ChipFlow: Starter R$ 74,98 (até 10 chips), Pro R$ 119,98 (20), Elite R$ 224,98 (50), Escala R$ 399,00 (100), Escala Elite R$ 787,99 (200). A tabela de preços é confusa e também mostra "a partir de $18.33". Resultados declarados: "~98% dos números sem bloqueio", cerca de 2 semanas para maturar, "2.551 WhatsApps ativos" e "170.844 conversas" (sem data). A página diz que não garante contra bloqueio. — [ChipFlow](https://chipflow.com.br/)
- **ProtectZap** (protectzap.com.br): aquecimento gradual que começa com "poucas mensagens por dia" e leva cerca de 2 semanas (FAQ: ~15 dias). Modos: grupos exclusivos; status (o cliente sobe fotos e vídeos e o sistema posta); conversas privadas entre os chips do cliente, que salvam os contatos uns dos outros; e **modo Comunidade**, em que o chip conversa com chips de outros clientes e o número fica salvo "em centenas de outros WhatsApps". São mais de 8 tipos de conteúdo (áudio, imagem, vídeo, figurinha, documento, contato, PDF, planilha). Usa proxy para "mascarar seu IP". Não menciona IA. Afirma "2.000+ mensagens por chip com aquecimento completo". — [ProtectZap](https://www.protectzap.com.br/)
- Preços do ProtectZap: Básico R$ 49/mês (1 número), Pro R$ 99 (até 5), Pro+ R$ 149 (10 números, com API/webhooks/MCP e velocidade ajustável), R$ 11/mês por número extra e Enterprise acima de 50. Tem conta grátis para começar. O FAQ diz que **não garante** proteção contra bloqueio. — [ProtectZap](https://www.protectzap.com.br/)
- **MaturaGo!** (maturago.com.br): modelo "em comunidade de forma colaborativa", em que usuários aquecem os chips uns dos outros. Conecta por QR, oferece modo privado, grupos ou ambos, e envia texto, imagem, áudio, vídeo, PDF, GIF, figurinha, enquete, localização, contato e stories. Salva o contato antes de enviar. Limite de mensagens e delays são configuráveis por instância, com agendamento de início e pausa e **proxy individual por instância**. Não informa fases nem volumes padrão. — [MaturaGo](https://maturago.com.br/)
- Preços do MaturaGo (30 dias): 1 instância R$ 9,90; 10 por R$ 49,90; 50 por R$ 149,90; 100/200/300 por R$ 249,90/349,90/449,90. Há planos de 15 dias mais baratos. Pagamento por PIX ou cartão via InfinitePay. Não há resultado medido, os contadores ao vivo aparecem zerados e a "garantia" aparece como "0 dias". — [MaturaGo](https://maturago.com.br/)

**Software desktop/licença**
- **WaHammer**: revendido em vários sites, com licença anual entre R$ 39,90 e R$ 45,90 conforme a revenda. Tem o recurso "Aquecedor de Grupos", em que duas ou mais contas do mesmo dono conversam num grupo comum. — [CiaSaaS](https://ciasaas.com/product/wahammer-aquecedor-maturador-de-chips-whatsapp/); [PayPay Mix](https://www.paypaymix.com/produto/aquecedor-maturador-de-chip-whatsapp/); [DFG](https://www.dfg.com.br/outros/maturador-de-chip-wahammer-aquecedor-de-contas-lic-anual-943460847)
- **Maturador de Chip (QSM Agência)**: programa para Windows com licença mensal de R$ 74,90 a R$ 197,00, uma instalação por licença. **Aquecedor Pro (Auto Robôs)**: planos de até 5 números (+R$ 49,99), até 10 (+R$ 147) e até 50 (+R$ 697). Dados tirados de snippet de busca e não verificados na página. — [QSM](https://qsmagencia.com.br/produto/maturador-chip-whatsapp/); [Auto Robôs](https://autorobos.net/produto/maturador-de-chip/)
- **Super Maturador de Chip 2026 (Multsender)**: construído sobre a base do MultiSender (disparador em massa) e vendido como forma de evitar bloqueios e prolongar a vida útil dos números. — [Multsender](https://multsender.com/super-maturador-de-chip-2026-aquecimento-de-whatsapp-profissional/)
- O Mercado Livre também vende o serviço "aquecedor/maturador de chip – 1 mês". — [Mercado Livre](https://produto.mercadolivre.com.br/MLB-3634740019-aquecedormaturador-de-chip-numeros-de-whatsapp-1-ms-_JM)

**Open source**
- **JonasCaetanoSz/maturador-de-chips** (GitHub, 35 estrelas): app desktop em Python/PyQt5 que automatiza o WhatsApp Web via Selenium com um `injected.js`, sem Baileys. Aquece por grupo e por mensagens privadas, com intervalo mínimo/máximo, troca de conta a cada X mensagens, parada automática quando ocorre bloqueio e mensagens opcionais geradas pelo ChatGPT. A tag `v30.07.2026` sugere release de julho/2026. — [GitHub](https://github.com/JonasCaetanoSz/maturador-de-chips)
- **emaworkdev/projeto-smc**: sincroniza dois perfis que conversam automaticamente com diálogos pré-gravados e postam status. — [GitHub](https://github.com/emaworkdev/projeto-smc)
- O gruposwhats.app lista vários grupos públicos de "maturador de chip" (comunidade de troca de mensagens). Não verifiquei. — [gruposwhats.app](https://gruposwhats.app/group/575776)

### Inferences
- Do ponto de vista técnico, as técnicas comuns são: conversa bilateral entre chips com conteúdo variado (texto, áudio, mídia), entrada em grupos, postagem de status, salvar contatos mutuamente e rampa de volume em cerca de 15 dias. O diferencial dos SaaS é o "pool comunitário" (ProtectZap Comunidade, MaturaGo), que faz o número conversar com contas de terceiros. Com só ~10 números de clientes diferentes, o CRM não conseguiria isso sozinho.
- Para um CRM com ~10 números, a referência de custo vai de ~R$ 50/mês para 10 instâncias (MaturaGo) a ~R$ 75-150/mês (ChipFlow/ProtectZap). Construir um maturador interno (chip-a-chip entre as instâncias Evolution existentes) replica só parte disso: falta o pool de terceiros. Há também o risco de todos os chips ficarem no mesmo IP da VPS.
- Nomes citados no pedido ("Maturador.pro", "ChipWarm", "Sendflow como maturador") não apareceram nas buscas como produtos de maturação ativos em 2026. Ver Gaps.

### Gaps
- Não encontrei Maturador.pro nem ChipWarm. O Sendflow não apareceu como maturador. Não confirmei se existem ou se estão ativos.
- Nenhum fornecedor publica o motor usado (Baileys, whatsmeow ou WhatsApp Web). Também não informam se o "pool comunitário" usa números reais de outros clientes ou números do próprio fornecedor.
- Não há dado independente sobre a taxa de ban após a maturação. O "98% sem bloqueio" do ChipFlow é autodeclarado e não tem metodologia.

## 2. Provedores de API não oficial: motor, recursos anti-ban, preço 2026, reputação

### Takeaway
Self-host gratuito: Evolution API (Baileys), Evolution Go (whatsmeow), WAHA (4 motores, agora gratuito). SaaS BR: Z-API R$ 99,99/instância, Mega API, WAME, ZAP-API etc. SaaS internacional: Whapi.Cloud US$ 29/número com módulo de warm-up, Green-API ~US$ 12/instância. **Atenção: a Evolution API a partir da 2.4.0 (rc, maio/2026) exige ativação de licença no servidor da Evolution Foundation**, e a v2.3.7 (Baileys 7.0.0-rc.9) ainda é a última "Latest". O Baileys 7.x continua em release candidate e tem issues abertas de 401 `device_removed` logo após o pareamento.

### Cited Findings
**Evolution API (Node, Baileys)**
- Linha 2.3.x: 2.3.0 (17/jun, Baileys 6.7.18); 2.3.2 (02/set, **SOCKS proxy adicionado**, Baileys 6.7.19); 2.3.3 (Baileys 7.0.0-rc.3); 2.3.5 (rc.5); 2.3.6 (21/out, rc.6); **2.3.7 (05/dez, Baileys 7.0.0-rc.9, correção de upload de mídia via proxy com agente Undici, correção de mensagens que paravam de chegar após reconexão)**. A página de releases não mostra o ano das 2.3.x, mas o CHANGELOG data a 2.3.0 em 2025-06-17. Nenhuma release menciona recurso anti-ban ou nome de browser. — [GitHub releases](https://github.com/evolution-foundation/evolution-api/releases); [CHANGELOG](https://github.com/EvolutionAPI/evolution-api/blob/main/CHANGELOG.md)
- **2.4.0-rc1 (06/mai/2026)**: breaking change. Toda instância precisa ser ativada no servidor de licenciamento da Evolution Foundation, e até lá os endpoints de negócio respondem 503 `LICENSE_REQUIRED`. Também traz Manager v2, carrossel, PIX e mapeamento LID→telefone. **2.4.0-rc2 (17/mai/2026)**: auto-ativação headless via `EVOLUTION_OPERATOR_EMAIL` e bypass de `onWhatsApp` para contatos `@lid`. As notas dizem "do not deploy to production". Não havia 2.4.0 final na página. — [GitHub releases](https://github.com/evolution-foundation/evolution-api/releases)
- Configuração de nome do dispositivo/browser via env: `CONFIG_SESSION_PHONE_CLIENT=Evolution API` e `CONFIG_SESSION_PHONE_NAME=Chrome`. A versão do WhatsApp Web (`CONFIG_SESSION_PHONE_VERSION`) fica comentada. Há proxy global via `PROXY_HOST/PORT/PROTOCOL/USERNAME/PASSWORD`. **Não há variável de rate limit/delay de envio** no .env.example. — [.env.example](https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/.env.example)
- **Evolution Go**: API em Go sobre **whatsmeow**, com REST/Swagger, WebSocket, webhooks, RabbitMQ, NATS e S3. Tem `CLIENT_NAME` (padrão `evolution`, "client identifier"). O README não menciona proxy por instância. **Exige licença**: a API retorna 503 até a ativação, e o README não diz se a licença é paga. Licença Apache 2.0 com cláusulas de marca. — [GitHub evolution-go](https://github.com/evolution-foundation/evolution-go)

**Baileys (WhiskeySockets)**
- O npm lista `7.0.0-rc14` como a mais recente. Segundo guia de 2026, a 7.x segue em RC e a 6.7.x é a linha estável. — [npm](https://www.npmjs.com/package/@whiskeysockets/baileys); [checkleaked](https://whatsapp.checkleaked.cc/blog/what-is-baileys)
- **Issue #2248** (aberta em 09/jan/2026, ainda aberta, último comentário em 26/ago/2026): o pareamento conclui e logo depois chega **401 `conflict: device_removed`**. Foram testados vários fingerprints de browser e vários números, e um login via Playwright/Chromium na mesma rede ficou estável. **Workaround único relatado: o IP da VPS estava em blacklist; o autor passou o tráfego por IP residencial (Raspberry Pi em casa via Tailscale) e esperou 24h antes de re-parear.** Em 13/ago/2026 outro usuário relatou 401 cerca de 1,4s após o login payload no **7.0.0-rc14**, enquanto a **6.7.23** completou o ciclo normalmente. Trocar a versão do WA, `passive:false` e o envelope de pareamento não resolveu. — [Baileys #2248](https://github.com/WhiskeySockets/Baileys/issues/2248)
- Na documentação do Baileys, 401 significa sessão invalidada/credenciais revogadas: não se deve reconectar. — [Baileys docs (mintlify)](https://whiskeysockets-baileys-94.mintlify.app/concepts/connection)
- Um issue do openclaw pede bump do Baileys 7.0.0-rc.9 para o master, porque há correções só no master, não lançadas. — [openclaw #10491](https://github.com/openclaw/openclaw/issues/10491)

**WAHA (devlikeapro)**
- Quatro motores: **WEBJS** (Puppeteer + WhatsApp Web, padrão), **WPP** (Puppeteer/WPPConnect), **NOWEB** (WebSocket, Node) e **GOWS** (WebSocket, Golang, futuro substituto do NOWEB). A doc avisa que respostas e webhooks diferem entre motores. — [WAHA engines](https://waha.devlike.pro/docs/how-to/engines/)
- **Proxy por sessão**: `config.proxy` (server/username/password) no `POST /api/sessions/`, ou proxy global via `WHATSAPP_PROXY_SERVER`. — [WAHA proxy](https://waha.devlike.pro/docs/how-to/proxy/)
- **WAHA agora é gratuito**. Há só um tier "Community" de apoio por US$ 5/mês (Patreon/Boosty/cripto). — [WAHA engines](https://waha.devlike.pro/docs/how-to/engines/); [WAHA proxy](https://waha.devlike.pro/docs/how-to/proxy/)

**SaaS brasileiros (preços em BRL; tabela da Wafly, que é parte interessada)**
- Z-API: Ultimate R$ 99,99/instância/mês; Partner a partir de R$ 89,99/instância (10+). Teste de 2 dias. Verificado em 26/09/2026. — [Wafly](https://wafly.com.br/comparativos/quanto-custa-api-whatsapp/); [Cubo Suite (28/08/2026, atualizado em 05/10/2026)](https://blog.cubosuite.com.br/z-api-guia-completo/)
- Z-API: conexão por QR (não oficial). O artigo da Cubo **não descreve nenhum recurso anti-ban**, diz que o suporte "pode reconectar, mas não recuperar número banido" e não confirma qual biblioteca usa. — [Cubo Suite](https://blog.cubosuite.com.br/z-api-guia-completo/)
- Mega API: Start R$ 69,90 (1 instância) / R$ 99,90 (3); Business R$ 99,90 (1 dedicada). ChatPro: R$ 199/mês (1 instância, 5.000 envios) ou R$ 0,04-0,14 por envio. WAME API: R$ 28,99 / 44 / 55. Zapster: a partir de R$ 47. ZAP-API: R$ 49 (1ª e 2ª instância) e R$ 29 (3ª em diante). Wafly: R$ 59,90 por número até 10. Uazapi: "valor a confirmar no checkout". Evolution self-host: VPS de ~US$ 6-7/mês. — [Wafly](https://wafly.com.br/comparativos/quanto-custa-api-whatsapp/)
- Uazapi LITE R$ 138 (até 100 dispositivos), segundo um concorrente. Não verificado na fonte oficial. — [ZapClaw](https://zapclaw.app/zapclaw-vs-uazapi.html)
- A doc oficial do uazapi não informa motor, proxy, nome de dispositivo nem anti-ban na página inicial. — [docs.uazapi.com](https://docs.uazapi.com/)
- Comentário no TabNews cita z-api.io a R$ 99/mês e evoapicloud.com a partir de ~R$ 110/mês, e menciona w-api.app como concorrente. Não encontrei preço oficial da W-API. — [TabNews](https://www.tabnews.com.br/ivanamato/450a2559-aada-4aab-a8b7-a0af43cb3315)

**SaaS internacionais**
- **Whapi.Cloud**: Sandbox grátis (150 msgs/dia, 1.000 requests/mês); Developer Premium US$ 29/mês por número (de US$ 40). **O Premium inclui o "Automatic number warming module".** A página de preço não informa motor nem proxy. — [Whapi pricing](https://whapi.cloud/price)
- Whapi e proxy: recomenda **proxy residencial por canal**, conectado **antes** de escanear o QR, com geolocalização igual à do número. Não vende mais proxy, indica AstroProxy e Infatica. Qualquer proxy residencial com acesso a web.whatsapp.com funciona. — [Whapi residential proxies](https://support.whapi.cloud/help-desk/blocking/using-residential-proxies-with-whapi.cloud)
- **Green-API**: cobrança por instância (cada instância paga o próprio plano). Business a ~US$ 12/mês segundo terceiros, 690 rublos/mês em artigo próprio de 2026. Plano Developer grátis. — [Green-API tariffs](https://green-api.com/en/docs/about-tariffs/); [SoftwareFinder](https://softwarefinder.com/sales-tools/green-api); [Green-API 2026 article](https://green-api.com/articles/en/how-much-is-whatsapp-business-api-worth-in-2026/)

**Reputação / risco (fontes BR, a maioria vendedora de API oficial)**
- Sinais de detecção citados: velocidade de envio não humana, intervalos fixos, vários números no mesmo IP, denúncias de spam. — [ProxyAds](https://proxyads.com/blog/whatsapp-api-oficial-vs-nao-oficial/)
- "40-60% das contas com APIs paralelas suspensas no 1º trimestre de 2026" vem de "estimativas da comunidade técnica", **sem fonte verificável**. — [Cubo Suite](https://blog.cubosuite.com.br/evolution-api-do-whatsapp-o-que-e-riscos-e-alternativa-oficial-2026/)

### Inferences
- O sintoma do CRM (401 loggedOut 1-2s após mensagem fria em número novo) coincide com o padrão da issue #2248. As duas hipóteses mais sustentadas pela comunidade são: (1) reputação do IP do datacenter da VPS, que a única correção relatada resolveu com IP residencial mais 24h de espera; (2) regressão no Baileys 7.0.0-rc (rc14 falha onde a 6.7.23 funciona). A Evolution 2.3.7 roda rc.9. Isso indica que o problema não é só "falta de maturação". Hipótese, não confirmada.
- A Evolution 2.3.7 já tem proxy (SOCKS desde a 2.3.2, correção de mídia via proxy na 2.3.7) e nome de cliente/browser configurável por env (`CONFIG_SESSION_PHONE_CLIENT/NAME`). Conhecimento prévio, não reconfirmado nesta sessão porque a página de doc deu 404: a v2 tem proxy **por instância** via endpoint `/proxy/set/{instance}` e campo `proxy` na criação da instância. Vale conferir no código local.
- Atualizar para a Evolution 2.4 traz dependência de licença externa (503 até ativar). É um risco operacional a pesar antes de qualquer upgrade.
- O WAHA (gratuito, proxy por sessão, motor GOWS/whatsmeow ou WEBJS com browser real) é a alternativa self-host mais flexível para testar motor diferente do Baileys.

### Gaps
- Não obtive páginas oficiais de preço e recursos de W-API, uazapi/uazapiGO (motor whatsmeow não confirmado), UltraMsg, Maytapi e WPPConnect. Não há dado de 2026 confirmado para esses.
- Não existem taxas de ban publicadas por provedor. Reclame Aqui não foi consultado.
- Não confirmei se Z-API usa Baileys (o artigo "Z-API usa Baileys?" da Cubo não foi lido).

## 3. Guias de warm-up da Green-API e da Whapi.Cloud: cronogramas e volumes exatos

### Takeaway
A Green-API pede no mínimo 10 dias: esperar 24h antes de conectar, só receber nos dias 2-4 (1 msg a cada ~2h), começar a responder no dia 4 e subir de 12 para 100 msgs/dia até o dia 7, com "sinal verde" após 25-30 dias. A Whapi fala em 3-10 dias: esperar algumas horas antes do QR, ter 20-50 contatos na agenda, usar proxy residencial dedicado, no máximo 2 msgs/min, 6h de atividade/dia e 3 dias consecutivos para iniciantes. A Whapi oferece módulo automático de aquecimento mútuo entre números, com pausa inicial maior que 30 min.

### Cited Findings
**Green-API**
- **Dia 1:** registrar o número e **esperar 24h antes de conectar a instância/web**. Preencher foto e nome e adicionar alguns contatos. — [Green-API FAQ](https://green-api.com/en/docs/faq/warming-up-whatsapp-number/)
- **Dias 2-4:** outras contas mandam mensagem para o número, idealmente contatos diferentes, **~1 mensagem recebida a cada 2h**, variando texto, voz e mídia. — [Green-API FAQ](https://green-api.com/en/docs/faq/warming-up-whatsapp-number/)
- **Dia 4:** começar a responder, ~1 enviada a cada 2h, **só para números salvos nos contatos**, com texto natural e não templado. — [Green-API FAQ](https://green-api.com/en/docs/faq/warming-up-whatsapp-number/)
- **Dias 5-10:** subir gradualmente para **12-100 msgs/dia até o dia 7**, adicionar contatos, criar 1-2 grupos pequenos de 3-5 pessoas e fazer chamadas de voz e vídeo periódicas. — [Green-API FAQ](https://green-api.com/en/docs/faq/warming-up-whatsapp-number/)
- **Após 10 dias** o número fica "significativamente mais resistente". **Após 25-30 dias** sem atividade suspeita vem o "sinal verde", mas dispositivos vinculados ainda podem ser desconectados. **Depois de um bloqueio o aquecimento zera.** — [Green-API FAQ](https://green-api.com/en/docs/faq/warming-up-whatsapp-number/)
- Regras: não mandar mensagens idênticas a pessoas diferentes, não adicionar muitos contatos de uma vez, variar horários e tipos de conteúdo, não fazer envio em massa antes de aquecer. Sinais de alerta: atraso de mensagens, limite em grupos, desconexão do dispositivo vinculado, pedidos repetidos de QR. Reação recomendada: reduzir volume, desligar web/desktop por 24-48h e usar só para conversas pessoais por 2-3 dias. A página não tem data. — [Green-API FAQ](https://green-api.com/en/docs/faq/warming-up-whatsapp-number/)

**Whapi.Cloud**
- **Não escanear o QR logo após registrar**: esperar "algumas horas ou mais" (na página getting-started, "um dia ou um pouco mais"). — [Whapi warm-up](https://support.whapi.cloud/help-desk/blocking/warming-up-new-phone-numbers-for-whatsapp-api); [Whapi getting started](https://support.whapi.cloud/help-desk/getting-started/getting-started)
- **Dia 0:** perfil completo, **20-50 contatos na agenda** (agenda vazia é fator de risco), 1-2 mensagens manuais com resposta e, idealmente, **proxy dedicado com o mesmo país/cidade do telefone**. **Dia 1:** 3-6 chats privados pelo celular, algumas mensagens variadas via API e troca de mídia. **Dia 2:** 10-15 chats, ~1 msg/min, respondendo às recebidas. **Dia 3:** mais conversas, entrar em grupos, mensagens com link e textos longos, **mantendo enviadas ≈ recebidas**, e começar outreach gradual. **Dia 4+:** grupos, status, canais e comunidades. — [Whapi warm-up](https://support.whapi.cloud/help-desk/blocking/warming-up-new-phone-numbers-for-whatsapp-api)
- **Limites para iniciantes:** no máximo **2 msgs/minuto**, **6h de atividade/dia** e **3 dias consecutivos de atividade**. Salvar o número como contato (dá para fazer via API) antes de mandar mensagem. Espalhar interações de forma aleatória ao longo do dia. — [Whapi warm-up](https://support.whapi.cloud/help-desk/blocking/warming-up-new-phone-numbers-for-whatsapp-api)
- **Módulo automático:** conecta 2 ou mais números que trocam mensagens entre si. O timer de pausa entre atividades deve começar **acima de 30 min** para números novos e cair dia a dia. Exige um canal pago, e o segundo pode ser Sandbox grátis. Não informa volumes nem duração. — [Whapi auto warm-up](https://support.whapi.cloud/help-desk/tools/automatic-warm-up-module)
- O celular precisa abrir o app pelo menos 1 vez a cada 14 dias. A Whapi diz que o comportamento, não o uso de API, é o principal fator de risco. — [Whapi getting started](https://support.whapi.cloud/help-desk/getting-started/getting-started)

**Outras referências de cronograma (para comparar)**
- Radist: 25-30 dias. Número com menos de 24h de registro não deve ser conectado, e número parado há mais de 7 dias precisa de 2-3 dias de conversa antes. — [Radist](https://docs.radist.online/en/our-products/whatsapp/whatsapp-number-warm-up/)
- Guia BR (automacaohoje, 18/07/2026), com números "empíricos da comunidade Evolution": dias 1-3 com 10-30 msgs/dia só para quem tende a responder; dias 4-7 com 30-80; depois 150-200/dia; **≤30 msgs/hora**; **delay aleatório de 45-120s**; taxa de resposta acima de 30%; variar texto. Diz que "50+ msgs/dia em número novo aciona revisão", sem fonte. — [Automação Hoje](https://automacaohoje.com/guias/evolution-api-banimento-como-evitar/)
- WhatsGW (2025, antigo): dias 1-3 até 20 msgs/dia, dias 4-7 até 50, sem links e arquivos nos primeiros dias. — [WhatsGW](https://whatsgw.com.br/2025/04/23/como-aquecer-e-maturar-um-chip-para-disparos-no-whatsapp-com-seguranca/)

### Inferences
- As duas referências concordam que **mensagem fria para não-contato na primeira semana é o comportamento de maior risco**. A Green-API só permite enviar a partir do dia 4 e apenas para contatos salvos. A Whapi só libera outreach gradual no dia 3. Um número novo que conecta na Evolution e dispara campanha fria no mesmo dia viola os dois guias ao mesmo tempo, além da regra "esperar 24h antes de conectar".
- Parâmetros concretos para o CRM: espera mínima de 24h após o registro; 3 dias só recebendo; envio apenas para contatos salvos até o dia 7; rampa de 12 para 100/dia; ≤2/min; pausas de 30 min ou mais no aquecimento automático.

### Gaps
- Nenhum dos guias tem data de publicação visível. A Green-API não diz se os "12-100" são por dia total.
- Nenhum dos dois apresenta dados de eficácia.

## 4. Quem suporta proxy por instância e nome de dispositivo/browser customizado nativamente

### Takeaway
Confirmado nesta pesquisa: proxy por instância/sessão em WAHA (`config.proxy`), Whapi (por canal, residencial, antes do QR) e MaturaGo (por instância). A Evolution API tem proxy (SOCKS desde a 2.3.2) e nome de cliente/browser por env global (`CONFIG_SESSION_PHONE_CLIENT/NAME`). Nome de dispositivo customizado só foi confirmado na Evolution (global) e, de forma ambígua, na Evolution Go (`CLIENT_NAME`).

### Cited Findings
- WAHA: proxy por sessão via `config.proxy` ou global via env. A página não trata de nome de dispositivo. — [WAHA proxy](https://waha.devlike.pro/docs/how-to/proxy/)
- Whapi: proxy residencial por canal, ligado antes do QR e com geolocalização igual à do número. — [Whapi residential proxies](https://support.whapi.cloud/help-desk/blocking/using-residential-proxies-with-whapi.cloud)
- Evolution API: env `CONFIG_SESSION_PHONE_CLIENT=Evolution API` e `CONFIG_SESSION_PHONE_NAME=Chrome`; proxy global `PROXY_*`; SOCKS na 2.3.2; correção de mídia via proxy na 2.3.7. — [.env.example](https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/.env.example); [releases](https://github.com/evolution-foundation/evolution-api/releases)
- Evolution Go: `CLIENT_NAME` (default `evolution`), sem menção a proxy por instância. — [evolution-go](https://github.com/evolution-foundation/evolution-go)
- Projeto Go multi-sessão baseado em whatsmeow tem `POST /devices/me/proxy` (proxy por dispositivo que sobrescreve o global `WHATSAPP_CLIENT_PROXY_URL`). Mostra que proxy por sessão é trivial em whatsmeow. — [bump.sh go-whatsapp-multi-session](https://bump.sh/gdbrns/doc/go-whatsapp-multi-session-rest/operation/operation-post-devices-me-proxy)
- MaturaGo: proxy individual por instância. ProtectZap e ChipFlow: "proxy/proteção de IP", sem detalhe. — [MaturaGo](https://maturago.com.br/); [ProtectZap](https://www.protectzap.com.br/); [ChipFlow](https://chipflow.com.br/)

### Inferences
- Com `CONFIG_SESSION_PHONE_CLIENT=Evolution API` como padrão, todo dispositivo vinculado aparece no celular com o nome "Evolution API". Esse identificador é público e associado a automação. Trocar por um nome comum (ex.: "Chrome"/"Windows") é barato. Não há evidência de que a Meta use esse campo, então é hipótese.

### Gaps
- Não confirmei proxy por instância e nome de dispositivo em Z-API, W-API, uazapi, Green-API, UltraMsg, Maytapi e WPPConnect.
- Não reconfirmei nesta sessão o endpoint de proxy por instância da Evolution v2 (a doc deu 404).

## 5. O que comunidades brasileiras dizem sobre o que reduz ban em 2026

### Takeaway
Não encontrei relatos independentes e verificáveis (fóruns, Telegram, YouTube) com dados. O conteúdo indexado é dominado por vendedores de maturador (que dizem "funciona") e de API oficial (que dizem "nada garante"). O ponto em comum: consentimento/opt-in, volume gradual, intervalos aleatórios e evitar vários números no mesmo IP. O único relato técnico concreto sobre 401 logo após conectar aponta reputação de IP da VPS.

### Cited Findings
- Chatsac (25/07/2026, vendedor de API oficial): "nenhuma rotina de aquecimento, troca de chip ou configuração torna uma conta imune a bloqueio". Os fatores reais seriam denúncias de spam, qualidade, **consentimento (contato sem opt-in é o gatilho mais comum)** e cumprimento de política. — [Chatsac](https://chatsac.com/blog/aquecer-chip-whatsapp-business/)
- Automação Hoje (18/07/2026): a Meta "endureceu a detecção" em 2026; há relatos de ban em nível de IMEI, que afeta número novo no mesmo aparelho; rotação de IP é "técnica do passado, pouco confiável em 2026". Cita Hora de Codar e Wehsoft como fontes. — [Automação Hoje](https://automacaohoje.com/guias/evolution-api-banimento-como-evitar/)
- ProxyAds: vários números no mesmo IP aparecem entre os sinais de detecção. — [ProxyAds](https://proxyads.com/blog/whatsapp-api-oficial-vs-nao-oficial/)
- Relato técnico de 2026 (Baileys #2248): IP de VPS em blacklist causava 401 `device_removed`, resolvido com IP residencial mais 24h. — [Baileys #2248](https://github.com/WhiskeySockets/Baileys/issues/2248)
- Os blu.direct sobre "grupos de WhatsApp para aquecer chips" tratam grupos de aquecimento como "essenciais", mas é blog de quem vende disparo. — [blu.direct](https://blu.direct/blog/grupos-de-whatsapp-para-aquecer-chips)

### Inferences
- Há contradição sobre proxy: Whapi e os SaaS de maturação recomendam proxy residencial, enquanto a Automação Hoje diz que rotação de IP não é mais confiável. Dá para conciliar: **IP residencial fixo por número** (e não rotação) é o que Whapi e a issue do Baileys sugerem.
- No caso do CRM, ~10 números de clientes diferentes saindo do mesmo IP de datacenter da VPS (147.93.9.172) somam dois fatores de risco citados: IP de datacenter e vários números no mesmo IP.

### Gaps
- Não consegui acessar Telegram nem descrições de vídeos do YouTube de 2026 com relatos de operadores. Os grupos do gruposwhats.app não foram verificados.
- Não há dado quantitativo independente de taxa de ban por ferramenta ou por estratégia.
