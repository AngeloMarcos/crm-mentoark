import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Wand2, Copy, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const formInicial = {
  // Negócio
  empresa: "",
  segmento: "",
  vende: "",
  diferencial: "",
  // Produto
  produto_nome: "",
  produto_preco: "",
  produto_beneficios: "",
  // Cliente
  cliente_ideal: "",
  dores: "",
  objecoes: "",
  // Personalidade
  agente_nome: "",
  tom: "profissional",
  emojis: "Usar com moderação",
  idioma: "Português BR",
  // Regras
  deve_fazer: "",
  nao_fazer: "",
  quando_transferir: "",
  // Objetivo
  objetivo: "Qualificar lead",
  cta: "",
  horario: "",
};

function montarPrompt(f: typeof formInicial): string {
  const linhaEmoji =
    f.emojis === "Usar bastante"
      ? "Use emojis de forma natural e frequente para deixar a conversa leve."
      : f.emojis === "Não usar"
      ? "Não utilize emojis."
      : "Use emojis com moderação para tornar a conversa mais amigável.";

  return `Você é ${f.agente_nome || "[nome do agente]"}, atendente digital da ${f.empresa || "[empresa]"}.

SOBRE A EMPRESA
${f.empresa || "[empresa]"} atua no segmento de ${f.segmento || "[segmento]"} e oferece ${f.vende || "[produto/serviço]"}.
Diferencial competitivo: ${f.diferencial || "[diferencial]"}

PRODUTO PRINCIPAL
- Nome: ${f.produto_nome || "[produto]"}
- Preço: ${f.produto_preco || "[preço]"}
- Benefícios: ${f.produto_beneficios || "[benefícios]"}

SEU OBJETIVO
${f.objetivo}. Seu CTA principal é: ${f.cta || "[CTA]"}.

CLIENTE IDEAL
${f.cliente_ideal || "[descrição do cliente ideal]"}
Principais dores que resolvemos: ${f.dores || "[dores]"}

PERSONALIDADE
- Tom de voz: ${f.tom}
- Idioma: ${f.idioma}
- ${linhaEmoji}

REGRAS OBRIGATÓRIAS
✅ DEVE: ${f.deve_fazer || "[ações obrigatórias]"}
❌ NÃO DEVE: ${f.nao_fazer || "[ações proibidas]"}

QUANDO TRANSFERIR PARA HUMANO
${f.quando_transferir || "[critérios de transferência]"}
Horário do atendimento humano: ${f.horario || "[horário]"}

TRATAMENTO DE OBJEÇÕES
Quando o cliente disser algo como: "${f.objecoes || "[objeções comuns]"}", responda com empatia, valide o sentimento e reforce o valor do produto/serviço sem ser invasivo.

DIRETRIZES FINAIS
- Sempre se apresente como ${f.agente_nome || "[nome]"} no primeiro contato.
- Personalize as respostas com o nome do cliente sempre que possível.
- Conduza a conversa de forma natural até o CTA: "${f.cta || "[CTA]"}".`;
}

