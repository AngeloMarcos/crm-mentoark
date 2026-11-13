# Configuração do app no Meta for Developers — runbook para o agente de navegador

**Para quem é este documento:** o agente que vai operar `developers.facebook.com` e
`business.facebook.com` dentro da conta Meta real da MentoArk. Não é documentação de leitura —
é a especificação do estado final que o app precisa ter. Executar na ordem.

**Fonte dos valores:** todos os valores literais abaixo foram extraídos do código do backend em
2026-11-13 (arquivos citados em cada seção). Se o código mudar, este documento mente — confira os
arquivos citados antes de executar.

---

## 0. Como usar este documento

1. **Navegue pelo estado final, não pelo caminho de cliques.** Os nomes de menu da Meta mudam
   várias vezes por ano. Cada seção abaixo define *o que precisa estar verdadeiro no fim*. Use a
   busca do painel para chegar lá e confirme pelo estado final, não pelo caminho que você seguiu.
2. **Não invente valor nenhum.** Toda URL, token, escopo e campo está escrito literalmente aqui.
   Se um campo obrigatório não estiver especificado neste documento, **pare e pergunte** — não
   preencha com o que parecer razoável.
3. **Relate em formato de tabela** ao final: o que ficou configurado, o que ficou pendente de
   análise da Meta e os valores da seção 7 para o Angelo colar no servidor.
4. **Segredos:** o App Secret aparece uma única vez. Entregue ao Angelo pelo canal que ele indicar.
   Não cole segredo em comentário, issue, commit, ticket ou qualquer campo do próprio painel da Meta.

---

## 1. Pré-requisitos que só o Angelo resolve — confirme antes de começar

Não dá para configurar o app sem isso. Se algum item estiver em aberto, registre e siga com o que
não depende dele.

| # | Pré-requisito | Por que trava |
|---|---|---|
| T1 | Portfólio de negócios da MentoArk **verificado** (CNPJ, endereço, telefone, domínio, documento do admin) | Sem verificação do negócio não há acesso avançado a `whatsapp_business_management` nem Tech Provider |
| T2 | Domínio `mentoark.com.br` verificado no portfólio | Exigido para o app sair do modo de desenvolvimento |
| T2 | URLs de política de privacidade, termos de uso e exclusão de dados publicadas | Campos obrigatórios do app tipo "Empresa" |
| T3 | Método de pagamento válido na WABA | Sem isso o envio por template falha em produção |

Referência interna: `diagnosticos/SPRINTS_META_ADS_WHATSAPP_OFICIAL.md`, trilha T.

---

## 2. Identidade do app

Um app só, tipo **Empresa** (*Business*), vinculado ao portfólio de negócios da MentoArk.

- **Nome:** MentoArk CRM
- **E-mail de contato:** o que o Angelo informar (não invente)
- **Categoria:** Mensagens (*Messaging*)
- **Domínios do app:** `crm.mentoark.com.br` e `api.mentoark.com.br`
- **URL do site:** `https://crm.mentoark.com.br`

