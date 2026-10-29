import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronUp, List, MoreHorizontal, Search, Trash2, Users, X } from "lucide-react";

export interface ListaBase {
  id: string;
  nome: string;
  created_at?: string | null;
}

export interface ResumoLista {
  total: number; validos: number; sem_whatsapp: number; pendentes: number; business: number; com_nome: number;
  verificados?: number; score_medio: number | null; nota: "A" | "B" | "C" | "D" | null;
}

export interface ImportacaoDoGrupo {
  id: string;
  data: string | null;   // "21/10/2026", extraída do nome
  total: number;
}

export interface GrupoListas {
  /** Valor usado no filtro: id da lista (grupo de 1 lista) ou "grupo:<nome normalizado>". */
  key: string;
  nome: string;
  deGrupoWhatsapp: boolean;
  importacoes: ImportacaoDoGrupo[]; // mais recente primeiro
  total: number;                    // contatos únicos somando todas as importações
  pctWhatsapp: number | null;       // null = menos da metade verificada (não higienizado)
  nota: ResumoLista["nota"];
  criadoEm: number;
}

// Mesmo padrão de `nomeDoGrupo` em backend/src/utils/classificacao.ts:
// "Importação Grupo Corretores SP 20/09/2026" -> "Corretores SP" + "20/09/2026".
const RE_IMPORTACAO_GRUPO = /^importa\S*\s+grupo\s+(.*?)(?:\s+(\d{2}\/\d{2}\/\d{4}))?\s*$/i;

export function parseNomeLista(nome: string): { nome: string; data: string | null; deGrupo: boolean } {
  const m = nome.match(RE_IMPORTACAO_GRUPO);
  if (!m) return { nome, data: null, deGrupo: false };
  return { nome: m[1].trim() || nome, data: m[2] ?? null, deGrupo: true };
}

// Porta de `notaDaLista` (backend/src/utils/classificacao.ts), aplicada ao agregado do grupo.
function notaDoAgregado(r: { total: number; validos: number; business: number; com_nome: number; verificados: number; score_medio: number | null }): ResumoLista["nota"] {
  if (r.total <= 0 || r.verificados / r.total < 0.5 || r.score_medio == null) return null;
  const pct = (n: number) => (n / r.total) * 100;
  const composto = 0.4 * r.score_medio + 0.3 * pct(r.validos) + 0.15 * pct(r.business) + 0.15 * pct(r.com_nome);
  if (composto >= 60) return "A";
  if (composto >= 40) return "B";
  if (composto >= 25) return "C";
  return "D";
}

/** Junta as importações repetidas do mesmo grupo de WhatsApp num item só. */
export function agruparListas(
  listas: ListaBase[],
  resumo: Map<string, ResumoLista>,
  membros: Map<string, Set<string>>,
): GrupoListas[] {
  const porNome = new Map<string, { nome: string; deGrupo: boolean; itens: Array<ListaBase & { data: string | null }> }>();
  for (const l of listas) {
    const p = parseNomeLista(l.nome);
    const chave = p.deGrupo ? `g:${p.nome.toLowerCase().replace(/\s+/g, " ")}` : `l:${l.id}`;
    const atual = porNome.get(chave) ?? { nome: p.nome, deGrupo: p.deGrupo, itens: [] };
    atual.itens.push({ ...l, data: p.data });
    porNome.set(chave, atual);
  }

  return [...porNome.entries()].map(([chave, g]) => {
    const itens = [...g.itens].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    const unicos = new Set<string>();
    const ag = { total: 0, validos: 0, business: 0, com_nome: 0, verificados: 0, scoreSoma: 0, scorePeso: 0 };
    for (const l of itens) {
      membros.get(l.id)?.forEach((id) => unicos.add(id));
      const r = resumo.get(l.id);
      if (!r) continue;
      ag.total += r.total; ag.validos += r.validos; ag.business += r.business; ag.com_nome += r.com_nome;
      ag.verificados += r.verificados ?? (r.total - r.pendentes);
      if (r.score_medio != null) { ag.scoreSoma += r.score_medio * r.total; ag.scorePeso += r.total; }
    }
    const score_medio = ag.scorePeso ? Math.round(ag.scoreSoma / ag.scorePeso) : null;
    const higienizado = ag.total > 0 && ag.verificados / ag.total >= 0.5;
    return {
      key: itens.length > 1 ? `grupo:${chave.slice(2)}` : itens[0].id,
      nome: g.nome,
      deGrupoWhatsapp: g.deGrupo,
      importacoes: itens.map((l) => ({ id: l.id, data: l.data, total: resumo.get(l.id)?.total ?? membros.get(l.id)?.size ?? 0 })),
      total: unicos.size || ag.total,
      pctWhatsapp: higienizado ? Math.round((ag.validos / ag.total) * 100) : null,
      nota: itens.length === 1 ? (resumo.get(itens[0].id)?.nota ?? null) : notaDoAgregado({ ...ag, score_medio }),
      criadoEm: Date.parse(itens[0].created_at ?? "") || 0,
    };
  });
}

export const notaClasse: Record<string, string> = {
  A: "bg-success/20 text-success",
  B: "bg-info/20 text-info",
  C: "bg-warning/20 text-warning",
  D: "bg-destructive/20 text-destructive",
};

type Ordem = "recentes" | "maiores" | "nota";
const ORDEM_NOTA: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
const VISIVEIS_RECOLHIDO = 10;

interface Props {
  grupos: GrupoListas[];
  filtro: string;
  onFiltro: (valor: string) => void;
  onRemoverLista: (id: string) => void;
}

