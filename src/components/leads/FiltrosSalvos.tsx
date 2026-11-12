/**
 * Filtros salvos da lista de Leads (2026-11-12, lacuna P3 do Cubo): guarda a combinação atual de
 * filtros com um nome, por usuário, em `filtros_salvos` (CRUD genérico /api/filtros_salvos).
 */
import { useEffect, useState } from "react";
import { Bookmark, BookmarkPlus, Check, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/integrations/database/client";
import { useToast } from "@/hooks/use-toast";

export interface FiltrosLeads {
  search: string;
  statusFilter: string;
  listaFiltro: string;
  campoFiltro: string;
  campoValor: string;
}

interface FiltroSalvo { id: string; nome: string; filtros: FiltrosLeads }

const MAX_FILTROS = 30;

/** O que aparece no resumo do item (só o que difere do padrão). */
function resumo(f: FiltrosLeads): string {
  const partes: string[] = [];
  if (f.search) partes.push(`"${f.search}"`);
  if (f.statusFilter && f.statusFilter !== "todos") partes.push(f.statusFilter);
  if (f.listaFiltro && f.listaFiltro !== "todas") partes.push("lista");
  if (f.campoFiltro && f.campoFiltro !== "nenhum") partes.push(f.campoValor ? `${f.campoFiltro}~${f.campoValor}` : f.campoFiltro);
  return partes.join(" · ");
}

export function FiltrosSalvos({ atual, onAplicar }: { atual: FiltrosLeads; onAplicar: (f: FiltrosLeads) => void }) {
  const { toast } = useToast();
  const [filtros, setFiltros] = useState<FiltroSalvo[]>([]);
  const [dialogAberto, setDialogAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await api.from("filtros_salvos").select("*").eq("tela", "leads").order("created_at", { ascending: true });
      setFiltros(((data || []) as any[]).map(r => ({ id: r.id, nome: r.nome, filtros: r.filtros || {} })));
    })();
  }, []);

  const filtroVazio = !atual.search && atual.statusFilter === "todos" && atual.listaFiltro === "todas" && (atual.campoFiltro === "nenhum" || !atual.campoFiltro);

  const salvar = async () => {
    const n = nome.trim();
    if (!n) return;
    if (filtros.some(f => f.nome.toLowerCase() === n.toLowerCase())) {
      toast({ title: "Já existe um filtro com este nome", variant: "destructive" });
      return;
    }
    setSalvando(true);
    const { data, error } = await api.from("filtros_salvos").insert({ tela: "leads", nome: n, filtros: atual }).select().single();
    setSalvando(false);
    if (error || !data) { toast({ title: "Erro ao salvar filtro", description: error?.message, variant: "destructive" }); return; }
    setFiltros(prev => [...prev, { id: (data as any).id, nome: n, filtros: atual }]);
    setDialogAberto(false);
    setNome("");
    toast({ title: `Filtro "${n}" salvo` });
  };

  const excluir = async (f: FiltroSalvo, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const { error } = await api.from("filtros_salvos").delete().eq("id", f.id);
    if (error) { toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }); return; }
    setFiltros(prev => prev.filter(x => x.id !== f.id));
    toast({ title: `Filtro "${f.nome}" excluído` });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2 w-full sm:w-auto">
            <Bookmark className="h-4 w-4" />
            Filtros salvos{filtros.length > 0 && ` (${filtros.length})`}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Filtros salvos</DropdownMenuLabel>
          {filtros.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum ainda — monte os filtros e salve a combinação.</p>
          )}
          {filtros.map(f => (
            <DropdownMenuItem key={f.id} className="flex items-start justify-between gap-2" onClick={() => onAplicar(f.filtros)}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{f.nome}</span>
                {resumo(f.filtros) && <span className="block truncate text-xs text-muted-foreground">{resumo(f.filtros)}</span>}
              </span>
              <button
                type="button"
                aria-label={`Excluir filtro ${f.nome}`}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                onClick={(e) => excluir(f, e)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={filtroVazio || filtros.length >= MAX_FILTROS} onClick={() => { setNome(""); setDialogAberto(true); }}>
            <BookmarkPlus className="mr-2 h-4 w-4" />
            {filtroVazio ? "Salvar filtro atual (nenhum filtro ativo)" : "Salvar filtro atual…"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Salvar filtro</DialogTitle>
            <DialogDescription>{resumo(atual) || "Filtros atuais da lista."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); salvar(); }}>
            <Input value={nome} onChange={e => setNome(e.target.value)} maxLength={60} placeholder="Ex.: Quentes de Santos" autoFocus />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setDialogAberto(false)}>Cancelar</Button>
              <Button type="submit" disabled={salvando || !nome.trim()}>
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />} Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
