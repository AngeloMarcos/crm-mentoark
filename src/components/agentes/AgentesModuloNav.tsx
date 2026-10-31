/**
 * Navegação do módulo "Agentes de IA" (2026-10-31, modelo Cubo: Meus agentes · Execuções · Bases
 * de conhecimento · Conexões). Fica no topo de cada tela de IA para toda a configuração da IA
 * estar num lugar só, sem caçar itens no menu lateral.
 */
import { useLocation, useNavigate } from "react-router-dom";
import { Activity, Bot, Brain, MessageCircle, Plug } from "lucide-react";

const ITENS = [
  { rota: "/agentes", rotulo: "Meus agentes", icone: Bot },
  { rota: "/canais", rotulo: "Canais", icone: MessageCircle },
  { rota: "/cerebro", rotulo: "Bases de conhecimento", icone: Brain },
  { rota: "/integracoes", rotulo: "Integrações de IA", icone: Plug },
  { rota: "/uso-ia", rotulo: "Uso de IA", icone: Activity },
];

export function AgentesModuloNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b -mt-1" aria-label="Agentes de IA">
      {ITENS.map(({ rota, rotulo, icone: Icone }) => {
        const ativo = pathname === rota || pathname.startsWith(rota + "/");
        return (
          <button
            key={rota}
            onClick={() => navigate(rota)}
            className={`flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              ativo ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icone className="h-4 w-4" /> {rotulo}
          </button>
        );
      })}
    </nav>
  );
}
