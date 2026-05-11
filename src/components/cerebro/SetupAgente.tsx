import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ChevronRight, ChevronLeft, Building2, Bot, Wrench, MessageCircle, Code2, Check, Copy, Wand2, Plus, Trash2 } from "lucide-react";
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

const TONS = ["profissional", "amigável", "consultivo", "formal", "descontraído"];
const IDIOMAS = ["Português BR", "Português PT", "Espanhol", "Inglês"];
const MODELOS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];

export function SetupAgente({ open, onClose, onConcluir }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);

  const [data, setData] = useState({
    // Passo 1: Negócio
    agente_nome: "", empresa: "", segmento: "", vende: "", diferencial: "",
    produto_nome: "", produto_preco: "", produto_beneficios: "",
    cliente_ideal: "", dores: "",
    // Passo 2: Personalidade
    tom: "profissional", emojis: "moderado", idioma: "Português BR", persona: "",
    objetivo: "", cta: "", horario: "", deve_fazer: "", nao_fazer: "",
    quando_transferir: "", modelo: "gpt-4o-mini", temperatura: 0.7,
    // Passo 3
    ferramentas: [
      { id: "cerebro", nome: "Cerebro", ativa: true, desc: "Busca informações internas na base de conhecimento" },
      { id: "criar_reuniao", nome: "criar_reuniao", ativa: true, desc: "Agenda reunião (coleta nome, email, data/hora, duração 50min)" },
      { id: "cancelar_reuniao", nome: "cancelar_reuniao", ativa: true, desc: "Cancela agendamento" },
      { id: "reagendar_reuniao", nome: "reagendar_reuniao", ativa: true, desc: "Reagenda compromisso" },
      { id: "transferir_humano", nome: "transferir_humano", ativa: true, desc: "Passa o atendimento para um humano" }
    ],
    // Passo 4
    abertura: "",
    qualificacao: [""],
    objecoes: [{ gatilho: "", resposta: "" }],
    follow_up: { dia_1: "", dia_3: "", dia_7: "" },
    encerramento: "",
    // Passo 5
    webhook_principal: "", webhook_indexacao: "", webhook_teste: "",
    evolution_server_url: "", evolution_api_key: "", evolution_instancia: "",
    rag_threshold: 0.7, rag_resultados: 5, rag_ativo: true
  });

  const update = (key: string, val: any) => setData(p => ({ ...p, [key]: val }));

  const addQualificacao = () => {
    if (data.qualificacao.length < 8) update("qualificacao", [...data.qualificacao, ""]);
  };

  const updateQualificacao = (i: number, val: string) => {
    const list = [...data.qualificacao];
    list[i] = val;
    update("qualificacao", list);
  };

  const removeQualificacao = (i: number) => {
    update("qualificacao", data.qualificacao.filter((_, idx) => idx !== i));
  };

  const addObjecao = () => {
    if (data.objecoes.length < 6) update("objecoes", [...data.objecoes, { gatilho: "", resposta: "" }]);
  };

  const updateObjecao = (i: number, key: "gatilho" | "resposta", val: string) => {
    const list = [...data.objecoes];
    list[i][key] = val;
    update("objecoes", list);
  };

  const removeObjecao = (i: number) => {
    update("objecoes", data.objecoes.filter((_, idx) => idx !== i));
  };

  const testarEvolution = async () => {
    if (!data.evolution_server_url || !data.evolution_api_key) return toast.error("Preencha os dados da Evolution");
    setTestando(true);
    try {
      const res = await fetch(`${data.evolution_server_url}/instance/fetchInstances`, {
        headers: { apikey: data.evolution_api_key }
      });
      if (res.ok) toast.success("Conexão OK!");
      else toast.error("Falha na conexão");
    } catch { toast.error("Erro de conexão"); }
    finally { setTestando(false); }
  };

  const jsonGerado = () => {
    return {
      agente: {
        nome: data.agente_nome,
        empresa: data.empresa,
        segmento: data.segmento,
        idioma: data.idioma,
        modelo: data.modelo,
        temperatura: data.temperatura
      },
      identidade: `Você é ${data.agente_nome}, atendente da ${data.empresa}. ${data.persona}`,
      sobre_empresa: `${data.empresa} atua em ${data.segmento}. Diferenciais: ${data.diferencial}`,
      produto: { nome: data.produto_nome, preco: data.produto_preco, beneficios: data.produto_beneficios },
      cliente_ideal: { perfil: data.cliente_ideal, dores: data.dores },
      tom_de_voz: {
        estilo: data.tom,
        emojis: data.emojis,
        regras: ["Mensagens curtas", "Nunca mais de 3 linhas", "Ser direto e cordial"]
      },
      ferramentas: data.ferramentas.filter(f => f.ativa).map(f => ({ nome: f.nome, descricao: f.desc })),
      fluxo_atendimento: {
        abertura: data.abertura,
        qualificacao: data.qualificacao.filter(Boolean),
        objetivo: data.objetivo,
        cta: data.cta
      },
      objecoes: data.objecoes.filter(o => o.gatilho).map(o => ({ gatilho: o.gatilho, resposta: o.resposta })),
      follow_up: data.follow_up,
      encerramento: data.encerramento,
      regras_inviolaveis: data.nao_fazer.split("\n").filter(Boolean),
      deve_fazer: data.deve_fazer.split("\n").filter(Boolean),
      quando_transferir: data.quando_transferir,
      horario_atendimento: data.horario,
      objetivo_final: data.objetivo
    };
  };

  const salvar = async () => {
    if (!user) return;
    setSalvando(true);
    try {
      const json = jsonGerado();

      // Salva conhecimento individualmente para aparecer nas abas do Cerebro
      await supabase.from("conhecimento").delete().eq("user_id", user.id).in("tipo", ["negocio", "personalidade"]);
      
      const conhecimentoRows: any[] = [];
      
      // Negócio
      const fieldsNeg = ["empresa", "segmento", "vende", "diferencial", "produto_nome", "produto_preco", "produto_beneficios", "cliente_ideal", "dores"];
      fieldsNeg.forEach(f => {
        if (data[f as keyof typeof data]) {
          conhecimentoRows.push({ user_id: user.id, tipo: "negocio", campo: f, conteudo: String(data[f as keyof typeof data]), indexado: false });
        }
      });

      // Personalidade
      const fieldsPer = ["tom", "emojis", "idioma", "persona", "objetivo", "cta", "horario", "deve_fazer", "nao_fazer", "quando_transferir"];
      fieldsPer.forEach(f => {
        if (data[f as keyof typeof data]) {
          conhecimentoRows.push({ user_id: user.id, tipo: "personalidade", campo: f, conteudo: String(data[f as keyof typeof data]), indexado: false });
        }
      });

      if (conhecimentoRows.length > 0) {
        await supabase.from("conhecimento").insert(conhecimentoRows);
      }

      // Atualiza agentes
      const { data: agente } = await supabase.from("agentes").select("id").eq("user_id", user.id).maybeSingle();
      const agenteData = {
        user_id: user.id,
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
        temperatura: data.temperatura,
        ativo: true
      };

      if (agente) await supabase.from("agentes").update(agenteData).eq("id", agente.id);
      else await supabase.from("agentes").insert(agenteData);

      // Prompt
      await supabase.from("agent_prompts").update({ ativo: false }).eq("user_id", user.id);
      await supabase.from("agent_prompts").insert({
        user_id: user.id,
        nome: `Wizard Prompt ${new Date().toLocaleDateString()}`,
        conteudo: JSON.stringify(json, null, 2),
        ativo: true,
        created_by: user.email
      });

      toast.success("Agente configurado com sucesso!");
      onConcluir();
      onClose();
    } catch (e) {
      toast.error("Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  };

  const StepIcon = ({ id, active, done }: { id: number, active: boolean, done: boolean }) => {
    const Icon = STEPS.find(s => s.id === id)!.icon;
    return (
      <div className={`flex flex-col items-center gap-1 flex-1 ${active ? "text-primary" : done ? "text-success" : "text-muted-foreground"}`}>
        <div className={`p-2 rounded-full ${active ? "bg-primary/10" : done ? "bg-success/10" : "bg-muted"}`}>
          {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
        </div>
        <span className="text-[10px] uppercase font-bold tracking-wider">{STEPS.find(s => s.id === id)!.label}</span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <div className="p-6 border-b bg-muted/30">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Wand2 className="h-5 w-5 text-primary" /> Setup do Agente</DialogTitle></DialogHeader>
          <div className="flex justify-between mt-6 relative">
            <div className="absolute top-4 left-0 right-0 h-0.5 bg-muted -z-10" />
            {STEPS.map(s => <StepIcon key={s.id} id={s.id} active={step === s.id} done={step > s.id} />)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* PASSO 1: NEGÓCIO */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome do Agente</Label>
                  <Input placeholder="Ex: Sofia" value={data.agente_nome} onChange={e => update("agente_nome", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Nome da Empresa</Label>
                  <Input placeholder="Ex: Imobiliária Central" value={data.empresa} onChange={e => update("empresa", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Segmento</Label>
                <Input placeholder="Ex: Imóveis residenciais" value={data.segmento} onChange={e => update("segmento", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>O que você vende/oferece?</Label>
                <Input placeholder="Ex: Apartamentos de alto padrão" value={data.vende} onChange={e => update("vende", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Diferencial Competitivo</Label>
                <Input placeholder="Ex: Atendimento 24h e tour virtual" value={data.diferencial} onChange={e => update("diferencial", e.target.value)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Produto/Plano Principal</Label>
                  <Input placeholder="Ex: Consultoria Premium" value={data.produto_nome} onChange={e => update("produto_nome", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Preço</Label>
                  <Input placeholder="Ex: R$ 497/mês" value={data.produto_preco} onChange={e => update("produto_preco", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Principais Benefícios</Label>
                <Textarea placeholder="Descreva os ganhos do cliente..." value={data.produto_beneficios} onChange={e => update("produto_beneficios", e.target.value)} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Quem é o cliente ideal?</Label>
                <Input placeholder="Ex: Investidores de imóveis" value={data.cliente_ideal} onChange={e => update("cliente_ideal", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Principais Dores do Cliente</Label>
                <Textarea placeholder="O que tira o sono do seu cliente?" value={data.dores} onChange={e => update("dores", e.target.value)} rows={2} />
              </div>
            </div>
          )}

          {/* PASSO 2: PERSONALIDADE */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Tom de Voz</Label>
                  <Select value={data.tom} onValueChange={v => update("tom", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TONS.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Uso de Emojis</Label>
                  <Select value={data.emojis} onValueChange={v => update("emojis", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bastante">Bastante</SelectItem>
                      <SelectItem value="moderado">Moderado</SelectItem>
                      <SelectItem value="nao">Não usar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Idioma</Label>
                  <Select value={data.idioma} onValueChange={v => update("idioma", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {IDIOMAS.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Persona</Label>
                <Textarea placeholder="Como o agente se apresenta e se comporta?" value={data.persona} onChange={e => update("persona", e.target.value)} rows={3} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Objetivo Principal</Label>
                  <Input placeholder="Ex: Qualificar lead e agendar reunião" value={data.objetivo} onChange={e => update("objetivo", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>CTA Principal</Label>
                  <Input placeholder="Ex: Agendar demonstração gratuita" value={data.cta} onChange={e => update("cta", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Horário de Atendimento Humano</Label>
                <Input placeholder="Ex: Seg-Sex, 9h às 18h" value={data.horario} onChange={e => update("horario", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>O agente DEVE fazer</Label>
                <Textarea placeholder="Regra 1&#10;Regra 2..." value={data.deve_fazer} onChange={e => update("deve_fazer", e.target.value)} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>O agente NÃO DEVE fazer</Label>
                <Textarea placeholder="Regra 1&#10;Regra 2..." value={data.nao_fazer} onChange={e => update("nao_fazer", e.target.value)} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>Critério de Transferência</Label>
                <Input placeholder="Quando o cliente pedir falar com humano..." value={data.quando_transferir} onChange={e => update("quando_transferir", e.target.value)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div className="space-y-2">
                  <Label>Modelo de IA</Label>
                  <Select value={data.modelo} onValueChange={v => update("modelo", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODELOS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <Label>Temperatura</Label>
                    <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{data.temperatura}</span>
                  </div>
                  <Slider value={[data.temperatura]} min={0} max={1} step={0.1} onValueChange={([v]) => update("temperatura", v)} className="py-2" />
                </div>
              </div>
            </div>
          )}

          {/* PASSO 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <Label>Ative as ferramentas necessárias</Label>
              {data.ferramentas.map((f, i) => (
                <Card key={f.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <Checkbox checked={f.ativa} onCheckedChange={v => {
                      const list = [...data.ferramentas];
                      list[i].ativa = !!v;
                      update("ferramentas", list);
                    }} />
                    <div className="flex-1 space-y-2">
                      <Label>{f.nome}</Label>
                      <Input value={f.desc} onChange={e => {
                        const list = [...data.ferramentas];
                        list[i].desc = e.target.value;
                        update("ferramentas", list);
                      }} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* PASSO 4 */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="space-y-2"><Label>Mensagem de Abertura</Label><Textarea value={data.abertura} onChange={e => update("abertura", e.target.value)} /></div>
              <div className="space-y-3">
                <div className="flex justify-between items-center"><Label>Perguntas de Qualificação (Máx 8)</Label><Button size="sm" variant="outline" onClick={addQualificacao} disabled={data.qualificacao.length >= 8}><Plus className="h-4 w-4 mr-1"/> Adicionar</Button></div>
                {data.qualificacao.map((q, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={q} onChange={e => updateQualificacao(i, e.target.value)} placeholder={`Pergunta ${i+1}`} />
                    <Button size="icon" variant="ghost" onClick={() => removeQualificacao(i)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center"><Label>Objeções (Máx 6)</Label><Button size="sm" variant="outline" onClick={addObjecao} disabled={data.objecoes.length >= 6}><Plus className="h-4 w-4 mr-1"/> Adicionar</Button></div>
                {data.objecoes.map((o, i) => (
                  <Card key={i} className="p-3 space-y-2">
                    <div className="flex justify-between"><span className="text-xs font-bold">Objeção {i+1}</span><Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeObjecao(i)}><Trash2 className="h-3 w-3"/></Button></div>
                    <Input placeholder="Gatilho/Dúvida" value={o.gatilho} onChange={e => updateObjecao(i, "gatilho", e.target.value)} />
                    <Textarea placeholder="Resposta sugerida" value={o.resposta} onChange={e => updateObjecao(i, "resposta", e.target.value)} rows={2} />
                  </Card>
                ))}
              </div>
              <div className="space-y-3">
                <Label>Follow-up</Label>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1"><Label className="text-[10px]">Dia 1</Label><Textarea value={data.follow_up.dia_1} onChange={e => update("follow_up", { ...data.follow_up, dia_1: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-[10px]">Dia 3</Label><Textarea value={data.follow_up.dia_3} onChange={e => update("follow_up", { ...data.follow_up, dia_3: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-[10px]">Dia 7</Label><Textarea value={data.follow_up.dia_7} onChange={e => update("follow_up", { ...data.follow_up, dia_7: e.target.value })} /></div>
                </div>
              </div>
              <div className="space-y-2"><Label>Mensagem de Encerramento</Label><Textarea value={data.encerramento} onChange={e => update("encerramento", e.target.value)} /></div>
            </div>
          )}

          {/* PASSO 5 */}
          {step === 5 && (
            <div className="space-y-6">
              <Card className="p-4 bg-muted/20">
                <h4 className="font-bold mb-4 flex items-center gap-2 text-sm"><Wrench className="h-4 w-4" /> Webhooks n8n</h4>
                <div className="space-y-3">
                  <div className="space-y-1"><Label className="text-xs">Principal (WhatsApp)</Label><Input value={data.webhook_principal} onChange={e => update("webhook_principal", e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Indexação (RAG)</Label><Input value={data.webhook_indexacao} onChange={e => update("webhook_indexacao", e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Teste</Label><Input value={data.webhook_teste} onChange={e => update("webhook_teste", e.target.value)} /></div>
                </div>
              </Card>

              <Card className="p-4 bg-muted/20">
                <h4 className="font-bold mb-4 flex items-center gap-2 text-sm"><MessageCircle className="h-4 w-4" /> Evolution API</h4>
                <div className="space-y-3">
                  <div className="space-y-1"><Label className="text-xs">Server URL</Label><Input value={data.evolution_server_url} onChange={e => update("evolution_server_url", e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">API Key</Label><Input type="password" value={data.evolution_api_key} onChange={e => update("evolution_api_key", e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Instância</Label><Input value={data.evolution_instancia} onChange={e => update("evolution_instancia", e.target.value)} /></div>
                  <Button variant="outline" className="w-full" onClick={testarEvolution} disabled={testando}>{testando && <Loader2 className="animate-spin mr-2 h-4 w-4"/>} Testar Conexão</Button>
                </div>
              </Card>

              <Card className="p-4 bg-muted/20">
                <h4 className="font-bold mb-4 flex items-center gap-2 text-sm"><Code2 className="h-4 w-4" /> RAG Config</h4>
                <div className="space-y-4">
                  <div className="flex items-center justify-between"><Label>Ativo</Label><Switch checked={data.rag_ativo} onCheckedChange={v => update("rag_ativo", v)} /></div>
                  <div className="space-y-1"><div className="flex justify-between"><Label>Threshold</Label><span>{data.rag_threshold}</span></div><Slider value={[data.rag_threshold]} min={0.5} max={1} step={0.05} onValueChange={([v]) => update("rag_threshold", v)} /></div>
                  <div className="space-y-1"><Label>Resultados</Label><Input type="number" value={data.rag_resultados} onChange={e => update("rag_resultados", parseInt(e.target.value))} /></div>
                </div>
              </Card>

              <div className="space-y-2">
                <Label>JSON Gerado (Preview)</Label>
                <div className="relative">
                  <pre className="p-4 bg-muted rounded-lg text-[10px] max-h-60 overflow-auto font-mono">{JSON.stringify(jsonGerado(), null, 2)}</pre>
                  <Button size="icon" variant="ghost" className="absolute top-2 right-2" onClick={() => { navigator.clipboard.writeText(JSON.stringify(jsonGerado(), null, 2)); toast.success("Copiado!"); }}><Copy className="h-4 w-4"/></Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t flex justify-between bg-muted/10">
          <Button variant="ghost" onClick={() => setStep(s => s - 1)} disabled={step === 1}><ChevronLeft className="h-4 w-4 mr-2" /> Anterior</Button>
          {step < 5 ? (
            <Button onClick={() => setStep(s => s + 1)}>Próximo <ChevronRight className="h-4 w-4 ml-2" /></Button>
          ) : (
            <Button onClick={salvar} disabled={salvando}>{salvando ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Check className="h-4 w-4 mr-2" />} Finalizar e Salvar</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
