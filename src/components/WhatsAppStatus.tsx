import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, QrCode, CheckCircle2, XCircle, LogOut } from "lucide-react";
import { toast } from "sonner";
import { fetchConnectionStatus, createInstance, disconnectInstance, type StatusResult, type CreateInstanceResult } from "@/services/evolutionService";

export function WhatsAppStatus() {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [qrData, setQrData] = useState<CreateInstanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const checkStatus = async () => {
    try {
      setLoading(true);
      const res = await fetchConnectionStatus();
      setStatus(res);
      if (res.state === 'close') {
        // If closed, maybe try to get a QR code automatically or wait for user
      }
    } catch (error: any) {
      console.error("Erro ao buscar status:", error);
      toast.error("Erro ao verificar status do WhatsApp");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  const handleConnect = async () => {
    try {
      setActionLoading(true);
      const res = await createInstance();
      setQrData(res);
      if (res.qrCode) {
        toast.info("QR Code gerado. Escaneie no seu WhatsApp.");
      } else if (res.state === 'open') {
        toast.success("WhatsApp conectado!");
        checkStatus();
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao conectar");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Tem certeza que deseja desconectar o WhatsApp?")) return;
    try {
      setActionLoading(true);
      await disconnectInstance();
      setStatus({ state: 'close' });
      setQrData(null);
      toast.success("WhatsApp desconectado");
    } catch (error: any) {
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
          <Badge variant={isConnected ? "default" : "secondary"} className={isConnected ? "bg-success hover:bg-success text-white" : "animate-pulse"}>
            {isConnected ? "Conectado" : "Desconectado"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isConnected && !qrData?.qrCode && (
          <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <QrCode className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground max-w-[280px]">
                Conecte seu WhatsApp para que o Agente IA possa responder suas mensagens em tempo real.
              </p>
            </div>
            <Button 
              onClick={handleConnect} 
              disabled={actionLoading}
              className="w-full sm:w-auto px-8"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
              Gerar QR Code
            </Button>
          </div>
        )}

        {qrData?.qrCode && !isConnected && (
          <div className="flex flex-col items-center justify-center py-6 text-center space-y-6">
            <div className="bg-white p-4 rounded-xl shadow-inner border-4 border-primary/10">
              <img 
                src={qrData.qrCode} 
                alt="WhatsApp QR Code" 
                className="w-48 h-48"
              />
            </div>
            <div className="space-y-2">
              <p className="font-bold text-sm">Escaneie o QR Code</p>
              <p className="text-xs text-muted-foreground max-w-[250px]">
                Abra o WhatsApp no seu celular {'>'} Configurações {'>'} Aparelhos Conectados {'>'} Conectar um Aparelho.
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={checkStatus} 
              disabled={actionLoading}
              className="w-full sm:w-auto"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${actionLoading ? "animate-spin" : ""}`} />
              Já escaneei
            </Button>
          </div>
        )}

        {isConnected && (
          <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-xl bg-muted/30 border border-border/50 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm font-bold">Conexão Ativa</p>
                <p className="text-[10px] text-muted-foreground">O agente está operando normalmente</p>
              </div>
            </div>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={handleDisconnect}
              disabled={actionLoading}
              className="w-full sm:w-auto"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogOut className="h-4 w-4 mr-2" />}
              Desconectar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
