import {
  Zap, Brain, Send, GitBranch, Timer, Database, Image, Mic, FileText,
  UserPlus, Search, Repeat, Heart, Users, Workflow, Target, Clock, DatabaseZap,
} from "lucide-react";

const categories = [
  {
    label: "Triggers",
    items: [
      { type: "trigger", label: "WhatsApp Recebido", icon: Zap, color: "text-emerald-500", defaults: { triggerType: "whatsapp_incoming" } },
      { type: "trigger", label: "Webhook", icon: Zap, color: "text-emerald-500", defaults: { triggerType: "webhook" } },
      { type: "trigger", label: "Agendado (Cron)", icon: Clock, color: "text-emerald-500", defaults: { triggerType: "schedule", cronExpression: "0 9 * * 1-5" } },
      { type: "trigger", label: "Mudança DB", icon: DatabaseZap, color: "text-emerald-500", defaults: { triggerType: "db_change", watchTable: "contatos", watchEvent: "INSERT" } },
    ],
  },
  {
    label: "IA",
    items: [
      { type: "ai", label: "Agente IA", icon: Brain, color: "text-violet-500", defaults: { model: "gpt-4o-mini", systemPrompt: "", temperature: 0.7, maxTokens: 1000, useMemory: false } },
      { type: "sentiment", label: "Análise Sentimento", icon: Heart, color: "text-pink-500", defaults: { inputField: "message", outputVar: "sentiment" } },
      { type: "multi_agent", label: "Multi-Agent", icon: Users, color: "text-indigo-500", defaults: { agents: [{ role: "Classificador", model: "gpt-4o-mini", systemPrompt: "" }], strategy: "sequential" } },
      { type: "intent", label: "Classificar Intenção", icon: Target, color: "text-cyan-500", defaults: { inputField: "message", outputVar: "intent", categories: ["compra", "suporte", "agendamento", "informacao", "outro"] } },
    ],
  },
  {
    label: "Ações",
    items: [
      { type: "action", label: "Enviar Mensagem", icon: Send, color: "text-blue-500", defaults: { actionType: "send_message", messageTemplate: "" } },
      { type: "action", label: "Enviar Imagem", icon: Image, color: "text-blue-500", defaults: { actionType: "send_image", mediaUrl: "", caption: "" } },
      { type: "action", label: "Enviar Áudio", icon: Mic, color: "text-blue-500", defaults: { actionType: "send_audio", mediaUrl: "" } },
      { type: "action", label: "Enviar Documento", icon: FileText, color: "text-blue-500", defaults: { actionType: "send_document", mediaUrl: "", fileName: "" } },
      { type: "action", label: "HTTP Request", icon: Send, color: "text-blue-500", defaults: { actionType: "http_request", httpUrl: "", httpMethod: "POST" } },
    ],
  },
  {
    label: "Dados",
    items: [
      { type: "supabase_query", label: "Query Banco", icon: Search, color: "text-cyan-500", defaults: { operation: "select", tableName: "contatos", columns: "*", limit: 10 } },
      { type: "lead_capture", label: "Capturar Lead", icon: UserPlus, color: "text-teal-500", defaults: { phoneField: "{{phone}}", nameField: "{{nome}}", emailField: "", initialStage: "novo" } },
    ],
  },
  {
    label: "Lógica",
    items: [
      { type: "condition", label: "Condição If/Else", icon: GitBranch, color: "text-amber-500", defaults: { field: "", operator: "equals", value: "" } },
      { type: "loop", label: "Loop (Iterar)", icon: Repeat, color: "text-orange-500", defaults: { arrayField: "", iteratorVar: "item", maxIterations: 50 } },
      { type: "delay", label: "Delay", icon: Timer, color: "text-muted-foreground", defaults: { delayValue: 5, delayUnit: "seconds" } },
      { type: "memory", label: "Memória", icon: Database, color: "text-rose-500", defaults: { operation: "get", key: "" } },
      { type: "subworkflow", label: "Subworkflow", icon: Workflow, color: "text-teal-500", defaults: { workflowId: "", inputMapping: "{}" } },
    ],
  },
];

export function NodePalette() {
  const onDragStart = (e: React.DragEvent, type: string, label: string, defaults: any) => {
    e.dataTransfer.setData("application/reactflow", JSON.stringify({ type, label, defaults }));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="w-full md:w-64 md:shrink-0 border-b md:border-b-0 md:border-r border-border bg-card/40 max-h-64 md:max-h-none md:h-full overflow-y-auto p-3 space-y-4 rounded-lg md:rounded-none">
      <h3 className="text-sm font-semibold tracking-tight">Componentes</h3>
      {categories.map((cat) => (
        <div key={cat.label} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {cat.label}
          </p>
          <div className="space-y-1.5">
            {cat.items.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={`${cat.label}-${item.label}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, item.type, item.label, item.defaults)}
                  className="flex items-center gap-2 p-2 rounded-md border border-border/60 bg-background cursor-grab hover:border-primary/40 transition-colors select-none text-sm"
                >
                  <Icon className={`h-4 w-4 ${item.color}`} />
                  <span className="truncate">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
