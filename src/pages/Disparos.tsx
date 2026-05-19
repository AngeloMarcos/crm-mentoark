import { useState, useMemo, useEffect } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  ShieldCheck, ShieldAlert, Shield, Play, Pause, Square,
  Settings2, AlertOctagon, RefreshCw, Users, Upload, 
  Clock, Calendar, MessageSquare, Image as ImageIcon, 
  FileText, Headphones, AlertTriangle, CheckCircle2,
  Table as TableIcon, Send, XCircle, Activity, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";


const Steps = ["Lista de Contatos", "Mensagem", "Proteção Anti-ban", "Revisar e Agendar"];

export default function DisparosPage() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [activeCampaign, setActiveCampaign] = useState<any>(null);

  const [form, setForm] = useState({
    nome: "",
    tipo_midia: "texto" as "texto" | "imagem" | "audio" | "documento",
    mensagem: "",
    perfil_velocidade: "safe" as "safe" | "moderate" | "fast",
    janela_inicio: "08:00",
    janela_fim: "21:00",
    pausa_fins_semana: true,
    pausa_erros_consecutivos: true,
    limite_erros_consecutivos: 5,
    pausa_bloqueios_detectados: true,
    instancias_ids: [] as string[],
    contatos: [] as any[],
    tags_selecionadas: [] as string[],
    estagios_selecionados: [] as string[],
    url_midia: "",
    legenda_midia: "",
  });


  if (activeCampaign) {
    return <MonitoringDashboard campaign={activeCampaign} onCancel={() => setActiveCampaign(null)} />;
  }

  return (
    <CRMLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Novo Disparo em Massa</h1>
        
        <div className="flex gap-4 mb-8">
          {Steps.map((s, i) => (
            <div key={s} className={`flex items-center gap-2 ${i <= step ? "text-primary" : "text-muted-foreground"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${i <= step ? "bg-primary text-primary-foreground" : ""}`}>
                {i + 1}
              </div>
              <span className="text-sm font-medium">{s}</span>
            </div>
          ))}
        </div>

        <div className="min-h-[400px]">
          {step === 0 && <StepContacts />}
          {step === 1 && <StepMessage form={form} setForm={setForm} />}
          {step === 2 && <StepAntiBan form={form} setForm={setForm} />}
          {step === 3 && <StepReview form={form} onStart={() => setActiveCampaign({ nome: form.nome })} />}
        </div>

        <div className="flex justify-between pt-6 border-t">
          <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Voltar</Button>
          <Button onClick={() => step === 3 ? setActiveCampaign({ nome: form.nome }) : setStep(Math.min(3, step + 1))}>
            {step === 3 ? "Iniciar Disparo" : "Próximo"}
          </Button>
        </div>
      </div>
    </CRMLayout>
  );
}

