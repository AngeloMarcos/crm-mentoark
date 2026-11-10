# Sprint Relatórios de Atendimento v1

Data: 2026-11-10 · Continuação da Sprint Atendimento v1 (`SPRINT_ATENDIMENTO_V1.md`, "Fora desta sprint").
Status: **CONCLUÍDA** (2026-11-10). Em produção; validado em homolog com dados sintéticos de resultado conhecido e verificação visual.

## Objetivo

Uma página **Atendimento → Relatórios** que responde, para um período: quantos atendimentos chegaram, quanto
tempo levaram para a 1ª resposta e para resolver, quantos voltaram, quem atendeu, por que foram encerrados e, agora,
quem está esperando.

## Definições (todas sobre `atendimentos`, fuso America/Sao_Paulo)

- **Período**: atendimentos com `aberto_em` no intervalo. Padrão: últimos 7 dias; máximo 92 dias.
- Ficam de fora os criados pela migração (`origem = 'migracao'`): o `aberto_em` deles é a última mensagem, não a chegada.
- **1ª resposta**: `primeira_resposta_em − aberto_em` (IA ou pessoa). **1ª resposta humana**: `primeira_resposta_humana_em − aberto_em`.
- **Resolução**: `resolvido_em − aberto_em`, só dos resolvidos.
- Tempos em mediana e p90 (média distorce com atendimento esquecido aberto).
- **Reaberto**: tem `reaberto_de` (cliente voltou em menos de 24h depois de resolvido).
- **Resolvido só pela IA**: resolvido sem nenhuma resposta humana.
- **Dentro da meta**: compara com `agentes.sla_tme` (1ª resposta humana) e `agentes.sla_tma` (resolução), em minutos, do
  número do atendimento (tela SLA / Gestão). Sem meta configurada, vale o padrão da tela (15 e 120 min).
- **Por atendente**: atribuídos no período, resolvidos por ele (pela data de resolução), mediana da 1ª resposta humana e da resolução.
- **Motivos**: resoluções do período por motivo, inclusive "Sem motivo".
- **Agora**: atendimentos em andamento por estado, sem atendente, e a fila de "aguardando humano" mais antiga primeiro.

## Entregas

1. `GET /api/atendimentos/relatorio?de=&ate=&instancia=` e `GET /api/atendimentos/agora` (escopados pela conta).
2. Página `/atendimento/relatorios` com indicadores, gráfico diário, tabela por atendente, motivos e painel "Agora".
3. Testes: regras puras (período, duração) e E2E em homolog com dados sintéticos e isolamento entre contas.

## Fora desta sprint

Alertas de SLA (notificar quando estoura), departamentos e filas, exportar CSV, relatório por etiqueta/funil.
