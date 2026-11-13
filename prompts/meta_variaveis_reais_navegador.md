# Valores reais do CRM para a spec do app "Facilita CRM" — correções e o que fazer agora

**Para quem é:** o agente que opera `developers.facebook.com` / `business.facebook.com` (Claude no
navegador), executando a *Especificação de configuração — App Meta "Facilita CRM"*.

**O que este documento é:** o preenchimento da tabela "1. Variáveis a definir antes de executar"
daquela spec, com os valores **lidos do código do backend em 2026-11-13**, mais as correções dos
valores que estavam como exemplo e **estão errados**. A spec continua valendo em tudo o mais —
ordem das fases, regras de segurança, critérios de aceite.

**Regra que não muda:** onde a spec diz para parar e perguntar, pare e pergunte. Nada aqui
autoriza enviar para análise, publicar o app, cadastrar pagamento ou subir documento.

---

## 1. Correções na tabela de variáveis — use estes valores, não os da spec

Quatro linhas da spec estavam marcadas "confirmar" ou "ex." e **estão incorretas**. Os valores
abaixo vêm do código, não de suposição.

| Variável | Valor na spec (❌ não usar) | **Valor correto** | Onde isso está no código |
|---|---|---|---|
| `DOMINIO_APP` | `suite.mentoark.com.br` | **`crm.mentoark.com.br`** | `suite.` é outro produto (CuboCRM white-label), **não** é o nosso CRM |
| `DOMINIO_DEV` | `dev.mentoark.com.br` | **`homolog.mentoark.com.br`** | ambiente de homologação real; `dev.` não existe |
| `WEBHOOK_WHATSAPP` | `/webhooks/whatsapp` | **`https://api.mentoark.com.br/webhook/meta/app`** | `backend/src/index.ts:186` + `routes/metaWebhook.ts:37` (repare: `webhook` no singular) |
| `WEBHOOK_PAGE` | `/webhooks/meta/page` | **`https://api.mentoark.com.br/api/marketing/webhook/leads`** | `routes/marketing.ts:693` |
| `WEBHOOK_INSTAGRAM` | `/webhooks/meta/instagram` | **não existe — não configurar** | nenhum endpoint de Instagram no backend hoje |

### Tabela de variáveis, preenchida

| Variável | Valor |
|---|---|
| `DOMINIO_APP` | `crm.mentoark.com.br` |
| `DOMINIO_DEV` | `homolog.mentoark.com.br` |
| `WEBHOOK_WHATSAPP` | `https://api.mentoark.com.br/webhook/meta/app` |
| `WEBHOOK_PAGE` | `https://api.mentoark.com.br/api/marketing/webhook/leads` |
| `WEBHOOK_INSTAGRAM` | — (pular a subfase de Instagram) |
| `VERIFY_TOKEN_WHATSAPP` | **o Angelo passa na conversa** (já está no servidor; não está escrito aqui de propósito) |
| `VERIFY_TOKEN_PAGE` | **o mesmo token acima** — veja o aviso abaixo |
| `VERIFY_TOKEN_INSTAGRAM` | — |
| `URL_POLITICA_PRIVACIDADE` | `https://crm.mentoark.com.br/privacidade` |
| `URL_TERMOS` | `https://crm.mentoark.com.br/termos` |
| `URL_EXCLUSAO_DADOS` | `https://crm.mentoark.com.br/exclusao-de-dados` |
| `EMAIL_CONTATO` | o Angelo informa |

> **Um token só, não três.** O backend usa a mesma variável (`META_WEBHOOK_VERIFY_TOKEN`) nos dois
> endpoints. Cole o mesmo valor no webhook do WhatsApp e no de Lead Ads. Não gere token novo: o que
> está no servidor é o único que funciona.

---

## 2. O que já está pronto do nosso lado (não precisa pedir)

Verificado hoje, com chamada real aos endpoints de produção:

- **Handshake de verificação funcionando nos dois webhooks.** Ao clicar em *Verificar e salvar*, a
  Meta recebe o `hub.challenge` de volta em texto puro, status 200. Testado em produção:
  `/webhook/meta/app` e `/api/marketing/webhook/leads` responderam corretamente, e ambos devolvem
  **403 com token errado**.
