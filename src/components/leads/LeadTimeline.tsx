import { useEffect, useState } from "react";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Phone,
  MessageCircle,
  Mail,
  Calendar,
  ArrowRight,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

interface Evento {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  data_evento: string;
}

const tipos = [
  { value: "nota", label: "Nota", icon: FileText, color: "text-muted-foreground bg-muted" },
  { value: "chamada", label: "Chamada", icon: Phone, color: "text-primary bg-primary/15" },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "text-success bg-success/15" },
  { value: "email", label: "E-mail", icon: Mail, color: "text-info bg-info/15" },
  { value: "reuniao", label: "Reunião", icon: Calendar, color: "text-accent bg-accent/15" },
  { value: "status", label: "Status", icon: ArrowRight, color: "text-warning bg-warning/15" },
];

function tempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function LeadTimeline({ contatoId }: { contatoId: string }) {
  const { user } = useAuth();
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tipo, setTipo] = useState("nota");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("timeline_eventos")
      .select("id, tipo, titulo, descricao, data_evento")
      .eq("contato_id", contatoId)
      .order("data_evento", { ascending: false });
    if (error) toast.error("Erro ao carregar timeline");
    else setEventos(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contatoId]);

  const adicionar = async () => {
    if (!user || !titulo.trim()) return;
    setSaving(true);
    const { error } = await api.from("timeline_eventos").insert({
      user_id: user.id,
      contato_id: contatoId,
      tipo,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Erro ao adicionar");
      return;
    }
    toast.success("Evento adicionado");
    setTitulo("");
    setDescricao("");
    setTipo("nota");
    carregar();
  };

  return (
    <div className="space-y-4">
      {/* Formulário inline */}
      <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/30">
        <div className="grid grid-cols-[140px_1fr] gap-2">
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tipos.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Título do evento"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            className="h-9"
          />
        </div>
        <Textarea
          placeholder="Descrição (opcional)"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={2}
          className="text-sm"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={adicionar} disabled={!titulo.trim() || saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            Adicionar
          </Button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : eventos.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Nenhum evento registrado ainda.
        </div>
      ) : (
        <div className="space-y-3">
          {eventos.map((ev, i) => {
            const meta = tipos.find((t) => t.value === ev.tipo) ?? tipos[0];
            const Icon = meta.icon;
            return (
              <div key={ev.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${meta.color}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  {i < eventos.length - 1 && (
                    <div className="w-px flex-1 bg-border mt-1" />
                  )}
                </div>
                <div className="pb-3 flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium truncate">{ev.titulo}</p>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {tempoRelativo(ev.data_evento)}
                    </span>
                  </div>
                  {ev.descricao && (
                    <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">
                      {ev.descricao}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
