import { useEffect, useState } from "react";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface Tarefa {
  id: string;
  titulo: string;
  status: string;
  prioridade: string;
  prazo: string | null;
  concluida_at: string | null;
}

const prioridades = [
  { value: "baixa", label: "Baixa", color: "bg-muted text-muted-foreground" },
  { value: "media", label: "Média", color: "bg-info/15 text-info" },
  { value: "alta", label: "Alta", color: "bg-warning/15 text-warning" },
  { value: "urgente", label: "Urgente", color: "bg-destructive/15 text-destructive" },
];

function corPrioridade(p: string) {
  return prioridades.find((x) => x.value === p)?.color ?? "bg-muted";
}

export function LeadTarefas({
  contatoId,
  onChange,
}: {
  contatoId: string;
  onChange?: () => void;
}) {
  const { user } = useAuth();
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [titulo, setTitulo] = useState("");
  const [prioridade, setPrioridade] = useState("media");
  const [prazo, setPrazo] = useState("");

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tarefas")
      .select("id, titulo, status, prioridade, prazo, concluida_at")
      .eq("contato_id", contatoId)
      .order("prazo", { ascending: true });
    if (error) toast.error("Erro ao carregar tarefas");
    else setTarefas(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contatoId]);

  const criar = async () => {
    if (!user || !titulo.trim()) return;
    setSaving(true);
    const { error } = await api.from("tarefas").insert({
      user_id: user.id,
      contato_id: contatoId,
      titulo: titulo.trim(),
      prioridade,
      prazo: prazo ? new Date(prazo).toISOString() : null,
    });
    setSaving(false);
    if (error) {
      toast.error("Erro ao criar tarefa");
      return;
    }
    toast.success("Tarefa criada");
    setTitulo("");
    setPrioridade("media");
    setPrazo("");
    carregar();
    onChange?.();
  };

  const toggleConcluida = async (t: Tarefa, checked: boolean) => {
    const novoStatus = checked ? "concluida" : "pendente";
    const { error } = await supabase
      .from("tarefas")
      .update({
        status: novoStatus,
        concluida_at: checked ? new Date().toISOString() : null,
      })
      .eq("id", t.id);
    if (error) {
      toast.error("Erro ao atualizar");
      return;
    }
    setTarefas((prev) =>
      prev.map((x) =>
        x.id === t.id ? { ...x, status: novoStatus, concluida_at: checked ? new Date().toISOString() : null } : x,
      ),
    );
    onChange?.();
  };

  const excluir = async (id: string) => {
    const { error } = await api.from("tarefas").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    toast.success("Tarefa excluída");
    setTarefas((prev) => prev.filter((x) => x.id !== id));
    onChange?.();
  };

  const agora = Date.now();

  return (
    <div className="space-y-4">
      {/* Formulário */}
      <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/30">
        <Input
          placeholder="Título da tarefa"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          className="h-9"
        />
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Prioridade</Label>
            <Select value={prioridade} onValueChange={setPrioridade}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {prioridades.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Prazo</Label>
            <Input
              type="datetime-local"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              className="h-9"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={criar} disabled={!titulo.trim() || saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            Criar tarefa
          </Button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : tarefas.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Nenhuma tarefa para este contato.
        </div>
      ) : (
        <div className="space-y-2">
          {tarefas.map((t) => {
            const concluida = t.status === "concluida";
            const vencida =
              !concluida && t.prazo && new Date(t.prazo).getTime() < agora;
            return (
              <div
                key={t.id}
                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                  concluida
                    ? "bg-muted/30 border-border opacity-70"
                    : vencida
                      ? "bg-destructive/5 border-destructive/30"
                      : "bg-card border-border"
                }`}
              >
                <Checkbox
                  checked={concluida}
                  onCheckedChange={(c) => toggleConcluida(t, !!c)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`${corPrioridade(t.prioridade)} text-xs border-0`}>
                      {prioridades.find((p) => p.value === t.prioridade)?.label ?? t.prioridade}
                    </Badge>
                    <p
                      className={`text-sm font-medium ${concluida ? "line-through text-muted-foreground" : ""}`}
                    >
                      {t.titulo}
                    </p>
                  </div>
                  {t.prazo && (
                    <p
                      className={`text-xs flex items-center gap-1 ${
                        vencida ? "text-destructive font-medium" : "text-muted-foreground"
                      }`}
                    >
                      {vencida && <AlertTriangle className="h-3 w-3" />}
                      {new Date(t.prazo).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {vencida && " · vencida"}
                    </p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive shrink-0"
                  onClick={() => excluir(t.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
