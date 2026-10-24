# Maturador v5 — plano de sprints (modelo ChipFlow)

_Revisado em 18/10/2026. Substitui o plano anterior a partir da Sprint 7. Sprints 1, 2, 4, 5 e 6 já estão em
produção; a Sprint 3 (comprar proxies) continua pendente com o usuário._

## 1. Qual é a melhor referência

| Referência | O que é | Avaliação |
|---|---|---|
| **ChipFlow** (chipflow.com.br) | SaaS. Chips conversam entre si com IA, áudio com voz fixa, status, grupos, canais, rotina diária, proxy por chip | **Melhor e mais completo.** ~2.567 chips ativos e ~27 mil mensagens/dia na plataforma (contador público em 18/10). Usa **whatsmeow** (Go), não Baileys. Única fonte de avaliação positiva é vídeo de afiliado (`utm_source=LORENA`) — não há avaliação independente |
| JonasCaetanoSz/maturador-de-chips | App de desktop (Python + WhatsApp Web injetado). Texto de arquivo ou ChatGPT, grupos, figurinhas | 35 estrelas, 20 forks, ativo (jul/2026). Comentários do vídeo de 6,1 mil views: maioria "não funciona", "parou", "fechou sozinho", dúvida sobre token da OpenAI. Intervalo de 10–15 s entre mensagens |
| EduardoDos-SantosP/maturador-whatsapp | 60 linhas com whatsapp-web.js | 4 estrelas, abandonado (abr/2024), issue de erro aberta. Manda "bacon ipsum" em **inglês** a cada 30–90 s, 24h — padrão de robô |
| **Nosso maturador (v4)** | Pares por conta + Aquecimento Global, fases ~26 dias, mentor, só-recebe, score, rotina, proxy testado | Base técnica já melhor que os dois repositórios; falta o "conteúdo humano" do ChipFlow (IA, áudio, mídia, status rico, grupos, canais) e a tela de controles |

Conclusão: **seguir o ChipFlow como modelo de produto**, reaproveitando nossa base (fases, travas, score, proxy,
Aquecimento Global). Não copiar código de ninguém — só o comportamento observável.

## 2. Como o ChipFlow funciona (observado na conta do usuário, 18/10/2026)

**Por chip** (`GET /instances/`): `maturity_stage`, `onboarding_stage` (ex.: `PUBLIC_ONBOARDING`),
`onboarding_progress_percent` + `progress_reason` ("reconectando"), `historical_messages_count`,
`has_saved_contacts`, `warm_breakdown` {messages, official_groups, managed_groups, status_posts},
`public_groups_joined`, `chipflow_groups`, `canais_seguidos`, `in_cooldown`/`cooldown_remaining_s`,
`meta_restricted_s`, `proxy_health`/`proxy_dead`/`transport_dead`, `has_custom_proxy`, `auto_rotate_enabled`,
`velocidade` {escolhido, efetivo, travado, motivo, niveis: lenta/normal/rapida}, `api_version: "whatsmeow"`.

**Controles** (`GET /instances/features`): `feat_p2p` (puxar conversa), `feat_grupos`, `feat_status`, `feat_midia`
(fotos, áudios, figurinhas), `feat_contatos` (salvar contatos), `feat_canais` — cada um com
`ligado` / `disponivel` / `ativo_agora` ("começa quando o chip amadurecer").

**Status** (`GET /instances/status-config`): até **20 imagens** e **20 textos de até 500 caracteres** por chip
(200 imagens por conta), saem em sequência; sem nada cadastrado, a IA escolhe imagem e escreve a frase.

**Grupos** (`GET /instances/group-links`): até **5 convites** colados pelo usuário; só os chips dele entram;
estado do link (ex.: "tentando"). Regra: **máx. 2 grupos/dia, ≥ 2 h entre entradas**.

**Rotina**: 00–07 dorme (só monitora conexão); 07–24 conversas e grupos; 14–20 **1 status/dia**.
Os 2 primeiros dias são lentos de propósito; velocidade travada na fase inicial.

**Conteúdo**: conversas geradas por IA sobre o dia a dia brasileiro (trânsito, futebol, comida, memes), com
gírias e erros de digitação; parte das respostas em **áudio com voz fixa por chip**; "digitando…" e
"gravando…" pelo tempo real; pausas longas no começo e menores com a maturidade; número com histórico começa
num nível mais avançado.

**Plataforma**: pool compartilhado (todos os clientes) e **pool privado** nos planos maiores; proxy por chip
(pool do sistema ou próprio do cliente). Painel `pulso`: mensagens hoje (P2P × grupo), conversas hoje.

## 3. O que já temos × o que falta

