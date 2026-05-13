import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, QrCode, CheckCircle2, XCircle, LogOut, Terminal, History, AlertTriangle } from "lucide-react";
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
  const [lastError, setLastError] = useState<{ message: string; timestamp: string; lastAction: 'create' | 'status' | 'logout' } | null>(null);
  const [autoRetrying, setAutoRetrying] = useState(false);

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
      <Card className={`border-l-4 ${isConnected ? "border-l-success" : "border-l-warning"} shadow-md overflow-hidden bg-background/50 backdrop-blur-sm`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isConnected ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                {isConnected ? <CheckCircle2 className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
              </div>
              <div>
                <CardTitle className="text-lg">Status do WhatsApp</CardTitle>
                <CardDescription>
                  {isConnected ? `Instância ativa: ${status.phoneNumber || ""}` : "Aguardando pareamento via QR Code"}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setShowDebug(!showDebug)}
                className={showDebug ? "text-primary bg-primary/10" : "text-muted-foreground"}
                title="Log de Sincronização"
              >
                <Terminal className="h-4 w-4" />
              </Button>
              <Badge variant={isConnected ? "default" : "secondary"} className={isConnected ? "bg-success hover:bg-success text-white" : "animate-pulse"}>
                {isConnected ? "Conectado" : "Desconectado"}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isConnected && !qrData?.qrCode && (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-4 animate-in fade-in zoom-in duration-300">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center ring-8 ring-primary/5">
                <QrCode className="h-10 w-10 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-lg">Parear Novo Dispositivo</h3>
                <p className="text-sm text-muted-foreground max-w-[320px]">
                  Conecte seu WhatsApp para habilitar as automações do Agente IA MentoArk.
                </p>
              </div>
              <Button 
                onClick={handleConnect} 
                disabled={actionLoading}
                className="w-full sm:w-auto px-8 py-6 text-base font-semibold transition-all hover:scale-105"
              >
                {actionLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <QrCode className="h-5 w-5 mr-2" />}
                Gerar Novo QR Code
              </Button>
            </div>
          )}

          {qrData?.qrCode && !isConnected && (
            <div className="flex flex-col items-center justify-center py-6 text-center space-y-6 animate-in slide-in-from-bottom-4 duration-500">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary to-accent rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative bg-white p-5 rounded-2xl shadow-2xl border border-white/20">
                  <img 
                    src={qrData.qrCode} 
                    alt="WhatsApp QR Code" 
                    className="w-56 h-56 transition-transform duration-500 hover:scale-105"
                  />
                  {actionLoading && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-2xl">
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex flex-col items-center gap-2">
                  <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 px-3 py-1">
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Sincronizando QR...
                  </Badge>
                  <h3 className="font-bold text-xl">Escaneie o Código Acima</h3>
                </div>
                <div className="bg-muted/50 p-4 rounded-xl text-left space-y-2 border border-border/50 max-w-[350px]">
                  <p className="text-sm flex gap-3"><span className="flex-shrink-0 w-5 h-5 bg-primary text-white rounded-full flex items-center justify-center text-[10px] font-bold">1</span> No WhatsApp, acesse <strong>Aparelhos Conectados</strong></p>
                  <p className="text-sm flex gap-3"><span className="flex-shrink-0 w-5 h-5 bg-primary text-white rounded-full flex items-center justify-center text-[10px] font-bold">2</span> Toque em <strong>Conectar um Aparelho</strong></p>
                  <p className="text-sm flex gap-3"><span className="flex-shrink-0 w-5 h-5 bg-primary text-white rounded-full flex items-center justify-center text-[10px] font-bold">3</span> Escaneie o QR Code exibido nesta tela</p>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Atualização automática em tempo real</p>
              </div>
              <div className="flex gap-2 w-full max-w-[350px]">
                <Button 
                  variant="outline" 
                  onClick={() => checkStatus()} 
                  disabled={actionLoading}
                  className="flex-1"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${actionLoading ? "animate-spin" : ""}`} />
                  Forçar Atualização
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={() => setQrData(null)}
                  className="px-3"
                  title="Fechar QR Code"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {isConnected && (
            <div className="flex flex-col p-6 rounded-2xl bg-success/5 border border-success/20 animate-in fade-in duration-500">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="absolute -inset-2 bg-success rounded-full blur opacity-20 animate-pulse"></div>
                    <div className="relative w-14 h-14 rounded-full bg-success/10 flex items-center justify-center ring-4 ring-success/5">
                      <CheckCircle2 className="h-8 w-8 text-success" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-success-foreground">Conexão Estabelecida</h3>
                    <p className="text-sm text-muted-foreground">O Agente IA está ativo no número {status.phoneNumber || ""}</p>
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => checkStatus()}
                    className="flex-1 sm:flex-none"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-2" />
                    Sincronizar
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    onClick={handleDisconnect}
                    disabled={actionLoading}
                    className="flex-1 sm:flex-none"
                  >
                    {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <LogOut className="h-3.5 w-3.5 mr-2" />}
                    Remover Conexão
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
