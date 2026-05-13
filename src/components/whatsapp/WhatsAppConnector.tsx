import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { QrCode, RefreshCw, Wifi, WifiOff, LogOut, Phone, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { createInstance, reconnectInstance, fetchConnectionStatus, disconnectInstance } from '@/services/evolutionService';

interface WhatsAppConnectorProps {
  onConnected: () => void;
}

const QR_EXPIRY_SECONDS = 60;
const POLL_INTERVAL_MS = 3000;

export function WhatsAppConnector({ onConnected }: WhatsAppConnectorProps) {
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const [connectionState, setConnectionState] = useState<'open' | 'close' | 'connecting'>('close');
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    setTimer(QR_EXPIRY_SECONDS);

    timerRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          stopPolling();
          setQrBase64(null);
          toast.info('QR Code expirado. Gere um novo.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    pollRef.current = setInterval(async () => {
      try {
        const { state, phoneNumber: phone } = await fetchConnectionStatus();
        setConnectionState(state);
        if (state === 'open') {
          stopPolling();
          setPhoneNumber(phone || null);
          toast.success('WhatsApp conectado com sucesso!');
          onConnected();
        }
      } catch { /* keep polling */ }
    }, POLL_INTERVAL_MS);
  }, [onConnected, stopPolling]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { state } = await fetchConnectionStatus();
        if (cancelled) return;
        setConnectionState(state);
        if (state === 'connecting') {
          setLoading(true);
          try {
            const result = await reconnectInstance();
            if (!cancelled && result.qrCode) {
              setQrBase64(result.qrCode);
              setPairingCode(result.pairingCode || null);
              startPolling();
            }
          } finally {
            if (!cancelled) setLoading(false);
          }
        } else if (state === 'open') {
          onConnected();
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [onConnected, startPolling]);

  const handleConnect = async () => {
    try {
      setLoading(true);
      const result = await createInstance();

      if (result.state === 'open') {
        setConnectionState('open');
        setPhoneNumber(result.phoneNumber || null);
        toast.success('WhatsApp já está conectado!');
        onConnected();
      } else if (result.qrCode) {
        setQrBase64(result.qrCode);
        setPairingCode(result.pairingCode || null);
        startPolling();
      } else {
        const { state } = await fetchConnectionStatus();
        setConnectionState(state);
        if (state === 'open') {
          toast.success('WhatsApp já está conectado!');
          onConnected();
        } else {
          toast.warning('Nenhum QR Code retornado. Tente novamente.');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      toast.error(`Erro ao conectar: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReconnect = async () => {
    try {
      setLoading(true);
      const result = await reconnectInstance();
      if (result.qrCode) {
        setQrBase64(result.qrCode);
        setPairingCode(result.pairingCode || null);
        startPolling();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      toast.error(`Erro ao gerar QR Code: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await disconnectInstance();
      setConnectionState('close');
      setQrBase64(null);
      setPhoneNumber(null);
      stopPolling();
      toast.success('WhatsApp desconectado.');
    } catch {
      toast.error('Erro ao desconectar.');
    }
  };

  if (connectionState === 'open') {
    return (
      <Card className="flex flex-col items-center justify-center h-full p-6 gap-6 bg-card">
        <Badge variant="default" className="bg-emerald-600 text-white gap-1 text-sm px-3 py-1">
          <Wifi className="h-3.5 w-3.5" /> WhatsApp Conectado
        </Badge>

        {phoneNumber && (
          <div className="flex items-center gap-2 text-lg font-medium">
            <Phone className="h-5 w-5 text-emerald-500" />
            <span>{phoneNumber}</span>
          </div>
        )}

        <Button variant="destructive" size="sm" onClick={handleLogout} className="gap-1 mt-2">
          <LogOut className="h-3 w-3" /> Desconectar
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center justify-center h-full p-6 gap-6 bg-card">
      <Badge variant="secondary" className="gap-1">
        <WifiOff className="h-3 w-3" /> Desconectado
      </Badge>

      <div className="flex flex-col md:flex-row items-center gap-8 max-w-2xl w-full">
        <div className="flex flex-col items-center gap-3 shrink-0">
          <div className="relative max-w-[220px] rounded-2xl bg-gray-900/85 backdrop-blur-md border border-white/10 px-4 py-3 text-sm font-medium text-white shadow-xl">
            Escaneie o QR Code para conectar seu WhatsApp!
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-gray-900/85" />
          </div>
          <div className="w-32 h-32 bg-primary/10 rounded-full flex items-center justify-center">
            <MessageSquare className="w-16 h-16 text-primary" />
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center gap-4 w-full">
          {!qrBase64 && !loading && (
            <Button onClick={handleConnect} className="gap-2 bg-[#25D366] hover:bg-[#20BD5A] text-white" size="lg">
              <QrCode className="h-5 w-5" /> Conectar WhatsApp
            </Button>
          )}

          {loading && <Skeleton className="w-[280px] h-[280px] rounded-xl" />}

          {qrBase64 && !loading && (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-white rounded-xl shadow-lg">
                <img src={qrBase64} alt="QR Code WhatsApp" className="w-[260px] h-[260px] object-contain" />
              </div>

              {pairingCode && (
                <p className="text-xs text-muted-foreground">
                  Código de pareamento: <span className="font-mono font-bold">{pairingCode}</span>
                </p>
              )}

              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Expira em <span className="font-bold text-foreground">{timer}s</span>
                </span>
                <Button variant="outline" size="sm" onClick={handleReconnect} className="gap-1">
                  <RefreshCw className="h-3 w-3" /> Atualizar
                </Button>
              </div>

              <p className="text-xs text-muted-foreground text-center max-w-[260px]">
                Abra o WhatsApp no celular → Aparelhos conectados → Conectar novo aparelho → Escaneie este código
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