| Recurso ChipFlow | Nosso maturador hoje | Sprint |
|---|---|---|
| Fases + só recebe nos primeiros dias | ✅ Perfil → Madura (~26 dias), só-recebe, mentor | — |
| Rotina diária | ⚠️ janela 8–21 por par | 7 |
| Controles por chip (conversas, grupos, mídia, canais, status) | ❌ | 7 |
| Velocidade lenta/normal/rápida travada no início | ❌ | 7 |
| Barra de progresso + contadores de aquecimento | ⚠️ histórico de 14 dias (Sprint 5) | 7 |
| Número com histórico começa adiantado | ❌ (manual, ex.: Pessoal) | 7 |
| Conversas com IA, gírias e erros de digitação | ❌ 24 temas fixos com spintax | 8 |
| Áudio com voz fixa + "gravando…" | ❌ | 9 |
| Fotos e figurinhas nas conversas | ❌ | 9 |
| Status com 20 imagens/20 textos, IA quando vazio, 14–20h | ⚠️ 8 frases fixas, só para o parceiro | 10 |
| Seus grupos (5 convites, 2/dia, ≥ 2 h) + conversa em grupo | ❌ | 11 |
| Seguir canais | ❌ | 11 |
| Visualizador de conversas (P2P / grupos) | ❌ | 12 |
| Pool privado × compartilhado | ✅ par da conta × Aquecimento Global | 12 (tela) |
| Salvar contatos entre chips | ❌ | 12 (investigar) |
| Proxy por chip | ✅ código (Sprint 2); compra pendente (Sprint 3) | 3 |

## 4. Sprints

### Sprint 7 — Controles por chip, rotina e velocidade (base)
- Tabela `maturador_controles` por agente: `conversas`, `grupos`, `midia`, `canais`, `status`, `contatos`
  (todos ligados por padrão) + `velocidade` (lenta/normal/rápida).
- Cada controle mostra **Ativo agora** ou **Começa quando o chip amadurecer** (regra de fase no backend).
- Conversas desligadas = só responde (já existe no motor como "só recebe").
- **Rotina global**: dorme 00–07, conversa 07–24, status 14–20 (1/dia); substitui a janela por par.
- **Velocidade** multiplica pausas e teto diário; **travada em "lenta" nos 2 primeiros dias** e enquanto
  Perfil/Aquecimento 1.
- **Histórico do número**: na 1ª conexão, contar mensagens antigas e pular fases (ex.: ≥ 6 meses de uso → começa
  no Aquecimento 3).
- Tela "Controles" (cards por chip, como o ChipFlow) e card de chip com barra de progresso e contadores
  (mensagens, grupos, status).
- **Pronto quando**: desligar "Conversas" faz o chip só responder; à 00h nada sai; velocidade travada no início.

### Sprint 8 — Conversas com IA (texto)
- Gerar o **roteiro da sessão inteira numa chamada** (3–7 trocas) com modelo pequeno, para custar centavos:
  assunto do dia a dia brasileiro, gírias, abreviações, **erros de digitação propositais** (aplicados no código,
  não pela IA), persona fixa por chip (idade, cidade, jeito de escrever).
- A resposta considera a última mensagem recebida (contexto curto).
- **Teto de custo por conta/dia** e queda automática para o banco de 24 temas se a IA falhar ou estourar o teto.
- Nunca citar empresa, produto ou dados do cliente.
- **Pronto quando**: 100 sessões sem frase repetida, custo medido por dia, fallback testado.
- ✅ **Feito (19/10, a1cae4d, em prod)** — `services/maturadorIA.ts`. ~US$ 0,0003/roteiro; teto 30/conta/dia.
  Pendente: chave OpenAI do servidor e da conta mentoark dão 401 → hoje cai no banco de temas.

### Sprint 9 — Áudio, fotos e figurinhas
- **Áudio**: TTS (ElevenLabs já integrado no CRM, ou OpenAI TTS) com **voz fixa por chip**, enviado como
  mensagem de voz (PTT) pela Evolution, com presença **"gravando…"** pelo tempo do áudio. Fração de respostas em
  áudio cresce com a fase (0% no início).
- **Fotos e figurinhas**: banco próprio (comida, paisagem, meme genérico, sem marcas/pessoas), com variação de
  imagem por envio (já existe anti-fingerprint de imagem no Disparo).
- Respeita o controle **Fotos e áudios** e a fase ("começa quando amadurecer").
- Testar recebimento: o parceiro "ouve" (marca como reproduzido) e visualiza.
- **Pronto quando**: chips trocam áudio e imagem em homolog, voz igual sempre para o mesmo chip, custo medido.
- ✅ **Feito (20/10, em prod)** — `services/maturadorMidia.ts`. Áudio: gpt-4o-mini-tts (voz/jeito fixos por
  chip, ~US$ 0,015/min, teto 20/conta/dia) ou ElevenLabs da conta; "gravando…" confirmado no código da Evolution.
  Foto: Lorem Picsum re-codificada (hash único). Figurinha: Noto Emoji. Chances 8–20% a partir do Aq2; teto por
  chip/dia 8 áudios, 3 fotos, 5 figurinhas. Ressalvas: Picsum não tem filtro de tema (pode vir foto com
  letreiro/pessoas); "marcar áudio como ouvido" não existe na Evolution 2.3.7 (só "lido"); troca real entre chips
  ainda não observada — homolog sem par ativo e TTS depende da chave OpenAI válida.

