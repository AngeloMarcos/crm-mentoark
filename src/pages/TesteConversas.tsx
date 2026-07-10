import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authHeader } from "@/lib/api-token";
import { Download, RefreshCw, MessageSquare, Database, Search, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// [AUDITORIA] LÓGICA: página DEV (rota /dev/teste-conversas, gated fora de produção
// — ver App.tsx) para inspecionar conversas WhatsApp já persistidas em
// whatsapp_messages via GET /api/whatsapp/conversas e /conversas/:phone. Painel
// "Diagnóstico & Comparação" é claramente WIP: ver BUG no painel "Comparação de
// Fontes" abaixo.
interface Conversa {
  session_id: string;
  instancia: string;
  nome: string;
  ultima_atividade: string;
  ultima_mensagem: string;
  phone?: string;
}

interface Mensagem {
  id: string;
  from_me: boolean;
  type: string;
  timestamp: string;
  content: string;
}

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

const TesteConversas = () => {
  const { toast } = useToast();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [diag, setDiag] = useState<{ whatsapp: number; n8n: number } | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const carregarConversas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/conversas`, {
        headers: authHeader(),
      });
      if (!res.ok) throw new Error("Erro ao carregar conversas");
      const data = await res.json();
      setConversas(data);
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    carregarConversas();
  }, [carregarConversas]);

  const carregarChat = async (conversa: Conversa) => {
    const phone = conversa.phone || conversa.session_id.split("@")[0];
    setSelectedPhone(phone);
    setMensagens([]);
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/conversas/${phone}`, {
        headers: authHeader(),
      });
      if (!res.ok) throw new Error("Erro ao carregar chat");
      const data = await res.json();
      setMensagens(data);
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // [AUDITORIA] BUG: a chamada a /api/whatsapp/status envia
  // `body: JSON.stringify({force:true})` sem header Content-Type: application/json —
  // o body-parser do Express não reconhece o corpo sem esse header, então `force`
  // nunca chega de fato no backend (req.body fica vazio). Além disso a resposta
  // (resN8n) é buscada mas nunca lida/usada — diag.n8n fica hardcoded em 0 (comentário
  // original já dizia "Placeholder se não houver endpoint"). FIX PENDENTE (motivo:
  // não existe endpoint de contagem de n8n_chat_histories no backend hoje — decisão de
  // produto se vale criar um, e página é só ferramenta DEV, baixa prioridade).
  const verificarTabelas = async () => {
    setDiagLoading(true);
    try {
      // Tenta buscar as tabelas via endpoints de listagem (assumindo que existam ou via um proxy de contagem)
      // Como pedido: "chame os endpoints de listagem e conte os itens retornados"
      // Se não existirem endpoints específicos para n8n_chat_histories, vamos simular ou usar o que estiver disponível

      const [resWpp, resN8n] = await Promise.all([
        fetch(`${API_URL}/api/whatsapp/conversas`, { headers: authHeader() }),
        fetch(`${API_URL}/api/whatsapp/status`, { method: "POST", headers: authHeader(), body: JSON.stringify({ force: true }) }) // Exemplo de call que toca o backend
      ]);

      const dataWpp = await resWpp.json();

      setDiag({
        whatsapp: Array.isArray(dataWpp) ? dataWpp.length : 0,
        n8n: 0, // Placeholder se não houver endpoint de histórico direto
      });
    } catch (err) {
      toast({ title: "Erro no diagnóstico", variant: "destructive" });
    } finally {
      setDiagLoading(false);
    }
  };

  const exportarJSON = () => {
    const blob = new Blob([JSON.stringify(conversas, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversas_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const instanciasCount = conversas.reduce((acc, curr) => {
    acc[curr.instancia] = (acc[curr.instancia] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="container py-8 space-y-8 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teste de Conversas (DEV)</h1>
          <p className="text-muted-foreground text-sm">Verificação de integridade e fluxo de dados do WhatsApp.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={carregarConversas} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportarJSON}>
            <Download className="w-4 h-4 mr-2" />
            Exportar JSON
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(instanciasCount).map(([inst, count]) => (
          <Badge key={inst} variant="secondary" className="px-3 py-1">
            {inst}: {count}
          </Badge>
        ))}
        <Badge variant="outline" className="ml-auto">
          Total: {conversas.length}
        </Badge>
      </div>

      <Tabs defaultValue="listagem">
        <TabsList className="mb-4">
          <TabsTrigger value="listagem">Listagem</TabsTrigger>
          <TabsTrigger value="diagnostico">Diagnóstico & Comparação</TabsTrigger>
        </TabsList>

        <TabsContent value="listagem" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader className="py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Search className="w-4 h-4" />
                Conversas Recentes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instância</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Atividade</TableHead>
                    <TableHead>Última Mensagem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conversas.map((c) => (
                    <TableRow 
                      key={c.session_id} 
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => carregarChat(c)}
                    >
                      <TableCell className="font-mono text-[10px]">{c.instancia}</TableCell>
                      <TableCell className="font-medium max-w-[150px] truncate">{c.nome || c.session_id.split("@")[0]}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(c.ultima_atividade).toLocaleString()}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate italic">
                        {c.ultima_mensagem?.substring(0, 50) || "---"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="h-[600px] flex flex-col">
            <CardHeader className="py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Chat: {selectedPhone || "Selecione um contato"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full p-4">
                <div className="space-y-4">
                  {mensagens.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "flex flex-col max-w-[80%] rounded-lg p-3 text-sm",
                        m.from_me 
                          ? "ml-auto bg-blue-600 text-white" 
                          : "mr-auto bg-muted text-foreground"
                      )}
                    >
                      <div className="flex items-center justify-between gap-4 mb-1 opacity-70 text-[10px]">
                        <span>{m.type}</span>
                        <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  ))}
                  {selectedPhone && mensagens.length === 0 && (
                    <p className="text-center text-muted-foreground py-10">Nenhuma mensagem encontrada.</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnostico" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Diagnóstico de Tabelas
                </CardTitle>
                <CardDescription>Verifica contagem de registros no backend</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button onClick={verificarTabelas} disabled={diagLoading} className="w-full">
                  {diagLoading ? "Verificando..." : "Verificar agora"}
                </Button>
                {diag && (
                  <div className="space-y-2">
                    <div className="flex justify-between p-2 rounded bg-muted/50 text-sm">
                      <span>whatsapp_messages:</span>
                      <span className="font-mono font-bold text-blue-600">{diag.whatsapp}</span>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-muted/50 text-sm">
                      <span>n8n_chat_histories:</span>
                      <span className="font-mono font-bold text-orange-600">{diag.n8n}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* [AUDITORIA] BUG: as duas colunas ("API v1" e "API v1 (Ref)") renderizam
                exatamente `conversas.slice(0,2)` — a MESMA variável duas vezes, não uma
                segunda fonte de dados real. O badge "Fonte de dados consistente" abaixo
                é hardcoded (sempre verde, nunca compara nada de fato). Numa página cujo
                propósito declarado é justamente validar consistência de dados do
                WhatsApp — o mesmo tipo de bug que estamos investigando no módulo — esse
                painel dá falsa confiança. FIX PENDENTE (motivo: não está claro qual
                deveria ser a segunda fonte real a comparar — n8n_chat_histories? a
                Evolution API diretamente? decisão de produto antes de implementar). */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Comparação de Fontes
                </CardTitle>
                <CardDescription>Validação de consistência de dados</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-[10px] mb-4">
                  <div className="p-2 border rounded bg-slate-50 overflow-hidden">
                    <div className="font-bold mb-1 border-b pb-1">API v1</div>
                    <pre className="opacity-50">{JSON.stringify(conversas.slice(0, 2), null, 2)}</pre>
                  </div>
                  <div className="p-2 border rounded bg-slate-50 overflow-hidden">
                    <div className="font-bold mb-1 border-b pb-1">API v1 (Ref)</div>
                    <pre className="opacity-50">{JSON.stringify(conversas.slice(0, 2), null, 2)}</pre>
                  </div>
                </div>
                <div className="flex items-center justify-center p-3 bg-green-50 text-green-700 rounded border border-green-100 text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Fonte de dados consistente
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default TesteConversas;
