import { useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Link2, QrCode, Plus, Copy, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function SmartLinksPage() {
  const [destino, setDestino] = useState("");

  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt);
    toast({ title: "Copiado!", description: txt });
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-fuchsia-500/15 text-fuchsia-500 flex items-center justify-center">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Smart Links & QR Code</h1>
            <p className="text-sm text-muted-foreground">
              Crie links curtos rastreáveis e QR Codes para campanhas.
            </p>
          </div>
        </div>

        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-semibold">Criar novo Smart Link</h2>
          <div className="flex flex-col md:flex-row gap-3">
            <Input
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              placeholder="https://seu-link-de-destino.com"
              className="flex-1"
            />
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Gerar Link
            </Button>
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground">Smart Link</p>
                <p className="font-mono text-sm mt-1">mentoark.link/exemplo</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => copy("mentoark.link/exemplo")}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>0 cliques</span>
              <span>•</span>
              <span>Criado agora</span>
            </div>
            <Button variant="outline" size="sm" className="mt-4 gap-2">
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir
            </Button>
          </Card>

          <Card className="p-6 flex flex-col items-center justify-center text-center">
            <div className="w-32 h-32 rounded-xl bg-muted flex items-center justify-center mb-3">
              <QrCode className="h-16 w-16 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">QR Code do link</p>
            <p className="text-xs text-muted-foreground">Selecione um link para gerar o QR.</p>
          </Card>
        </div>

        <Card className="p-12 text-center border-dashed">
          <p className="text-muted-foreground text-sm">
            Histórico de Smart Links e métricas de cliques aparecerão aqui.
          </p>
        </Card>
      </div>
    </CRMLayout>
  );
}