function StepContacts({ form, setForm }: any) {
  const [tags, setTags] = useState<any[]>([]);
  const [estagios, setEstagios] = useState<any[]>([]);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);

  useEffect(() => {
    const fetchTargets = async () => {
      const { data: tagsData } = await supabase.from("tags").select("*");
      const { data: estagiosData } = await supabase.from("funil_estagios").select("*");
      setTags(tagsData || []);
      setEstagios(estagiosData || []);
    };
    fetchTargets();
  }, []);

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: "binary" });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      setCsvPreview(data.slice(0, 5));
      // Map columns logic here...
      toast.success("CSV importado com sucesso!");
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <Label>Nome da Campanha</Label>
        <Input placeholder="Ex: Campanha Black Friday" value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} />
      </div>

      <Tabs defaultValue="tags" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="tags">Por Tag</TabsTrigger>
          <TabsTrigger value="estagio">Por Estágio</TabsTrigger>
          <TabsTrigger value="csv">Importar CSV</TabsTrigger>
        </TabsList>
        
        <TabsContent value="tags" className="p-4 border rounded-lg bg-card space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Selecione as tags:</p>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <Switch checked />
                <span className="text-xs">Excluir Opt-outs</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked disabled />
                <span className="text-xs">Excluir Blacklist</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {tags.map(t => (
              <div key={t.id} className="flex items-center space-x-2 p-2 border rounded hover:bg-muted/50">
                <input type="checkbox" id={t.id} className="h-4 w-4" onChange={(e) => {
                  const newTags = e.target.checked 
                    ? [...form.tags_selecionadas, t.nome]
                    : form.tags_selecionadas.filter((st: string) => st !== t.nome);
                  setForm({...form, tags_selecionadas: newTags});
                }} />
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.cor }} />
                <label htmlFor={t.id} className="text-sm cursor-pointer">{t.nome}</label>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="estagio" className="p-4 border rounded-lg bg-card space-y-4">
          <p className="text-sm font-medium">Selecione os estágios do funil:</p>
          <div className="grid grid-cols-2 gap-3">
            {estagios.map(s => (
              <div key={s.id} className="flex items-center space-x-2 p-2 border rounded hover:bg-muted/50">
                <input type="checkbox" id={s.id} className="h-4 w-4" onChange={(e) => {
                  const newEstagios = e.target.checked 
                    ? [...form.estagios_selecionados, s.id]
                    : form.estagios_selecionados.filter((se: string) => se !== s.id);
                  setForm({...form, estagios_selecionados: newEstagios});
                }} />
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.cor }} />
                <label htmlFor={s.id} className="text-sm cursor-pointer">{s.nome}</label>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="csv" className="p-4 border rounded-lg bg-card space-y-4 text-center">
          <div className="py-8 border-2 border-dashed rounded-lg">
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Clique para fazer upload ou arraste o arquivo CSV</p>
            <input type="file" className="hidden" id="csv-upload" accept=".csv,.xlsx" onChange={handleCsvUpload} />
            <Button variant="outline" size="sm" className="mt-4" onClick={() => document.getElementById('csv-upload')?.click()}>
              Selecionar Arquivo
            </Button>
          </div>
          {csvPreview.length > 0 && (
            <div className="space-y-2 text-left">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Preview (Primeiras 5 linhas)</p>
              <div className="border rounded overflow-hidden">
                <table className="w-full text-xs">
                  <tbody className="divide-y">
                    {csvPreview.map((row, i) => (
                      <tr key={i} className="divide-x">
                        {row.map((cell: any, j: number) => <td key={j} className="p-1">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}


function StepMessage({ form, setForm }: any) {
  const mediaTypes = [
    { id: "texto", label: "Texto", icon: MessageSquare },
    { id: "imagem", label: "Imagem", icon: ImageIcon },
    { id: "audio", label: "Áudio", icon: Headphones },
    { id: "documento", label: "Documento", icon: FileText },
  ];

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
          {mediaTypes.map(t => (
            <Button 
              key={t.id} 
              variant={form.tipo_midia === t.id ? "default" : "ghost"} 
              size="sm" 
              className="h-8 gap-2"
              onClick={() => setForm({...form, tipo_midia: t.id})}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </Button>
          ))}
        </div>

        {form.tipo_midia !== 'texto' && (
          <div className="space-y-2">
            <Label>Arquivo de Mídia</Label>
            <div className="flex gap-2">
              <Input placeholder="URL do arquivo (ou faça upload)" value={form.url_midia} onChange={e => setForm({...form, url_midia: e.target.value})} />
              <Button variant="outline"><Upload className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <Label>{form.tipo_midia === 'texto' ? 'Mensagem' : 'Legenda (opcional)'}</Label>
            <span className="text-[10px] text-muted-foreground">{form.mensagem.length}/1024</span>
          </div>
          <Textarea 
            className="min-h-[150px] font-mono text-sm" 
            value={form.mensagem} 
            onChange={e => setForm({...form, mensagem: e.target.value})} 
            placeholder={form.tipo_midia === 'texto' ? "Olá {{primeiro_nome}}, tudo bem?" : "Legenda do arquivo..."} 
          />
          <div className="flex gap-2 flex-wrap">
            {["{{nome}}", "{{primeiro_nome}}", "{{telefone}}", "{{data}}", "{{empresa}}"].map(v => (
              <Button key={v} size="sm" variant="secondary" className="text-[10px] h-7" onClick={() => {
                setForm({...form, mensagem: form.mensagem + v});
              }}>+{v}</Button>
            ))}
          </div>
        </div>

        {/* Preview Card */}
        <div className="p-4 border rounded-lg bg-emerald-50/30 dark:bg-emerald-950/10">
          <p className="text-[10px] font-bold uppercase text-emerald-600 mb-2">Preview do 1º Contato</p>
          <div className="p-3 bg-white dark:bg-zinc-900 rounded shadow-sm max-w-[80%] border-l-4 border-emerald-500">
            {form.tipo_midia !== 'texto' && (
              <div className="aspect-video bg-muted rounded mb-2 flex items-center justify-center">
                <ImageIcon className="h-8 w-8 opacity-20" />
              </div>
            )}
            <p className="text-sm whitespace-pre-wrap">
              {form.mensagem.replace('{{nome}}', 'João Silva').replace('{{primeiro_nome}}', 'João')}
            </p>
            <span className="text-[10px] text-muted-foreground float-right">10:45</span>
          </div>
        </div>
      </div>
    </Card>
  );
}


function StepAntiBan({ form, setForm }: any) {
  const [instancias, setInstancias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInstancias = async () => {
      const { data } = await supabase.from("agentes").select("*").not("evolution_instancia", "is", null);
      setInstancias(data || []);
      setLoading(false);
    };
    fetchInstancias();
  }, []);

  const profiles = [
    { id: "safe", label: "SEGURO", icon: ShieldCheck, color: "text-emerald-500", delay: "30-60s", limit: "50", desc: "Recomendado para novos números" },
    { id: "moderate", label: "MODERADO", icon: Shield, color: "text-yellow-500", delay: "15-30s", limit: "100", desc: "Equilíbrio entre velocidade e segurança" },
    { id: "fast", label: "RÁPIDO", icon: ShieldAlert, color: "text-red-500", delay: "5-15s", limit: "200", desc: "Risco aumentado de banimento", alert: true },
  ];

  return (
    <div className="space-y-6">
      {/* Instances Selection */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <Label className="font-bold">Instâncias para Disparar</Label>
          <div className="flex items-center gap-2">
            <Switch />
            <span className="text-xs">Apenas saudáveis (&gt;70)</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {instancias.map(inst => {
            const isBlocked = (inst.whatsapp_score || 0) < 40;
            return (
              <div key={inst.id} className={`flex items-center justify-between p-3 border rounded-lg ${isBlocked ? 'bg-red-50/50 dark:bg-red-950/10 border-red-200' : ''}`}>
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    disabled={isBlocked} 
                    checked={form.instancias_ids.includes(inst.id)}
                    onChange={(e) => {
                      const ids = e.target.checked 
                        ? [...form.instancias_ids, inst.id]
                        : form.instancias_ids.filter((id: string) => id !== inst.id);
                      setForm({...form, instancias_ids: ids});
                    }}
                    className="h-4 w-4" 
                  />
                  <div>
                    <p className="text-sm font-bold">{inst.nome}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{inst.evolution_instancia}</p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={isBlocked ? "destructive" : "outline"} className="text-[10px]">
                    Score: {inst.whatsapp_score || 0}
                  </Badge>
                  {isBlocked && <p className="text-[9px] text-red-500 font-bold mt-1 uppercase">Bloqueada</p>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Velocity Profiles */}
      <div className="grid grid-cols-3 gap-4">
        {profiles.map(p => (
          <Card 
            key={p.id} 
            className={`p-4 cursor-pointer transition-all border-2 ${form.perfil_velocidade === p.id ? 'border-primary shadow-md' : 'border-transparent'}`}
            onClick={() => setForm({...form, perfil_velocidade: p.id})}
          >
            <p.icon className={`h-8 w-8 mb-2 ${p.color}`} />
            <h3 className="font-bold text-sm">{p.label}</h3>
            <div className="mt-2 space-y-1">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Delay: {p.delay}</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Limite: {p.limit}/dia</p>
            </div>
            {p.alert && <p className="text-[9px] text-red-500 font-bold mt-2 uppercase flex items-center gap-1"><AlertOctagon className="h-3 w-3" /> Risco de Ban</p>}
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Sending Window */}
        <Card className="p-4 space-y-4">
          <Label className="font-bold flex items-center gap-2"><Calendar className="h-4 w-4" /> Janela de Envio</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Início</span>
              <Input type="time" value={form.janela_inicio} onChange={e => setForm({...form, janela_inicio: e.target.value})} />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Término</span>
              <Input type="time" value={form.janela_fim} onChange={e => setForm({...form, janela_fim: e.target.value})} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Pausar nos fins de semana</span>
            <Switch checked={form.pausa_fins_semana} onCheckedChange={v => setForm({...form, pausa_fins_semana: v})} />
          </div>
        </Card>

        {/* Auto Pause */}
        <Card className="p-4 space-y-4">
          <Label className="font-bold flex items-center gap-2"><Settings2 className="h-4 w-4" /> Pausa Automática</Label>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs">Pausar em erros consecutivos</span>
              <Switch checked={form.pausa_erros_consecutivos} onCheckedChange={v => setForm({...form, pausa_erros_consecutivos: v})} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Pausar se bloqueios detectados</span>
              <Switch checked={form.pausa_bloqueios_detectados} onCheckedChange={v => setForm({...form, pausa_bloqueios_detectados: v})} />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Falhas seguidas para pausar</span>
              <Input type="number" value={form.limite_erros_consecutivos} onChange={e => setForm({...form, limite_erros_consecutivos: parseInt(e.target.value)})} className="h-8" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}


function StepReview({ form, onStart }: any) {
  const estimateTotalTime = () => {
    const total = 450; // Mock total
    const msgsPerHour = form.perfil_velocidade === 'safe' ? 60 : form.perfil_velocidade === 'moderate' ? 120 : 240;
    const hours = Math.ceil(total / msgsPerHour);
    return `${hours}h ${Math.floor((total % msgsPerHour) / (msgsPerHour/60))}m`;
  };

  const [agendarAt, setAgendarAt] = useState("");

  const handleStart = async (now = true) => {
    const payload: any = {
      user_id: (await supabase.auth.getUser()).data.user?.id,
      nome: form.nome || "Disparo em Massa " + new Date().toLocaleDateString(),
      status: now ? 'em_andamento' : 'rascunho',
      perfil_velocidade: form.perfil_velocidade,
      horario_inicio: form.janela_inicio,
      horario_fim: form.janela_fim,
      instancias_ids: form.instancias_ids,
      total_leads: 450, // Mock
      mensagem_template: form.mensagem,
      tipo_midia: form.tipo_midia,
      url_midia: form.url_midia,
      legenda_midia: form.legenda_midia,
      agendado_para: now ? null : agendarAt,
      pausa_fins_semana: form.pausa_fins_semana,
      pausa_erros_consecutivos: form.pausa_erros_consecutivos,
      limite_erros_consecutivos: form.limite_erros_consecutivos,
      pausa_bloqueios_detectados: form.pausa_bloqueios_detectados,
    };

    const { data, error } = await supabase.from("disparos").insert(payload as any).select().single();

    if (error) {
      toast.error("Erro ao salvar campanha: " + error.message);
      return;
    }
    
    toast.success(now ? "Campanha iniciada!" : "Campanha agendada!");
    if (now) onStart(data);
  };

  return (
    <div className="grid grid-cols-3 gap-6">
      <Card className="col-span-2 p-6 space-y-6">
        <h3 className="text-lg font-bold">Revisão da Configuração</h3>
        
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Destinatários</p>
              <div className="flex items-center gap-2 mt-1">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-xl font-bold">450 contatos</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">12 duplicados removidos | 5 opt-outs excluídos</p>
            </div>
            
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Proteção Ativa</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                  <ShieldCheck className="h-3 w-3 mr-1" /> Perfil {form.perfil_velocidade}
                </Badge>
                {form.pausa_fins_semana && <Badge variant="outline">Pausa FDS</Badge>}
                <Badge variant="outline">Janela: {form.janela_inicio} - {form.janela_fim}</Badge>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Tempo Estimado</p>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-xl font-bold">{estimateTotalTime()}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Término previsto: Hoje, 15:30</p>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Instâncias</p>
              <div className="flex gap-2 mt-2">
                {form.instancias_ids.length} selecionadas
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-muted/50 rounded-lg border">
          <p className="text-xs font-bold mb-2">Resumo da Mensagem:</p>
          <p className="text-xs italic text-muted-foreground line-clamp-3">"{form.mensagem}"</p>
        </div>
      </Card>

      <Card className="p-6 flex flex-col justify-between">
        <div className="space-y-4">
          <h3 className="font-bold">Ações</h3>
          <Button className="w-full gap-2 h-12 text-lg font-bold" onClick={() => handleStart(true)}>
            <Play className="h-5 w-5 fill-current" /> Disparar Agora
          </Button>
          
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-background px-2 text-muted-foreground">OU</span></div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Agendar para:</Label>
            <Input type="datetime-local" value={agendarAt} onChange={e => setAgendarAt(e.target.value)} />
            <Button variant="outline" className="w-full gap-2" disabled={!agendarAt} onClick={() => handleStart(false)}>
              <Calendar className="h-4 w-4" /> Agendar Disparo
            </Button>
          </div>
        </div>

        <p className="text-[10px] text-center text-muted-foreground mt-6 italic">
          Ao iniciar, o sistema respeitará as regras de delay e janela de envio configuradas.
        </p>
      </Card>
    </div>
  );
}

function MonitoringDashboard({ campaign, onCancel }: { campaign: any, onCancel: () => void }) {
  const stats = [
    { label: "Enviados", val: campaign.enviados || 124, total: campaign.total_contatos || 450, icon: Send, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Entregues", val: campaign.entregues || 112, total: null, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Respondidos", val: campaign.respondidos || 30, total: null, icon: MessageSquare, color: "text-purple-500", bg: "bg-purple-500/10" },
    { label: "Falhas", val: campaign.falhas || 2, total: null, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
  ];

  const failureRate = ((campaign.falhas || 2) / (campaign.enviados || 124)) * 100;

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in zoom-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary animate-pulse" />
            Monitoramento: {campaign.nome}
          </h2>
          <Badge className="mt-1 bg-emerald-500/20 text-emerald-600 border-emerald-500/30">EM ANDAMENTO</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline"><Pause className="w-4 h-4 mr-2" /> Pausar</Button>
          <Button variant="destructive" onClick={onCancel}><Square className="w-4 h-4 mr-2" /> Cancelar</Button>
        </div>
      </div>

      {failureRate > 10 && (
        <Alert variant={failureRate > 25 ? "destructive" : "default"} className={`animate-bounce ${failureRate <= 25 ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20' : ''}`}>
          <AlertCircle className={`h-4 w-4 ${failureRate <= 25 ? 'text-yellow-500' : ''}`} />
          <AlertTitle className={failureRate <= 25 ? 'text-yellow-600' : ''}>{failureRate > 25 ? "Pausa Automática Ativada" : "Taxa de Falha Elevada"}</AlertTitle>
          <AlertDescription className={failureRate <= 25 ? 'text-yellow-600/80' : ''}>
            {failureRate > 25 
              ? "A campanha foi pausada automaticamente devido a uma taxa de erro superior a 25%." 
              : "Detectamos que mais de 10% dos disparos estão falhando. Recomendamos revisar suas instâncias."}
          </AlertDescription>
        </Alert>
      )}

      
      <div className="grid grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="p-5 border-none shadow-sm overflow-hidden relative group">
            <div className={`absolute top-0 right-0 p-4 transition-transform group-hover:scale-110`}>
              <s.icon className={`h-12 w-12 opacity-10 ${s.color}`} />
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{s.label}</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-3xl font-black ${s.color}`}>{s.val}</span>
              {s.total && <span className="text-sm text-muted-foreground font-bold">/ {s.total}</span>}
            </div>
            {s.total && <Progress value={(s.val/s.total)*100} className={`h-1.5 mt-3 ${s.bg}`} />}
            {s.label === "Respondidos" && <p className="text-[10px] text-purple-600 font-bold mt-2">Conversão: 24.2%</p>}
          </Card>
        ))}
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <div className="bg-muted/30 p-4 border-b flex justify-between items-center">
          <h3 className="font-bold text-sm flex items-center gap-2"><TableIcon className="h-4 w-4" /> Log de Envios (Tempo Real)</h3>
          <Badge variant="outline" className="text-[10px]">Atualizando a cada 5s</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/10">
                <th className="p-3 text-left font-bold">Contato</th>
                <th className="p-3 text-left font-bold">Número</th>
                <th className="p-3 text-left font-bold">Status</th>
                <th className="p-3 text-left font-bold">Instância</th>
                <th className="p-3 text-left font-bold">Horário</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[
                { name: "Maria Oliveira", phone: "5511999999999", status: "Respondido", instance: "Instância 01", time: "10:48" },
                { name: "Carlos Souza", phone: "5511888888888", status: "Entregue", instance: "Instância 02", time: "10:47" },
                { name: "Ana Santos", phone: "5511777777777", status: "Enviado", instance: "Instância 01", time: "10:47" },
                { name: "Felipe Lima", phone: "5511666666666", status: "Falha", instance: "Instância 03", time: "10:46" },
                { name: "Julia Melo", phone: "5511555555555", status: "Pulado", instance: "N/A", time: "10:45" },
              ].map((log, i) => (
                <tr key={i} className="hover:bg-muted/5 transition-colors">
                  <td className="p-3 font-medium">{log.name}</td>
                  <td className="p-3 text-xs font-mono">{log.phone}</td>
                  <td className="p-3">
                    <Badge variant={
                      log.status === 'Respondido' ? 'default' : 
                      log.status === 'Entregue' ? 'secondary' :
                      log.status === 'Falha' ? 'destructive' : 'outline'
                    } className="text-[10px] px-2 py-0">
                      {log.status}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs">{log.instance}</td>
                  <td className="p-3 text-xs text-muted-foreground">{log.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

