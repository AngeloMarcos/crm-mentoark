/**
 * Canais de WhatsApp (2026-10-30, modelo Cubo `/settings/channels`): cada número, como ele está
 * conectado e QUAL agente de IA responde por ele. A conexão do número continua em
 * WhatsApp → Instâncias; aqui se decide quem atende.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bot, Loader2, MessageCircle, Plus, RefreshCw, ShieldCheck, QrCode } from "lucide-react";
import { toast } from "sonner";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgenteOpcao, Canal, atualizarCanal, listarCanais } from "@/lib/canais";
import { AgentesModuloNav } from "@/components/agentes/AgentesModuloNav";

const NENHUM = "__nenhum";

/** Por que este canal não vai responder, mesmo com a IA ligada (null = vai responder). */
function bloqueio(canal: Canal, agente: AgenteOpcao | undefined): string | null {
  if (canal.pessoal) return "Número pessoal: a IA nunca responde nele.";
  if (!canal.ia_ativa) return null;
  if (!agente) return "Escolha o agente que vai responder.";
  if (!agente.tem_prompt) return `O agente "${agente.nome}" está sem prompt e não responde.`;
  // No QR Code com a própria configuração, "ligado" é o próprio switch da linha.
  if (!canal.agente_proprio && !agente.ativo) return `O agente "${agente.nome}" está desligado.`;
  if (canal.provider === "meta_cloud" && !agente.tem_escopo) return "A Meta exige escopo definido no agente para responder no número oficial.";
  if (!canal.conectado) return "Número desconectado.";
  return null;
}

export default function CanaisPage() {
  const navigate = useNavigate();
  const [canais, setCanais] = useState<Canal[]>([]);
  const [agentes, setAgentes] = useState<AgenteOpcao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const r = await listarCanais();
      setCanais(r.canais);
      setAgentes(r.agentes);
    } catch (e: unknown) {
      toast.error(`Erro ao carregar canais: ${(e as Error).message}`);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const agentePorId = useMemo(() => new Map(agentes.map((a) => [a.id, a])), [agentes]);
  // Só agentes com prompt servem de "cérebro"; o próprio número entra sempre (é o comportamento antigo).
  const opcoesPara = (c: Canal) =>
    agentes.filter((a) => a.tem_prompt || a.id === c.agente_id || (c.provider === "evolution" && a.id === c.id));

  const mudar = async (canal: Canal, mudanca: { ia_ativa?: boolean; agente_id?: string | null }) => {
    setSalvando(canal.id);
    try {
      await atualizarCanal(canal, mudanca);
      toast.success("Canal atualizado.");
      await carregar();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(null);
    }
  };

  const respondendo = canais.filter((c) => c.ia_ativa && !bloqueio(c, c.agente_id ? agentePorId.get(c.agente_id) : undefined)).length;

  return (
    <CRMLayout>
      <div className="space-y-6">
        <AgentesModuloNav />
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Canais</h1>
              <p className="text-muted-foreground text-sm">Seus números de WhatsApp e o agente de IA que atende em cada um.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={carregar} disabled={carregando}>
              <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            <Button onClick={() => navigate("/whatsapp?tab=instancias")}><Plus className="h-4 w-4" /> Conectar número</Button>
          </div>
        </div>

        {!carregando && canais.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {respondendo} de {canais.length} {canais.length === 1 ? "canal está" : "canais estão"} com IA respondendo.
          </p>
        )}

        {carregando ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : canais.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center text-center py-12 gap-3">
              <MessageCircle className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-semibold">Nenhum número conectado</p>
                <p className="text-sm text-muted-foreground">Conecte um número por QR Code ou pela API oficial da Meta.</p>
              </div>
              <Button onClick={() => navigate("/whatsapp?tab=instancias")}><Plus className="h-4 w-4" /> Conectar número</Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead>Conexão</TableHead>
                    <TableHead className="min-w-[240px]">Agente de IA</TableHead>
                    <TableHead className="text-center">IA ligada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {canais.map((c) => {
                    const agente = c.agente_id ? agentePorId.get(c.agente_id) : undefined;
                    const motivo = bloqueio(c, agente);
                    const ocupado = salvando === c.id;
                    return (
                      <TableRow key={`${c.provider}:${c.id}`}>
                        <TableCell>
                          <div className="flex items-start gap-2">
                            {c.provider === "meta_cloud"
                              ? <ShieldCheck className="h-4 w-4 mt-0.5 text-success shrink-0" />
                              : <QrCode className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
                            <div className="min-w-0">
                              <p className="font-medium truncate">{c.nome}</p>
                              <p className="text-xs text-muted-foreground">
                                {c.numero || c.instancia || "—"} · {c.provider === "meta_cloud" ? "API oficial" : "QR Code"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={`border-0 text-xs ${c.conectado ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                            {c.conectado ? "Conectado" : "Desconectado"}
                          </Badge>
                          {c.qualidade && <p className="text-xs text-muted-foreground mt-1">Qualidade {c.qualidade}{c.limite ? ` · ${c.limite}` : ""}</p>}
                          {c.alerta && <p className="text-xs text-warning mt-1 line-clamp-2">{c.alerta}</p>}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={c.agente_id ?? NENHUM}
                            disabled={ocupado || c.pessoal}
                            onValueChange={(v) => mudar(c, { agente_id: v === NENHUM ? null : v })}
                          >
                            <SelectTrigger><SelectValue placeholder="Escolha o agente" /></SelectTrigger>
                            <SelectContent>
                              {c.provider === "meta_cloud" && !c.agente_id && <SelectItem value={NENHUM}>Escolha o agente</SelectItem>}
                              {opcoesPara(c).map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {c.provider === "evolution" && a.id === c.id ? `${a.nome} (configuração deste número)` : a.nome}
                                  {!a.tem_prompt ? " — sem prompt" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {motivo && (
                            <p className="text-xs text-destructive mt-1 flex items-start gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {motivo}
                            </p>
                          )}
                          {agente && (
                            <button className="text-xs text-primary underline underline-offset-2 mt-1 inline-flex items-center gap-1"
                              onClick={() => navigate("/agentes")}>
                              <Bot className="h-3 w-3" /> Configurar agente
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {ocupado
                            ? <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                            : <Switch checked={c.ia_ativa} disabled={c.pessoal} onCheckedChange={(v) => mudar(c, { ia_ativa: v })} />}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </CRMLayout>
  );
}
