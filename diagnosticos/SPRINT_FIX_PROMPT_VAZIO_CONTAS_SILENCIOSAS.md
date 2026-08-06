# Sprint — Corrigir contas com `prompt_sistema` vazio (IA silenciosa) — fmakonee03 e stefanocatedral

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Continuação do diagnóstico de custo de IA (`SPRINT_DIAGNOSTICO_APROFUNDADO_CUSTO_IA.md`) — achado lateral, não o foco original, mas relevante: 2 contas ativas do sistema (`fmakonee03@gmail.com` e `stefanocatedral@hotmail.com`) estão com `agent_configs.prompt_sistema` vazio, então **não geram nenhuma resposta de IA hoje** — o gate de segurança já existente no motor (`agentEngine.ts`, "sem prompt real, IA não responde") está funcionando como deveria, mas a causa raiz de por que o prompt nunca foi salvo precisa ser corrigida.

---

## Contexto

Hipótese mais provável, a confirmar: o mesmo padrão do incidente histórico da "Cris" (`ConfigAgenteIA.tsx` salvando na rota `/api/agent_configs`, que nunca existiu — a rota real é `/api/agent-config`, singular/hífen) — a tela de configuração falha silenciosamente ao salvar, o operador não percebe porque a tela não dá erro visível, e a conta fica sem prompt configurado. `fmakonee03` foi criada em 28/07 às 14:45 — se o bug ainda estiver presente (ou tiver voltado por alguma regressão), o prompt dela pode nunca ter chegado a salvar de verdade, apesar de o operador ter preenchido o formulário.

## O que fazer

1. **Confirmar a causa raiz de verdade, não assumir**: testar o fluxo de salvar configuração de agente (`ConfigAgenteIA.tsx` → `/api/agent-config`) em homolog com uma conta de teste — preencher um prompt de teste, salvar, e confirmar que persiste de fato no banco (`agent_configs.prompt_sistema`). Se salvar corretamente, o bug do roteamento **não é a causa** — investigar outra explicação (ex: erro de rede/timeout no momento específico em que essas 2 contas tentaram salvar, erro de validação silencioso, etc.) antes de prosseguir.
2. Se o bug de roteamento (ou qualquer outro bug de salvamento) for confirmado: corrigir a causa raiz no código — não só essas 2 contas manualmente, a correção tem que valer pra qualquer conta nova que passar por esse fluxo daqui pra frente.
3. **Não escrever nenhum conteúdo de prompt pelas contas `fmakonee03`/`stefanocatedral`** — são contas de clientes reais da Mentoark, não é papel do Claude Code (nem meu) inventar a persona/prompt de negócio de outro cliente. O objetivo desta sprint é só garantir que a TELA DE CONFIGURAÇÃO funciona corretamente — depois de corrigido, avisar o usuário (Angelo) pra que ele (ou o cliente dono da conta) preencha o prompt de verdade pela interface.
4. Confirmar, depois do fix, que salvar um prompt de teste nessas 2 contas específicas (ou numa conta de teste equivalente) funciona ponta a ponta — sem deixar as contas reais com um prompt de teste esquecido lá (se usar as contas reais pro teste, reverter pro estado vazio depois, já que quem decide o conteúdo real é o dono da conta, não esta sprint).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend e backend). Testar em homolog primeiro. Se a correção for só de rota/frontend (baixo risco), pode seguir pra produção na mesma sprint, desde que testado; se envolver mudança mais estrutural, reportar e esperar aprovação separada pra produção.

## AO FINALIZAR, REPORTAR

- Causa raiz confirmada (bug de roteamento reincidente, ou outra causa).
- Correção aplicada, com teste real de salvar+persistir um prompt de teste.
- Confirmação de que nenhum conteúdo de prompt foi inventado/inserido pras contas reais dos clientes.
- Se chegou a produção nesta sprint ou fica pendente de aprovação separada.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
