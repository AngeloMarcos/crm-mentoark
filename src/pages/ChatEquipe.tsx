import { useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Briefcase,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

export default function ChatEquipePage() {
  const [query, setQuery] = useState("");

  return (
    <CRMLayout>
      <div className="h-[calc(100vh-8rem)] rounded-2xl border border-border bg-card overflow-hidden flex">
        {/* Sidebar de conversas */}
        <aside className="w-[300px] border-r border-border bg-muted/30 flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl gradient-brand flex items-center justify-center">
                <Users className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold leading-tight">Espaço de Trabalho</h2>
                <p className="text-xs text-muted-foreground">Comunicação Interna</p>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8">
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Conversa Direta
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Users className="h-4 w-4 mr-2" />
                  Novo Grupo de Trabalho
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="px-3 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar conversas ou colegas..."
                className="pl-9 h-9 bg-background"
              />
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <MessageCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Nenhuma conversa</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use o botão "+" para iniciar um chat.
            </p>
          </div>
        </aside>

        {/* Área principal */}
        <main className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-5">
            <Briefcase className="h-7 w-7 text-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Chat Corporativo MentoArk</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">
            Selecione um colaborador na lista ao lado para iniciar o alinhamento de demandas.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-500 text-xs font-medium">
            <ShieldCheck className="h-3.5 w-3.5" />
            Canal de Comunicação Interno Reservado
          </div>
        </main>
      </div>
    </CRMLayout>
  );
}
