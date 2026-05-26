import React, { useState, useEffect, useCallback } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Database, Server, Clock, RefreshCw } from "lucide-react";

interface HealthStatus {
  status: 'ok' | 'error' | 'loading';
  db: 'connected' | 'disconnected' | 'unknown';
  latency: number | null;
  lastCheck: string | null;
  consecutiveErrors: number;
}

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export const HealthCheck = () => {
  const isDev = import.meta.env.DEV === true;
  const { toast } = useToast();
  
  const [health, setHealth] = useState<HealthStatus>(() => {
    const saved = sessionStorage.getItem('health_check_state');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      status: 'loading',
      db: 'unknown',
      latency: null,
      lastCheck: null,
      consecutiveErrors: 0,
    };
  });

  const checkHealth = useCallback(async () => {
    const startTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${API_URL}/health`, { 
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeoutId);
      
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);
      const data = await response.json();
      
      const newStatus: HealthStatus = {
        status: data.status === 'ok' ? 'ok' : 'error',
        db: data.db === 'connected' ? 'connected' : 'disconnected',
        latency,
        lastCheck: new Date().toLocaleTimeString(),
        consecutiveErrors: 0,
      };

      setHealth(newStatus);
    } catch (error) {
      clearTimeout(timeoutId);
      setHealth(prev => {
        const newConsecutiveErrors = prev.consecutiveErrors + 1;
        
        if (newConsecutiveErrors === 3) {
          toast({
            title: "⚠️ Backend sem resposta",
            description: "Verifique a conexão com o servidor.",
            variant: "destructive",
          });
        }

        return {
          status: 'error',
          db: 'disconnected',
          latency: null,
          lastCheck: new Date().toLocaleTimeString(),
          consecutiveErrors: newConsecutiveErrors,
        };
      });
    }
  }, [toast]);

  useEffect(() => {
    sessionStorage.setItem('health_check_state', JSON.stringify(health));
  }, [health]);

  useEffect(() => {
    if (!isDev) return;

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth, isDev]);

  if (!isDev) return null;

  const getStatusColor = () => {
    if (health.status === 'loading') return 'bg-gray-400';
    if (health.status === 'error') return 'bg-red-500';
    if (health.db !== 'connected') return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getStatusText = () => {
    if (health.status === 'loading') return 'Verificando...';
    if (health.status === 'error') return 'Erro no backend';
    if (health.db !== 'connected') return 'DB desconectado';
    return 'Backend saudável';
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9999]">
      <TooltipProvider>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button 
                  className={cn(
                    "w-3 h-3 rounded-full shadow-sm transition-all hover:scale-125",
                    getStatusColor(),
                    health.status === 'loading' && "animate-pulse"
                  )}
                />
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs font-medium">{getStatusText()}</p>
            </TooltipContent>
          </Tooltip>

          <PopoverContent className="w-56 p-3" align="end" side="top">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-bold uppercase text-muted-foreground">Status do Sistema</span>
                <div className={cn("w-2 h-2 rounded-full", getStatusColor())} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Server className="w-3 h-3 text-muted-foreground" />
                    <span>Backend:</span>
                  </div>
                  <span className={cn(health.status === 'ok' ? "text-green-600" : "text-red-600", "font-medium")}>
                    {health.status === 'ok' ? 'OK' : 'Erro'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Database className="w-3 h-3 text-muted-foreground" />
                    <span>Banco de Dados:</span>
                  </div>
                  <span className={cn(health.db === 'connected' ? "text-green-600" : "text-red-600", "font-medium")}>
                    {health.db === 'connected' ? 'Conectado' : 'Desconectado'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    <span>Latência:</span>
                  </div>
                  <span className="font-medium">{health.latency ? `${health.latency}ms` : '--'}</span>
                </div>

                <div className="pt-1 text-[10px] text-muted-foreground italic text-right">
                  Última verificação: {health.lastCheck || '--'}
                </div>
              </div>

              <Button 
                size="sm" 
                variant="outline" 
                className="w-full h-7 text-xs gap-1.5"
                onClick={() => checkHealth()}
              >
                <RefreshCw className="w-3 h-3" />
                Testar agora
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    </div>
  );
};