export function ListasGrid({ grupos, filtro, onFiltro, onRemoverLista }: Props) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("recentes");
  const [verTodos, setVerTodos] = useState(false);
  const [aberto, setAberto] = useState(true);

  const ordenados = useMemo(() => {
    const s = busca.trim().toLowerCase();
    const lista = s ? grupos.filter((g) => g.nome.toLowerCase().includes(s)) : [...grupos];
    return lista.sort((a, b) => {
      if (ordem === "maiores") return b.total - a.total;
      if (ordem === "nota") return (ORDEM_NOTA[a.nota ?? ""] ?? 9) - (ORDEM_NOTA[b.nota ?? ""] ?? 9) || b.total - a.total;
      return b.criadoEm - a.criadoEm;
    });
  }, [grupos, busca, ordem]);

  const ativoKey = grupos.find((g) => g.key === filtro || g.importacoes.some((i) => i.id === filtro))?.key;
  // Mantém o card selecionado visível mesmo quando cairia fora das primeiras posições.
  const visiveis = verTodos || busca ? ordenados : (() => {
    const topo = ordenados.slice(0, VISIVEIS_RECOLHIDO);
    const ativo = ordenados.find((g) => g.key === ativoKey);
    return ativo && !topo.includes(ativo) ? [...topo.slice(0, VISIVEIS_RECOLHIDO - 1), ativo] : topo;
  })();

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="flex items-center gap-1.5 text-sm font-semibold" onClick={() => setAberto(!aberto)}>
          {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Listas e grupos <span className="text-muted-foreground font-normal">({grupos.length})</span>
        </button>
        {filtro !== "todas" && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onFiltro("todas")}>
            <X className="h-3 w-3 mr-1" /> Limpar filtro
          </Button>
        )}
        {aberto && (
          <div className="flex items-center gap-2 ml-auto w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar grupo ou lista..." className="h-8 pl-8 text-sm" />
            </div>
            <Select value={ordem} onValueChange={(v) => setOrdem(v as Ordem)}>
              <SelectTrigger className="h-8 w-[130px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recentes">Mais recentes</SelectItem>
                <SelectItem value="maiores">Mais contatos</SelectItem>
                <SelectItem value="nota">Melhor nota</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {aberto && (
        <>
          {visiveis.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma lista encontrada.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
              {visiveis.map((g) => (
                <CardGrupo
                  key={g.key}
                  grupo={g}
                  ativo={g.key === ativoKey}
                  filtro={filtro}
                  onFiltro={onFiltro}
                  onRemoverLista={onRemoverLista}
                />
              ))}
            </div>
          )}
          {!busca && ordenados.length > VISIVEIS_RECOLHIDO && (
            <div className="text-center">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setVerTodos(!verTodos)}>
                {verTodos ? "Mostrar menos" : `Ver todos (${ordenados.length})`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CardGrupo({ grupo: g, ativo, filtro, onFiltro, onRemoverLista }: {
  grupo: GrupoListas; ativo: boolean; filtro: string;
  onFiltro: (v: string) => void; onRemoverLista: (id: string) => void;
}) {
  const varias = g.importacoes.length > 1;
  const importacaoAtiva = varias ? g.importacoes.find((i) => i.id === filtro) : undefined;
  const Icone = g.deGrupoWhatsapp ? Users : List;
  const ultima = g.importacoes[0]?.data;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onFiltro(ativo && !importacaoAtiva ? "todas" : g.key)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFiltro(ativo && !importacaoAtiva ? "todas" : g.key); } }}
      className={`group relative rounded-md border p-2.5 text-left cursor-pointer transition-colors ${
        ativo ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border hover:bg-muted/50"}`}
    >
      <div className="flex items-start gap-1.5 pr-6">
        <Icone className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-sm font-medium leading-tight line-clamp-2 break-words" title={g.nome}>{g.nome}</p>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{g.total.toLocaleString("pt-BR")}</span> contatos
        {g.nota && <span className={`ml-auto rounded px-1 text-[10px] font-bold ${notaClasse[g.nota]}`} title="Nota de qualidade da lista">{g.nota}</span>}
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5">
        {varias ? `${g.importacoes.length} importações · última ${ultima ?? "—"}` : ultima ? `Importado em ${ultima}` : "Lista manual"}
      </p>

      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden" title={g.pctWhatsapp == null ? "Ainda não higienizada" : `${g.pctWhatsapp}% com WhatsApp válido`}>
        {g.pctWhatsapp != null && <div className="h-full bg-success" style={{ width: `${g.pctWhatsapp}%` }} />}
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {g.pctWhatsapp == null ? "Não higienizada" : `${g.pctWhatsapp}% com WhatsApp`}
      </p>

      {importacaoAtiva && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFiltro(g.key); }}
          className="mt-1.5 inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary"
          title="Voltar a ver todas as importações deste grupo"
        >
          Só a importação de {importacaoAtiva.data ?? "—"} <X className="h-2.5 w-2.5" />
        </button>
      )}

      <div className="absolute top-1.5 right-1.5" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-60 group-hover:opacity-100" aria-label="Opções da lista">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {varias && (
              <>
                <DropdownMenuLabel className="text-xs">Ver só uma importação</DropdownMenuLabel>
                {g.importacoes.map((i) => (
                  <DropdownMenuItem key={i.id} onClick={() => onFiltro(i.id)} className="text-xs">
                    {i.data ?? "Sem data"} <span className="ml-auto text-muted-foreground tabular-nums">{i.total}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="text-xs text-destructive">
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir importação
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {g.importacoes.map((i) => (
                      <DropdownMenuItem key={i.id} onClick={() => onRemoverLista(i.id)} className="text-xs text-destructive">
                        {i.data ?? "Sem data"} ({i.total})
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}
            {!varias && (
              <DropdownMenuItem onClick={() => onRemoverLista(g.importacoes[0].id)} className="text-xs text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir lista
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
