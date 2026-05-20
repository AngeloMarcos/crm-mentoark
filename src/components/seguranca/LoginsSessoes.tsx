import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, AlertTriangle, XCircle, ShieldCheck, 
  Settings, Clock, Mail, Key, UserCheck 
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoginsSessoes() {
  const checklist = [
    { label: "JWT verificado em todos os endpoints /api/*", status: "ok" },
    { label: "user_id extraído do token (não do body)", status: "ok" },
    { label: "Multi-tenant enforçado no CRUD factory", status: "ok" },
    { label: "Admin role verificado via adminMiddleware", status: "ok" },
    { label: "CORS restrito a domínios conhecidos", status: "ok" },
    { label: "MCP protegido por chave separada (x-mcp-key)", status: "ok" },
    { label: "Bulk delete requer pelo menos 1 filtro", status: "ok" },
    { label: "Uploads servidos sem autenticação (qualquer URL é pública)", status: "warn" },
    { label: "Emails admin hardcoded em modulos.ts (MASTERS array)", status: "warn" },
    { label: "Rate limiting não configurado na API", status: "warn" },
    { label: "MCP Client com acesso full ao banco", status: "error" },
  ];

  const configAuth = [
    { label: "Provider", valor: "Supabase Auth", sub: "Email + Senha", icon: Mail },
    { label: "JWT Secret", valor: "Configurado", sub: "Lido via env.JWT_SECRET", icon: Key },
    { label: "Expiração", valor: "1h (Access)", sub: "7d (Refresh Token)", icon: Clock },
    { label: "Role Management", valor: "App Metadata", sub: "user_roles table sync", icon: UserCheck },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Checklist de Segurança */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-3 border-b border-white/5">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Checklist de Segurança do Sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {checklist.map((item, idx) => (
              <div key={idx} className="flex items-start gap-3 p-2 rounded hover:bg-white/[0.02] transition-colors">
                {item.status === "ok" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                ) : item.status === "warn" ? (
                  <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                )}
                <span className={`text-xs ${
                  item.status === "error" ? "text-red-400" : 
                  item.status === "warn" ? "text-white/70" : "text-white/80"
                }`}>
                  {item.label}
                </span>
              </div>
            ))}
            
            <div className="pt-4 border-t border-white/5 flex justify-between items-center">
              <p className="text-[10px] text-muted-foreground italic">
                Última auditoria automática: hoje às 14:32
              </p>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10">
                Rodar Auditoria
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Configuração de Auth */}
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="pb-3 border-b border-white/5">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Settings className="h-4 w-4 text-blue-500" />
                Arquitetura de Autenticação
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-4">
                {configAuth.map((item) => (
                  <div key={item.label} className="p-3 rounded-lg border border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-2 mb-2">
                      <item.icon className="h-3.5 w-3.5 text-blue-400 opacity-70" />
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                    </div>
                    <p className="text-sm font-semibold text-white">{item.valor}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{item.sub}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-col gap-3">
                <div className="p-3 rounded-lg border border-white/5 bg-black/20">
                  <p className="text-xs font-medium text-white/80 mb-1">Admins Master (Hardcoded)</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="bg-white/5 text-xs font-normal">angelobispofilho@gmail.com</Badge>
                    <Badge variant="secondary" className="bg-white/5 text-xs font-normal">mentoark@gmail.com</Badge>
                  </div>
                </div>
                <Button variant="outline" className="w-full bg-white/5 border-white/10 text-xs gap-2">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Ver Logs de Autenticação (Supabase Audit)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
