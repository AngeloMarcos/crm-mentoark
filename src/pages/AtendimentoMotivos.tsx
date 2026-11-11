import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  criarMotivo, editarMotivo, lerConfigAtendimento, listarMotivos, salvarConfigAtendimento,
  type Motivo, type TipoMotivo,
} from "@/lib/atendimento";

const ABAS: { tipo: TipoMotivo; rotulo: string; ajuda: string }[] = [
  { tipo: "resolucao", rotulo: "Resolução", ajuda: "Aparecem ao resolver um atendimento." },
  { tipo: "transferencia", rotulo: "Transferência", ajuda: "Aparecem ao passar a conversa para outra pessoa." },
  { tipo: "pausa", rotulo: "Pausa", ajuda: "Registram por que a IA foi pausada." },
  { tipo: "perda", rotulo: "Perda", ajuda: "Aparecem ao mover um negócio para uma etapa de perda no funil." },
];

function ListaMotivos({ tipo, ajuda }: { tipo: TipoMotivo; ajuda: string }) {
  const [motivos, setMotivos] = useState<Motivo[] | null>(null);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    listarMotivos(tipo).then(setMotivos).catch((e: any) => { setMotivos([]); toast.error(e.message); });
  }, [tipo]);
  useEffect(() => { carregar(); }, [carregar]);

  const adicionar = async () => {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      await criarMotivo(tipo, nome.trim());
      setNome("");
      carregar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (m: Motivo) => {
    try {
      await editarMotivo(m.id, { ativo: false });
      carregar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{ajuda}</p>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); adicionar(); }}>
        <Input value={nome} onChange={e => setNome(e.target.value)} maxLength={80} placeholder="Nome do motivo" aria-label="Nome do novo motivo" />
        <Button type="submit" disabled={salvando || !nome.trim()} className="shrink-0">
          {salvando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />} Adicionar
        </Button>
      </form>
      {motivos === null ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : motivos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum motivo cadastrado.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {motivos.map(m => (
            <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{m.nome}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Excluir ${m.nome}`} onClick={() => excluir(m)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AtendimentoMotivosPage() {
  const [obrigatorio, setObrigatorio] = useState<boolean | null>(null);
  const [horas, setHoras] = useState("");
  const [horasSalvas, setHorasSalvas] = useState<number | null>(null);

  useEffect(() => {
    lerConfigAtendimento()
      .then(c => { setObrigatorio(c.motivo_obrigatorio); setHoras(String(c.resolver_inativo_horas)); setHorasSalvas(c.resolver_inativo_horas); })
      .catch(() => setObrigatorio(false));
  }, []);

  const salvarHoras = async () => {
    const n = Number(horas);
    try {
      const c = await salvarConfigAtendimento({ resolver_inativo_horas: n });
      setHorasSalvas(c.resolver_inativo_horas);
      toast.success(n === 0 ? "Encerramento automático desligado" : `Atendimentos sem atividade por ${n} h serão encerrados`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const alternar = async (v: boolean) => {
    const anterior = obrigatorio;
    setObrigatorio(v);
    try {
      await salvarConfigAtendimento({ motivo_obrigatorio: v });
    } catch (e: any) {
      setObrigatorio(anterior);
      toast.error(e.message);
    }
  };

  return (
    <CRMLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-bold">Motivos e regras de atendimento</h1>
          <p className="text-sm text-muted-foreground">Os motivos alimentam o histórico de cada conversa e os relatórios.</p>
        </div>
        <Card className="flex items-center justify-between gap-4 p-4">
          <div>
            <Label htmlFor="motivo-obrigatorio" className="font-semibold">Motivo obrigatório</Label>
            <p className="text-sm text-muted-foreground">Exige um motivo para transferir, resolver ou perder um negócio.</p>
          </div>
          <Switch id="motivo-obrigatorio" checked={obrigatorio === true} disabled={obrigatorio === null} onCheckedChange={alternar} />
        </Card>
        <Card className="space-y-2 p-4">
          <Label htmlFor="horas-inatividade" className="font-semibold">Encerrar atendimento parado</Label>
          <p className="text-sm text-muted-foreground">
            Atendimento aberto sem nenhuma mensagem nem nota por este tempo é encerrado sozinho. A pausa da IA não muda, e quem pediu atendente continua na fila. 0 desliga.
          </p>
          <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); salvarHoras(); }}>
            <Input id="horas-inatividade" inputMode="numeric" className="w-24" value={horas} onChange={e => setHoras(e.target.value.replace(/\D/g, ""))} disabled={horasSalvas === null} />
            <span className="text-sm text-muted-foreground">horas</span>
            <Button type="submit" variant="outline" disabled={horasSalvas === null || horas === "" || Number(horas) === horasSalvas}>Salvar</Button>
          </form>
        </Card>
        <Card className="p-4">
          <Tabs defaultValue="resolucao">
            <TabsList className="mb-3">
              {ABAS.map(a => <TabsTrigger key={a.tipo} value={a.tipo}>{a.rotulo}</TabsTrigger>)}
            </TabsList>
            {ABAS.map(a => <TabsContent key={a.tipo} value={a.tipo}><ListaMotivos tipo={a.tipo} ajuda={a.ajuda} /></TabsContent>)}
          </Tabs>
        </Card>
      </div>
    </CRMLayout>
  );
}
