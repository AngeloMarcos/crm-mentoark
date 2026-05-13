import { useState, useEffect } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, CheckCircle, AlertCircle, Phone, Package, LayoutGrid, Calendar } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
const token = () => localStorage.getItem("access_token") || "";

interface Log {
  id: string;
  tipo: string;
  telefone: string;
  status: string;
  mensagem_texto: string;
  produto_nome?: string;
  catalogo_nome?: string;
  erro_mensagem?: string;
  created_at: string;
}

export default function CatalogoEnviosPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const carregar = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/catalogo/history?limit=100`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (r.ok) {
        setLogs(await r.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/catalogo")}>
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Histórico de Envios</h1>
            <p className="text-sm text-muted-foreground">Log detalhado de produtos e catálogos enviados via WhatsApp</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Clock className="animate-spin h-8 w-8 text-primary" />
          </div>
        ) : logs.length === 0 ? (
          <Card className="py-20 text-center">
            <Clock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhum envio registrado ainda</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {logs.map((log) => (
              <Card key={log.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex flex-col sm:flex-row">
                    {/* Status lateral */}
                    <div className={`w-2 ${log.status === 'ENVIADO' ? 'bg-green-500' : 'bg-red-500'}`} />
                    
                    <div className="flex-1 p-4 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {log.tipo === 'PRODUTO' ? <Package className="h-4 w-4 text-primary" /> : <LayoutGrid className="h-4 w-4 text-primary" />}
                          <span className="font-semibold">{log.tipo}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {log.produto_nome || log.catalogo_nome || "Item removido"}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{log.telefone}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(log.created_at), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}
                        </div>
                      </div>

                      <div className="md:col-span-1">
                        <Badge variant={log.status === 'ENVIADO' ? 'default' : 'destructive'} className="gap-1">
                          {log.status === 'ENVIADO' ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                          {log.status}
                        </Badge>
                      </div>

                      <div className="text-sm text-muted-foreground line-clamp-2 italic">
                        {log.status === 'ERRO' ? (
                          <span className="text-red-400">Erro: {log.erro_mensagem}</span>
                        ) : (
                          log.mensagem_texto
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </CRMLayout>
  );
}
