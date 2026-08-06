# Sprint — Mapeamento completo do módulo Disparos: o que está pronto, o que tem bug, o que falta

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Esta sprint é só diagnóstico/relatório — não corrigir nada aqui, só mapear.** O módulo de Disparos acumulou muitas sprints ao longo do tempo (importação, agendamento, multi-instância, placeholders, upload de mídia, templates, deploy) e o usuário perdeu a visão clara de: o que já está implementado E deployado, o que está implementado mas só em homolog, o que foi proposto mas nunca rodado, e o que ainda nem foi especificado. Esta sprint fecha essa lacuna.

---

## Parte 1 — Inventário de sprints já propostas (ler os arquivos, não confiar só no nome)

Ler cada um destes arquivos em `diagnosticos/` (se algum já tiver sido absorvido/removido, contar como executado e buscar a confirmação em `AUDITORIA_LOG.md`/`STATUS.md`) e classificar como: **NÃO EXECUTADA** / **EXECUTADA, SÓ HOMOLOG** / **EXECUTADA, EM PRODUÇÃO** / **PARCIALMENTE EXECUTADA** (dizer o que falta):

- Importação CSV/XLSX (já absorvida — confirmar onde ficou: homolog e/ou produção)
- Agendamento de disparo (rascunho → em_andamento)
- Multi-instância / round-robin
- Placeholders de personalização + upload de mídia + limpeza de UI decorativa
- Templates de Mensagem (tela dedicada + integração no wizard)
- Deploy pra produção (Templates + Placeholders/Upload) — `SPRINT_DISPAROS_DEPLOY_PRODUCAO.md`
- Bloqueio de reenvio duplicado entre campanhas — `SPRINT_DISPAROS_BLOQUEIO_REENVIO_DUPLICADO.md`
- Colunas de status de envio + tag no chat/contato — `SPRINT_DISPAROS_COLUNAS_STATUS_ENVIO_CONTATOS.md`
- Intervalo anti-ban em minutos — `SPRINT_DISPAROS_INTERVALO_MINUTOS.md`
- Variação de imagem por envio — `SPRINT_DISPAROS_VARIACAO_IMAGEM.md`
- Verificação prática de que o motor não manda em rajada — `SPRINT_DISPAROS_VERIFICACAO_ANTIBAN_RAJADA.md`

## Parte 2 — Releitura fresca do código atual (não confiar em comentários `[AUDITORIA]` antigos sem reconfirmar)

Ler por completo, na versão atual: `src/pages/Disparos.tsx`, `src/pages/DisparoTemplates.tsx`, `backend/src/services/disparoProcessor.ts`, `backend/src/routes/disparos.ts`, e as partes relevantes de `backend/src/migrations.ts` (tabelas `disparos`, `disparo_logs`, `disparo_templates`, função `get_next_disparo_batch`/`promover_disparos_agendados`).

Catalogar, com base na leitura (não em memória de sessões passadas):
1. O que está **implementado e funcional** (com evidência: teste real já feito, não só "parece certo pelo código").
2. O que está **implementado mas nunca testado com dado real** (build limpo, sem teste em homolog/produção).
3. O que é **decorativo/stub** (botão sem ação, campo que não é lido em lugar nenhum, etc.) — varredura ativa, não só repetir achados antigos.
4. O que está **fora de escopo/não iniciado** — qualquer coisa mencionada em conversas anteriores que nunca virou nem um `[AUDITORIA]` comment nem código.

## Parte 3 — Consolidar num relatório único

Produzir uma tabela final (formato livre, mas completo) com no mínimo estas colunas: **Funcionalidade | Status (dos 4 acima) | Ambiente (nenhum/homolog/produção) | Testado com dado real? | Observação**. Cobrir pelo menos: importação de contatos, agendamento, seleção/round-robin de instâncias, perfis de velocidade/delay, teto diário (por conta ou por instância — confirmar qual está ativo hoje), placeholders de personalização, upload de mídia, templates de mensagem, prévia da mensagem (passo 2 — sabidamente simples, ainda não melhorada), bloqueio de reenvio duplicado, colunas/tag de status de envio, variação de imagem, opt-out, retry/circuit breaker de erros.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Não alterar código nesta sprint — é puramente investigação e relatório. Se durante a leitura aparecer um bug óbvio e de baixíssimo risco (ex: erro de digitação, comentário desatualizado), pode anotar no relatório como achado, mas não corrigir sem que o usuário peça — o objetivo aqui é dar visão clara antes de decidir a próxima ação, não acumular mais mudanças não revisadas.

## AO FINALIZAR, REPORTAR

- A tabela completa da Parte 3.
- Lista curta (top 3-5) do que o Claude Code recomendaria priorizar a seguir, com justificativa.
- Confirmação de que nenhum código foi alterado nesta sprint.
- Atualizar `STATUS.md` com um resumo consolidado do estado do módulo Disparos (pode substituir/consolidar entradas antigas espalhadas, se fizer sentido, sem perder informação relevante).
