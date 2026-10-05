import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

interface Props {
  children: ReactNode;
  name?: string;
}
interface State {
  hasError: boolean;
  error: Error | null;
  mostrarDetalhes: boolean;
}

/**
 * Erros de reconciliação do DOM ("removeChild"/"insertBefore" reclamando que o nó não é filho)
 * quase sempre vêm de algo fora do React mexendo na página por fora — extensão de tradutor,
 * bloqueador de anúncio, ferramenta de disparo em massa instalada como extensão de navegador —
 * nunca um bug isolado de uma tela específica (achado real, 2026-09-30: cliente via esse erro em
 * várias telas diferentes do CRM, o que não bate com um bug de componente, mas bate exatamente com
 * uma extensão rodando em toda aba aberta). Mostrar o texto cru do erro pro cliente não ajuda em
 * nada — ele não vai saber o que é "removeChild"; melhor reconhecer o padrão e já sugerir o que
 * resolve na prática, guardando o técnico só para quem for dar suporte.
 */
const RE_CONFLITO_DOM = /removeChild|insertBefore|appendChild|is not a child of this node|node to be removed/i;

function mensagemAmigavel(error: Error | null): { titulo: string; texto: string } {
  if (error && RE_CONFLITO_DOM.test(error.message)) {
    return {
      titulo: "Conflito com uma extensão do navegador",
      texto:
        "Isso costuma acontecer quando alguma extensão instalada no navegador (tradutor automático, " +
        "bloqueador de anúncios, ferramentas de disparo em massa) mexe na página por fora do sistema. " +
        "Recarregue a página; se continuar, tente desativar as extensões ou abrir numa aba anônima.",
    };
  }
  return {
    titulo: "Algo deu errado",
    texto: "Ocorreu um erro inesperado. Recarregue a página; se continuar, fale com o suporte.",
  };
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, mostrarDetalhes: false };
  }

  static getDerivedStateFromError(error: Error): Pick<State, "hasError" | "error"> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    // Best-effort: se isso falhar (offline, endpoint fora do ar), não faz diferença nenhuma —
    // o usuário já está vendo a tela de erro de qualquer forma.
    fetch(`${API_BASE}/api/client-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        boundary: this.props.name || "global",
      }),
    }).catch(() => {});
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, mostrarDetalhes: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const { titulo, texto } = mensagemAmigavel(this.state.error);
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="glass card-gradient-border max-w-md w-full p-8 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/15 text-destructive flex items-center justify-center">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold">{titulo}</h2>
              <p className="text-sm text-muted-foreground">{texto}</p>
            </div>
            <Button onClick={this.handleReload} className="w-full">
              Recarregar página
            </Button>
            {this.state.error?.message && (
              <div className="text-left">
                <button
                  onClick={() => this.setState(s => ({ mostrarDetalhes: !s.mostrarDetalhes }))}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {this.state.mostrarDetalhes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Detalhes técnicos (para o suporte)
                </button>
                {this.state.mostrarDetalhes && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground whitespace-pre-wrap break-words">
                    {this.state.error.message}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
