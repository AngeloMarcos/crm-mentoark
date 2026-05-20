import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Database, Globe, Lock, ShieldCheck, AlertTriangle } from "lucide-react";

export function MapaBancoDados() {
  const tabelas = [
    { nome: "contatos", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "leads", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "agentes", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "galeria_midias", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "catalogos", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "produtos", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "conhecimento", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "integracoes_config", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "campanhas", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "user_modulos", isolamento: "user_id", status: "Protegida", nivel: "Crítica" },
    { nome: "n8n_chat_histories", isolamento: "user_id", status: "Protegida", nivel: "Alta" },
    { nome: "disparo_logs", isolamento: "user_id", status: "Protegida", nivel: "Média" },
    { nome: "uploads (arquivos)", isolamento: "público", status: "Sem auth", nivel: "Baixa" },
  ];

  const endpointsPublicos = [
    { metodo: "GET", path: "/health", descricao: "Health check" },
    { metodo: "POST", path: "/auth/*", descricao: "Login / registro / refresh" },
    { metodo: "POST", path: "/webhook/*", descricao: "Webhooks n8n / Evolution" },
    { metodo: "POST", path: "/mcp", descricao: "MCP Client (auth via x-mcp-key)" },
    { metodo: "GET", path: "/uploads/*", descricao: "Arquivos estáticos (sem autenticação)" },
    { metodo: "GET", path: "/api/catalogo/n8n/:userId", descricao: "Catálogo para n8n (auth via x-n8n-secret)" },
    { metodo: "POST", path: "/api/marketing/facebook/callback", descricao: "OAuth callback Meta" },
    { metodo: "POST", path: "/api/marketing/facebook/webhook", descricao: "Leads webhook Meta" },
  ];

  const endpointsAdmin = [
    { metodo: "GET", path: "/api/modulos/lista", descricao: "Lista canônica de módulos" },
    { metodo: "GET", path: "/api/modulos/usuario/:userId", descricao: "Consultar módulos de usuário" },
    { metodo: "PUT", path: "/api/modulos/usuario/:userId", descricao: "Atualizar múltiplos módulos" },
    { metodo: "POST", path: "/api/modulos/usuario/:userId/toggle", descricao: "Toggle módulo individual" },
    { metodo: "GET", path: "/api/usuarios/*", descricao: "Gestão global de usuários" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Seção: Tabelas protegidas */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-3 border-b border-white/5">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-500" />
              Tabelas & Multi-tenancy
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-xs text-muted-foreground">Tabela</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Isolamento</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Nível</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tabelas.map((t) => (
                  <TableRow key={t.nome} className="border-white/5 hover:bg-white/[0.02]">
                    <TableCell className="text-xs font-mono text-white/80">{t.nome}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.isolamento}</TableCell>
                    <TableCell>
                      <span className={`text-[10px] uppercase font-bold ${
                        t.nivel === "Crítica" ? "text-red-400" : 
                        t.nivel === "Alta" ? "text-orange-400" : 
                        t.nivel === "Média" ? "text-yellow-400" : "text-blue-400"
                      }`}>
                        {t.nivel}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {t.status === "Protegida" ? (
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                        )}
                        <span className="text-[10px] font-medium">{t.status}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Endpoints Públicos */}
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="pb-3 border-b border-white/5">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Globe className="h-4 w-4 text-emerald-500" />
                Endpoints Públicos (Sem JWT)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableBody>
                  {endpointsPublicos.map((e) => (
                    <TableRow key={e.path} className="border-white/5 hover:bg-white/[0.02]">
                      <TableCell className="text-[10px] font-bold text-emerald-400 w-16">{e.metodo}</TableCell>
                      <TableCell className="text-xs font-mono text-white/70">{e.path}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground text-right">{e.descricao}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Endpoints Admin */}
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="pb-3 border-b border-white/5">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Lock className="h-4 w-4 text-purple-500" />
                Endpoints Restritos (Admin Only)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableBody>
                  {endpointsAdmin.map((e) => (
                    <TableRow key={e.path} className="border-white/5 hover:bg-white/[0.02]">
                      <TableCell className="text-[10px] font-bold text-purple-400 w-16">{e.metodo}</TableCell>
                      <TableCell className="text-xs font-mono text-white/70">{e.path}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground text-right">{e.descricao}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
