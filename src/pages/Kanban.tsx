/**
 * Kanban.tsx — Página principal do quadro Kanban (rota /kanban)
 *
 * [AUDITORIA] BUG (achado 2026-08-04 — Sprint Kanban estilo Jira): este arquivo mantinha uma
 * cópia própria e completa (~450 linhas) de toda a lógica do quadro — estado, filtros, CRUD de
 * tarefas/colunas, drag & drop — DUPLICADA de `KanbanBoard.tsx`, que existia com o comentário
 * "reutilizável, usado em /kanban e na aba Tarefas de Equipe". Checado por grep: nenhum arquivo
 * importava `KanbanBoard` — era código morto, e esta página nunca chegou a usá-lo de fato. Toda
 * mudança no quadro (ex: sensores de toque, filtros rápidos) precisava ser replicada nos dois
 * lugares manualmente, com risco real de os dois arquivos ficarem incoerentes entre si (já
 * estavam: `KanbanBoard.tsx` tinha um badge "IA" com texto diferente do daqui).
 * [AUDITORIA] FIX APLICADO: esta página passa a só renderizar `KanbanBoard` dentro do
 * `CRMLayout`. Toda a lógica (e as melhorias desta sprint: TouchSensor pra iPad/tablet, filtros
 * rápidos "Minhas tarefas"/"Alta prioridade", placeholder tracejado no drag) vive só em
 * `KanbanBoard.tsx` a partir de agora.
 */
import { CRMLayout } from "@/components/CRMLayout";
import KanbanBoard from "@/components/kanban/KanbanBoard";

const KanbanPage = () => (
  <CRMLayout>
    <KanbanBoard className="p-4" />
  </CRMLayout>
);

export default KanbanPage;