- **Assinatura `X-Hub-Signature-256` conferida** em todo POST dos dois webhooks (HMAC-SHA256 do
  corpo bruto). Item 10 da spec: já atendido.
- **Embedded Signup já implementado no front** (`FB.login` com `config_id`, `response_type: 'code'`,
  `override_default_response_type`, e `featureType: 'whatsapp_business_app_onboarding'` quando o
  cliente escolhe coexistência). Falta só o `config_id` que você vai gerar na Fase 5.
- **Páginas públicas no ar:** privacidade, termos e exclusão de dados, nas URLs da tabela acima.

---

## 3. Bloqueio removido hoje — e o que ainda falta do lado do servidor

O servidor estava **sem nenhuma variável da Meta configurada**. Isso faria a Fase 1 falhar logo no
primeiro clique: sem o verify token, o endpoint responde 403 e o botão *Verificar e salvar* recusa.

| Variável do servidor | Situação |
|---|---|
| `META_WEBHOOK_VERIFY_TOKEN` | ✅ **gerado e aplicado hoje** em produção e homologação, com os endpoints testados |
| `FACEBOOK_APP_ID` | ⏳ vazio — vale `1112560648323276`, o Angelo aplica |
| `FACEBOOK_APP_SECRET` | ⏳ vazio — **só existe no painel**; é o que você precisa entregar ao Angelo |
| `META_ES_CONFIG_ID` | ⏳ vazio — é o Configuration ID que sai da **Fase 5.2** |

**Sem o App Secret o CRM não consegue:** validar a assinatura dos webhooks (hoje ele rejeita tudo
por falta de segredo) nem trocar o `code` do Embedded Signup por token. Então, das suas entregas,
**a mais importante é o App Secret**, junto com o Configuration ID.

---

## 4. Ordem recomendada, considerando o que já existe

A ordem da spec (3 → 1 → 2 → 5 → 4 → 6 → 7) continua certa. Dois ajustes:

1. **Fase 1 (webhooks) pode ser feita já** — os endpoints estão no ar e testados. Inscreva os
   campos da tabela 4.2 da spec. Confirme que `messages` e `account_update` ficaram inscritos.
2. **Pule a subfase de Instagram e Messenger (7.5) por enquanto.** Não existe endpoint no backend
   para receber esses eventos; configurar agora só aumenta a superfície do App Review sem nenhum
   módulo do CRM usando. Lead Ads (7.3), sim — o endpoint existe e valida assinatura.

---

## 5. Decisão de coexistência — já está respondida no código

A spec manda perguntar antes de inscrever `smb_message_echoes`, `smb_app_state_sync` e `history`.
Resposta: **o CRM já suporta coexistência** — o front envia
`featureType: 'whatsapp_business_app_onboarding'` quando o cliente opta por manter o número no
celular, e essa é a situação esperada para a maioria dos clientes da MentoArk.

**Ainda assim, confirme com o Angelo antes de inscrever os três campos.** Motivo honesto: o
backend recebe o echo, mas a exibição dessas mensagens na linha do tempo do contato ainda não foi
verificada ponta a ponta. Inscrever não quebra nada — só pode deixar a conversa incompleta na tela
até isso ser testado.

---

## 6. O que entregar ao Angelo no fim

1. **App Secret** — pelo canal que ele indicar, nunca na conversa nem em campo do painel.
2. **Configuration ID** da configuração *MentoArk — WhatsApp Embedded Signup* (Fase 5.2).
3. **Configuration ID** da configuração *MentoArk — Ads e Páginas*, se a Fase 4 for feita.
4. Tabela do estado final: o que ficou configurado, o que está aguardando análise da Meta, e o que
   depende dele (pagamento, documentos de verificação, gravação dos vídeos).

Com o App Secret e o Configuration ID em mãos, o CRM fica pronto para o primeiro número oficial.

---

## 7. Observações sobre a versão da Graph API

A spec usa `v27.0` no front e `v21.0` nos exemplos de servidor. O backend hoje tem `v23.0` como
padrão e aceita `META_GRAPH_VERSION` para sobrescrever. Não é bloqueio: **não mude nada por causa
disso** — só relate qual versão o painel oferece como atual, que o Angelo alinha o servidor depois.
