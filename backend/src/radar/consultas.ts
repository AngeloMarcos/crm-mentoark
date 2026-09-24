/** Geração de consultas de busca a partir de nicho + região. Pura e determinística. */
export interface NichoBusca {
  nome: string;
  termos_busca: string[];
  regioes: string[];
}

export interface OpcoesConsultas {
  incluirTelegram?: boolean;
  /** Teto de consultas devolvidas (o teto de custo real é aplicado de novo na execução). */
  max?: number;
}

const aspas = (s: string) => `"${s.replace(/"/g, '').trim()}"`;

export function gerarConsultas(nicho: NichoBusca, opts: OpcoesConsultas = {}): string[] {
  const termos = nicho.termos_busca.map(t => t.trim()).filter(Boolean);
  const regioes = nicho.regioes.map(r => r.trim()).filter(Boolean);
  const out: string[] = [];
  const add = (q: string) => { if (!out.includes(q)) out.push(q); };

  // Sem região primeiro (mais amplo), depois cada região: quem tem teto baixo pega o essencial.
  for (const t of termos) add(`${aspas('chat.whatsapp.com')} ${t}`);
  for (const t of termos) for (const r of regioes) add(`${aspas('chat.whatsapp.com')} ${t} ${aspas(r)}`);
  if (opts.incluirTelegram) for (const t of termos) add(`${aspas('t.me')} ${t}`);

  return typeof opts.max === 'number' ? out.slice(0, Math.max(0, opts.max)) : out;
}
