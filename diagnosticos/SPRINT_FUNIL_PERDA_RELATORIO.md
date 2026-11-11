# Sprint Funil: perda com motivo e relatório do funil

Data: 2026-11-10 · Origem: relatório de lacunas do Cubo (`engenharia_reversa_suite/RELATORIO_LACUNAS_CUBO_2026-11-04.md`),
Prioridade 3 (ganhar/perder com motivo) e Prioridade 2 (relatório do funil: lostreason, timeToClose, velocity).
Status: **CONCLUÍDA** (2026-11-11). Em produção; validado em homolog com dados sintéticos de resultado conhecido (22/22) e verificação visual do diálogo de perda e do relatório.

## O que muda

1. **Perda com motivo cadastrado.** Levar um card para uma etapa de tipo "Perdido" pede o motivo, escolhido do cadastro
   (`motivos` com `tipo = 'perda'`, já criado na Sprint Atendimento). Padrões na 1ª leitura: Preço, Comprou do concorrente,
   Sem resposta, Sem interesse, Fora do perfil. Obrigatório quando a conta liga "Motivo obrigatório" (mesmo ajuste de
   transferir/resolver). O evento do funil guarda `motivo_id` e o nome no texto (o histórico de hoje continua igual).
   A IA não move para Ganho/Perdido (regra existente). API: `PUT /v1/peoples/:id/stage` aceita `lostReasonId`.
2. **Relatório do funil** (`GET /api/funil-auto/relatorio`, página `/funil/relatorio`), período em dias de Brasília:
   - entraram no funil (1º movimento do contato no período), ganhos, perdidos, conversão = ganhos ÷ (ganhos + perdidos),
     valor ganho (`valor_potencial` dos ganhos);
   - ciclo de venda: mediana entre a 1ª entrada no funil e o ganho;
   - por etapa: cards e valor agora, quantos saíram dela no período e o tempo mediano que ficaram;
   - motivos de perda.
   Base: `funil_eventos` com `resultado = 'feito'` e `origem <> 'automacao'`. Contato ganho duas vezes no período conta uma vez.

## Fora desta sprint

Campos personalizados, filtros salvos, organizações, motivo de ganho.
