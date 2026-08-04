import { Badge } from "@/components/ui/badge";
import { Send } from "lucide-react";

// [AUDITORIA] LÓGICA (Sprint Colunas de Status de Envio, 2026-07-31): componente visual
// compartilhado entre StepContacts (Disparos.tsx), WhatsAppInterface.tsx e ContatoDetalhe.tsx —
// mesma tag "Já enviado (campanha, data)" / "Nunca enviado" nos 3 lugares, uma única definição de
// cor/paleta. Deliberadamente uma paleta PRÓPRIA (âmbar), separada das cores livres de
// `tags`/`funil_estagios` (essas são definidas pelo usuário) — esta é sempre um aviso do sistema,
// não uma categorização de negócio.
export function TagStatusEnvio({
  ultimoDisparoEm,
  campanhaNome,
  className = "",
  // [AUDITORIA] LÓGICA: `compact` omite data/campanha do texto da tag — usado na tabela de
  // seleção de contatos (StepContacts), que já mostra "Data do último envio" e "Nome da última
  // campanha" como colunas próprias (pedido explícito da sprint); sem `compact` (default),
  // mostra tudo junto na mesma tag — usado em WhatsAppInterface.tsx/ContatoDetalhe.tsx, onde não
  // faz sentido ter 3 elementos separados num painel de contato único.
  compact = false,
}: {
  ultimoDisparoEm?: string | null;
  campanhaNome?: string | null;
  className?: string;
  compact?: boolean;
}) {
  if (!ultimoDisparoEm) {
    return (
      <Badge variant="outline" className={`text-[10px] text-muted-foreground ${className}`}>
        Nunca enviado
      </Badge>
    );
  }
  const data = new Date(ultimoDisparoEm).toLocaleDateString("pt-BR");
  return (
    <Badge
      variant="outline"
      className={`text-[10px] gap-1 border-amber-500/40 text-amber-700 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400 ${className}`}
      title={campanhaNome ? `Campanha: ${campanhaNome}` : undefined}
    >
      <Send className="h-2.5 w-2.5" />
      {compact ? "Já enviado" : `Já enviado${campanhaNome ? ` — ${campanhaNome}` : ""} (${data})`}
    </Badge>
  );
}