Não publique o app ("Ativo"/*Live*) nesta etapa. Publicar antes dos webhooks responderem faz a Meta
começar a entregar evento em URL que ainda não valida assinatura. A publicação é o último passo,
na seção 8.

---

## 3. Produto: WhatsApp Business Platform

### 3.1 Webhook do app (uma URL para todos os clientes)

O backend é Tech Provider: todos os números cadastrados por Embedded Signup entregam eventos na
**mesma** URL, roteados internamente por `phone_number_id`.
Código: `backend/src/routes/metaWebhook.ts`, rotas `GET/POST /app`.

Objeto do webhook: **`whatsapp_business_account`**

| Campo | Valor |
|---|---|
| URL de callback | `https://api.mentoark.com.br/webhook/meta/app` |
| Token de verificação | o valor de `META_WEBHOOK_VERIFY_TOKEN` (peça ao Angelo; é o mesmo da seção 5) |

A verificação só passa se `META_WEBHOOK_VERIFY_TOKEN` já estiver definida no servidor **e o
backend já tiver sido reiniciado**. Se a Meta recusar o handshake, pare: o problema é do lado do
servidor, não do painel. Não tente outro token.

### 3.2 Campos a assinar

Assine exatamente estes sete. Cada um é tratado no backend
(`backend/src/services/metaWebhookProcessor.ts`); assinar campo que não tratamos só gera ruído, e
deixar de assinar um destes quebra uma função específica do CRM:

| Campo | O que quebra se faltar |
|---|---|
| `messages` | Mensagem recebida não entra na conversa |
| `account_update` | CRM não fica sabendo de restrição/ban da conta e não pausa as campanhas |
| `phone_number_quality_update` | Limite diário e qualidade do número ficam desatualizados |
| `message_template_status_update` | Template reprovado/pausado continua sendo usado em campanha |
| `template_category_update` | Categoria (e custo) do template fica errada no CRM |
| `user_preferences` | Opt-out de marketing não é respeitado — **risco de conformidade** |
| `smb_message_echoes` | Na coexistência, mensagem enviada pelo celular não aparece no CRM |

> Atenção: a tela do CRM (`src/components/whatsapp/NumerosOficiais.tsx`) ainda lista só os seis
> primeiros. `smb_message_echoes` é tratado pelo backend mas não aparece na instrução da tela.
> Assine os sete; sinalize essa divergência no seu relatório.

### 3.3 Configuração do Embedded Signup (v4)

Em **Login do Facebook para Empresas → Configurações**, crie uma configuração do tipo
**Cadastro incorporado do WhatsApp** (*WhatsApp Embedded Signup*).

- v2 e v3 foram descontinuados em 15/10/2026 — tem que ser **v4**.
- Ativos que a configuração deve pedir: conta do WhatsApp Business (WABA) e número de telefone.
- Permissões da configuração: `whatsapp_business_management`, `whatsapp_business_messaging`,
  `business_management`.
- **Copie o ID da configuração** → vira `META_ES_CONFIG_ID` (seção 7).

O fluxo do navegador usa `response_type: 'code'` com `override_default_response_type: true`, e
troca o code no servidor. Código: `backend/src/services/embeddedSignup.ts`. Se a configuração for
criada em outro modo de resposta, o cadastro de cliente falha com "a Meta não devolveu o token".

### 3.4 Tech Provider

Inscreva o app como **Tech Provider** do WhatsApp. É o que permite cadastrar o número de um
cliente sem que ele crie app próprio. Depende de T1 (seção 1).

### 3.5 App Review do WhatsApp

Submeta `whatsapp_business_messaging` e `whatsapp_business_management` para acesso avançado.
Dois vídeos, ambos de funcionalidades que já existem hoje:

1. mensagem enviada pelo CRM chegando num celular real;
2. template criado pelo CRM aparecendo no Gerenciador do WhatsApp.

**Não submeta sem o Angelo.** Prepare o rascunho, deixe salvo e relate.

---

## 4. Produto: Facebook Login for Business (Meta Ads)

Usado para conectar a conta de anúncios do cliente ao módulo de Marketing.
Código: `backend/src/routes/marketing.ts` (início do OAuth na linha ~244, callback na ~654).

| Item | Valor exato |
|---|---|
| URI de redirecionamento do OAuth válido | `https://api.mentoark.com.br/api/marketing/facebook/callback` |
| Login com SDK do JavaScript | Ativado |
| Domínios permitidos para o SDK | `crm.mentoark.com.br` |

**Escopos** (exatamente estes sete, na ordem em que o backend os pede):

```
ads_management,ads_read,leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_metadata,business_management
```

Justificativas para o App Review — cada permissão precisa de uso demonstrável no vídeo, pedir sem
uso reprova:

- `ads_management` — pausar e reativar campanha pelo CRM (`/campanhas/:id/pausar|reativar`)
- `ads_read` — painel de métricas e ROI
- `leads_retrieval` — buscar os dados do lead de formulário (seção 5)
- `pages_show_list` — listar as páginas do cliente para ele escolher qual inscrever
- `pages_read_engagement` + `pages_manage_metadata` — inscrever a página escolhida no webhook `leadgen`
- `business_management` — ler o portfólio para localizar conta de anúncios e WABA

---

## 5. Produto: Webhooks — objeto Página (Lead Ads)

**Webhook separado do item 3.1**, outro objeto e outra URL, no mesmo app.
Código: `backend/src/routes/marketing.ts`, rotas `GET/POST /webhook/leads`.

Objeto do webhook: **`page`**

| Campo | Valor |
|---|---|
| URL de callback | `https://api.mentoark.com.br/api/marketing/webhook/leads` |
| Token de verificação | o mesmo `META_WEBHOOK_VERIFY_TOKEN` da seção 3.1 |
| Campo a assinar | `leadgen` (só esse) |

A inscrição de cada página individual **não** é feita no painel — quem faz é o CRM, pela tela de
Marketing, quando o cliente escolhe a página. No painel só fica a URL e o campo.

---

## 6. O que NÃO fazer sem autorização explícita do Angelo

- **Não gere novo App Secret** se já existir um. Isso derruba na hora todos os webhooks em
  produção (a assinatura HMAC para de bater) e todo cadastro por Embedded Signup.
- **Não remova nem edite** webhook, produto ou permissão que já esteja configurado e que este
  documento não mande mudar. Relate o que encontrou diferente e pare.
- **Não submeta App Review** (nem de WhatsApp nem de Ads) — prepare e deixe salvo.
- **Não publique o app** antes da verificação da seção 8 passar.
- **Não adicione método de pagamento, não mude plano, não aceite termo novo** em nome da empresa.
- **Não exclua** número, WABA ou configuração de Embedded Signup.

Se o painel pedir uma decisão que não está neste documento, pare e pergunte.

---

## 7. Valores para copiar de volta

Entregue nesta tabela. Vão para o `.env` do backend em produção (`/opt/crm`) e precisam de
reinício do serviço para valer.

| Onde achar no painel | Variável de ambiente | Observação |
|---|---|---|
| Configurações → Básico → ID do app | `FACEBOOK_APP_ID` | público |
| Configurações → Básico → Chave secreta | `FACEBOOK_APP_SECRET` | **segredo**, aparece uma vez |
| Login para Empresas → Configurações → ID da configuração | `META_ES_CONFIG_ID` | público |
| — (definido por nós, não pela Meta) | `META_WEBHOOK_VERIFY_TOKEN` | gere 32 hex; **tem que existir no servidor ANTES** do handshake da seção 3.1 |

### Três variáveis que precisam ser conferidas no servidor antes de qualquer teste

Achados do levantamento de hoje no código — são bloqueios reais, não detalhe:

1. **`API_URL` não existe no `backend/.env` local** (conferido em 2026-11-13; o `.env` da VPS de
   produção não foi conferido — **confirme lá antes de testar**). `marketing.ts` monta o `redirect_uri` do OAuth com
   `process.env.API_URL` e devolve **503** se ela faltar. Sem ela, a seção 4 inteira não funciona,
   por mais correto que esteja o painel. Precisa valer `https://api.mentoark.com.br`.
   Nota: o repo usa **três nomes diferentes** para a mesma URL pública — `API_URL` (marketing),
   `API_BASE_URL` (metaOficial, catálogo, galeria) e `API_PUBLIC_URL` (auth, cadastro). Defina as
   três com o mesmo valor; unificar isso é dívida técnica para outra hora.

2. **`META_GRAPH_VERSION` não está definida e os padrões divergem:** `metaCloudApi.ts` cai em
   `v21.0` e `metaAds.ts` em `v23.0`. Ou seja, hoje WhatsApp e Ads falam com versões diferentes da
   Graph. Defina explicitamente **uma** versão (a que você confirmar como atual e compatível com
   Embedded Signup v4) para os dois usarem a mesma.

3. **`CRM_ORIGIN`** — usada para o `postMessage` de volta ao popup do OAuth. O padrão embutido já é
   `https://crm.mentoark.com.br`; só confirme que não está sobrescrita com outro valor.

---

## 8. Verificação ponta a ponta

Nesta ordem. Não siga para a próxima enquanto a anterior não passar.

1. **Handshake do WhatsApp** — no painel, "Verificar e salvar" na URL da seção 3.1. Tem que
   devolver sucesso. Se recusar, o backend está sem `META_WEBHOOK_VERIFY_TOKEN` ou não reiniciou.
2. **Handshake do Lead Ads** — mesma coisa para a URL da seção 5.
3. **Os sete campos** da seção 3.2 aparecem como assinados no objeto `whatsapp_business_account`.
4. **`leadgen`** aparece como assinado no objeto `page`.
5. **Redirect URI** da seção 4 salva, SDK JS ativado, domínio liberado.
6. **Teste real de ponta a ponta** (com o Angelo): cadastrar um número piloto pelo Embedded Signup
   no CRM e mandar uma mensagem para ele. O CRM mostra "Último webhook" preenchido na tela de
   Números Oficiais quando o evento chega — é a confirmação de que a cadeia inteira funciona
   (handshake, assinatura HMAC e roteamento por `phone_number_id`).
7. Só então: publicar o app.

Se o passo 6 não chegar no CRM, o diagnóstico é do nosso lado — logs do backend com a tag
`META_WEBHOOK`. Os motivos mais prováveis, em ordem: App Secret divergente entre painel e `.env`
(assinatura recusada, HTTP 401), ou número sem config ativa (`phone_number_id` sem dono).

---

## 9. Modo manual (não mexa, mas saiba que existe)

Há um segundo caminho no CRM, para cliente que tem app Meta próprio: a tela gera uma URL de
webhook por configuração — `https://api.mentoark.com.br/webhook/meta/<configId>` — com Verify
Token próprio, guardado no banco, e App Secret do app do cliente. Esse caminho é configurado no
app **do cliente**, não no nosso. Não confunda com a URL da seção 3.1 e não tente configurá-lo
aqui.
