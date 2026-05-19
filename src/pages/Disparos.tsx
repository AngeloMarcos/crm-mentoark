import { useState, useMemo } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  ShieldCheck, ShieldAlert, Shield, Play, Pause, Square,
  Settings2, AlertOctagon, RefreshCw
} from "lucide-react";
import { toast } from "sonner";

const Steps = ["Lista de Contatos", "Mensagem", "Proteção Anti-ban", "Revisar e Agendar"];

export default function DisparosPage() {
  const [step, setStep] = useState(0);
  const [activeCampaign, setActiveCampaign] = useState<any>(null);

  const [form, setForm] = useState({
    nome: "",
    tipo_midia: "texto",
    mensagem: "",
    perfil_velocidade: "safe",
    janela_inicio: "08:00",
    janela_fim: "21:00",
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

function StepContacts() {
  return (
    <Tabs defaultValue="tags" className="w-full">
      <TabsList>
        <TabsTrigger value="tags">Por Tag</TabsTrigger>
        <TabsTrigger value="estagio">Por Estágio</TabsTrigger>
        <TabsTrigger value="csv">Importar CSV</TabsTrigger>
      </TabsList>
      <TabsContent value="tags" className="p-4 border rounded-lg bg-card space-y-4">
        <p className="text-sm font-medium">Selecione as tags de contatos:</p>
        <div className="grid grid-cols-2 gap-2">
            {["Lead", "VIP", "Cliente Ativo"].map(t => (
              <div key={t} className="flex items-center space-x-2">
                <input type="checkbox" id={t} className="h-4 w-4" />
                <label htmlFor={t}>{t} (120 contatos)</label>
              </div>
            ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function StepMessage({ form, setForm }: any) {
  return (
    <Card className="p-6">
      <div className="space-y-4">
        <Label>Conteúdo da Mensagem</Label>
        <Textarea className="min-h-[150px]" value={form.mensagem} onChange={e => setForm({...form, mensagem: e.target.value})} placeholder="Olá {{primeiro_nome}}..." />
        <div className="flex gap-2">
          {["Nome", "Telefone", "Empresa"].map(v => (
            <Button key={v} size="sm" variant="outline" className="text-xs">+{v}</Button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function StepAntiBan({ form, setForm }: any) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[
          { id: "safe", label: "Seguro", icon: ShieldCheck, color: "text-green-500" },
          { id: "moderate", label: "Moderado", icon: Shield, color: "text-yellow-500" },
          { id: "fast", label: "Rápido", icon: ShieldAlert, color: "text-red-500" }
        ].map(p => (
          <Card key={p.id} className={`p-4 cursor-pointer hover:border-primary ${form.perfil_velocidade === p.id ? 'border-primary' : ''}`} onClick={() => setForm({...form, perfil_velocidade: p.id})}>
            <p.icon className={`h-8 w-8 mb-2 ${p.color}`} />
            <h3 className="font-bold">{p.label}</h3>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StepReview({ form, onStart }: any) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <Card className="p-6">
        <h3 className="font-bold mb-4">Resumo da Campanha: {form.nome || "Nova Campanha"}</h3>
        <p>Destinatários: 450</p>
        <p>Perfil de Velocidade: {form.perfil_velocidade}</p>
        <Button className="w-full mt-4" onClick={onStart}>Iniciar Disparo</Button>
      </Card>
    </div>
  );
}

function MonitoringDashboard({ campaign, onCancel }: { campaign: any, onCancel: () => void }) {
  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Monitoramento: {campaign.nome}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm"><Pause className="w-4 h-4 mr-2" /> Pausar</Button>
            <Button variant="destructive" size="sm" onClick={onCancel}><Square className="w-4 h-4 mr-2" /> Cancelar</Button>
          </div>
        </div>
        
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Enviados", val: "124/450", color: "text-blue-500" },
            { label: "Entregues", val: "112", color: "text-green-500" },
            { label: "Respondidos", val: "30", color: "text-purple-500" },
            { label: "Falhas", val: "2", color: "text-red-500" }
          ].map(m => (
            <Card key={m.label} className="p-4">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className={`text-2xl font-bold ${m.color}`}>{m.val}</p>
              <Progress value={30} className="mt-2" />
            </Card>
          ))}
        </div>
      </div>
    </CRMLayout>
  );
}
