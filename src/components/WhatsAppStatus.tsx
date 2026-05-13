import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, QrCode, CheckCircle2, XCircle, LogOut, Terminal, History, ChevronDown, ChevronUp } from "lucide-react";
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

  const addLog = (event: string, data: any) => {
    const log: DebugLog = {
      timestamp: new Date().toLocaleTimeString(),
      event,
      data
    };
    setDebugLogs(prev => [log, ...prev].slice(0, 20));
  };

  const checkStatus = async () => {
    try {
      setLoading(true);
      const res = await fetchConnectionStatus();
      addLog("CheckStatus Result", res);
      setStatus(res);
      if (res.state === 'open') {
        setQrData(null);
      }
    } catch (error: any) {
      addLog("CheckStatus Error", error.message);
      console.error("Erro ao buscar status:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(() => {
      checkStatus();
    }, 15000); 

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let qrInterval: number | undefined;

    if (qrData?.qrCode && status?.state !== 'open') {
      qrInterval = window.setInterval(async () => {
        addLog("Regenerating QR", { currentStatus: status?.state });
        try {
          const res = await createInstance();
          addLog("Regeneration Success", { hasQr: !!res.qrCode, state: res.state });
          setQrData(res);
          
          if (res.state === 'open') {
            checkStatus();
          }
        } catch (error: any) {
          addLog("Regeneration Error", error.message);
          console.error("Falha ao regenerar QR:", error);
        }
      }, 20000); 
    }

    return () => {
      if (qrInterval) clearInterval(qrInterval);
    };
  }, [qrData?.qrCode, status?.state]);

  const handleConnect = async () => {
    try {
      setActionLoading(true);
      addLog("Init Connection", { action: "create" });
      setQrData(null);
      const res = await createInstance();
      addLog("Connection Response", { state: res.state, hasQr: !!res.qrCode });
      
      if (res.state === 'open') {
        toast.success("WhatsApp já está conectado!");
        setStatus({ state: 'open', phoneNumber: res.phoneNumber });
        setQrData(null);
        // Pequeno delay antes do checkStatus para garantir que o backend da Evolution propagou
        setTimeout(checkStatus, 1000);
        return;
      }

      if (!res.qrCode && res.state !== 'open') {
        addLog("QR Missing", "Retrying in 2s...");
        setTimeout(async () => {
          const retryRes = await createInstance();
          addLog("Retry Response", { state: retryRes.state, hasQr: !!retryRes.qrCode });
          if (retryRes.state === 'open') {
            toast.success("WhatsApp conectado!");
            setStatus({ state: 'open', phoneNumber: retryRes.phoneNumber });
            setQrData(null);
            checkStatus();
          } else {
            setQrData(retryRes);
          }
        }, 2000);
      } else {
        setQrData(res);
      }

      if (res.qrCode) {
        toast.info("QR Code gerado. Escaneie no seu WhatsApp.");
      }
    } catch (error: any) {
      addLog("Connection Error", error.message);
      toast.error(error.message || "Erro ao conectar");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Tem certeza que deseja desconectar o WhatsApp?")) return;
    try {
      setActionLoading(true);
      addLog("Disconnecting", { instanceName: qrData?.instanceName });
      await disconnectInstance();
      addLog("Disconnect Success", null);
      setStatus({ state: 'close' });
      setQrData(null);
      toast.success("WhatsApp desconectado");
    } catch (error: any) {
      addLog("Disconnect Error", error.message);
      toast.error(error.message || "Erro ao desconectar");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !status) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
          <span className="text-sm font-medium">Verificando conexão...</span>
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
                  {isConnected ? `Conectado: ${status.phoneNumber || ""}` : "Aguardando conexão"}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setShowDebug(!showDebug)}
                className={showDebug ? "text-primary bg-primary/10" : "text-muted-foreground"}
                title="Log de Diagnóstico"
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
                <h3 className="font-bold text-lg">Pronto para Conectar?</h3>
                <p className="text-sm text-muted-foreground max-w-[320px]">
                  Conecte seu WhatsApp para que o Agente IA possa automatizar seu atendimento em tempo real.
                </p>
              </div>
              <Button 
                onClick={handleConnect} 
                disabled={actionLoading}
                className="w-full sm:w-auto px-8 py-6 text-base font-semibold transition-all hover:scale-105"
              >
                {actionLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <QrCode className="h-5 w-5 mr-2" />}
                Gerar QR Code de Conexão
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
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Aguardando Leitura
                  </Badge>
                  <h3 className="font-bold text-xl">Escaneie com seu Celular</h3>
                </div>
                <div className="bg-muted/50 p-4 rounded-xl text-left space-y-2 border border-border/50 max-w-[350px]">
                  <p className="text-sm flex gap-3"><span className="flex-shrink-0 w-5 h-5 bg-primary text-white rounded-full flex items-center justify-center text-[10px] font-bold">1</span> Abra o WhatsApp e vá em <strong>Aparelhos Conectados</strong></p>
                  <p className="text-sm flex gap-3"><span className="flex-shrink-0 w-5 h-5 bg-primary text-white rounded-full flex items-center justify-center text-[10px] font-bold">2</span> Toque em <strong>Conectar um Aparelho</strong></p>
                  <p className="text-sm flex gap-3"><span className="flex-shrink-0 w-5 h-5 bg-primary text-white rounded-full flex items-center justify-center text-[10px] font-bold">3</span> Aponte sua câmera para este QR Code</p>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">O código atualiza automaticamente a cada 20s</p>
              </div>
              <div className="flex gap-2 w-full max-w-[350px]">
                <Button 
                  variant="outline" 
                  onClick={checkStatus} 
                  disabled={actionLoading}
                  className="flex-1"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${actionLoading ? "animate-spin" : ""}`} />
                  Atualizar Status
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={() => setQrData(null)}
                  className="px-3"
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
                    <h3 className="text-lg font-bold text-success-foreground">Agente IA Conectado</h3>
                    <p className="text-sm text-muted-foreground">Operando via {status.phoneNumber || "WhatsApp"}</p>
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={checkStatus}
                    className="flex-1 sm:flex-none"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-2" />
                    Verificar
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    onClick={handleDisconnect}
                    disabled={actionLoading}
                    className="flex-1 sm:flex-none"
                  >
                    {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <LogOut className="h-3.5 w-3.5 mr-2" />}
                    Desconectar
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Painel de Debug */}
      {showDebug && (
        <Card className="border-primary/20 bg-muted/30 animate-in slide-in-from-top-2 duration-300">
          <CardHeader className="py-3 border-b flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-bold uppercase tracking-wider">Log de Diagnóstico</CardTitle>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDebugLogs([])} className="h-7 text-[10px]">Limpar</Button>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[200px] w-full">
              <div className="p-4 space-y-3">
                {debugLogs.length === 0 ? (
                  <p className="text-xs text-center text-muted-foreground py-10">Nenhum evento registrado ainda.</p>
                ) : (
                  debugLogs.map((log, i) => (
                    <div key={i} className="space-y-1 pb-2 border-b border-border/50 last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-primary font-bold">{log.timestamp}</span>
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{log.event}</Badge>
                      </div>
                      <pre className="text-[10px] font-mono bg-background/50 p-2 rounded overflow-x-auto text-muted-foreground max-h-32">
                        {JSON.stringify(log.data, null, 2)}
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
