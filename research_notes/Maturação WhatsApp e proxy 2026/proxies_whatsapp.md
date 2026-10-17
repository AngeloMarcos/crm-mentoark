# Proxies para automação não oficial do WhatsApp (Baileys / Evolution API), 2025–2026, foco Brasil

> Nota geral sobre as fontes: quase todo o material público sobre "proxy para WhatsApp" é marketing de vendedores de proxy ou blog de afiliados. Não encontrei nenhum documento da Meta/WhatsApp sobre proxies, ASN ou várias contas por IP. As fontes de primeira mão (código da Evolution, docs da Whapi/Green-API, issues no GitHub) estão marcadas assim. Todo o resto deve ser tratado como consenso de praticantes, não como comportamento de detecção verificado. Data da pesquisa: 2026-10-17.

## 1. Residencial vs móvel 4G/5G vs ISP (residencial estático) vs datacenter: o que se recomenda e por quê

### Takeaway
O consenso dos praticantes em 2026: datacenter (como um IP de VPS) é o pior; móvel 4G/5G é o melhor para registrar e aquecer números novos (IPs CGNAT de operadora são compartilhados por muitos assinantes reais e custam caro de bloquear); ISP/residencial estático é a opção custo-benefício para operar números já aquecidos. Nada disso é confirmado pela Meta.

