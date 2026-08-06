# Sprint — Implementar integração "Corridas via WhatsApp" (híbrido IA + fila de confirmação)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Continuação da sprint de investigação já feita (achados completos em `diagnosticos/AUDITORIA_LOG.md`/histórico da sessão — não repetir o levantamento, só implementar). Arquitetura decidida: IA extrai os dados do pedido de corrida da conversa; se extração vier completa e sem ambiguidade, envia direto pra API do cliente; se faltar campo ou ficar incerta, cai numa fila de confirmação humana. Toda corrida (automática ou confirmada) fica registrada.

---

## 1. Tabela `corridas`

Nova tabela, seguindo o padrão já usado no arquivo (`disparo_templates`/`disparo_logs` como referência de estilo):

```sql
CREATE TABLE IF NOT EXISTS corridas (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL,
  contato_id        UUID,
  telefone          TEXT NOT NULL,
  nome_passageiro   TEXT,
  origem            TEXT,
  destino           TEXT,
  horario_solicitado TEXT,      -- texto livre por enquanto (ex: "amanhã 8h", "agora") — não forçar parse de data rígido nesta fase
  observacoes       TEXT,
  status            TEXT NOT NULL DEFAULT 'pendente_confirmacao', -- 'pendente_confirmacao' | 'confirmada' | 'enviada' | 'falha_envio' | 'cancelada'
  origem_extracao   TEXT NOT NULL DEFAULT 'ia', -- 'ia' | 'manual' — de onde vieram os dados
  confianca_ia      TEXT,        -- 'alta' | 'baixa' — a IA reporta isso ao extrair, usado pra decidir se cai na fila
  payload_enviado   JSONB,       -- o que de fato foi mandado pra API do cliente, pra auditoria
  resposta_api      JSONB,       -- resposta (ou erro) da API do cliente
  enviado_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
)
```
+ índice `(user_id, status, created_at DESC)` (a fila de pendentes vai filtrar por isso o tempo todo) + FK `user_id → users(id) ON DELETE CASCADE`, mesmo padrão das outras tabelas do arquivo.

Reaproveitar `integracoes_config` (já existe, já suporta `tipo` livre com `url`/`api_key`/`token`/`config` jsonb) pra guardar a config da API do cliente — novo `tipo = 'corridas_cliente'` (ou nome mais específico se o usuário já tiver decidido o nome do cliente), em vez de criar uma tabela de config nova.

## 2. Ferramenta nova de IA: `criar_corrida`

Seguir exatamente o padrão já mapeado em `backend/src/services/mcp/tools.ts` (schema Zod em `functionCallingSecurity.ts` + entrada em `MCP_TOOLS` + `case` em `executarFerramenta`), mesmo estilo de `buscar_documentos`/`criar_agendamento`.

**Schema de entrada (input_schema/JSON Schema) da ferramenta**, campos que a IA deve extrair da conversa:
```json
{
  "origem": "string (endereço/local de partida, se mencionado)",
  "destino": "string (endereço/local de destino, se mencionado)",
  "horario_solicitado": "string (quando a pessoa quer a corrida, em texto livre — ex: 'agora', 'amanhã 8h')",
  "nome_passageiro": "string (se diferente do nome do contato já conhecido)",
  "observacoes": "string (qualquer detalhe extra relevante)",
  "confianca": "enum: alta | baixa — 'alta' só se origem, destino E horário estiverem claros e sem ambiguidade; 'baixa' em qualquer outro caso"
}
```

**Lógica de execução (`executarFerramenta`, case `criar_corrida`):**
1. Validar args com Zod (novo schema em `functionCallingSecurity.ts`, mesmo padrão dos outros — reaproveitar `validateUserIdIsolation`/`validateNoDestructiveSql` já existentes).
2. Inserir em `corridas` com `origem_extracao='ia'`, `confianca_ia` = o que a IA reportou.
3. Se `confianca === 'alta'` E `integracoes_config` tiver uma URL configurada pro cliente: montar o payload (ver contrato na seção 3) e chamar a API externa via `resilientFetch` (reaproveitar o utilitário já existente em `backend/src/utils/resilientFetch.ts`, timeout configurável, em vez de `fetch` cru — nenhuma das integrações de saída existentes usa isso hoje, é uma melhoria real de robustez). Sucesso → `status='enviada'`, grava `resposta_api`. Falha → `status='falha_envio'`, grava o erro, **não perde a corrida** (fica visível na fila mesmo tendo tentado enviar automático e falhado).
4. Se `confianca === 'baixa'` ou não houver integração configurada ainda: `status='pendente_confirmacao'` — não tenta enviar, só registra.
5. Retornar pro LLM uma confirmação curta do que foi registrado (para ele poder confirmar pro cliente final na conversa, ex: "Anotei sua corrida de [origem] pra [destino]! Já estou providenciando." — sem prometer horário exato se a extração não tiver certeza disso).

## 3. Contrato mínimo de payload pra negociar com o cliente

Proposta de payload JSON pra levar pra negociação com o dev do sistema do cliente — ajustar depois conforme o que ele já tiver:

```json
POST {url_configurada}
Headers: { "Content-Type": "application/json", "Authorization": "Bearer {token_configurado}" }

Body:
{
  "origem_sistema": "mentoark_crm",
  "id_externo": "{corridas.id, UUID do CRM — permite ao sistema do cliente evitar duplicata se reenviarmos por engano}",
  "passageiro": { "nome": "string", "telefone": "string (E.164 se possível)" },
  "origem": "string",
  "destino": "string",
  "horario_solicitado": "string (texto livre nesta fase)",
  "observacoes": "string | null",
  "criado_em": "ISO 8601"
}
```
Resposta esperada (proposta): `200`/`201` com algum identificador da corrida no sistema do cliente, pra gravar em `corridas.resposta_api` — se o cliente não tiver isso ainda, seguir só com o `200 OK` como confirmação mínima.

## 4. Tela "Corridas Pendentes" (fila de confirmação — Opção A do desenho híbrido)

Nova página simples (mesmo padrão de `RespostasRapidas.tsx`/`DisparoTemplates.tsx` — lista + modal), mostrando `corridas` com `status='pendente_confirmacao'`: nome, telefone, origem/destino/horário extraídos (editáveis), botão "Confirmar e enviar" (chama a mesma lógica de envio da ferramenta, com `origem_extracao` atualizado pra refletir a edição manual se algo foi corrigido) e "Descartar" (`status='cancelada'`).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Não configurar a URL real da API do cliente ainda (ela não existe/não foi negociada) — deixar a integração pronta pra funcionar assim que a URL for configurada em `integracoes_config`, e testável em homolog simulando a API do cliente com um endpoint fake (ex: `webhook.site` ou um mock local) só pra confirmar que o payload sai certo. `npm run build` (frontend e backend). Testar em homolog: mandar uma mensagem de teste clara ("preciso de corrida da Rua X pro Aeroporto amanhã 8h") e confirmar que vira uma corrida com `confianca='alta'`; mandar uma mensagem vaga ("preciso de uma corrida") e confirmar que cai em `pendente_confirmacao`.

## AO FINALIZAR, REPORTAR

- Tabela `corridas` criada, ferramenta `criar_corrida` funcionando (teste real com mensagem clara → alta confiança, mensagem vaga → fila).
- Tela "Corridas Pendentes" funcional, com confirmar/descartar testados.
- Payload de saída confirmado batendo com o contrato proposto (teste contra endpoint fake).
- Build do frontend e do backend passaram.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
