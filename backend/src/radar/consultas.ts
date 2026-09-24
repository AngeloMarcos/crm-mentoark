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

// Achados em teste real (Serper, plano gratuito): "termo \"chat.whatsapp.com\"" rende ~5-8 links por chamada; `site:` só ~1;
// aspas NO INÍCIO da consulta e região entre aspas dão 400 / zero resultado. Por isso: termo primeiro, domínio entre aspas, região solta.
const DOMINIO = `"chat.whatsapp.com"`;

export function gerarConsultas(nicho: NichoBusca, opts: OpcoesConsultas = {}): string[] {
  const termos = nicho.termos_busca.map(t => t.trim()).filter(Boolean);
  const regioes = nicho.regioes.map(r => r.trim()).filter(Boolean);
  const out: string[] = [];
  const add = (q: string) => { if (!out.includes(q)) out.push(q); };

  // Sem região primeiro (mais amplo), depois cada região: quem tem teto baixo pega o essencial.
  for (const t of termos) add(`${t} ${DOMINIO}`);
  for (const t of termos) for (const r of regioes) add(`${t} ${DOMINIO} ${r.replace(/"/g, "")}`);
  if (opts.incluirTelegram) for (const t of termos) add(`${t} "t.me"`);

  return typeof opts.max === 'number' ? out.slice(0, Math.max(0, opts.max)) : out;
}
