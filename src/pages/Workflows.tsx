import { CRMLayout } from "@/components/CRMLayout";
import { WorkflowCanvas } from "@/components/workflows/WorkflowCanvas";
import { NodePalette } from "@/components/workflows/NodePalette";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Play, RotateCcw, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflowStore";

export default function WorkflowsPage() {
  const { nodes, edges, resetWorkflow } = useWorkflowStore();

  const salvar = () => {
    const payload = { nodes, edges, savedAt: new Date().toISOString() };
    localStorage.setItem("workflow_draft", JSON.stringify(payload));
    toast.success("Workflow salvo localmente");
  };

  const executar = () => {
    toast.info("Execução via n8n — configure o webhook em Integrações");
  };

  return (
    <CRMLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg gradient-brand flex items-center justify-center shrink-0 glow-primary">
              <GitBranch className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Workflow Builder</h1>
              <p className="text-sm text-muted-foreground">
                Arraste nós da paleta para construir automações
              </p>
            </div>
            <Badge variant="secondary" className="ml-2">
              {nodes.length} nós · {edges.length} conexões
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetWorkflow();
                toast.info("Workflow limpo");
              }}
            >
              <RotateCcw className="h-4 w-4 mr-1" /> Limpar
            </Button>
            <Button variant="outline" size="sm" onClick={salvar}>
              <Save className="h-4 w-4 mr-1" /> Salvar
            </Button>
            <Button size="sm" onClick={executar}>
              <Play className="h-4 w-4 mr-1" /> Executar
            </Button>
          </div>
        </div>

        {/* Canvas + Paleta */}
        <div className="flex-1 flex gap-4 pt-4 min-h-0">
          <NodePalette />
          <div className="flex-1 rounded-lg border border-border overflow-hidden bg-card">
            <WorkflowCanvas />
          </div>
        </div>
      </div>
    </CRMLayout>
  );
}
