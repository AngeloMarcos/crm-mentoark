# Como o Cubo (suite.mentoark.com.br) faz IA e Meta, e o plano para repaginar a nossa IA

Data: 2026-10-29. Fontes: REA (`capture_browser_scenario`, login real), props Inertia de cada tela
(sessão HTTP autenticada), chunk compilado `pages/agents/Edit.vue`, `GET /api/agent-microfunctions`,
`GET /api/agents/catalog`, OpenAPI pública. Artefatos em `ia/` nesta pasta.
**Nada foi gravado no Cubo.** O segredo do app Meta que a tela `/tenant/facebook` devolve não foi salvo.

---

## Parte A — Meta / WhatsApp oficial no Cubo

### Observado
- O white-label tem **um app Meta próprio do tenant** (App ID `1651234338702109`), cadastrado em
  Administração → Facebook, com: App Secret, chave do webhook, `config_id` do **Login for Business**
  (Facebook/Lead Ads) e `config_id` do **Embedded Signup de WhatsApp**. O `config_id` de Instagram está vazio.
- Com esse app já existem **3 integrações `whatsapp_business` ativas** (Comercial 1, Mento 3, Mentoark
  Comercial). Ou seja: o app já passa pelo Embedded Signup em produção.
- O fluxo de conexão (rotas):
  `POST /integrations/whatsapp-business/connect-via-sdk` (SDK JS + `config_id`), `.../callback`,
  `sync-phones`, `register-phone`, `sync-template`, `delete-template`, `template-manual-send`,
  `user-mappings` (número ↔ usuário), `activate-webhooks`, `disconnect`. Webhook único `/webhooks/facebook`.
- **Separação Integração → Canal → Agente.** A integração guarda o token da WABA. O **canal** é um número
  (`phoneNumberId`, `provider: meta_cloud`) com `defaultAgentId`, `defaultAutomationId`, departamento,
  SLA (TMA/TME/TMR), transcrição e uma lista de `capabilities` (janela de 24h, templates, listas, botões,
  `banRisk: false`...). O agente de IA não sabe nada de WhatsApp.
- As páginas públicas que a Meta exige ficam em `/site/politica-de-privacidade`, `/site/termos-de-uso`,
  `/site/privacidade-dados` (exclusão de dados) e `/site/incidentes`.

### Nossa situação
- O código do Embedded Signup v4 já existe (`services/embeddedSignup.ts`, `routes/metaOficial.ts`,
  webhook `/webhook/meta/app`), assim como Privacidade, Termos e Exclusão de Dados (`/privacidade`, `/termos`, `ExclusaoDados.tsx`).
