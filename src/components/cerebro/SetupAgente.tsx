import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ChevronRight, ChevronLeft, Building2, Bot, FileCode, MessageCircle, Check, Copy, Wand2 } from "lucide-react";
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
  { id: 3, label: "Prompt", icon: FileCode },
  { id: 4, label: "WhatsApp", icon: MessageCircle },
];

const TONS = ["profissional", "amigável", "consultivo", "formal", "descontraído"];
const MODELOS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];

function gerarPrompt(neg: NegocioData, per: PersonalidadeData): string {
  const emoji =
    per.emojis === "bastante"
      ? "Use emojis de forma natural e frequente para tornar a conversa mais leve."
      : per.emojis === "nao"
      ? "NÃO utilize emojis."
      : "Use emojis com moderação para tornar a conversa mais amigável.";

  return `Você é ${per.nome || "[nome do agente]"}, atendente digital da ${neg.empresa || "[empresa]"}.

## SOBRE A EMPRESA
${neg.empresa} atua no segmento de ${neg.segmento} e oferece ${neg.vende}.
Diferencial competitivo: ${neg.diferencial}

## PRODUTO / SERVIÇO
Nome: ${neg.produto_nome}${neg.produto_preco ? `\nPreço: ${neg.produto_preco}` : ""}
Benefícios: ${neg.produto_beneficios}

## CLIENTE IDEAL
${neg.cliente_ideal}
Principais dores: ${neg.dores}
Objeções comuns: ${neg.objecoes}

## SUA PERSONALIDADE
Tom de voz: ${per.tom}
${per.persona ? `Persona: ${per.persona}` : ""}
${emoji}

## OBJETIVO
${per.objetivo}
${per.cta ? `CTA principal: ${per.cta}` : ""}

## REGRAS — O QUE VOCÊ DEVE FAZER
${per.deve_fazer || "- Ser sempre cordial e prestativo\n- Responder de forma clara e objetiva\n- Qualificar o lead antes de apresentar o produto"}

## REGRAS — O QUE VOCÊ NÃO DEVE FAZER
${per.nao_fazer || "- NÃO inventar informações sobre produtos ou preços\n- NÃO prometer prazos ou descontos sem autorização\n- NUNCA ser rude ou impaciente"}

## QUANDO TRANSFERIR PARA HUMANO
${per.quando_transferir || "Quando o cliente solicitar explicitamente falar com um atendente humano ou quando a situação exigir autorização especial."}

${per.horario ? `## HORÁRIO DE ATENDIMENTO\n${per.horario}\nFora desse horário, informe quando estará disponível e ofereça enviar informações por escrito.` : ""}

---
Responda SEMPRE em ${per.idioma || "Português BR"}.
Seja conciso — respostas curtas, diretas e envolventes.`;
}

interface NegocioData {
  empresa: string;
  segmento: string;
  vende: string;
  diferencial: string;
  produto_nome: string;
  produto_preco: string;
  produto_beneficios: string;
  cliente_ideal: string;
  dores: string;
  objecoes: string;
}

interface PersonalidadeData {
  nome: string;
  tom: string;
  persona: string;
  objetivo: string;
  cta: string;
  horario: string;
  deve_fazer: string;
  nao_fazer: string;
  quando_transferir: string;
  emojis: string;
  idioma: string;
  modelo: string;
  temperatura: number;
}

interface WhatsAppData {
  evolution_server_url: string;
  evolution_api_key: string;
  evolution_instancia: string;
}

const negInicial: NegocioData = {
  empresa: "", segmento: "", vende: "", diferencial: "",
  produto_nome: "", produto_preco: "", produto_beneficios: "",
  cliente_ideal: "", dores: "", objecoes: "",
};

const perInicial: PersonalidadeData = {
  nome: "", tom: "profissional", persona: "", objetivo: "Qualificar leads e apresentar o produto",
  cta: "", horario: "", deve_fazer: "", nao_fazer: "", quando_transferir: "",
  emojis: "moderado", idioma: "Português BR", modelo: "gpt-4o-mini", temperatura: 0.7,
};

const waInicial: WhatsAppData = {
  evolution_server_url: "", evolution_api_key: "", evolution_instancia: "",
};

export function SetupAgente({ open, onClose, onConcluir }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [neg, setNeg] = useState<NegocioData>(negInicial);
  const [per, setPer] = useState<PersonalidadeData>(perInicial);
  const [wa, setWa] = useState<WhatsAppData>(waInicial);
  const [prompt, setPrompt] = useState("");
  const [promptNome, setPromptNome] = useState("Prompt Principal v1");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);

  function atualizarNeg(k: keyof NegocioData, v: string) {
    setNeg((p) => ({ ...p, [k]: v }));
  }
  function atualizarPer(k: keyof PersonalidadeData, v: string | number) {
    setPer((p) => ({ ...p, [k]: v }));
  }

  function irParaStep(n: number) {
    if (n === 3) setPrompt(gerarPrompt(neg, per));
    setStep(n);
  }

  async function testarConexaoEvolution() {
    if (!wa.evolution_server_url || !wa.evolution_api_key) {
      return toast.error("Preencha URL e API Key primeiro");
    }
    setTestando(true);
    try {
      const res = await fetch(`${wa.evolution_server_url}/instance/fetchInstances`, {
        headers: { apikey: wa.evolution_api_key },
      });
      if (res.ok) toast.success("Conexão com Evolution OK!");
      else toast.error("Falha na conexão: " + res.status);
    } catch {
      toast.error("Não foi possível conectar ao Evolution");
    } finally {
      setTestando(false);
    }
  }

  async function salvarTudo() {
    if (!user) return toast.error("Faça login");
    setSalvando(true);
    try {
      const uid = user.id;

      // 1. Salva conhecimento tipo 'negocio'
      const camposNegocio = [
        { campo: "empresa", conteudo: neg.empresa },
        { campo: "segmento", conteudo: neg.segmento },
        { campo: "vende", conteudo: neg.vende },
        { campo: "diferencial", conteudo: neg.diferencial },
        { campo: "produto_nome", conteudo: neg.produto_nome },
        { campo: "produto_preco", conteudo: neg.produto_preco },
        { campo: "produto_beneficios", conteudo: neg.produto_beneficios },
        { campo: "cliente_ideal", conteudo: neg.cliente_ideal },
        { campo: "dores", conteudo: neg.dores },
        { campo: "objecoes", conteudo: neg.objecoes },
      ].filter((c) => c.conteudo.trim());

      for (const c of camposNegocio) {
        await supabase.from("conhecimento").insert({
          user_id: uid, tipo: "negocio",
          campo: c.campo, conteudo: c.conteudo, indexado: false,
        });
      }

      // 2. Salva conhecimento tipo 'personalidade'
      const camposPersonalidade = [
        { campo: "nome_agente", conteudo: per.nome },
        { campo: "tom_de_voz", conteudo: per.tom },
        { campo: "persona", conteudo: per.persona },
        { campo: "objetivo", conteudo: per.objetivo },
        { campo: "deve_fazer", conteudo: per.deve_fazer },
        { campo: "nao_fazer", conteudo: per.nao_fazer },
        { campo: "quando_transferir", conteudo: per.quando_transferir },
      ].filter((c) => c.conteudo.trim());

      for (const c of camposPersonalidade) {
        await supabase.from("conhecimento").insert({
          user_id: uid, tipo: "personalidade",
          campo: c.campo, conteudo: c.conteudo, indexado: false,
        });
      }

      // 3. Salva ou atualiza agente
      const { data: agentesExist } = await supabase
        .from("agentes")
        .select("id")
        .eq("user_id", uid)
        .limit(1);

      const agenteDados = {
        user_id: uid,
        nome: per.nome || "Agente Principal",
        persona: per.persona,
        tom: per.tom,
        objetivo: per.objetivo,
        modelo: per.modelo,
        temperatura: per.temperatura,
        evolution_server_url: wa.evolution_server_url || null,
        evolution_api_key: wa.evolution_api_key || null,
        evolution_instancia: wa.evolution_instancia || null,
        ativo: true,
      };

      if (agentesExist && agentesExist.length > 0) {
        await supabase.from("agentes").update(agenteDados).eq("id", agentesExist[0].id);
      } else {
        await supabase.from("agentes").insert(agenteDados);
      }

      // 4. Desativa prompts anteriores e salva novo como ativo
      await supabase.from("agent_prompts").update({ ativo: false }).eq("user_id", uid);
      await supabase.from("agent_prompts").insert({
        user_id: uid,
        nome: promptNome,
        conteudo: prompt,
        ativo: true,
        created_by: user.email,
      });

      toast.success("Agente configurado com sucesso!");
      onConcluir();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar configurações");
    } finally {
      setSalvando(false);
    }
  }

  function resetar() {
    setStep(1);
    setNeg(negInicial);
    setPer(perInicial);
    setWa(waInicial);
    setPrompt("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetar(); onClose(); } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Wand2 className="h-5 w-5 text-primary" />
            Configurar Agente IA
          </DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 mb-6">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = step === s.id;
            const done = step > s.id;
            return (
              <div key={s.id} className="flex items-center gap-1 flex-1">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  done ? "bg-success/15 text-success" :
                  active ? "bg-primary/15 text-primary" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-px flex-1 mx-1 ${step > s.id ? "bg-success/40" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── STEP 1: NEGÓCIO ── */}
        {step === 1 && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Conte-nos sobre seu negócio. Essas informações alimentarão o cérebro do agente.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nome da empresa *</Label>
                <Input placeholder="Ex: MentoArk" value={neg.empresa} onChange={(e) => atualizarNeg("empresa", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Segmento de atuação *</Label>
                <Input placeholder="Ex: Educação, SaaS, Varejo..." value={neg.segmento} onChange={(e) => atualizarNeg("segmento", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>O que você vende? *</Label>
              <Input placeholder="Ex: Plataforma de automação comercial com IA" value={neg.vende} onChange={(e) => atualizarNeg("vende", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Diferencial competitivo</Label>
              <Input placeholder="Ex: Única plataforma que integra WhatsApp + CRM + IA em um só lugar" value={neg.diferencial} onChange={(e) => atualizarNeg("diferencial", e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nome do produto/plano principal</Label>
                <Input placeholder="Ex: Plano Pro" value={neg.produto_nome} onChange={(e) => atualizarNeg("produto_nome", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Preço / Investimento</Label>
                <Input placeholder="Ex: R$ 497/mês" value={neg.produto_preco} onChange={(e) => atualizarNeg("produto_preco", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Principais benefícios do produto</Label>
              <Textarea rows={2} placeholder="Ex: Automatiza 80% dos atendimentos, aumenta conversão em 3x, reduz custo operacional" value={neg.produto_beneficios} onChange={(e) => atualizarNeg("produto_beneficios", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Quem é seu cliente ideal?</Label>
              <Input placeholder="Ex: Pequenas e médias empresas com time de vendas ativo" value={neg.cliente_ideal} onChange={(e) => atualizarNeg("cliente_ideal", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Principais dores do cliente</Label>
              <Textarea rows={2} placeholder="Ex: Perde leads por falta de follow-up, atendimento lento, equipe sobrecarregada" value={neg.dores} onChange={(e) => atualizarNeg("dores", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Objeções mais comuns</Label>
              <Textarea rows={2} placeholder="Ex: 'É muito caro', 'Não tenho tempo para implementar', 'Já tenho um sistema'" value={neg.objecoes} onChange={(e) => atualizarNeg("objecoes", e.target.value)} />
            </div>
          </div>
        )}

        {/* ── STEP 2: PERSONALIDADE ── */}
        {step === 2 && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Defina como seu agente vai se comportar e se comunicar.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nome do agente *</Label>
                <Input placeholder="Ex: Sofia, Max, Ara..." value={per.nome} onChange={(e) => atualizarPer("nome", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Tom de voz *</Label>
                <Select value={per.tom} onValueChange={(v) => atualizarPer("tom", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TONS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Persona / Apresentação</Label>
              <Textarea rows={2} placeholder="Ex: Sou especialista em automação comercial e estou aqui para ajudar você a escalar suas vendas sem aumentar a equipe." value={per.persona} onChange={(e) => atualizarPer("persona", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Objetivo principal da conversa *</Label>
              <Input placeholder="Ex: Qualificar o lead e agendar uma demonstração" value={per.objetivo} onChange={(e) => atualizarPer("objetivo", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>CTA (chamada para ação)</Label>
              <Input placeholder="Ex: Agendar demo gratuita, Enviar proposta, Fazer cadastro" value={per.cta} onChange={(e) => atualizarPer("cta", e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Uso de emojis</Label>
                <Select value={per.emojis} onValueChange={(v) => atualizarPer("emojis", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bastante">Usar bastante 😊🎯🚀</SelectItem>
                    <SelectItem value="moderado">Usar com moderação</SelectItem>
                    <SelectItem value="nao">Não usar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Horário de atendimento</Label>
                <Input placeholder="Ex: Seg a Sex, 8h às 18h" value={per.horario} onChange={(e) => atualizarPer("horario", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>O agente DEVE fazer</Label>
              <Textarea rows={2} placeholder="Ex: Sempre perguntar o nome do cliente&#10;Confirmar interesse antes de apresentar preço&#10;Oferecer conteúdo de valor" value={per.deve_fazer} onChange={(e) => atualizarPer("deve_fazer", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>O agente NÃO DEVE fazer</Label>
              <Textarea rows={2} placeholder="Ex: NÃO inventar preços ou prazos&#10;NUNCA falar mal de concorrentes&#10;PROIBIDO dar desconto sem aprovação" value={per.nao_fazer} onChange={(e) => atualizarPer("nao_fazer", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Quando transferir para humano?</Label>
              <Input placeholder="Ex: Quando o cliente pedir ou quando houver reclamação grave" value={per.quando_transferir} onChange={(e) => atualizarPer("quando_transferir", e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Modelo LLM</Label>
                <Select value={per.modelo} onValueChange={(v) => atualizarPer("modelo", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODELOS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Temperatura: <span className="text-primary font-mono">{per.temperatura}</span></Label>
                <input
                  type="range" min={0} max={1} step={0.1}
                  value={per.temperatura}
                  onChange={(e) => atualizarPer("temperatura", parseFloat(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Preciso</span><span>Criativo</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: PROMPT ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Prompt gerado automaticamente. Revise e edite à vontade.
              </p>
              <Button variant="outline" size="sm" onClick={() => setPrompt(gerarPrompt(neg, per))}>
                <Wand2 className="h-3.5 w-3.5 mr-1" /> Regenerar
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>Nome desta versão</Label>
              <Input value={promptNome} onChange={(e) => setPromptNome(e.target.value)} placeholder="Ex: Prompt Principal v1" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between mb-1">
                <Label>Prompt do sistema</Label>
                <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(prompt); toast.success("Copiado!"); }}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                </Button>
              </div>
              <Textarea
                rows={18}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="font-mono text-sm resize-none"
                placeholder="O prompt será gerado com base nas informações preenchidas..."
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{prompt.length} caracteres</span>
                <span>{prompt.split(/\s+/).filter(Boolean).length} palavras</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {["PROIBIDO", "NUNCA", "SEMPRE", "OBRIGATÓRIO"].map((kw) =>
                prompt.includes(kw) ? (
                  <Badge key={kw} variant="outline" className="text-destructive border-destructive/30 text-xs">
                    {kw} detectado
                  </Badge>
                ) : null
              )}
            </div>
          </div>
        )}

        {/* ── STEP 4: WHATSAPP ── */}
        {step === 4 && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Configure a integração com o WhatsApp via Evolution API. <span className="text-primary">Opcional</span> — pode configurar depois em Agentes.
            </p>
            <div className="space-y-1.5">
              <Label>URL do servidor Evolution</Label>
              <Input placeholder="Ex: https://disparo.mentoark.com.br" value={wa.evolution_server_url} onChange={(e) => setWa((p) => ({ ...p, evolution_server_url: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input type="password" placeholder="Sua apikey da Evolution" value={wa.evolution_api_key} onChange={(e) => setWa((p) => ({ ...p, evolution_api_key: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Nome da instância</Label>
              <Input placeholder="Ex: mentoark-principal" value={wa.evolution_instancia} onChange={(e) => setWa((p) => ({ ...p, evolution_instancia: e.target.value }))} />
            </div>
            {wa.evolution_server_url && wa.evolution_api_key && (
              <Button variant="outline" onClick={testarConexaoEvolution} disabled={testando}>
                {testando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Testar Conexão
              </Button>
            )}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Resumo do que será salvo:</p>
              <p>✓ {Object.values(neg).filter(Boolean).length} campos de negócio no Cérebro</p>
              <p>✓ Personalidade do agente <strong>{per.nome || "sem nome"}</strong></p>
              <p>✓ Prompt principal "{promptNome}" ativado</p>
              {wa.evolution_instancia && <p>✓ WhatsApp: instância <strong>{wa.evolution_instancia}</strong></p>}
            </div>
          </div>
        )}

        {/* Navegação */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button variant="outline" onClick={() => step > 1 ? setStep(step - 1) : onClose()} disabled={salvando}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            {step === 1 ? "Cancelar" : "Voltar"}
          </Button>
          <div className="flex gap-2">
            {step < 4 && (
              <Button onClick={() => irParaStep(step + 1)}>
                Próximo <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === 4 && (
              <Button onClick={salvarTudo} disabled={salvando} className="gap-2">
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Salvar e Ativar Agente
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
