import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Error in ${this.props.name || "Component"}:`, error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <Card className="border-destructive/50 bg-destructive/5 my-4">
          <CardContent className="pt-6 pb-6 flex flex-col items-center text-center space-y-3">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <div className="space-y-1">
              <h3 className="font-semibold text-lg text-destructive">Algo deu errado</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                {this.props.name ? `Ocorreu um erro no módulo ${this.props.name}.` : "Não foi possível carregar este componente."}
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => this.setState({ hasError: false })}
              className="gap-2"
            >
              <RefreshCcw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
