import { useEffect, useState } from "react";
import { lerContadores, type Contadores, type FiltroAtendimento } from "@/lib/atendimento";

const FILTROS: { valor: FiltroAtendimento; rotulo: string }[] = [
  { valor: "aberto", rotulo: "Abertos" },
  { valor: "aguardando", rotulo: "Aguardando humano" },
  { valor: "resolvido", rotulo: "Resolvidos" },
  { valor: "meus", rotulo: "Meus" },
  { valor: "sem_atendente", rotulo: "Sem atendente" },
];

interface Props {
  valor: FiltroAtendimento | null;
  onChange: (v: FiltroAtendimento | null) => void;
  /** Muda depois de cada ação no atendimento, para recontar na hora. */
  versao: number;
}

/** Filtros da lista de conversas. Clicar no filtro ativo volta a mostrar tudo. */
export function FiltrosAtendimento({ valor, onChange, versao }: Props) {
  const [contadores, setContadores] = useState<Contadores | null>(null);

  useEffect(() => {
    const carregar = () => { if (document.visibilityState !== "hidden") lerContadores().then(setContadores).catch(() => {}); };
    carregar();
    const t = setInterval(carregar, 20_000);
    return () => clearInterval(t);
  }, [versao]);

  return (
    <div role="group" aria-label="Filtrar por atendimento" className="flex flex-wrap gap-1.5 px-3 sm:px-4 py-2 border-b">
      {FILTROS.map(f => {
        const ativo = valor === f.valor;
        const total = contadores?.[f.valor];
        return (
          <button
            key={f.valor}
            aria-pressed={ativo}
            onClick={() => onChange(ativo ? null : f.valor)}
            className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              ativo ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.rotulo}
            {total !== undefined && <span className="tabular-nums opacity-70">{total > 999 ? "999+" : total}</span>}
          </button>
        );
      })}
    </div>
  );
}
