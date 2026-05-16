import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, QrCode, CheckCircle2, XCircle, LogOut, Terminal, History, AlertTriangle, Bot } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { fetchConnectionStatus, createInstance, disconnectInstance, type StatusResult, type CreateInstanceResult } from "@/services/evolutionService";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DebugLog {
  timestamp: string;
  event: string;
  data: any;
}

export function WhatsAppStatus() {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [qrData, setQrData] = useState<CreateInstanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [lastError, setLastError] = useState<{ message: string; timestamp: string; lastAction: 'create' | 'status' | 'logout' } | null>(() => {
    const saved = localStorage.getItem('whatsapp_last_error');
    return saved ? JSON.parse(saved) : null;
  });
  const [autoRetrying, setAutoRetrying] = useState(false);

  // Persistir erro no localStorage
  useEffect(() => {
    if (lastError) {
      localStorage.setItem('whatsapp_last_error', JSON.stringify(lastError));
    } else {
      localStorage.removeItem('whatsapp_last_error');
    }
  }, [lastError]);

  const retryCountRef = useRef(0);
  const maxRetries = 5;

  const addLog = (event: string, data: any) => {
    const log: DebugLog = {
      timestamp: new Date().toLocaleTimeString(),
      event,
      data
    };
    setDebugLogs(prev => [log, ...prev].slice(0, 30));
  };

  const checkStatus = async (retry = 0) => {
    try {
      if (retry === 0) setLoading(true);
      
      const res = await fetchConnectionStatus();
      addLog(`CheckStatus (Attempt ${retry + 1})`, res);
      
      // Se estamos tentando confirmar uma conexão que acabou de ocorrer
      // mas a Evolution ainda retorna 'close', aplicamos o retry com backoff
      if (retryCountRef.current > 0 && res.state !== 'open' && retry < maxRetries) {
        const backoffDelay = Math.min(1000 * Math.pow(2, retry), 8000);
        addLog("Status Inconsistent", `Retrying in ${backoffDelay}ms...`);
        setTimeout(() => checkStatus(retry + 1), backoffDelay);
        return;
      }

      setStatus(res);
      if (res.state === 'open') {
        setQrData(null);
        retryCountRef.current = 0; // Reset ao conectar com sucesso
      }
    } catch (error: any) {
      addLog("CheckStatus Error", error.message);
      setLastError({ message: error.message || "Falha ao consultar status", timestamp: new Date().toLocaleTimeString(), lastAction: 'status' });
      console.error("Erro ao buscar status:", error);
    } finally {
      if (retry === 0 || retry >= maxRetries || status?.state === 'open') {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(() => {
      // Só faz o polling regular se não estivermos no meio de um processo de retry
      if (retryCountRef.current === 0) {
        checkStatus();
      }
    }, 20000); 

    return () => clearInterval(interval);
  }, []);

  // Effect to regenerate QR code while connecting
  useEffect(() => {
    let qrInterval: number | undefined;

    if (qrData?.qrCode && status?.state !== 'open') {
      qrInterval = window.setInterval(async () => {
        addLog("Auto-Regenerating QR", { currentStatus: status?.state });
        try {
          const res = await createInstance();
          addLog("Regeneration Response", { hasQr: !!res.qrCode, state: res.state });
          
          if (res.state === 'open') {
            retryCountRef.current = 1;
            checkStatus();
          } else {
            setQrData(res);
          }
        } catch (error: any) {
          addLog("Regeneration Error", error.message);
        }
      }, 25000); 
    }

    return () => {
      if (qrInterval) clearInterval(qrInterval);
    };
  }, [qrData?.qrCode, status?.state]);

  const handleConnect = async () => {
    try {
      setActionLoading(true);
      addLog("Action: Connect Request", null);
      setQrData(null);
      
      const res = await createInstance();
      addLog("Initial Connect Response", res);
      
      if (res.state === 'open') {
        toast.success("WhatsApp conectado!");
        setStatus({ state: 'open', phoneNumber: res.phoneNumber });
        setQrData(null);
        retryCountRef.current = 1;
        setTimeout(() => checkStatus(), 1000);
        return;
      }

      if (!res.qrCode && res.state !== 'open') {
        addLog("QR Not Found", "Retrying immediately...");
        const retryRes = await createInstance();
        addLog("Immediate Retry Response", retryRes);
        
        if (retryRes.state === 'open') {
          toast.success("Conectado com sucesso!");
          retryCountRef.current = 1;
          checkStatus();
        } else {
          setQrData(retryRes);
        }
      } else {
        setQrData(res);
      }

      if (res.qrCode) {
        toast.info("QR Code gerado com sucesso.");
      }
    } catch (error: any) {
      addLog("Connection Error", error.message);
      setLastError({ message: error.message || "Falha na comunicação com a Evolution", timestamp: new Date().toLocaleTimeString(), lastAction: 'create' });
      toast.error(error.message || "Falha na comunicação com a Evolution");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Isso removerá a instância e desconectará o WhatsApp. Continuar?")) return;
    try {
      setActionLoading(true);
      addLog("Action: Disconnect", null);
      await disconnectInstance();
      addLog("Disconnect Success", null);
      setStatus({ state: 'close' });
      setQrData(null);
      retryCountRef.current = 0;
      toast.success("WhatsApp desconectado e instância removida");
    } catch (error: any) {
      addLog("Disconnect Error", error.message);
      setLastError({ message: error.message || "Erro ao desconectar", timestamp: new Date().toLocaleTimeString(), lastAction: 'logout' });
      toast.error(error.message || "Erro ao desconectar");
    } finally {
      setActionLoading(false);
    }
  };

  const retryLastAction = async () => {
    if (!lastError) return;
    setAutoRetrying(true);
    try {
      if (lastError.lastAction === 'create') await handleConnect();
      else if (lastError.lastAction === 'logout') await handleDisconnect();
      else await checkStatus();
      setLastError(null);
    } finally {
      setAutoRetrying(false);
    }
  };

  if (loading && !status) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
          <span className="text-sm font-medium">Sincronizando com Evolution API...</span>
        </CardContent>
      </Card>
    );
  }

  const isConnected = status?.state === 'open';

  return (
    <div className="space-y-4">
      {lastError && (
        <Alert variant="destructive" className="animate-in slide-in-from-top-2 duration-300 border-destructive/50 bg-destructive/5">
          <AlertTriangle className="h-4 w-4" />
          <div className="flex items-start justify-between gap-4 w-full">
            <div className="flex-1">
              <AlertTitle className="text-sm font-bold">Falha na última operação ({lastError.lastAction})</AlertTitle>
              <AlertDescription className="text-xs mt-1 font-mono opacity-90">
                [{lastError.timestamp}] {lastError.message}
              </AlertDescription>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" onClick={retryLastAction} disabled={autoRetrying} className="h-8 border-destructive/30 hover:bg-destructive/10">
                {autoRetrying ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Tentar novamente
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLastError(null)} className="h-8 px-2">
                <XCircle className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </Alert>
      )}
      <Card className={`border shadow-md overflow-hidden bg-background/50 backdrop-blur-sm relative ${isConnected ? "border-green-500/30" : "border-amber-500/30"}`}>
        {/* Header Decorativo */}
        <div className={`h-1 w-full absolute top-0 left-0 ${isConnected ? "bg-green-500" : "bg-amber-500"}`} />
        
        <CardHeader className="pb-3 pt-6 px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-2xl ${isConnected ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"}`}>
                {isConnected ? <CheckCircle2 className="h-6 w-6" /> : <QrCode className="h-6 w-6" />}
              </div>
              <div>
                <CardTitle className="text-xl font-bold tracking-tight">
                  {isConnected ? "Conectado" : "Conectar WhatsApp"}
                </CardTitle>
                <CardDescription className="text-sm">
                  {isConnected 
                    ? `Instância ativa no número ${status.phoneNumber || ""}` 
                    : "Sincronize seu dispositivo para começar"}
                </CardDescription>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setShowDebug(!showDebug)}
                className={`h-9 w-9 rounded-xl transition-colors ${showDebug ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-muted"}`}
              >
                <Terminal className="h-4 w-4" />
              </Button>
              <Badge variant="outline" className={`rounded-lg px-2 py-1 text-[10px] uppercase font-bold tracking-wider ${isConnected ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200 animate-pulse"}`}>
                {isConnected ? "Sistema Online" : "Aguardando Link"}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-6 pb-6 pt-2">
          {!isConnected && !qrData?.qrCode && (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
              <div className="relative">
                <div className="absolute -inset-4 bg-primary/10 rounded-full blur-xl animate-pulse"></div>
                <div className="relative w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
                  <QrCode className="h-12 w-12 text-primary" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-bold text-lg">Pronto para começar?</h3>
                <p className="text-sm text-muted-foreground max-w-[340px] leading-relaxed">
                  Ao conectar seu WhatsApp, o <strong>Agente MentoArk</strong> poderá responder seus clientes automaticamente 24h por dia.
                </p>
              </div>
              <Button 
                onClick={handleConnect} 
                disabled={actionLoading}
                className="w-full sm:w-auto h-12 px-10 rounded-xl text-base font-bold shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {actionLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <RefreshCw className="h-5 w-5 mr-2" />}
                Gerar QR Code de Acesso
              </Button>
            </div>
          )}

          {qrData?.qrCode && !isConnected && (
            <div className="flex flex-col md:flex-row items-center justify-center gap-10 py-6 animate-in slide-in-from-bottom-4 duration-500">
              <div className="relative group shrink-0">
                <div className="absolute -inset-2 bg-gradient-to-br from-primary via-accent/50 to-primary rounded-[2rem] blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                <div className="relative bg-white p-6 rounded-[1.5rem] shadow-xl border border-border/50">
                  <img 
                    src={qrData.qrCode} 
                    alt="WhatsApp QR Code" 
                    className="w-64 h-64 md:w-72 md:h-72"
                  />
                  {actionLoading && (
                    <div className="absolute inset-0 bg-white/90 backdrop-blur-[2px] flex items-center justify-center rounded-[1.5rem]">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                        <span className="text-xs font-bold text-primary uppercase tracking-widest">Sincronizando</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-6 max-w-[400px]">
                <div className="space-y-2">
                  <Badge className="bg-primary/10 text-primary border-none hover:bg-primary/10 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                    Passo a Passo
                  </Badge>
                  <h3 className="font-bold text-2xl tracking-tight">Escaneie o código</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Siga as instruções abaixo no seu celular para autorizar o Agente IA.
                  </p>
                </div>

                <div className="space-y-3">
                  {[
                    "Abra o WhatsApp no seu celular",
                    "Toque em Aparelhos Conectados",
                    "Aponte a câmera para esta tela"
                  ].map((step, i) => (
                    <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-muted/50 border border-border/30">
                      <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-lg flex items-center justify-center text-xs font-black">
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium">{step}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 pt-2">
                  <Button 
                    variant="outline" 
                    onClick={() => checkStatus()} 
                    disabled={actionLoading}
                    className="flex-1 h-11 rounded-xl font-bold"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${actionLoading ? "animate-spin" : ""}`} />
                    Já escaneei
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={() => setQrData(null)}
                    className="h-11 px-4 rounded-xl text-muted-foreground"
                    title="Cancelar"
                  >
                    <XCircle className="h-5 w-5" />
                  </Button>
                </div>
                <p className="text-[10px] text-center md:text-left text-muted-foreground uppercase tracking-[0.2em] font-bold opacity-60">
                  O código expira em 30 segundos
                </p>
              </div>
            </div>
          )}

          {isConnected && (
            <div className="p-8 rounded-3xl bg-green-500/[0.03] border border-green-500/10 animate-in fade-in duration-700">
              <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                <div className="flex items-center gap-6">
                  <div className="relative">
                    <div className="absolute -inset-4 bg-green-500/20 rounded-full blur-2xl animate-pulse"></div>
                    <div className="relative w-20 h-20 rounded-[2rem] bg-green-500 text-white flex items-center justify-center shadow-lg shadow-green-500/20">
                      <Bot className="h-10 w-10" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-md border-2 border-green-500">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </div>
                  </div>
                  <div className="text-center md:text-left">
                    <h3 className="text-xl font-bold text-green-900 tracking-tight">Agente IA Ativado</h3>
                    <p className="text-sm text-green-700/70 font-medium">Sincronizado com {status.phoneNumber || "seu número"}</p>
                    <div className="flex items-center gap-2 mt-2 justify-center md:justify-start">
                      <span className="flex h-2 w-2 rounded-full bg-green-500"></span>
                      <span className="text-[10px] uppercase font-bold tracking-widest text-green-600">Pronto para atender</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-3 w-full md:w-auto">
                  <Button 
                    variant="outline" 
                    size="lg"
                    onClick={() => checkStatus()}
                    className="flex-1 md:flex-none h-12 px-6 rounded-xl border-green-200 bg-white text-green-700 hover:bg-green-50 hover:text-green-800 font-bold"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sincronizar
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="lg" 
                    onClick={handleDisconnect}
                    disabled={actionLoading}
                    className="flex-1 md:flex-none h-12 px-6 rounded-xl font-bold shadow-lg shadow-red-500/10"
                  >
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogOut className="h-4 w-4 mr-2" />}
                    Desconectar
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {showDebug && (
        <Card className="border-primary/20 bg-muted/30 animate-in slide-in-from-top-2 duration-300">
          <CardHeader className="py-3 border-b flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-bold uppercase tracking-wider">Histórico de Sincronização</CardTitle>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDebugLogs([])} className="h-7 text-[10px]">Limpar Logs</Button>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[250px] w-full">
              <div className="p-4 space-y-3">
                {debugLogs.length === 0 ? (
                  <p className="text-xs text-center text-muted-foreground py-10 font-mono italic">Aguardando eventos da Evolution API...</p>
                ) : (
                  debugLogs.map((log, i) => (
                    <div key={i} className="space-y-1 pb-2 border-b border-border/50 last:border-0 group">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-primary font-bold bg-primary/5 px-1 rounded">{log.timestamp}</span>
                        <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono uppercase">{log.event}</Badge>
                      </div>
                      <pre className="text-[10px] font-mono bg-background/50 p-2 rounded overflow-x-auto text-muted-foreground max-h-32 group-hover:text-foreground transition-colors">
                        {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