### Sprint 10 — Status rico
- Por chip: até **20 imagens** e **20 textos (500 caracteres)**, publicados em sequência; sem cadastro, a IA
  escreve a frase e escolhe imagem do banco.
- Janela **14–20h, 1 por dia**, só a partir da fase permitida; controle **Publicar status**.
- Visibilidade configurável: só parceiros do maturador (atual) ou todos os contatos.
- **Pronto quando**: status com imagem e texto saindo 1×/dia no horário, ordem respeitada.
- ✅ **Feito (20/10, em prod)** — `services/maturadorStatus.ts`, tabela `maturador_status_itens`,
  `maturador_controles.status_visibilidade` (padrão "parceiros"), tela "Gerenciar status" no card Controles.
  Fila: nunca publicado primeiro, depois o mais antigo (gira sozinha). Imagem cadastrada é re-codificada a cada
  publicação. Sem cadastro: frase da IA (mesmos freios de custo) ou banco fixo, com foto em ~50%. E2E em homolog
  pelas rotas reais (cadastro, limites, ordem, visibilidade, remoção do arquivo); publicação real no WhatsApp
  ainda não observada (sem par ativo).

### Sprint 11 — Grupos e canais
- **Seus grupos**: até 5 convites por conta; só os chips da conta entram; **máx. 2 grupos/dia, ≥ 2 h**; estado
  do link (tentando, entrou, cheio, inválido); reaproveitar a verificação de convite do Radar (descarta
  comunidade, aprovação de admin).
- **Conversa em grupo**: chips da conta conversam no grupo (mensagens curtas, reações), com teto por dia.
- **Canais**: seguir alguns canais públicos por chip, aos poucos. Conferir se a Evolution 2.3.7 expõe
  `newsletter follow`; se não, patch na imagem própria (mesmo esquema da Sprint 1).
- Controle **Grupos** e **Canais**.
- **Pronto quando**: chip entra em 1 grupo colado respeitando os limites e conversa nele.
- ✅ **Grupos feitos (23/10, em prod)** — `services/maturadorGrupos.ts` (cron a cada 2 min), tabelas
  `maturador_grupos`, `maturador_grupo_membros`, `maturador_grupo_mensagens`, card "Seus grupos". Reaproveita a
  leitura/entrada/confirmação de convite do Radar. Entrada só Aq2+, controle ligado, sem trava dura; ~1 tentativa
  a cada 30 min por conta (sorteio). Conversa só com 2+ chips da conta dentro, em turnos, roteiro por IA ou banco
  de temas; teto 15 msgs/grupo/dia e 6/chip/dia; chip "só recebe" entra mas não fala. Remover do cadastro não
  tira o chip do grupo. Entrada/conversa real ainda não observadas (sem grupo e 2 chips aptos em homolog).
- ⏸ **Canais: bloqueado** — a Evolution 2.3.7 não tem rota de seguir canal (o Baileys 7 tem `newsletterFollow`).
  Exige patch na imagem `mentoark/evolution-api` + reiniciar a Evolution de produção (todos os números
  reconectam). Decisão do usuário.

### Sprint 12 — Visualizador, pools e contatos
- Tela **Conversas** do maturador (P2P e grupos), só leitura.
- Tela de pool: **privado** (só números da conta) × **compartilhado** (Aquecimento Global, exige proxy).
- **Contatos salvos**: investigar se dá para salvar os parceiros na agenda do chip via app-state do WhatsApp
  (Baileys); se não, marcar como manual (usuário salva no celular).
- Painel "pulso" do maturador (mensagens hoje, P2P × grupo, chips ativos).

### Sprint 3 (pendente) — proxies
Continua valendo: 1 proxy **fixo** por número (ISP estático BR). A trava de troca de IP já está em produção.

## 5. Atenção imediata (18/10/2026)

Os 3 chips cadastrados no ChipFlow são números do CRM: **5511979579548 (Mentoark 1, conectado agora na nossa
Evolution)**, **5511946650482 (Mentoark 2)** e **5511948702939**. Dois sistemas de aquecimento no mesmo número
(ChipFlow por whatsmeow + nosso maturador por Baileys, de IPs diferentes) dobram a atividade automatizada.
Decidir um sistema por número enquanto o v5 não fica pronto.