export function GeradorPrompt() {
  const { user } = useAuth();
  const [form, setForm] = useState(formInicial);
  const [prompt, setPrompt] = useState("");
  const [salvando, setSalvando] = useState(false);

  const set = (k: keyof typeof formInicial) => (v: string) =>
    setForm((p) => ({ ...p, [k]: v }));

  const gerar = () => {
    if (!form.empresa.trim() || !form.agente_nome.trim()) {
      toast.error("Preencha ao menos o nome da empresa e do agente.");
      return;
    }
    setPrompt(montarPrompt(form));
    toast.success("✅ Prompt gerado!");
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("✅ Copiado!");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const salvar = async () => {
    if (!user) return toast.error("Faça login");
    if (!prompt) return toast.error("Gere o prompt antes de salvar.");
    setSalvando(true);
    const { error } = await supabase.from("agent_prompts").insert({
      user_id: user.id,
      nome: `Prompt Gerado - ${form.empresa || "Sem empresa"}`,
      conteudo: prompt,
      ativo: false,
    });
    setSalvando(false);
    if (error) {
      toast.error(`Erro ao salvar: ${error.message}`);
      return;
    }
    toast.success("✅ Prompt salvo! Acesse a aba 'Prompt do Agente' para ativá-lo.");
  };

  const Field = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wand2 className="h-5 w-5 text-primary" /> Gerador IA de Prompt
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Preencha as 6 seções abaixo e gere automaticamente um system prompt profissional.
          </p>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* SEÇÃO 1 */}
          <section className="space-y-3">
            <h3 className="font-semibold text-primary">1. Negócio</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Nome da empresa">
                <Input value={form.empresa} onChange={(e) => set("empresa")(e.target.value)} />
              </Field>
              <Field label="Segmento / nicho">
                <Input
                  value={form.segmento}
                  onChange={(e) => set("segmento")(e.target.value)}
                  placeholder="Ex: Loja de capas de banco automotivo"
                />
              </Field>
            </div>
            <Field label="O que a empresa vende">
              <Textarea value={form.vende} onChange={(e) => set("vende")(e.target.value)} rows={2} />
            </Field>
            <Field label="Diferencial competitivo">
              <Textarea
                value={form.diferencial}
                onChange={(e) => set("diferencial")(e.target.value)}
                rows={2}
              />
            </Field>
          </section>

          {/* SEÇÃO 2 */}
          <section className="space-y-3">
            <h3 className="font-semibold text-primary">2. Produto / Serviço Principal</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Nome do produto/serviço">
                <Input
                  value={form.produto_nome}
                  onChange={(e) => set("produto_nome")(e.target.value)}
                />
              </Field>
              <Field label="Preço ou faixa de preço">
                <Input
                  value={form.produto_preco}
                  onChange={(e) => set("produto_preco")(e.target.value)}
                  placeholder="Ex: R$ 199 a R$ 499"
                />
              </Field>
            </div>
            <Field label="Principais benefícios">
              <Textarea
                value={form.produto_beneficios}
                onChange={(e) => set("produto_beneficios")(e.target.value)}
                placeholder="Ex: Durabilidade, personalização, entrega rápida"
                rows={2}
              />
            </Field>
          </section>

          {/* SEÇÃO 3 */}
          <section className="space-y-3">
            <h3 className="font-semibold text-primary">3. Cliente Ideal</h3>
            <Field label="Quem é o cliente ideal">
              <Textarea
                value={form.cliente_ideal}
                onChange={(e) => set("cliente_ideal")(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Principais dores que o produto resolve">
              <Textarea
                value={form.dores}
                onChange={(e) => set("dores")(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Objeções mais comuns">
              <Textarea
                value={form.objecoes}
                onChange={(e) => set("objecoes")(e.target.value)}
                rows={2}
              />
            </Field>
          </section>

          {/* SEÇÃO 4 */}
          <section className="space-y-3">
            <h3 className="font-semibold text-primary">4. Personalidade do Agente</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Nome do agente">
                <Input
                  value={form.agente_nome}
                  onChange={(e) => set("agente_nome")(e.target.value)}
                  placeholder="Ex: Ana"
                />
              </Field>
              <Field label="Tom de voz">
                <Select value={form.tom} onValueChange={set("tom")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["profissional", "amigável", "consultivo", "formal", "descontraído"].map(
                      (t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Emojis">
                <Select value={form.emojis} onValueChange={set("emojis")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Usar com moderação", "Usar bastante", "Não usar"].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Idioma">
                <Select value={form.idioma} onValueChange={set("idioma")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Português BR", "Português PT", "Espanhol", "Inglês"].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </section>

          {/* SEÇÃO 5 */}
          <section className="space-y-3">
            <h3 className="font-semibold text-primary">5. Regras e Limites</h3>
            <Field label="O que o agente DEVE fazer">
              <Textarea
                value={form.deve_fazer}
                onChange={(e) => set("deve_fazer")(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="O que o agente NÃO deve fazer">
              <Textarea
                value={form.nao_fazer}
                onChange={(e) => set("nao_fazer")(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Quando transferir para humano">
              <Textarea
                value={form.quando_transferir}
                onChange={(e) => set("quando_transferir")(e.target.value)}
                rows={2}
              />
            </Field>
          </section>

          {/* SEÇÃO 6 */}
          <section className="space-y-3">
            <h3 className="font-semibold text-primary">6. Objetivo Principal</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Objetivo da conversa">
                <Select value={form.objetivo} onValueChange={set("objetivo")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "Qualificar lead",
                      "Agendar demo",
                      "Fechar venda",
                      "Suporte",
                      "Informar",
                    ].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="CTA principal">
                <Input
                  value={form.cta}
                  onChange={(e) => set("cta")(e.target.value)}
                  placeholder="Ex: Agendar uma demonstração gratuita"
                />
              </Field>
            </div>
            <Field label="Horário de atendimento humano">
              <Input
                value={form.horario}
                onChange={(e) => set("horario")(e.target.value)}
                placeholder="Ex: Seg-Sex 9h-18h"
              />
            </Field>
          </section>

          <Button onClick={gerar} size="lg" className="w-full">
            <Wand2 className="h-4 w-4" /> Gerar Prompt
          </Button>
        </CardContent>
      </Card>

      {prompt && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Prompt gerado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={prompt}
              readOnly
              rows={18}
              className="font-mono text-xs leading-relaxed"
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copiar}>
                <Copy className="h-4 w-4" /> Copiar
              </Button>
              <Button onClick={salvar} disabled={salvando}>
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar como Prompt do Agente
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