- **Nenhum app Meta configurado:** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` e `META_ES_CONFIG_ID` estão vazios
  em `crm-api` e `crm-api-homolog`. Por isso o botão de cadastro fica indisponível.

### Decisão pendente (do Angelo)
1. **Reaproveitar o app `1651234338702109`** (se for da Mentoark e já tiver acesso avançado):
   é só adicionar o nosso domínio no app, o redirect URI e uma configuração de Embedded Signup própria.
   O webhook do app aponta para o Cubo. Os números do CRM usariam `override_callback_uri` por WABA
   (`POST /<WABA>/subscribed_apps`) para que os eventos venham para `api.mentoark.com.br`.
2. **App novo só do CRM:** passa por verificação do negócio, Tech Provider e App Review do zero.

### Checklist do App Review (WhatsApp, Tech Provider)
- Negócio verificado; app em modo Live; ícone; categoria; e-mail; domínio verificado.
- URLs: política de privacidade, termos e **callback de exclusão de dados**. Hoje existe a página, mas não
  existe o endpoint `signed_request`.
- Permissões: `whatsapp_business_management`, `whatsapp_business_messaging` (e `business_management` se o
  Embedded Signup pedir).
- Vídeos (em inglês ou com legenda):
  (1) cliente conecta o número pelo botão (Embedded Signup);
  (2) mensagem enviada pelo CRM chegando no celular, e a resposta voltando no inbox;
  (3) template criado no CRM e aprovado/listado.
- A IA precisa se **identificar como IA** (política da Meta de 2026). Por isso **não** vamos copiar o
  "Ocultar identidade de IA" do Cubo.

---

## Parte B — IA no Cubo

### Navegação
`Agentes de IA` → Meus agentes · Execuções · Bases de conhecimento · Conexões MCP · Intenções.
Pastas para agentes e para bases.

### Tela do agente: página própria `/agents/:id/edit`, 4 abas
1. **Perfil**: nome, pasta, ícone, cor, integração de IA (`openai | google_ai | openrouter`), modelo,
   **prompt do sistema num editor Monaco** (contador `25572 / 40000`) e o switch "Coletar dados antes de criar a negociação".
2. **Configurações**: seis seções, cada campo com texto de ajuda:
   - *Modelo e raciocínio*: temperatura, esforço de raciocínio (mínimo/baixo/médio/alto), suporte a imagens,
     texto a usar quando a transcrição falhar, tokens máximos de resposta e de prompt, limite de passos (20), nível de serviço OpenAI.
   - *Modo conversacional*: manter a conversa aberta, **espera para agrupar mensagens (ms)**,
     encerrar só por inatividade, condição de conclusão (`[CONCLUIDO]`), tempo limite (min).
   - *Histórico*: **mensagens do histórico (20)**, **tokens máximos do histórico (8000)**.
   - *Formato da resposta*: **dividir respostas longas**, modo (parágrafo/caracteres), tamanho, **intervalo (ms)**.
   - *Comportamento e persona*: mensagem de erro, assinatura, ocultar identidade de IA, transferir para humano,
     idioma forçado, **uso de emojis (off/low/normal/high)**, temas permitidos.
   - *Limites de uso*: máximo de interações por conversa, reset a cada X (unidade). Desfecho padrão do follow-up.
3. **Execuções**: últimas 25, com tokens, custo, latência e status. "Ver trace". **"Reexecutar com a configuração atual"**,
   que mostra a execução original lado a lado com a nova.
4. **Teste**: chat com **modo simulação**, em que ferramentas de escrita devolvem só uma prévia. Há um switch para permitir mutações reais, com confirmação.
   Também mostra métricas e o **rascunho da negociação** que está sendo montada.

### O grande diferencial: ferramentas são "chips" dentro do prompt
- Sintaxe `{{tool:nome(chave=valor,...)}}`. O editor reconhece os chips (decoração e autocomplete) e cada
  chip abre um formulário com os parâmetros.
- O modelo vê o chip como `nome_<ids>`. O prompt diz **quando** usar cada ferramenta, no lugar onde a regra está escrita.
- 36 microfunções (`ia/microfuncoes.json`), em categorias:
  - **pessoa**: buscar por telefone ou nome, cadastrar, atualizar nome ou telefone, tag, campo personalizado;
  - **negociação**: criar, buscar, mover etapa, ganhar, perder (com motivo), valor, título, nota, anexo, produto, tag, campo;
  - **conversa**: transferir para humano ou usuário, pausar o bot por X min, encaminhar a departamento, mudar status,
    nota, finalizar, enviar arquivo, tag;
  - **kb**: responder com uma base específica;
  - **calcom**: horários, agendar, remarcar, cancelar.
- Os parâmetros vêm de uma *allowlist* da conta (funis, etapas por funil, tags por tipo, campos, motivos de
  perda, bases, usuários, departamentos). O chip só aponta para IDs reais.
- **Follow-up por campo perseguido** (nome, telefone, campo X). Cada campo define tentativas, intervalos
  (no máximo 23h, dentro da janela de 24h), instruções de abordagem e o desfecho ao esgotar: humano, outro agente, fluxo ou encerrar.
- O catálogo é auto-descritivo (`GET /api/agents/catalog`, com ETag), e há `validate` e `simulate` sem gravar.

---

## Parte C — Comparação com o nosso motor (`services/agentEngine.ts`)

| Item | Cubo | Nós hoje |
|---|---|---|
| Espera para agrupar mensagens | por agente | **fixa em 3000 ms**; o campo "Espera antes de responder" da tela **não é lido** |
| Histórico enviado ao modelo | N mensagens + teto de tokens | **fixo em 20**, sem teto |
| Divisão da resposta | liga/desliga, parágrafo/caracteres, tamanho, intervalo | **no máximo 2 partes, 3 s fixos** |
| Emojis, assinatura, idioma | configuráveis | assinatura = nome de exibição; o resto não existe |
| Mensagem de erro ao contato | configurável | silêncio, com pausa e aviso ao humano |
| Ferramentas | 36 microfunções, como chips no prompt | 9 tools fixas, liga/desliga numa lista |
| Bases de conhecimento | várias, ligadas por agente | RAG global por conta |
| Tela | página própria, 4 abas | Sheet com **10 abas**, misturando número/WhatsApp/proxy com o "cérebro" |
| Campos sem efeito na tela | — | persona, tom, objetivo, regras, boas-vindas (marcados como "anotação interna") |

---

## Parte D — Sprints da repaginada

**IA-1 (esta entrega): o motor passa a respeitar a configuração, e a aba Configurações é reorganizada nas seções do Cubo.**
Colunas novas em `agentes`, todas NULL = comportamento atual, sem regressão:
`historico_mensagens`, `historico_max_tokens`, `divisao_ativa`, `divisao_modo`, `divisao_tamanho`,
`divisao_intervalo_ms`, `emoji_politica`, `assinatura_ativa`, `assinatura_texto`, `idioma_forcado`,
`mensagem_erro`. Além disso, `tempo_espera_mensagem` passa a valer de verdade no agrupamento.

**IA-2: página própria `/agentes/:id` com 4 abas.** Número, conexão, proxy e status saem do agente e vão
para a tela de Conexões/Canais. O número aponta para o agente (como `defaultAgentId`), e o menu ganha
o grupo "Agentes de IA".

**IA-3: ferramentas como chips no prompt.** Editor com autocomplete, catálogo de microfunções ligado ao
nosso CRM (funil/etapa, tags, contato, nota, transferir, pausar, enviar arquivo, RAG por base) e
allowlist da conta. Em paralelo, `validate` e `simulate`.

**IA-4: bases de conhecimento como entidade**, com status de indexação, ligadas por agente. Execuções com
"reexecutar e comparar". O Teste ganha simulação de mutações.

**IA-5: follow-up por campo perseguido** dentro da janela de 24h. Modo conversacional, condição de
conclusão e limite de interações com reset.

**Trilha Meta (paralela):** decidir qual app usar (A ou B acima) → configurar as envs em homolog →
callback `signed_request` de exclusão de dados → roteiro e gravação dos vídeos → submissão.
