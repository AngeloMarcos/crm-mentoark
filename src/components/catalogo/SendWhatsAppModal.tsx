import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
const token = () => localStorage.getItem("access_token") || "";

interface Contato {
  id: string;
  nome: string;
  telefone: string;
}

interface SendWhatsAppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "product" | "catalog";
  id: string; // produtoId ou catalogoId
}

export function SendWhatsAppModal({ open, onOpenChange, type, id }: SendWhatsAppModalProps) {
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const carregarContatos = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/contatos?limit=100`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (r.ok) {
        setContatos(await r.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      carregarContatos();
      setSelected([]);
    }
  }, [open]);

  const filteredContatos = contatos.filter(
    (c) =>
      c.nome.toLowerCase().includes(search.toLowerCase()) ||
      c.telefone.includes(search)
  );

  const handleSend = async () => {
    if (selected.length === 0) {
      toast.error("Selecione pelo menos um contato");
      return;
    }

    setSending(true);
    try {
      const endpoint = type === "product" ? "/api/catalogo/whatsapp/produto" : "/api/catalogo/whatsapp/catalogo";
      const body = type === "product" 
        ? { produto_id: id, contatos: selected }
        : { catalogo_id: id, contatos: selected };

      const r = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify(body),
      });

      if (r.ok) {
        const data = await r.json();
        toast.success(`${data.enviados || data.contatos} envio(s) processado(s)`);
        onOpenChange(false);
      } else {
        const err = await r.json();
        throw new Error(err.message || "Erro ao enviar");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const toggleSelect = (telefone: string) => {
    setSelected((prev) =>
      prev.includes(telefone) ? prev.filter((t) => t !== telefone) : [...prev, telefone]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar via WhatsApp</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar contatos..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <ScrollArea className="h-[300px] border rounded-md p-2">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filteredContatos.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                Nenhum contato encontrado
              </div>
            ) : (
              <div className="space-y-2">
                {filteredContatos.map((contato) => (
                  <div
                    key={contato.id}
                    className="flex items-center space-x-3 p-2 hover:bg-muted rounded-md cursor-pointer"
                    onClick={() => toggleSelect(contato.telefone)}
                  >
                    <Checkbox
                      checked={selected.includes(contato.telefone)}
                      onCheckedChange={() => toggleSelect(contato.telefone)}
                    />
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-medium leading-none truncate">{contato.nome}</p>
                      <p className="text-xs text-muted-foreground">{contato.telefone}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="text-xs text-muted-foreground px-1">
            {selected.length} contato(s) selecionado(s)
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending || selected.length === 0}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Enviar Agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
