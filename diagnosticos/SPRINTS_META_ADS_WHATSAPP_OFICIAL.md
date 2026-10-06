# Sprints — Tráfego pago (Meta Ads) no Marketing + WhatsApp oficial como Tech Provider

Planejado em 2026-10-06. Ler `AUDITORIA_PROTOCOLO.md` antes de cada sprint. Sempre homolog → prod via
`scripts/deploy.sh`.

## Objetivo

1. O cliente vê no CRM o resultado do tráfego pago **cruzado com o funil**: gasto por anúncio →
   leads → vendas → custo por lead real, custo por venda, ROAS.
2. O CRM devolve as vendas para a Meta (Conversions API) para as campanhas otimizarem para compra.
3. O cliente conecta o WhatsApp oficial com um botão (Embedded Signup), sem copiar token/IDs.

## Ponto de partida (confirmado no código em 2026-10-06)

| Já existe | Onde |
|---|---|
| Conexão Meta Ads (OAuth clássico + token de usuário do sistema), token criptografado | `routes/marketing.ts` — **não commitado** |
| Painel de insights (totais + série diária, resultado por objetivo) | `routes/marketing.ts` `/insights`, `MetricasMeta.tsx`, `useInsights.ts` — **não commitado** |
| Webhook de Lead Ads (grava `marketing_leads` com `ad_id`, `form_id`) | `routes/marketing.ts` ~l.676 |
| WhatsApp oficial: cadastro manual, webhook, inscrição na WABA, coexistência, templates (criar/sincronizar/excluir), IA | `routes/metaOficial.ts`, `services/metaWebhookProcessor.ts` |
| Contato vindo de anúncio CTWA marcado como `anuncio_ctwa` + headline | `metaWebhookProcessor.ts` ~l.116 |
| Etapa "ganho" no funil (`is_won`) | `routes/funis.ts` |

| Lacuna | Impacto |
|---|---|
| `ctwa_clid` e `referral.source_id` (ID do anúncio) **não são gravados** | Impossível cruzar anúncio × lead × venda e impossível usar CAPI |
| Insights consultados ao vivo na Graph a cada abertura da tela | Lento, gasta limite de chamadas, sem histórico |
| Token OAuth expira em ~60 dias | Painel do cliente "quebra" sozinho |
| Lead Ads só grava IDs, não cria contato com os dados do formulário | Lead do formulário não entra no funil |

---

## Trilha paralela T — Burocracia Meta (dono: Angelo, não é código)

Começa **já**; é o caminho crítico das sprints M5 e W1 (análise leva semanas).

- [ ] T1. Verificação do negócio do portfólio Mentoark (CNPJ, endereço, telefone, domínio, doc do admin).
- [ ] T2. App tipo "Empresa" com: URL de política de privacidade, termos de uso, exclusão de dados
      (a URL de callback sai da M5), ícone, categoria, e-mail de contato. Domínio do app verificado.
- [ ] T3. Inscrição como **Tech Provider** do WhatsApp (painel do app → WhatsApp → Tech Provider).
- [ ] T4. Adicionar 2–3 clientes piloto como **testadores** do app (permite usar Ads em modo dev).

---

## Sprint M0 — Fechar o que está aberto (1–2 dias)

- Revisar e commitar o trabalho não commitado de marketing (`marketing.ts`, `ContaMeta.tsx`,
  `MetricasMeta.tsx`, `useInsights.ts`, `useCampanhas.ts`, `useMetaStatus.ts`, migration).
  Os PNGs de logo modificados são de outra frente — **não** misturar no commit.
- Escopo do OAuth: **mantém `ads_management`** — corrigido em 2026-10-06: ele É usado
  (pausar/reativar campanha em `/campanhas/:id/pausar|reativar`); no App Review justificar por
  essa função. `pages_read_engagement`/`pages_manage_metadata` só entram na M1, junto com o
  código que inscreve a página no webhook `leadgen` (pedir permissão sem uso reprova a revisão).
- Deploy em homolog, testar com a conta de anúncios da Mentoark e um piloto (T4).

**Pronto quando:** painel mostra dados reais em homolog, para 2 contas diferentes.

## Sprint M1 — Atribuição de anúncio no contato (3–4 dias) ★ maior valor

- Migration: tabela `atribuicoes_anuncio`
  (`id, user_id, contato_id, canal ['ctwa'|'lead_ads'|'utm'], ctwa_clid, meta_lead_id, ad_id,
  adset_id, campaign_id, source_url, headline, payload jsonb, criado_em`) + índice
  `(user_id, ad_id)` e `(user_id, contato_id)`. Primeiro toque e último toque derivados por
  `criado_em` — sem colunas novas em `contatos` além de `primeira_atribuicao_id`.
- `metaWebhookProcessor.ts`: gravar `referral.source_id`, `source_type`, `ctwa_clid`,
  `source_url`, `headline` em toda mensagem com `referral` (não só no primeiro contato).
- Evolution (números não oficiais): **confirmar contra a Evolution real** se a mensagem traz
  `contextInfo.externalAdReply` com `sourceId`/`ctwaClid`. Se trouxer, gravar igual; se não,
  documentar que atribuição exata é só no número oficial.
- Lead Ads: ao receber `leadgen`, buscar `GET /{leadgen_id}` (campos do formulário), criar/
  atualizar contato e entrar no funil configurado; gravar atribuição `canal='lead_ads'`.
- Resolver `ad_id` → `adset_id`/`campaign_id` + nomes via Graph, com cache (tabela da M2).
- UI: card "Origem: anúncio X / campanha Y" no detalhe do contato e no card do lead.

