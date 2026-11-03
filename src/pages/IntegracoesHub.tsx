/**
 * Integrações num lugar só (2026-10-29, modelo Cubo — ver
 * diagnosticos/engenharia_reversa_suite/RELATORIO_INTEGRACOES_E_DESCARTE.md).
 *
 * Lista tudo o que a conta tem conectado (IA, WhatsApp, Meta Ads, voz, automação) com o status
 * de cada um. As integrações de IA (chave da OpenAI/Claude/Gemini/OpenRouter) são criadas, testadas
 * e desligadas aqui mesmo; as demais abrem a tela onde já são configuradas. A tela antiga continua
 * em /integracoes/conectores (Evolution manual, n8n, webhook, ElevenLabs).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot, CheckCircle2, ExternalLink, KeyRound, Loader2, Megaphone, MessageCircle, Plug, Plus,
  Power, RefreshCw, Trash2, Volume2, Workflow, XCircle, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AgentesModuloNav } from "@/components/agentes/AgentesModuloNav";
import {
  CategoriaIntegracao, IntegracaoIA, ItemIntegracao, ROTULO_CATEGORIA, ROTULO_STATUS, StatusIntegracao,
  TipoCatalogo, TipoIAInfo, atualizarIntegracaoIA, criarIntegracaoIA, excluirIntegracaoIA,
  listarIntegracoes, listarIntegracoesIA, testarIntegracaoIA, tiposIA,
} from "@/lib/integracoes";

const ICONE_CATEGORIA: Record<CategoriaIntegracao, typeof Bot> = {
  ia: Bot, whatsapp: MessageCircle, marketing: Megaphone, voz: Volume2, automacao: Workflow,
};

const ESTILO_STATUS: Record<StatusIntegracao, string> = {
  ok: "bg-success/15 text-success",
  atencao: "bg-warning/15 text-warning",
  erro: "bg-destructive/15 text-destructive",
  desligada: "bg-muted text-muted-foreground",
};

const ORDEM: CategoriaIntegracao[] = ["ia", "whatsapp", "marketing", "voz", "automacao"];

export default function IntegracoesHubPage() {
  const navigate = useNavigate();
  const [itens, setItens] = useState<ItemIntegracao[]>([]);
  const [catalogo, setCatalogo] = useState<TipoCatalogo[]>([]);
  const [ias, setIas] = useState<IntegracaoIA[]>([]);
  const [infosIA, setInfosIA] = useState<TipoIAInfo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<CategoriaIntegracao | "todas">("todas");
  const [ocupado, setOcupado] = useState<string | null>(null);

  // "Nova integração": passo 1 escolhe o tipo; passo 2 (só IA) pede nome e chave.
  const [novaAberta, setNovaAberta] = useState(false);
  const [tipoEscolhido, setTipoEscolhido] = useState<TipoIAInfo | null>(null);
  const [nome, setNome] = useState("");
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);

  // "Trocar chave"
  const [trocando, setTrocando] = useState<IntegracaoIA | null>(null);
  const [novaChave, setNovaChave] = useState("");

  const carregar = async () => {
    setCarregando(true);
    try {
      const [hub, lista, tipos] = await Promise.all([listarIntegracoes(), listarIntegracoesIA(), tiposIA()]);
      setItens(hub.itens);
      setCatalogo(hub.catalogo);
      setIas(lista);
      setInfosIA(tipos);
    } catch (e: unknown) {
      toast.error(`Erro ao carregar integrações: ${(e as Error).message}`);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const iaPorId = useMemo(() => new Map(ias.map((i) => [i.id, i])), [ias]);
  const visiveis = filtro === "todas" ? itens : itens.filter((i) => i.categoria === filtro);
  const contagem = (c: CategoriaIntegracao) => itens.filter((i) => i.categoria === c).length;
  const comErro = itens.filter((i) => i.status === "erro").length;

  const abrirNova = () => { setTipoEscolhido(null); setNome(""); setChave(""); setNovaAberta(true); };

  const escolherTipo = (t: TipoCatalogo) => {
    if (t.criar) { setNovaAberta(false); navigate(t.criar); return; }
    const info = infosIA.find((i) => i.tipo === t.tipo) ?? null;
    if (ias.some((i) => i.slug === t.tipo)) {
      toast.info(`Já existe uma integração ${info?.rotulo ?? t.rotulo}. Use "Trocar chave" nela.`);
      return;
    }
    setTipoEscolhido(info);
    setNome(info?.rotulo ?? t.rotulo);
  };

  const criar = async () => {
    if (!tipoEscolhido || !chave.trim()) return;
    setSalvando(true);
    try {
      const r = await criarIntegracaoIA({ nome: nome.trim() || tipoEscolhido.rotulo, slug: tipoEscolhido.tipo, api_key: chave.trim() });
      if (r.teste.ok) toast.success("Integração criada e chave validada.");
      else toast.warning(`Integração criada, mas a chave foi recusada: ${r.teste.erro ?? "erro desconhecido"}`);
      setNovaAberta(false);
      carregar();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const testar = async (id: string) => {
    setOcupado(id);
    try {
      const r = await testarIntegracaoIA(id);
      if (r.ok) toast.success(`Chave válida: ${r.total_modelos} modelos disponíveis.`);
      else toast.error(r.erro ?? "Chave recusada.");
      carregar();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const ligarDesligar = async (ia: IntegracaoIA) => {
    setOcupado(ia.id);
    try {
      await atualizarIntegracaoIA(ia.id, { ativo: !ia.ativo });
      toast.success(ia.ativo ? "Integração desligada." : "Integração ligada.");
      carregar();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const excluir = async (ia: IntegracaoIA) => {
    if (!confirm(`Excluir a integração "${ia.nome}"?`)) return;
    setOcupado(ia.id);
    try {
      await excluirIntegracaoIA(ia.id);
      toast.success("Integração excluída.");
      carregar();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const salvarNovaChave = async () => {
    if (!trocando || !novaChave.trim()) return;
    setSalvando(true);
    try {
      const r = await atualizarIntegracaoIA(trocando.id, { api_key: novaChave.trim() });
      if (r.teste?.ok) toast.success("Chave trocada e validada.");
      else toast.warning(`Chave salva, mas foi recusada: ${r.teste?.erro ?? "erro desconhecido"}`);
      setTrocando(null);
      setNovaChave("");
      carregar();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <AgentesModuloNav />
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Plug className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Integrações</h1>
              <p className="text-muted-foreground text-sm">Tudo o que a sua conta tem conectado, num lugar só.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={carregar} disabled={carregando}>
              <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            <Button variant="outline" onClick={() => navigate("/integracoes/api")}>
              <KeyRound className="h-4 w-4" /> API Keys
            </Button>
            <Button onClick={abrirNova}><Plus className="h-4 w-4" /> Nova integração</Button>
          </div>
        </div>

        {comErro > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <span>
              {comErro === 1 ? "1 integração está com erro." : `${comErro} integrações estão com erro.`}{" "}
              Se for uma chave de IA recusada, os agentes que dependem dela ficam sem responder até a chave ser trocada.
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={filtro === "todas" ? "default" : "outline"} onClick={() => setFiltro("todas")}>
            Todas ({itens.length})
          </Button>
          {ORDEM.map((c) => (
            <Button key={c} size="sm" variant={filtro === c ? "default" : "outline"} onClick={() => setFiltro(c)}>
              {ROTULO_CATEGORIA[c]} ({contagem(c)})
            </Button>
          ))}
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : visiveis.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center text-center py-12 gap-3">
              <Plug className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-semibold">Nenhuma integração {filtro === "todas" ? "" : `de ${ROTULO_CATEGORIA[filtro].toLowerCase()} `}ainda</p>
                <p className="text-sm text-muted-foreground">Conecte a primeira para começar.</p>
              </div>
              <Button onClick={abrirNova}><Plus className="h-4 w-4" /> Nova integração</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visiveis.map((item) => {
              const Icone = ICONE_CATEGORIA[item.categoria];
              const ia = item.id ? iaPorId.get(item.id) : undefined;
              return (
                <Card key={item.chave}>
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Icone className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{item.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {catalogo.find((c) => c.tipo === item.tipo)?.rotulo ?? item.tipo}
                        </p>
                      </div>
                      <Badge className={`border-0 text-xs shrink-0 ${ESTILO_STATUS[item.status]}`}>
                        {item.status === "ok" ? <CheckCircle2 className="h-3 w-3 mr-1" /> : item.status === "erro" ? <XCircle className="h-3 w-3 mr-1" /> : null}
                        {ROTULO_STATUS[item.status]}
                      </Badge>
                    </div>

                    {item.detalhe && <p className="text-xs text-muted-foreground line-clamp-2">{item.detalhe}</p>}
                    {ia && ia.agentes_usando > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Usada por {ia.agentes_usando} {ia.agentes_usando === 1 ? "agente" : "agentes"}
                      </p>
                    )}

                    {ia ? (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => testar(ia.id)} disabled={ocupado === ia.id}>
                          {ocupado === ia.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Testar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setTrocando(ia); setNovaChave(""); }}>
                          <KeyRound className="h-3.5 w-3.5" /> Trocar chave
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => ligarDesligar(ia)} disabled={ocupado === ia.id} title={ia.ativo ? "Desligar" : "Ligar"}>
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => excluir(ia)} disabled={ocupado === ia.id || ia.agentes_usando > 0}
                          title={ia.agentes_usando > 0 ? "Em uso por agentes: troque a integração deles antes de excluir" : "Excluir"}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(item.gerenciar)}>
                        <ExternalLink className="h-3.5 w-3.5" /> Gerenciar
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Webhook, n8n e conexão manual de Evolution continuam em{" "}
          <button className="underline underline-offset-2" onClick={() => navigate("/integracoes/conectores")}>Conectores avançados</button>.
        </p>
      </div>

      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tipoEscolhido ? `Conectar ${tipoEscolhido.rotulo}` : "Nova integração"}</DialogTitle>
            <DialogDescription>
              {tipoEscolhido ? "A chave é validada na hora e guardada criptografada. Ela nunca volta para a tela." : "Escolha o que você quer conectar."}
            </DialogDescription>
          </DialogHeader>

          {!tipoEscolhido ? (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {ORDEM.map((c) => {
                const tipos = catalogo.filter((t) => t.categoria === c);
                if (!tipos.length) return null;
                return (
                  <div key={c} className="space-y-2">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">{ROTULO_CATEGORIA[c]}</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {tipos.map((t) => (
                        <button key={t.tipo} onClick={() => escolherTipo(t)}
                          className="text-left rounded-lg border p-3 hover:border-primary/50 hover:bg-muted/40 transition-colors">
                          <p className="font-medium text-sm">{t.rotulo}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t.descricao}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nome da integração</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Chave de API</Label>
                <Input type="password" autoComplete="off" placeholder={tipoEscolhido.dicaChave} value={chave} onChange={(e) => setChave(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  Gere a chave em{" "}
                  <a href={tipoEscolhido.linkChave} target="_blank" rel="noreferrer" className="underline underline-offset-2">{new URL(tipoEscolhido.linkChave).host}</a>.
                  O modelo é escolhido em cada agente, entre os que esta chave libera.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            {tipoEscolhido && <Button variant="outline" onClick={() => setTipoEscolhido(null)}>Voltar</Button>}
            {tipoEscolhido && (
              <Button onClick={criar} disabled={salvando || !chave.trim()}>
                {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Conectar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!trocando} onOpenChange={(o) => { if (!o) setTrocando(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trocar chave: {trocando?.nome}</DialogTitle>
            <DialogDescription>A chave nova é testada na hora. Os agentes que usam esta integração passam a usá-la imediatamente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Nova chave de API</Label>
            <Input type="password" autoComplete="off" value={novaChave} onChange={(e) => setNovaChave(e.target.value)}
              placeholder={infosIA.find((i) => i.tipo === trocando?.slug)?.dicaChave} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrocando(null)}>Cancelar</Button>
            <Button onClick={salvarNovaChave} disabled={salvando || !novaChave.trim()}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar e testar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
