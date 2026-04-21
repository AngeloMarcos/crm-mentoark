import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="glass card-gradient-border max-w-md w-full p-8 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/15 text-destructive flex items-center justify-center">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold">Algo deu errado</h2>
              <p className="text-sm text-muted-foreground">
                {this.state.error?.message ??
                  "Erro inesperado. Tente recarregar a página."}
              </p>
            </div>
            <Button onClick={this.handleReload} className="w-full">
              Recarregar página
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
