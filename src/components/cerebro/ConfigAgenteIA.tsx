import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Save, Loader2, MessageSquare, Shield, Clock, Bell } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";

interface AgentConfig {
  id?: string;
  nome_agente: string;
  prompt_sistema: string;
  saudacao_inicial: string;
  bloco_qualificacao: string;
  mensagem_encaminhamento: string;
  mensagem_encerramento: string;
  palavra_reativar: string;
  sinal_pausa: string;
  tempo_espera_mensagem: number;
  tempo_espera_resposta: number;
  modelo_llm: string;
  modelo_parser: string;
  grupo_notificacao: string;
  ativo: boolean;
}

const defaultConfig: AgentConfig = {
  nome_agente: "Cris",
  prompt_sistema: "",
  saudacao_inicial: "",
  bloco_qualificacao: "",
  mensagem_encaminhamento: "",
  mensagem_encerramento: "",
  palavra_reativar: "Atendimento finalizado",
  sinal_pausa: "251213",
  tempo_espera_mensagem: 3,
  tempo_espera_resposta: 1,
  modelo_llm: "gpt-4o",
  modelo_parser: "gpt-4o-mini",
  grupo_notificacao: "",
  ativo: true,
};

export function ConfigAgenteIA() {
  const { user } = useAuth();
  const [config, setConfig] = useState<AgentConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (user) carregarConfig();
  }, [user]);

  const carregarConfig = async () => {
    try {
      const { data, error } = await api
        .from("agent_configs")
        .select("*")
        .eq("user_id", user?.id)
        .eq("ativo", true)
        .maybeSingle();

      if (data) {
        setConfig(data);
      }
    } catch (e) {
      toast.error("Erro ao carregar configurações do agente");
    } finally {
      setLoading(false);
    }
  };

  const update = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  const salvar = async () => {
    if (!user) return;
    setSalvando(true);
    try {
      const payload = {
        ...config,
        user_id: user.id,
        updated_at: new Date().toISOString(),
      };

      let error;
      if (config.id) {
        const { error: err } = await api
          .from("agent_configs")
          .update(payload)
          .eq("id", config.id);
        error = err;
      } else {
        const { data, error: err } = await api
          .from("agent_configs")
          .insert([payload])
          .select()
          .single();
        if (data) setConfig(data);
        error = err;
      }

      if (error) throw error;
      toast.success("Configurações do agente salvas!");
    } catch (e: any) {
      toast.error(`Erro ao salvar: ${e.message}`);
    } finally {
      setSalvando(false);
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Configurações do Fluxo IA</h3>
          <p className="text-sm text-muted-foreground">Personalize o comportamento e as mensagens do seu agente no WhatsApp.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="agente-ativo" className="text-sm">Agente Ativo</Label>
          <Switch 
            id="agente-ativo" 
            checked={config.ativo} 
            onCheckedChange={(v) => update("ativo", v)} 
          />
        </div>
      </div>

      <Tabs defaultValue="mensagens" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-8">
          <TabsTrigger value="mensagens" className="gap-2">
            <MessageSquare className="h-4 w-4" /> Mensagens Fixas
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-2">
            <Settings className="h-4 w-4" /> Parâmetros Técnicos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mensagens" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="h-4 w-4 text-primary" /> Configuração de Mensagens
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">1. Saudação Inicial</Label>
                <p className="text-xs text-muted-foreground">Primeira mensagem enviada para todo novo contato</p>
                <Textarea 
                  value={config.saudacao_inicial} 
                  onChange={(e) => update("saudacao_inicial", e.target.value)} 
                  rows={4}
                  placeholder="Ex: Olá! Sou a Cris, assistente virtual da Mentoark. Como posso te ajudar hoje?"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">2. Bloco de Qualificação</Label>
                <p className="text-xs text-muted-foreground">Enviado completo após coletar nome e e-mail do cliente</p>
                <Textarea 
                  value={config.bloco_qualificacao} 
                  onChange={(e) => update("bloco_qualificacao", e.target.value)} 
                  rows={4}
                  placeholder="Ex: Ótimo! Para prosseguirmos, poderia me informar sua renda mensal aproximada e se possui FGTS?"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">3. Mensagem de Encaminhamento</Label>
                  <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                    Inclui sinal de pausa
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Quando cliente demonstra interesse — pausa a IA automaticamente</p>
                <Textarea 
                  value={config.mensagem_encaminhamento} 
                  onChange={(e) => update("mensagem_encaminhamento", e.target.value)} 
                  rows={4}
                  placeholder="Ex: Entendido! Vou encaminhar seus dados para um de nossos especialistas. Aguarde um momento."
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">4. Mensagem de Encerramento</Label>
                  <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                    Inclui sinal de pausa
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Quando a conversa é finalizada — pausa a IA automaticamente</p>
                <Textarea 
                  value={config.mensagem_encerramento} 
                  onChange={(e) => update("mensagem_encerramento", e.target.value)} 
                  rows={4}
                  placeholder="Ex: Obrigado pelo contato! Se precisar de algo mais, estou à disposição. Tenha um ótimo dia!"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Identidade e Modelos */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="h-4 w-4 text-primary" /> Identidade e Modelos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Nome do Agente</Label>
                  <Input 
                    value={config.nome_agente} 
                    onChange={(e) => update("nome_agente", e.target.value)} 
                    placeholder="Ex: Cris"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Modelo Principal</Label>
                    <Select value={config.modelo_llm} onValueChange={(v) => update("modelo_llm", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gpt-4o">gpt-4o</SelectItem>
                        <SelectItem value="gpt-4o-mini">gpt-4o-mini</SelectItem>
                        <SelectItem value="gpt-4-turbo">gpt-4-turbo</SelectItem>
                        <SelectItem value="gpt-3.5-turbo">gpt-3.5-turbo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Modelo Parser</Label>
                    <Select value={config.modelo_parser} onValueChange={(v) => update("modelo_parser", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gpt-4o-mini">gpt-4o-mini</SelectItem>
                        <SelectItem value="gpt-4o">gpt-4o</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Controle e Pausa */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4 text-primary" /> Controle e Pausa
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Sinal de Pausa (Código)</Label>
                    <Input 
                      value={config.sinal_pausa} 
                      onChange={(e) => update("sinal_pausa", e.target.value)} 
                      placeholder="Ex: 251213"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Palavra para Reativar</Label>
                    <Input 
                      value={config.palavra_reativar} 
                      onChange={(e) => update("palavra_reativar", e.target.value)} 
                      placeholder="Ex: Atendimento finalizado"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Debounce Mensagem (s)</Label>
                    <Input 
                      type="number"
                      value={config.tempo_espera_mensagem} 
                      onChange={(e) => update("tempo_espera_mensagem", Number(e.target.value))} 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Espera Resposta (s)</Label>
                    <Input 
                      type="number"
                      value={config.tempo_espera_resposta} 
                      onChange={(e) => update("tempo_espera_resposta", Number(e.target.value))} 
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Notificações */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bell className="h-4 w-4 text-primary" /> Notificações
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  <Label>JID do Grupo de Notificação</Label>
                  <Input 
                    value={config.grupo_notificacao} 
                    onChange={(e) => update("grupo_notificacao", e.target.value)} 
                    placeholder="Ex: 120363427455779016@g.us"
                  />
                  <p className="text-[10px] text-muted-foreground">ID do grupo do WhatsApp onde a IA enviará notificações de novos leads qualificados.</p>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileCode className="h-4 w-4 text-primary" /> Prompt do Sistema
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  <Label>Instruções Principais</Label>
                  <Textarea 
                    value={config.prompt_sistema} 
                    onChange={(e) => update("prompt_sistema", e.target.value)} 
                    rows={8}
                    placeholder="Descreva aqui a personalidade e as regras do agente..."
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end pt-4 border-t">
        <Button onClick={salvar} size="lg" className="px-12 h-12 text-base font-semibold shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]" disabled={salvando}>
          {salvando ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Save className="h-5 w-5 mr-2" />} 
          Salvar Fluxo IA
        </Button>
      </div>
    </div>
  );
}