### Cited Findings
- O README do baileys-antiban (GitHub, projeto da comunidade) afirma que a detecção de ban do WhatsApp inclui "IP reputation scoring", que IPs de datacenter (VPS) são marcados e que proxies residenciais/4G resistem melhor. Nenhum dado é citado. — [kobie3717/baileys-antiban](https://github.com/kobie3717/baileys-antiban)
- A Proxy Brasil (vendedor BR, 21/04/2026) recomenda proxy dedicado, com IP fixo brasileiro de operadora/residencial em vez de datacenter, latência abaixo de 50 ms e uptime de 99% ou mais. Desaconselha proxy compartilhado. — [Proxy Brasil blog](https://www.proxybrasil.com/blog/proxy-para-whatsapp-apis)
- Um resumo de busca de um guia de vendedor BR diz que ASNs de datacenter (AWS, Google Cloud, DigitalOcean) são reconhecíveis pelo WhatsApp. — [todasolucao.com.br](https://todasolucao.com.br/blog/rotacionar-ips-evolution-api-proxy/) (alegação de vendedor; não consegui verificar)
- A ProxyUniverse (vendedor, 2026) divide por tarefa: proxy móvel só para registro e aquecimento ("a etapa mais sensível"); IPv4 dedicado ou residencial estático para contas Business já aquecidas; residencial rotativo só para tarefas paralelas (checagem de número, scraping). Justificativa: um IP de operadora é compartilhado via CGNAT por muitos assinantes reais, então bani-lo sai caro para a plataforma. — [ProxyUniverse](https://proxyuniverse.tech/en/blog/proxy-for-whatsapp)
- A Whapi.Cloud (provedor de API WhatsApp não oficial, help desk de primeira mão) recomenda proxies residenciais ("IPs de usuários reais") para fazer a sessão parecer um dispositivo real na região certa. Hoje ela não vende proxies; cita AstroProxy e Infatica como provedores que funcionaram para alguns clientes. — [Whapi help desk](https://support.whapi.cloud/help-desk/blocking/using-residential-proxies-with-whapi.cloud)
- A mesma Whapi diz que um proxy provavelmente é desnecessário para contas com mais de cerca de 1 ano, bots com poucas mensagens recebidas, uso de CRM só para atendimento ao cliente ou automação em velocidade humana. É útil para conectar contas novas com frequência, marketing ativo e automação em grande escala. — [Whapi help desk](https://support.whapi.cloud/help-desk/blocking/using-residential-proxies-with-whapi.cloud)
- A Coronium (vendedor de proxy móvel) diz que IPs móveis de Vivo/Claro/TIM ficam em pools CGNAT compartilhados com muitos usuários reais. — [Coronium Brazil](https://www.coronium.io/mobile-proxies/brazil)
- Vários rankings de vendedores (DriftProxy, Proxy-Cheap, ProxyCove) repetem a ordem móvel > residencial/ISP > datacenter para WhatsApp. — [DriftProxy](https://driftproxy.com/blog/best-proxies-for-whatsapp-2026); [Proxy-Cheap](https://www.proxy-cheap.com/integrations/proxies-for-whatsapp); [ProxyCove](https://proxycove.com/en/blog/proxy-whatsapp-business-api-massovaya-rassylka)

### Inferences
- Para este CRM (todos os números atrás de um único IP de datacenter da VPS), a mudança de maior impacto é tirar os números do IP do datacenter. O desenho de menor custo coerente com o consenso: ISP/residencial estático dedicado brasileiro por número em operação, e opcionalmente um proxy móvel 4G dedicado (sticky) para o pareamento e o aquecimento de números novos.
- O ponto de CGNAT tem dois lados. Um IP móvel já é compartilhado com muitos estranhos, o que é bom para a reputação, mas o IP pode mudar quando o modem reconecta (veja a seção 2).

### Gaps
- Nenhuma fonte primária (Meta, engenharia reversa, estudo controlado) mostra que o WhatsApp pontua o tipo de IP ou o ASN para sessões multi-device. Todas as afirmações são de vendedores ou praticantes.
- A Issue #1983 do Baileys (número restrito depois de 15 a 20 mensagens para contatos não salvos, sem proxy e sem IP compartilhado) mostra que bans comportamentais acontecem com qualquer IP. O comportamento domina; o IP é um fator secundário. — [Baileys #1983](https://github.com/WhiskeySockets/Baileys/issues/1983)

## 2. IP sticky/estático vs rotativo

### Takeaway
Todas as fontes concordam: uma sessão de WhatsApp precisa manter o mesmo IP pela vida inteira ("uma conta, um IP, para sempre"). Proxies residenciais rotativos servem só para tarefas paralelas. ISP = residencial estático: IPs alocados a ISPs, mas hospedados em servidores, que não giram. Proxies móveis giram por padrão e precisam ser configurados como sticky (rotação desligada ou longa).

### Cited Findings
- A Proxy Brasil diz que a sessão precisa do mesmo IP para não cair; trocar de IP no meio da sessão é sinal de risco, então proxy rotativo não é indicado. — [Proxy Brasil](https://www.proxybrasil.com/blog/proxy-para-whatsapp-apis)
- ProxyUniverse: "One account — one IP, forever"; rotação só para tarefas paralelas. — [ProxyUniverse](https://proxyuniverse.tech/en/blog/proxy-for-whatsapp)
- Coronium (móvel BR): rotação sob demanda ou agendada, sessões sticky de 1 minuto a 24 horas. A página não diz se dá para desligar a rotação por completo. — [Coronium](https://www.coronium.io/mobile-proxies/brazil)
- Proxy Brazil (proxybrazil.com, móvel BR): o plano anuncia "troca de IP ilimitada"; a operadora é atribuída pelo sistema. — resumo de busca de [proxybrazil.com](https://proxybrazil.com/proxy-para-google-ads)
- O "residencial estático" da Proxy-Cheap é anunciado para uso de longo prazo. — [Proxy-Cheap Brazil](https://www.proxy-cheap.com/locations/south-america/brazil)
- A Decodo vende residencial estático (ISP) em plano dedicado e compartilhado, com Brasil incluído (US, CA, BR, CO na América). — [Decodo static residential](https://decodo.com/proxies/static-residential-proxies)

### Inferences
- Para sessões Baileys de longa duração, prefira ISP/residencial estático dedicado. Se usar porta móvel 4G, peça ao vendedor que desligue a rotação ou use o sticky mais longo (24 h) e aceite que o IP ainda muda quando o modem reconecta. Uma mudança ocasional de IP dentro do mesmo ASN de operadora brasileira é exatamente o que um celular real faz, então provavelmente é menos arriscada do que pular entre ASNs ou países (inferência minha).
- Os helpers `proxyRotator` (rotação no disconnect/agendada) que o baileys-antiban oferece vão contra o consenso do "IP fixo". Use failover só para proxy morto, nunca rotação periódica. — [baileys-antiban](https://github.com/kobie3717/baileys-antiban)

### Gaps
- Não achei medição de quantas trocas de IP o WhatsApp tolera antes de deslogar ou marcar uma sessão.

## 3. Disponibilidade de IPs brasileiros e preços (2026)

### Takeaway
ISP/residencial estático brasileiro custa cerca de US$2 a 3,50 por IP/mês dedicado (e a partir de ~US$0,27 compartilhado). Proxies móveis 4G dedicados brasileiros custam R$200 a 890/mês em revendedores locais, ou US$89 a 109/mês na Coronium. Proxies BR "dedicados" baratos de vendedores locais (R$12 a 18/mês) existem, mas o tipo de IP precisa ser verificado. Todos os preços são os publicados pelos vendedores e mudam com frequência.

### Cited Findings
**ISP / residencial estático (por IP/mês)**
- Decodo, residencial estático dedicado: 3 IPs a $3,33/IP ($9,99, menor plano); 10 a $2,90; 20 a $2,80; 50 a $2,70; 100 a $2,60; 200 a $2,50. Compartilhado por IP a partir de $0,27/IP; por GB a partir de $1,30/GB (o structured data da página diz $6,50 por 1 GB, inconsistente). Brasil disponível; SOCKS5 e HTTP(S); existem limites de banda por assinatura e por IP. — [Decodo](https://decodo.com/proxies/static-residential-proxies)
- Proxy-Cheap Brasil: residencial estático IPv4 a partir de $2,44/IP/mês; residencial estático IPv6 a partir de $0,52; móvel estático a partir de $3,50/proxy (outro trecho da página diz $11,61, inconsistente); móvel rotativo $5,99/GB; residencial rotativo a partir de $0,78/GB. Segmentação por cidade (São Paulo com ~29 mil IPs, Rio ~1,2 mil, BH, POA, Fortaleza, Curitiba, Manaus, Belém, Brasília); sem segmentação por estado. HTTP/SOCKS5. — [Proxy-Cheap Brazil](https://www.proxy-cheap.com/locations/south-america/brazil)
- IPRoyal: ISP no Brasil a partir de $2,40/proxy/mês (plano de 90 dias); outra página da IPRoyal diz $1,80; uma review externa cita $4,0/IP/mês para um único IP. — resumo de busca de [IPRoyal Brazil](https://iproyal.com/proxies-by-location/south-america/brazil/) e reviews externas (não verificado diretamente)
- Proxy-Seller: um roundup de ISP de 2026 cita $3/IP para 1 a 5 IPs, $2,91 com 10, $2,85 com 20 a 30, até $1,89 a partir de 1000. Fontes mais antigas dizem Brasil a partir de $1,50 a 1,53 (desatualizado, cerca de 2025). — resumo de busca de [caproxy ISP list](https://caproxy.com/en/types/isp/) / [Proxyway Brazil](https://proxyway.com/proxy-locations/brazil-proxy) (verifique no checkout)
- Hproxy: ISP estático Brasil a partir de $2,50/IP; Oxylabs ISP em escada de $1,50/IP (até 20) até $1,10; Bright Data dedicado $3,50/IP com 10 IPs, $2,50 com 1000. — resumo de busca de [hproxy](https://hproxy.com/proxies/brazil) e [companionlink ISP 2026](https://www.companionlink.com/blog/2026/10/best-isp-proxies-in-2026-static-residential-isps-compared-and-rated/) (agregador; não verificado)
- Webshare Brasil: 337.626 IPs brasileiros; datacenter a partir de ~$0,03/IP; "dedicated" a partir de $0,825/proxy; residencial rotativo a partir de $7/mês por 1 GB; a página não traz preço de ISP/estático para o Brasil. HTTP e SOCKS5. — [Webshare BR](https://www.webshare.io/proxy-locations/br) (os planos "dedicated/private" da Webshare são IPs de datacenter, não residenciais)

**Proxies BR de vendedores locais**
- Proxy Brasil (proxybrasil.com): R$18/mês por proxy IPv4, R$12/mês por IPv6; exemplo de 10 números = R$180/mês (10× IPv4). — [Proxy Brasil](https://www.proxybrasil.com/blog/proxy-para-whatsapp-apis) (tipo de IP/ASN não comprovado; esse preço sugere IPs de datacenter/hospedagem, verifique o ASN)

**Móvel 4G/5G (dedicado, por mês)**
- GTI Proxy: plano móvel mensal R$200 (TIM/Vivo/Claro). — resumo de busca de [gtiproxy.com](https://gtiproxy.com/)
- Proxy Brazil (proxybrazil.com): R$249,90/mês, IP Claro/TIM/Vivo, 20 a 50 Mbps, troca de IP ilimitada. — resumo de busca de [proxybrazil.com](https://proxybrazil.com/proxy-para-google-ads)
- proxys.app: proxy móvel dedicado R$349,99/mês ilimitado. — resumo de busca de [proxys.app](https://proxys.app/)
- Shieldprox: Mobile 4G/5G R$890/mês, anunciado para WhatsApp Business. — resumo de busca de [shieldprox](https://shieldprox.com.br/precos)
- Coronium: $99/30 dias por porta dedicada (TIM a partir de $99, Vivo a partir de $109), $39/semana, $9/dia; modem 4G físico dedicado com SIM brasileiro; banda ilimitada; base principal em São Paulo; preços conferidos em 2026-10-14. — [Coronium](https://www.coronium.io/mobile-proxies/brazil)

### Inferences
- Custo aproximado para 10 números: ISP dedicado ~US$29/mês (Decodo, 10 IPs) a ~US$25 (Proxy-Cheap 10 × $2,44); 4G dedicado por número R$2.000 a 3.500/mês. Um meio-termo prático: 1 porta 4G compartilhada apenas para pareamento e aquecimento (um número de cada vez), depois mover o número para seu IP ISP dedicado. Mas mover do IP do pareamento para outro IP é por si só uma troca de IP. A alternativa mais segura é parear já no IP definitivo.
- A segmentação por estado/cidade só aparece de forma explícita na Proxy-Cheap (cidade) e na Coronium (São Paulo). Para números com DDD fora de SP, segmentar por cidade é desejável, mas a disponibilidade é baixa fora de SP/RJ.

### Gaps
- Não consegui conferir as páginas de preço da IPRoyal, Proxy-Seller, Soax, NetNut, Bright Data e Oxylabs para o Brasil especificamente (só agregadores).
- Não confirmei quais ISPs brasileiros reais (ASNs) estão por trás dos produtos "ISP" (muitos ISP proxies são anunciados por ASNs dos EUA, como AT&T/Comcast). Peça a lista de ASN ao vendedor antes de comprar.

## 4. Consumo de banda de uma sessão Baileys

### Takeaway
Não existe medição publicada para sessões Baileys/WhatsApp Web. O texto é minúsculo; mídia e chamadas dominam. Para ISP/móvel dedicado com banda ilimitada ou alta, isso pouco importa; só pesa em planos cobrados por GB.

### Cited Findings
- Texto: menos de 1 KB por mensagem; voz 0,3 a 0,5 MB/min; vídeo ~300 MB/h; usuário leve do app móvel 100 a 300 MB/mês. — [Saily](https://saily.com/blog/how-much-data-whatsapp-uses/) / [Firsty](https://www.firsty.app/help/general/how-much-data-does-whatsapp-use) (app móvel, não Baileys)
- Tráfego ocioso do app de ~10 KB/h, ~5 MB/mês (dado de 2011, desatualizado). — [handytechtips 2011](http://handytechtips.blogspot.com/2011/04/calculator-how-much-data-does-whatsapp.html)
- Na Evolution, imagens enviadas por URL são buscadas via axios com o agente do proxy quando ele está ativo; downloads de mídia recebida usam `downloadMediaMessage` sem um agente explícito (no trecho visível). Ou seja, o volume de mídia que passa pelo proxy depende do caminho no código. — [Evolution whatsapp.baileys.service.ts](https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts)

### Inferences
- Um número de CRM que só troca texto deve usar dezenas de MB por mês; com download automático de mídia (imagens/áudios de grupos, que neste CRM já foram volumosos: 4.239 mídias em 14 dias) pode chegar a vários GB. Meça empiricamente (contadores de bytes no proxy ou no painel do vendedor) antes de escolher plano por GB. Prefira planos por IP com banda ilimitada ou alta.

### Gaps
- Nenhum dado medido de tráfego de sessão Baileys/WhatsApp Web (ocioso + sync) encontrado.

## 5. Um IP exclusivo por número é necessário? Vários números no mesmo IP

### Takeaway
Os vendedores recomendam um IP por número; um vendedor brasileiro aceita de 3 a 5 instâncias por IP como "limite prático" para números da mesma operação. Não há evidência primária de que IP compartilhado, sozinho, cause ban. O risco citado é a correlação: um número marcado contamina os outros no mesmo IP, e cadastros ou disparos em lote de um mesmo IP parecem uma fazenda de automação.

### Cited Findings
- Proxy Brasil: abordagem mais segura = 1 proxy por instância (operações críticas); escalável = várias instâncias da mesma operação compartilhando, com limite prático de 3 a 5 instâncias por IP; exemplo "agressivo, maior risco" = 5 números por IP. — [Proxy Brasil](https://www.proxybrasil.com/blog/proxy-para-whatsapp-apis)
- Um resumo de busca da mesma fonte também diz que o WhatsApp tolera IPs compartilhados entre números da mesma "organização", enquanto outro guia BR diz que o bloqueio de uma conta afeta imediatamente as outras no mesmo IP. As afirmações conflitam e nenhuma traz fonte. — [Proxy Brasil](https://www.proxybrasil.com/blog/proxy-para-whatsapp-apis); [todasolucao](https://todasolucao.com.br/blog/rotacionar-ips-evolution-api-proxy/)
- ProxyUniverse: uma conta por IP. — [ProxyUniverse](https://proxyuniverse.tech/en/blog/proxy-for-whatsapp)
- baileys-antiban: oferece um orçamento de envio compartilhado entre instâncias porque, segundo ele, 5 bots a 8 msg/min cada (40/min agregado no mesmo IP) são marcados; o pool compartilhado limita a 20/min no total. Ou seja, o autor trata o volume agregado por IP como sinal. — [baileys-antiban](https://github.com/kobie3717/baileys-antiban)
- Whapi: recomenda que todos os dispositivos vinculados a um número fiquem na mesma região; nada explícito sobre compartilhar IP. — resumo de busca de [Whapi setting up proxy](https://support.whapi.cloud/help-desk/hints/setting-up-a-proxy)
- A Green-API oferece um proxy gratuito próprio (de.greenapi.org, porta de chat 8443, porta de mídia 7777) para acessar o WhatsApp, voltado a contornar bloqueios de rede e não a reputação, e compartilhado por muitos usuários. — [Green-API FAQ](https://green-api.com/en/docs/faq/how-to-use-a-proxy-server-in-whatsapp/)

### Inferences
- Este CRM hoje tem N números atrás de um único IP de datacenter, o pior caso do "consenso". Um proxy dedicado por número é barato no nível ISP (~US$2,5 a 3,3/IP/mês), então o custo de escolher isolamento é baixo. Também se alinha à lição registrada pelo próprio projeto de que o mesmo número em 2+ instâncias causou banimentos (correlação de sessão).
- Se compartilhar IPs, agrupe apenas números do mesmo cliente/tenant, nunca misture tenants (um tenant que dispara spam contaminaria o outro).

### Gaps
- Nenhuma fonte da Meta nem experimento controlado sobre os efeitos de compartilhar IP.

## 6. Como configurar corretamente na Evolution/Baileys

### Takeaway
A Evolution v2 monta tanto `agent` (WebSocket) quanto `fetchAgent` (undici, usado para upload de mídia) a partir do proxy da instância e os passa ao `makeWASocket`, mas apenas quando o socket é criado, então é preciso reconectar para aplicar. Configure o proxy antes do primeiro pareamento por QR, verifique o IP de saída e o ASN/geo, e monitore.

### Cited Findings
- Código da Evolution (branch main): `connectToWhatsapp` chama `this.loadProxy()`; `createClient` checa `this.localProxy?.enabled`, registra "Proxy enabled: host" e monta `options = { agent: makeProxyAgent(...), fetchAgent: makeProxyAgentUndici(...) }` a partir de host/port/protocol/username/password, e espalha isso no `socketConfig` do Baileys. Hosts com "proxyscrape" buscam uma lista e sorteiam uma entrada aleatória (ou seja, rotação; evite). Se a busca da lista falhar, o proxy é desativado silenciosamente (`localProxy.enabled = false`). — [Evolution source](https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts)
- No mesmo arquivo: chamadas a `downloadMediaMessage` (messages.upsert, sendMessageWithTyping) não recebem agente explícito; imagens enviadas por URL são buscadas com `httpsAgent: makeProxyAgent(...)`; mídia por URL que não é imagem vai para `prepareWAMessageMedia({url})` sem agente visível. — [Evolution source](https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts) (leitura parcial: só os primeiros 100 mil de 176 mil caracteres)
- PR #2416 da Evolution (aberto, não mergeado em 2026-06): diz que, com SOCKS5 configurado, o código caía para HTTP CONNECT em proxies SOCKS5 estritos ("Protocol Incorrect"). O mantenedor observou que o diff não implementava a correção alegada. Situação: não resolvido. — [Evolution PR #2416](https://github.com/EvolutionAPI/evolution-api/pull/2416)
- Proxy Brasil: env global da Evolution `PROXY_HOST`, `PROXY_PORT`, `PROXY_USERNAME`, `PROXY_PASSWORD`, `PROXY_PROTOCOL`; ou um objeto `proxy` por instância em `POST /instance/create`. Para Baileys puro, passar o proxy como `agent` e `fetchAgent` ("sem fetchAgent, uploads de mídia saem pelo IP real"). Também recomenda um `browser` diferente por instância, cerca de 1 semana de aquecimento, intervalos aleatórios de 8 a 15 s e monitorar `connection.update` (401 = deslogado). — [Proxy Brasil](https://www.proxybrasil.com/blog/proxy-para-whatsapp-apis)
- Whapi: conecte o proxy antes de escanear o QR para melhores resultados; formato `socks5://login:password@ip:port`; o IP precisa alcançar web.whatsapp.com; teste a estabilidade com um checker. — [Whapi help desk](https://support.whapi.cloud/help-desk/blocking/using-residential-proxies-with-whapi.cloud)
- ProxyUniverse: verifique o IP (whoer.net) antes de abrir o WhatsApp. — [ProxyUniverse](https://proxyuniverse.tech/en/blog/proxy-for-whatsapp)
- Green-API: o WhatsApp oficialmente só suporta conexões via proxy nas portas 80, 443 ou 5222 (isso se refere ao recurso de proxy do app). — resumo de busca de [Green-API blog](https://green-api.com/en/blog/free-proxy-server-for-whatsapp)

### Inferences (checklist recomendado para este CRM)
1. Use `protocol: "http"` por padrão. Use socks5 só depois de confirmar que funciona na v2.3.7, por causa do relato do PR #2416 (o fallback para HTTP CONNECT quebra proxies só-SOCKS5). Prefira vendedores que aceitem os dois protocolos.
2. Credenciais: se usuário/senha tiverem `@ : / # %`, faça URL-encode (`encodeURIComponent`), já que os agentes montam uma URL de proxy (inferência: o código monta a URL a partir dos campos; não verifiquei se a Evolution faz o encode). Mais seguro: escolher senhas alfanuméricas ou autenticação por whitelist de IP (a whitelist com o IP da VPS evita o problema por completo).
3. Ordem: crie a instância → `POST /proxy/set/{instance}` (ou um objeto `proxy` no create) → verifique → só então gere o QR. Para números já pareados: aplique o proxy e depois force uma reconexão (`/instance/restart` ou logout/connect), porque os agentes só são montados em `createClient`.
4. Verifique o IP de saída a partir da VPS: `curl -x http://user:pass@host:port https://ipinfo.io/json` (ou `http://ip-api.com/json/?fields=country,regionName,city,isp,as,mobile,proxy,hosting`). Confira country=BR, ASN de ISP/operadora brasileira, `hosting=false`. Registre IP + ASN por instância numa tabela.
5. Monitore: verificação periódica (por exemplo, a cada hora) do IP de saída de cada proxy, alertando se mudar ou se o país/ASN mudar. Também alerte sobre o log "Proxy enabled" ausente após reinícios, porque falhas no proxyscrape/lista desativam o proxy silenciosamente, e a Evolution então cairia de volta para o IP do datacenter.
6. Vazamento de mídia: confirme se mídia recebida/enviada passa pelo proxy (tcpdump/conntrack na VPS procurando conexões de saída diretas para hosts `*.whatsapp.net` / `mmg.whatsapp.net` a partir do container da Evolution). O trecho de código sugere que alguns caminhos de mídia podem não usar o agente do proxy explicitamente; o `fetchAgent` do Baileys deve cobrir uploads.
7. Não use hosts do tipo "proxyscrape" nem listas de proxy rotativas; elas sorteiam um IP aleatório a cada conexão.

### Gaps
- Não verifiquei o código da v2.3.7 especificamente (li a branch main), nem o endpoint de teste via icanhazip que o usuário descreveu.
- Não confirmei se o `downloadMediaMessage` do Baileys herda o `fetchAgent` do socket (no Baileys 6.x, `downloadContentFromMessage` aceita opções de fetch; não verificado).

## 7. Riscos de detecção: tipo de IP/ASN, geo vs código do país do telefone, trocas frequentes de IP

### Takeaway
Os fatores mais citados são: geolocalização do IP divergente da região do número (um +55 conectando de fora do Brasil), ASN de datacenter, mudanças bruscas de geo/IP e muitas contas no mesmo IP. Todos são alegados por vendedores ou por provedores de API não oficial (Whapi); nenhum foi confirmado pela Meta. Os sinais comportamentais (idade do número, proporção de mensagens recebidas e enviadas, denúncias, mensagens a não contatos) são os principais.

### Cited Findings
- Whapi: o WhatsApp considera a idade de registro do número, a proporção de mensagens recebidas e enviadas, os tipos de contato, as denúncias de usuários e se a sessão bate com a região registrada do número. — [Whapi help desk](https://support.whapi.cloud/help-desk/blocking/using-residential-proxies-with-whapi.cloud)
- ProxyUniverse: o país do proxy precisa bater com o país do SIM; divergência é "an instant flag". — [ProxyUniverse](https://proxyuniverse.tech/en/blog/proxy-for-whatsapp) (afirmação de vendedor)
- Resumo de busca de vendedores: muitas contas num IP + disparo em massa + saltos bruscos de geo combinam num sinal de ban; uma dúzia de números novos registrados do mesmo IP em pouco tempo parece automação. — [DriftProxy](https://driftproxy.com/blog/best-proxies-for-whatsapp-2026); [Proxy-Cheap](https://www.proxy-cheap.com/integrations/proxies-for-whatsapp)
- baileys-antiban: "IP reputation scoring"; IPs de datacenter são marcados. — [baileys-antiban](https://github.com/kobie3717/baileys-antiban)
- Baileys #1983: ban após 15 a 20 mensagens para contatos não salvos, sem proxy e sem IP compartilhado, ou seja, o comportamento sozinho basta. — [Baileys #1983](https://github.com/WhiskeySockets/Baileys/issues/1983)
- Vários sites de vendedores dizem que números Baileys duram 2 a 8 semanas (sem metodologia); posts da comunidade dizem que bans por API não oficial são permanentes. — [n8n community](https://community.n8n.io/t/whatsapp-n8n-con-evolution-api-oficial-vs-baileys-lo-que-aprendi-a-base-de-golpes/276547?tl=en); [pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/12969/integrate-whatsapp-evolution-api-vs-cloud-api)

### Inferences
- O IP da VPS está no Brasil? Se a VPS (147.93.9.172) geolocaliza fora do Brasil, isso é uma divergência de geo para números +55 hoje. Verifique com ipinfo antes de comprar qualquer coisa (inferência; não verifiquei o geo/ASN da VPS).
- O proxy reduz um fator de risco secundário. Não compensa o volume ou o comportamento de disparo. O ganho esperado é maior para números novos, para disparos e para o isolamento entre números/tenants.

### Gaps
- Não há documentação ou engenharia reversa pública sobre como o servidor do WhatsApp usa o IP de clientes multi-device/companion. Nenhum dado sobre a severidade de divergência de cidade/estado (por exemplo, DDD 11 vs IP de Fortaleza) frente a divergência de país.
