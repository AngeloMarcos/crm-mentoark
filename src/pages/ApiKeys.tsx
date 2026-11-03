/**
 * API Keys (2026-11-02, modelo Cubo Configurações → API Keys): chaves para n8n, site e outros
 * sistemas usarem a API pública /v1. A chave aparece uma única vez, na criação.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Copy, ExternalLink, KeyRound, Loader2, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  API_URL, Acao, ChaveApi, Escopos, ROTULO_ACAO, Recursos,
  atualizarChave, criarChave, listarChaves, revogarChave,
} from "@/lib/apiKeys";

const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function resumoEscopos(chave: ChaveApi, recursos: Recursos): string {
  if (chave.full_access) return "Acesso total";
  const partes = Object.entries(chave.scopes || {}).map(([r, acoes]) =>
    `${recursos[r]?.nome ?? r}: ${acoes.map((a) => ROTULO_ACAO[a].toLowerCase()).join(", ")}`);
  return partes.join(" · ") || "Nenhuma permissão";
}

export default function ApiKeysPage() {
  const navigate = useNavigate();
  const [chaves, setChaves] = useState<ChaveApi[]>([]);
  const [recursos, setRecursos] = useState<Recursos>({});
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const [novaAberta, setNovaAberta] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [total, setTotal] = useState(false);
  const [escopos, setEscopos] = useState<Escopos>({});
  const [criando, setCriando] = useState(false);
  const [chaveCriada, setChaveCriada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    try {
      const r = await listarChaves();
      setChaves(r.chaves);
      setRecursos(r.recursos);
    } catch (e: unknown) {
      toast.error(`Erro ao carregar chaves: ${(e as Error).message}`);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const abrirNova = () => {
    setTitulo("");
    setTotal(false);
    // Ponto de partida seguro: só leitura de contatos e conversas.
    setEscopos({ peoples: ["read"], conversations: ["read"] });
    setNovaAberta(true);
  };

  const alternar = (recurso: string, acao: Acao, marcado: boolean) => {
    setEscopos((atual) => {
      const lista = new Set(atual[recurso] ?? []);
      if (marcado) lista.add(acao); else lista.delete(acao);
      const proximo = { ...atual };
      if (lista.size) proximo[recurso] = [...lista]; else delete proximo[recurso];
      return proximo;
    });
  };

  const criar = async () => {
    setCriando(true);
    try {
      const r = await criarChave({ titulo: titulo.trim(), scopes: escopos, full_access: total });
      setNovaAberta(false);
      setChaveCriada(r.chave);
      setCopiado(false);
      await carregar();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setCriando(false);
    }
  };

  const copiar = async () => {
    if (!chaveCriada) return;
    await navigator.clipboard.writeText(chaveCriada).catch(() => {});
    setCopiado(true);
    toast.success("Chave copiada.");
  };

  const ligarDesligar = async (c: ChaveApi) => {
    setOcupado(c.id);
    try {
      await atualizarChave(c.id, { ativo: !c.ativo });
      await carregar();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const revogar = async (c: ChaveApi) => {
    if (!window.confirm(`Revogar a chave "${c.titulo}"? Quem estiver usando ela para de funcionar na hora.`)) return;
    setOcupado(c.id);
    try {
      await revogarChave(c.id);
      toast.success("Chave revogada.");
      await carregar();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const podeCriar = titulo.trim().length > 0 && (total || Object.keys(escopos).length > 0);

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/integracoes")} aria-label="Voltar para Integrações">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
              <p className="text-muted-foreground text-sm">Chaves para outros sistemas (n8n, site, ERP) usarem a API do CRM.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={`${API_URL}/v1/openapi.json`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Documentação (OpenAPI)
              </a>
            </Button>
            <Button onClick={abrirNova}><Plus className="h-4 w-4" /> Nova chave</Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground space-y-1">
            <p>
              Envie a chave no header <code className="text-foreground">X-API-Key</code> para{" "}
              <code className="text-foreground">{API_URL}/v1</code>. Comece por{" "}
              <code className="text-foreground">GET /v1/whoami</code>.
            </p>
            <p>A chave age como você: vê e altera o mesmo que você vê no CRM. Dê só as permissões que o sistema precisa.</p>
          </CardContent>
        </Card>

        {carregando ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : chaves.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center text-center py-12 gap-3">
              <KeyRound className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-semibold">Nenhuma chave ainda</p>
                <p className="text-sm text-muted-foreground">Crie uma para conectar outro sistema ao CRM.</p>
              </div>
              <Button onClick={abrirNova}><Plus className="h-4 w-4" /> Nova chave</Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Chave</TableHead>
                    <TableHead>Permissões</TableHead>
                    <TableHead>Último uso</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chaves.map((c) => (
                    <TableRow key={c.id} className={c.ativo ? "" : "opacity-60"}>
                      <TableCell className="font-medium">
                        {c.titulo}
                        {!c.ativo && <Badge variant="outline" className="ml-2 text-xs">Desligada</Badge>}
                      </TableCell>
                      <TableCell><code className="text-xs">{c.prefixo}…</code></TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs">{resumoEscopos(c, recursos)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{dataCurta(c.last_used_at)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => ligarDesligar(c)} disabled={ocupado === c.id}
                          title={c.ativo ? "Desligar" : "Ligar"}>
                          {ocupado === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => revogar(c)} disabled={ocupado === c.id} title="Revogar">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Nova chave de API</DialogTitle>
            <DialogDescription>Escolha um nome que diga onde ela vai ser usada e o que ela pode fazer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="titulo-chave">Nome</Label>
              <Input id="titulo-chave" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder='Ex.: "n8n", "site", "ERP"' maxLength={80} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Acesso total</p>
                <p className="text-xs text-muted-foreground">Todas as permissões, inclusive as que vierem a existir.</p>
              </div>
              <Switch checked={total} onCheckedChange={setTotal} />
            </div>
            {!total && (
              <div className="space-y-2">
                <Label>Permissões</Label>
                <div className="rounded-lg border divide-y">
                  {Object.entries(recursos).map(([id, r]) => (
                    <div key={id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="text-sm">{r.nome}</span>
                      <div className="flex flex-wrap gap-3">
                        {r.acoes.map((a) => (
                          <label key={a} className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <Checkbox
                              checked={escopos[id]?.includes(a) ?? false}
                              onCheckedChange={(v) => alternar(id, a, v === true)}
                            />
                            {ROTULO_ACAO[a]}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {escopos.messages?.includes("create") && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Envio de mensagens: até 30 por minuto por chave. Mandar para quem não pediu derruba o número.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaAberta(false)}>Cancelar</Button>
            <Button onClick={criar} disabled={!podeCriar || criando}>
              {criando && <Loader2 className="h-4 w-4 animate-spin" />} Criar chave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!chaveCriada} onOpenChange={(aberto) => { if (!aberto) setChaveCriada(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Copie a chave agora</DialogTitle>
            <DialogDescription>Ela não aparece de novo. Se perder, revogue esta e crie outra.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={chaveCriada ?? ""} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={copiar} variant={copiado ? "outline" : "default"}>
              {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copiado ? "Copiada" : "Copiar"}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setChaveCriada(null)} disabled={!copiado}>Já guardei</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
