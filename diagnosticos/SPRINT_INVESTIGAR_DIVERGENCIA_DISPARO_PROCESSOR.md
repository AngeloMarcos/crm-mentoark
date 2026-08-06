# Sprint — Investigar e corrigir divergência de `disparoProcessor.ts` entre homolog e produção

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Achado colateral, não investigado ainda** — surgiu como efeito lateral da sprint de fechamento do fix nome/telefone (mesmo dia, 2026-08-06), ao comparar arquivos locais contra a VPS.

---

## Contexto (relatado, ainda não investigado a fundo)

Ao comparar `backend/src/services/disparoProcessor.ts` local contra `/opt/crm/backend/src/services/disparoProcessor.ts` (produção) e `/opt/crm-homolog/backend/src/services/disparoProcessor.ts` (homolog), os arquivos **divergem**. Produção está rodando uma versão **anterior** ao fix de legenda de mídia (`SPRINT_DISPAROS_FIX_LEGENDA_MIDIA.md` / sessão 2026-08-02, mesmo dia da correção documentada em `STATUS.md`): a prioridade `legendaFinal = mensagem || legenda_midia` (que resolve corretamente `{{placeholders}}` em legenda de campanha de mídia baseada em template) não está lá — produção voltou a ter o comportamento antigo, que manda `{{placeholders}}` literais na legenda quando a campanha vem de um template.

Isso é uma **regressão**: o fix já tinha sido testado e deployado em produção antes (conforme `STATUS.md`, sessão 2026-08-02), mas o arquivo atual na VPS não reflete isso. Não sabemos ainda a causa — hipóteses a confirmar, não assumir nenhuma:

- Um deploy manual (scp direto, fora de `scripts/deploy.sh`) sobrescreveu o arquivo com uma versão antiga.
- Um rollback ou restore de backup trouxe uma versão anterior de volta.
- O deploy de outra sprint, feito em paralelo por esta mesma sessão do Claude Code rodando em outra janela, copiou um arquivo desatualizado do working tree local por engano (ex: `git stash`/checkout de branch sem perceber).
- Divergência mais antiga do que se pensa — talvez o fix nunca tenha sido deployado de fato em produção da forma como `STATUS.md` registrou (documentação incorreta na época).

## O que fazer

1. **Reconstruir a linha do tempo antes de mexer em qualquer coisa**: `git log`/`git blame` do arquivo local, comparar hash/data de modificação do arquivo em `/opt/crm/backend/src/services/disparoProcessor.ts` (produção) contra `/opt/crm-homolog/.../disparoProcessor.ts` (homolog) e contra o local — `diff` completo dos três, não só checar se são iguais/diferentes. Registrar exatamente QUAL trecho falta em produção (só a prioridade `legendaFinal`, ou mais coisa também?).
2. **Confirmar se é só este arquivo ou se outros arquivos da mesma sprint (2026-08-02) também regrediram em produção** — a sprint de legenda de mídia tocou também `src/pages/Disparos.tsx` (frontend). Comparar esse também contra `/opt/crm/src/pages/Disparos.tsx`.
3. **Não assumir causa nenhuma da lista acima sem evidência** — se não der pra determinar a causa raiz com certeza razoável (ex: sem log de deploy antigo o suficiente), registrar como "causa não determinada" em vez de forçar uma hipótese.
4. **Corrigir via `scripts/deploy.sh prod --confirm`** (nunca `scp` manual) — build local primeiro, redeployar `disparoProcessor.ts` (e `Disparos.tsx` também, se o item 2 confirmar que também regrediu) pra produção com o conteúdo correto (o mesmo que já está em homolog/local, testado).
5. **Teste real em homolog antes de reconfirmar em produção**: campanha de mídia criada a partir de um template com `{{primeiro_nome}}` na legenda, mandar pra um contato de teste — confirmar que a legenda chega com o placeholder substituído, não literal. Repetir a mesma checagem em produção logo após o redeploy (com um contato de teste real, mesmo cuidado de sempre).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Esta é uma correção de regressão em produção, não uma feature nova — mas ainda assim testar em homolog antes de reconfirmar em produção (o arquivo já existe e já foi testado antes; o objetivo aqui é entender por que sumiu e garantir que o redeploy não introduz outra divergência). Não mexer em nenhum outro serviço da VPS além dos dois arquivos identificados, a menos que o item 2 encontre mais divergências.

## AO FINALIZAR, REPORTAR

- Diff exato encontrado entre produção/homolog/local (o que faltava em produção, linha a linha se for pequeno).
- Causa raiz determinada, ou registrado como "não determinada" com o que foi checado pra tentar achar.
- Confirmação de que `Disparos.tsx` (frontend) não tem a mesma divergência (ou, se tiver, o que foi corrigido também).
- Resultado do teste real em homolog e em produção (legenda com placeholder substituído corretamente).
- Deploy feito via `scripts/deploy.sh prod --confirm`, `/health` 200, sem `ERROR` nos logs.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md` com o achado completo — inclusive a lição de processo, se alguma ficar clara (ex: "sempre confirmar hash contra a VPS depois de qualquer deploy", se for esse o caso).