**Pronto quando:** clicar num anúncio CTWA de teste em homolog gera contato com
`ad_id` e `ctwa_clid` gravados; lead de formulário de teste (Lead Ads Testing Tool) vira contato no funil.

## Sprint M2 — Sincronização de insights com cache (3 dias)

- Tabelas: `meta_entidades` (`user_id, ad_account_id, nivel, id, parent_id, nome, status,
  objetivo, thumbnail_url, atualizado_em`) e `meta_insights_diario` (`user_id, ad_account_id,
  nivel ['campaign'|'adset'|'ad'], entidade_id, data, spend, impressions, reach,
  inline_link_clicks, actions jsonb, resultados, moeda`; PK `(entidade_id, nivel, data)`).
- Job: backfill de 90 dias na conexão; diário às 05h re-sincroniza os **últimos 3 dias**
  (a Meta revisa números dentro da janela de atribuição). Botão "Atualizar agora" com trava.
- Respeitar os headers `x-business-use-case-usage` / `x-ad-account-usage`: pausar a conta
  quando passar de ~75%. Registrar taxa de erro (meta da M5: < 15%).
- `/insights` passa a ler do banco; Graph só no job.

**Pronto quando:** tela abre em < 1s sem chamar a Graph; job roda 2 dias seguidos sem erro.

## Sprint M3 — Painel de ROI: anúncio × funil (3–4 dias)

- Endpoint `/api/marketing/roi?since&until&nivel` juntando `meta_insights_diario` ×
  `atribuicoes_anuncio` × negócios do funil: gasto, leads, qualificados, vendas, receita,
  **CPL real, taxa de conversão, CAC, ROAS** por campanha → conjunto → anúncio (drill-down).
- Comparar "resultados segundo a Meta" × "leads que chegaram no CRM" (mostra vazamento).
- Card "Leads sem atribuição" (vieram de anúncio mas sem ID — ex. Evolution).
- Miniatura do criativo na tabela de anúncios.

**Pronto quando:** dado um período, os números batem com o Gerenciador de Anúncios (gasto) e
com o funil (vendas), conferido manualmente em 1 conta.

## Sprint M4 — Conversions API (devolver venda à Meta) (3 dias)

- Config por conta: `dataset_id` (pixel/dataset) + token com acesso ao dataset; etapa do funil
  que conta como "qualificado".
- Eventos: `LeadSubmitted` (contato criado com atribuição), `QualifiedLead` (etapa configurada),
  `Purchase` com `value`/`currency` (negócio ganho). CTWA: `action_source: "business_messaging"`,
  `messaging_channel: "whatsapp"`, `ctwa_clid` **sem hash**. Lead Ads: `action_source:
  "system_generated"` com `lead_id`. Telefone/e-mail com hash SHA-256 quando enviados.
- Fila com retry e tabela `capi_eventos` (payload, resposta, status) + `event_id` para deduplicar.
- Validar com o "código de teste de eventos" no Gerenciador de Eventos.

**Pronto quando:** venda marcada como ganha em homolog aparece no Gerenciador de Eventos.

## Sprint M5 — Login for Business + App Review de Ads (2–3 dias + espera da Meta)

Depende de T1/T2.
- Trocar o diálogo OAuth clássico por **Facebook Login for Business** (`config_id`), gerando
  token de usuário do sistema de integração do cliente (não expira). Manter compatibilidade com
  tokens antigos até renovarem.
- Callback de **exclusão de dados** (`/auth/meta/data-deletion`) + página de status.
- Gravar screencasts (conectar conta → painel → ROI → pausar/reativar campanha → lead de
  formulário entrando no funil) e submeter: `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `leads_retrieval`,
  `pages_read_engagement`, `pages_manage_metadata`.
- Acompanhar o **Marketing API Access Tier**: 500 chamadas em 15 dias com erro < 15% para sair
  do nível de desenvolvimento (o job da M2 já gera esse volume com os pilotos).

**Pronto quando:** permissões com acesso avançado aprovadas e um cliente que não é testador conecta sozinho.

## Sprint W1 — WhatsApp: Embedded Signup como Tech Provider (4–5 dias + espera da Meta)

Depende de T1/T2/T3.
- Botão "Conectar WhatsApp oficial" (SDK JS da Meta + `config_id` do Embedded Signup), com as
  duas variantes: número novo/só API e **coexistência** (app WhatsApp Business).
- Backend: trocar `code` por token de integração, descobrir `waba_id`/`phone_number_id`, gravar em
  `whatsapp_oficial_config`, inscrever app na WABA, registrar o número **somente se não for
  coexistência**, e definir PIN de 2 etapas.
- Formulário manual continua como "modo avançado".
- App Review do WhatsApp: vídeo 1 = mensagem enviada pelo CRM chegando no celular; vídeo 2 =
  template criado pelo CRM (ambos já funcionam hoje). Permissões: `whatsapp_business_messaging`,
  `whatsapp_business_management`.

**Pronto quando:** um cliente piloto conecta o próprio número em < 5 min sem copiar nenhum ID.

---

## Ordem e dependências

```
T (burocracia) ───────────────────────────────┐
M0 → M1 → M2 → M3 → M4                        ├→ M5 → (clientes externos em Ads)
                                              └→ W1 → (clientes externos em WhatsApp)
```

M0–M4 não dependem da Meta (funcionam com contas próprias + testadores). Estimativa total de
código: ~4 semanas; M5/W1 dependem do prazo de análise da Meta.

## Fontes

- https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/
- https://developers.facebook.com/docs/marketing-api/insights/
- https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
- https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/
- https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide
- https://whapi.cloud/blog/track-click-to-whatsapp-ctwa-clid
