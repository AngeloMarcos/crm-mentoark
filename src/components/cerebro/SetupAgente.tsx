import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Building2, Bot, Wrench, MessageCircle, Code2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  open: boolean;
  onClose: () => void;
  onConcluir: () => void;
}

const STEPS = [
  { id: 1, label: "Negócio", icon: Building2 },
  { id: 2, label: "Personalidade", icon: Bot },
  { id: 3, label: "Ferramentas", icon: Wrench },
  { id: 4, label: "Fluxo", icon: MessageCircle },
  { id: 5, label: "Config", icon: Code2 },
];

const FERRAMENTAS_PADRAO = [
  { id: "cerebro", nome: "Cerebro", desc: "Busca informações internas na base de conhecimento" },
  { id: "criar_reuniao", nome: "criar_reuniao", desc: "Agenda reunião (nome, email, data/hora)" },
  { id: "cancelar_reuniao", nome: "cancelar_reuniao", desc: "Cancela agendamento" },
  { id: "reagendar_reuniao", nome: "reagendar_reuniao", desc: "Reagenda compromisso" },
  { id: "transferir_humano", nome: "transferir_humano", desc: "Passa o atendimento para um humano" },
];

export function SetupAgente({ open, onClose, onConcluir }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<any>({
    agente_nome: "", empresa: "", segmento: "", vende: "", diferencial: "", produto_nome: "", produto_preco: "", produto_beneficios: "", cliente_ideal: "", dores: "",
    tom: "profissional", emojis: "moderado", idioma: "Português BR", persona: "", objetivo: "", cta: "", horario: "", deve_fazer: "", nao_fazer: "", quando_transferir: "", modelo: "gpt-4o-mini", temperatura: 0.7,
    ferramentas: FERRAMENTAS_PADRAO.map(f => ({ ...f, ativa: true })),
    abertura: "", qualificacao: [""], objecoes: [{ gatilho: "", resposta: "" }], follow_up: { dia_1: "", dia_3: "", dia_7: "" }, encerramento: "",
    webhook_principal: "", webhook_indexacao: "", webhook_teste: "", evolution_server_url: "", evolution_api_key: "", evolution_instancia: "", rag_threshold: 0.7, rag_resultados: 5, rag_ativo: true
  });
  const [salvando, setSalvando] = useState(false);

  const updateData = (path: string, val: any) => {
    setData((prev: any) => {
      const keys = path.split('.');
      const newData = { ...prev };
      let current = newData;
      for (let i = 0; i < keys.length - 1; i++) current = current[keys[i]];
      current[keys[keys.length - 1]] = val;
      return newData;
    });
  };

  const gerarJSON = () => {
    return {
      agente: { nome: data.agente_nome, empresa: data.empresa, segmento: data.segmento, idioma: data.idioma, modelo: data.modelo, temperatura: data.temperatura },
      identidade: `Você é ${data.agente_nome}, atendente da ${data.empresa}. ${data.persona}`,
      sobre_empresa: `${data.empresa} atua em ${data.segmento}. Diferenciais: ${data.diferencial}`,
      produto: { nome: data.produto_nome, preco: data.produto_preco, beneficios: data.produto_beneficios },
      cliente_ideal: { perfil: data.cliente_ideal, dores: data.dores },
      tom_de_voz: { estilo: data.tom, emojis: data.emojis, regras: ["Mensagens curtas", "Máximo 3 linhas"] },
      ferramentas: data.ferramentas.filter((f: any) => f.ativa),
      fluxo_atendimento: { abertura: data.abertura, qualificacao: data.qualificacao.filter(Boolean), objetivo: data.objetivo, cta: data.cta },
      objecoes: data.objecoes.filter((o: any) => o.gatilho),
      follow_up: data.follow_up,
      encerramento: data.encerramento,
      regras_inviolaveis: data.nao_fazer.split('\n'),
      deve_fazer: data.deve_fazer.split('\n'),
      quando_transferir: data.quando_transferir,
      horario_atendimento: data.horario,
      objetivo_final: data.objetivo
    };
  };

  const salvarTudo = async () => {
    if (!user) return toast.error("Faça login");
    setSalvando(true);
    try {
      const json = gerarJSON();
      await supabase.from("conhecimento").insert([
        { user_id: user.id, tipo: "negocio", campo: "dados", conteudo: JSON.stringify(data) },
        { user_id: user.id, tipo: "personalidade", campo: "dados", conteudo: JSON.stringify(data) }
      ]);
      await supabase.from("agentes").update({
        nome: data.agente_nome,
        evolution_server_url: data.evolution_server_url,
        evolution_api_key: data.evolution_api_key,
        evolution_instancia: data.evolution_instancia,
        webhook_principal: data.webhook_principal,
        webhook_indexacao: data.webhook_indexacao,
        webhook_teste: data.webhook_teste,
        rag_threshold: data.rag_threshold,
        rag_resultados: data.rag_resultados,
        rag_ativo: data.rag_ativo,
        modelo: data.modelo,
        temperatura: data.temperatura
      }).eq("user_id", user.id);
      await supabase.from("agent_prompts").update({ ativo: false }).eq("user_id", user.id);
      await supabase.from("agent_prompts").insert({ user_id: user.id, nome: "Setup Wizard " + new Date().toLocaleDateString(), conteudo: JSON.stringify(json, null, 2), ativo: true });
      toast.success("Agente configurado!");
      onConcluir();
      onClose();
    } catch { toast.error("Erro ao salvar"); } finally { setSalvando(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Wizard de Configuração</DialogTitle></DialogHeader>
        <div className="flex gap-4 mb-6 pt-4">
          {STEPS.map((s) => <div key={s.id} className={`flex-1 flex flex-col items-center gap-1 ${step >= s.id ? "text-primary" : "text-muted-foreground"}`}><s.icon className="h-6 w-6" /><span className="text-xs">{s.label}</span></div>)}
        </div>
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="font-bold">Negócio</h3>
            <Input placeholder="Nome da empresa" value={data.empresa} onChange={e => updateData("empresa", e.target.value)} />
            <Textarea placeholder="O que vende?" value={data.vende} onChange={e => updateData("vende", e.target.value)} />
            <Input placeholder="Nome do Produto" value={data.produto_nome} onChange={e => updateData("produto_nome", e.target.value)} />
            <Input placeholder="Dores do cliente" value={data.dores} onChange={e => updateData("dores", e.target.value)} />
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="font-bold">Personalidade</h3>
            <Select value={data.tom} onValueChange={v => updateData("tom", v)}>
              <SelectTrigger><SelectValue placeholder="Tom de voz" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="profissional">Profissional</SelectItem>
                <SelectItem value="amigavel">Amigável</SelectItem>
              </SelectContent>
            </Select>
            <Textarea placeholder="Persona do agente" value={data.persona} onChange={e => updateData("persona", e.target.value)} />
          </div>
        )}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-bold">Ferramentas</h3>
            {data.ferramentas.map((f: any, i: number) => (
              <div key={f.id} className="flex items-center gap-2">
                <Checkbox checked={f.ativa} onCheckedChange={v => updateData(`ferramentas.${i}.ativa`, v)} />
                <Label>{f.nome}</Label>
              </div>
            ))}
          </div>
        )}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="font-bold">Fluxo</h3>
            <Textarea placeholder="Mensagem de abertura" value={data.abertura} onChange={e => updateData("abertura", e.target.value)} />
          </div>
        )}
        {step === 5 && (
          <div className="space-y-4">
            <h3 className="font-bold">Configuração Técnica</h3>
            <Input placeholder="Evolution API URL" value={data.evolution_server_url} onChange={e => updateData("evolution_server_url", e.target.value)} />
            <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">{JSON.stringify(gerarJSON(), null, 2)}</pre>
          </div>
        )}
        <div className="flex justify-between pt-6">
          <Button disabled={step === 1} onClick={() => setStep(s => s - 1)}>Anterior</Button>
          {step < 5 ? <Button onClick={() => setStep(s => s + 1)}>Próximo</Button> : <Button onClick={salvarTudo} disabled={salvando}>{salvando ? <Loader2 className="animate-spin"/> : "Finalizar"}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
