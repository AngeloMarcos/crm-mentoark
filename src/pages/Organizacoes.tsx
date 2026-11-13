/**
 * Organizações (2026-11-12): a empresa do contato como registro próprio, com os contatos dentro.
 * Vincular um contato é feito na ficha dele (Leads → Editar → Organização).
 */
import { useCallback, useEffect, useState } from "react";
import { Building2, ExternalLink, Loader2, MapPin, Pencil, Phone, Plus, Search, Trash2, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CRMLayout } from "@/components/CRMLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  criarOrganizacao, editarOrganizacao, excluirOrganizacao, lerOrganizacao, listarOrganizacoes,
  type ContatoDaOrganizacao, type Organizacao,
} from "@/lib/organizacoes";

interface Rascunho { id?: string; nome: string; site: string; telefone: string; cidade: string; estado: string; notas: string }
const NOVA: Rascunho = { nome: "", site: "", telefone: "", cidade: "", estado: "", notas: "" };

function DialogoOrganizacao({ rascunho, onFechar, onSalvo }: { rascunho: Rascunho | null; onFechar: () => void; onSalvo: () => void }) {
  const [r, setR] = useState<Rascunho>(NOVA);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (rascunho) setR(rascunho); }, [rascunho]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const dados = {
        nome: r.nome.trim(), site: r.site.trim() || null, telefone: r.telefone.trim() || null,
        cidade: r.cidade.trim() || null, estado: r.estado.trim() || null, notas: r.notas.trim() || null,
      };
      if (r.id) await editarOrganizacao(r.id, dados);
      else await criarOrganizacao(dados);
      toast.success(r.id ? "Organização salva" : "Organização criada");
      onSalvo();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={!!rascunho} onOpenChange={v => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{r.id ? "Editar organização" : "Nova organização"}</DialogTitle>
          <DialogDescription>A empresa dos seus contatos, com os dados dela num lugar só.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (r.nome.trim()) salvar(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="org-nome">Nome *</Label>
            <Input id="org-nome" value={r.nome} maxLength={120} autoFocus onChange={e => setR({ ...r, nome: e.target.value })} placeholder="Ex.: Construtora Alfa" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="org-site">Site</Label>
              <Input id="org-site" value={r.site} onChange={e => setR({ ...r, site: e.target.value })} placeholder="alfa.com.br" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-tel">Telefone</Label>
              <Input id="org-tel" value={r.telefone} onChange={e => setR({ ...r, telefone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-cidade">Cidade</Label>
              <Input id="org-cidade" value={r.cidade} onChange={e => setR({ ...r, cidade: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-estado">Estado</Label>
              <Input id="org-estado" value={r.estado} maxLength={40} onChange={e => setR({ ...r, estado: e.target.value })} placeholder="SP" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-notas">Notas</Label>
            <Textarea id="org-notas" rows={3} value={r.notas} onChange={e => setR({ ...r, notas: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={salvando || !r.nome.trim()}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoContatos({ org, onFechar }: { org: Organizacao | null; onFechar: () => void }) {
  const navigate = useNavigate();
  const [contatos, setContatos] = useState<ContatoDaOrganizacao[] | null>(null);
  useEffect(() => {
    if (!org) { setContatos(null); return; }
    lerOrganizacao(org.id).then(d => setContatos(d.contatos || [])).catch((e: any) => { setContatos([]); toast.error(e.message); });
  }, [org]);

  return (
    <Dialog open={!!org} onOpenChange={v => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{org?.nome}</DialogTitle>
          <DialogDescription>Contatos desta organização. Para vincular alguém, abra o contato em Leads.</DialogDescription>
        </DialogHeader>
        {contatos === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : contatos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum contato vinculado ainda.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {contatos.map(c => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[c.cargo, c.telefone, c.email].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Abrir ${c.nome}`} onClick={() => navigate(`/leads?contato=${c.id}`)}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function OrganizacoesPage() {
  const [orgs, setOrgs] = useState<Organizacao[] | null>(null);
  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [vendoContatos, setVendoContatos] = useState<Organizacao | null>(null);

  const carregar = useCallback(() => {
    listarOrganizacoes().then(setOrgs).catch((e: any) => { setOrgs([]); toast.error(e.message); });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const excluir = async (o: Organizacao) => {
    if (!window.confirm(`Excluir "${o.nome}"? Os contatos continuam no CRM, só deixam de ter organização.`)) return;
    try { await excluirOrganizacao(o.id); carregar(); toast.success("Organização excluída"); } catch (e: any) { toast.error(e.message); }
  };

  const visiveis = (orgs || []).filter(o => !busca.trim() || o.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <CRMLayout>
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Organizações</h1>
            <p className="text-sm text-muted-foreground">As empresas dos seus contatos. Vincule um contato pela ficha dele, em Leads.</p>
          </div>
          <Button onClick={() => setRascunho({ ...NOVA })}><Plus className="mr-2 h-4 w-4" /> Nova organização</Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar organização…" aria-label="Buscar organização" />
        </div>

        {orgs === null ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : visiveis.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {orgs.length === 0 ? "Nenhuma organização ainda. Crie a primeira e vincule contatos a ela." : "Nenhuma organização com esse nome."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visiveis.map(o => (
              <Card key={o.id} className="transition-shadow hover:shadow-md">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{o.nome}</p>
                        {o.site && <p className="truncate text-xs text-muted-foreground">{o.site}</p>}
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Editar ${o.nome}`}
                        onClick={() => setRascunho({ id: o.id, nome: o.nome, site: o.site || "", telefone: o.telefone || "", cidade: o.cidade || "", estado: o.estado || "", notas: o.notas || "" })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`Excluir ${o.nome}`} onClick={() => excluir(o)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {o.telefone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{o.telefone}</span>}
                    {(o.cidade || o.estado) && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{[o.cidade, o.estado].filter(Boolean).join("/")}</span>}
                  </div>
                  <Button variant="outline" size="sm" className="h-7 w-full gap-1.5 text-xs" onClick={() => setVendoContatos(o)}>
                    <Users className="h-3 w-3" />
                    {o.contatos ? `${o.contatos} contato${o.contatos > 1 ? "s" : ""}` : "Sem contatos"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      <DialogoOrganizacao rascunho={rascunho} onFechar={() => setRascunho(null)} onSalvo={() => { setRascunho(null); carregar(); }} />
      <DialogoContatos org={vendoContatos} onFechar={() => setVendoContatos(null)} />
    </CRMLayout>
  );
}
