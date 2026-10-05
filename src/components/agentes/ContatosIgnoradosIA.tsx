/**
 * ContatosIgnoradosIA.tsx — lista "Contatos que a IA não responde" (Sprint 4 / H1, 2026-10-05).
 * Contatos pessoais (família, amigos, fornecedores) que usam o mesmo número não devem receber
 * resposta da IA. O motor consulta `ia_contatos_ignorados` antes de responder
 * (backend/src/services/agentEngine.ts → iaNaoDeveResponder).
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserX, Trash2, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { getAuthToken } from "@/lib/api-token";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";

interface Ignorado { id: number; telefone: string; nome: string | null }

async function apiFetch(path: string, options: RequestInit = {}) {
  const t = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Falha (${res.status})`);
  return json;
}

export function ContatosIgnoradosIA() {
  const [lista, setLista] = useState<Ignorado[]>([]);
  const [aberto, setAberto] = useState(false);
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");

  useEffect(() => {
    apiFetch("/api/whatsapp/ia-ignorados").then(r => setLista(r ?? [])).catch(() => {});
  }, []);

  const adicionar = async () => {
    try {
      const novo = await apiFetch("/api/whatsapp/ia-ignorados", { method: "POST", body: JSON.stringify({ telefone, nome }) });
      setLista(l => [novo, ...l.filter(x => x.id !== novo.id)]);
      setTelefone(""); setNome("");
      toast.success("A IA não vai mais responder esse contato.");
    } catch (e) { toast.error((e as Error).message); }
  };

  const remover = async (i: Ignorado) => {
    try {
      await apiFetch(`/api/whatsapp/ia-ignorados/${i.id}`, { method: "DELETE" });
      setLista(l => l.filter(x => x.id !== i.id));
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card className="p-4 space-y-3">
      <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => setAberto(a => !a)}>
        <span className="text-sm font-semibold flex items-center gap-2">
          <UserX className="h-4 w-4" /> Contatos que a IA não responde ({lista.length})
        </span>
        {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {aberto && (
        <>
          <p className="text-xs text-muted-foreground">
            Use para contatos pessoais, família e fornecedores que falam com o mesmo número. A IA
            ignora as mensagens deles; você continua vendo e respondendo normalmente.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="Telefone com DDI e DDD (ex: 5511999990000)" />
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome (opcional)" />
            <Button onClick={adicionar} disabled={telefone.replace(/\D/g, "").length < 10} className="gap-1.5 shrink-0">
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          </div>
          {lista.length > 0 && (
            <ul className="divide-y rounded-md border">
              {lista.map(i => (
                <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{i.nome ? <><b>{i.nome}</b> · </> : null}<span className="font-mono text-xs">+{i.telefone}</span></span>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => remover(i)} title="Remover da lista">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
