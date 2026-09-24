/**
 * Score determinístico de grupo (0-100). Só regras e pesos editáveis — nenhuma chamada a IA/LLM.
 * Cada regra que bateu vira um "motivo" mostrado na tela.
 */
export interface DadosGrupo {
  nome: string | null;
  descricao: string | null;
  participantes: number | null;
  /** % dos participantes com número visível (o resto é LID, que não dá para disparar). null = nunca medido. */
  pctComTelefone?: number | null;
}

export interface CriteriosNicho {
  palavras_positivas: string[];
  palavras_negativas: string[];
  regioes: string[];
}

export interface PesosScore {
  positiva_nome: number;        // por palavra positiva distinta achada no NOME
  positiva_descricao: number;   // por palavra positiva distinta achada só na DESCRIÇÃO
  teto_positivas: number;
  negativa: number;             // por palavra negativa distinta (subtrai)
  teto_negativas: number;
  regiao: number;
  tamanho_ideal: number;        // participantes dentro de [tamanho_min, tamanho_max]
  tamanho_pequeno: number;      // 20..tamanho_min-1
  tamanho_min: number;
  tamanho_max: number;
  restrito_profissionais: number; // "somente corretores", "exclusivo para profissionais"...
  telefone_alto: number;        // % com telefone >= telefone_alto_min
  telefone_baixo: number;       // desconto quando % com telefone < telefone_baixo_max
  telefone_alto_min: number;
  telefone_baixo_max: number;
  auto_rejeitar_baixa_aderencia: number; // 1 = descarta sozinho grupo cujo nome não condiz com o nicho; 0 = só marca
}

export const PESOS_PADRAO: PesosScore = {
  positiva_nome: 12,
  positiva_descricao: 5,
  teto_positivas: 40,
  negativa: 20,
  teto_negativas: 60,
  regiao: 15,
  tamanho_ideal: 20,
  tamanho_pequeno: 5,
  tamanho_min: 50,
  tamanho_max: 1024,
  restrito_profissionais: 15,
  telefone_alto: 10,
  telefone_baixo: 15,
  telefone_alto_min: 60,
  telefone_baixo_max: 20,
  auto_rejeitar_baixa_aderencia: 1,
};

/** Palavras que indicam grupo de consumidor/promoção — ruins para captação B2B. */
export const NEGATIVAS_PADRAO = [
  'promoção', 'promocao', 'achadinhos', 'cupom', 'ofertas', 'sorteio', 'vagas', 'emprego',
  'ganhe dinheiro', 'apostas', 'bets', 'pix', 'figurinhas', 'amizade', 'moradores',
];

export const FRASES_RESTRITAS = [
  'somente corretores', 'apenas corretores', 'exclusivo para corretores', 'exclusivo corretores',
  'exclusivo para profissionais', 'somente profissionais', 'apenas profissionais', 'exclusivo para empresarios',
];

export interface Motivo { regra: string; pontos: number; detalhe: string }
export interface ResultadoScore { score: number; motivos: Motivo[] }

export function normalizar(t: string | null | undefined): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Casa a palavra/frase inteira (não pega "ia" dentro de "empresaria"). Ambos já normalizados. */
export function contemPalavra(textoNorm: string, palavraNorm: string): boolean {
  if (!palavraNorm) return false;
  return new RegExp(`(^|[^a-z0-9])${escapar(palavraNorm)}([^a-z0-9]|$)`).test(textoNorm);
}

/**
 * Casa por RAIZ para palavras longas: "imobiliária" acha "imobiliário", "corretores" acha "corretora".
 * Palavras curtas (< 6 letras) e frases continuam exatas — "ia", "bets", "pix" não podem virar pedaço de outra palavra.
 */
export function contemRaiz(textoNorm: string, palavraNorm: string): boolean {
  if (!palavraNorm) return false;
  if (palavraNorm.length < 6 || /\s/.test(palavraNorm)) return contemPalavra(textoNorm, palavraNorm);
  const raiz = palavraNorm.slice(0, Math.max(5, palavraNorm.length - 3));
  return textoNorm.split(/[^a-z0-9]+/).some(t => t.startsWith(raiz));
}

const unicas = (lista: string[]) => [...new Set(lista.map(normalizar).filter(Boolean))];

export function pontuarGrupo(
  grupo: DadosGrupo,
  nicho: CriteriosNicho | null,
  pesos: PesosScore = PESOS_PADRAO,
): ResultadoScore {
  const nome = normalizar(grupo.nome);
  const desc = normalizar(grupo.descricao);
  const tudo = `${nome} ${desc}`.trim();
  const motivos: Motivo[] = [];

  // Positivas: nome vale mais que descrição; conta cada palavra uma vez.
  if (nicho) {
    let pos = 0;
    const achadasPos: string[] = [];
    for (const p of unicas(nicho.palavras_positivas)) {
      if (contemRaiz(nome, p)) { pos += pesos.positiva_nome; achadasPos.push(`${p} (nome)`); }
      else if (contemRaiz(desc, p)) { pos += pesos.positiva_descricao; achadasPos.push(`${p} (descrição)`); }
    }
    if (pos > 0) {
      const pontos = Math.min(pos, pesos.teto_positivas);
      motivos.push({ regra: 'palavras_positivas', pontos, detalhe: achadasPos.join(', ') });
    }

    // Região
    const reg = unicas(nicho.regioes).find(r => contemPalavra(tudo, r));
    if (reg) motivos.push({ regra: 'regiao', pontos: pesos.regiao, detalhe: reg });
  }

  // Negativas: as do nicho somadas às padrão.
  const negativas = unicas([...NEGATIVAS_PADRAO, ...(nicho?.palavras_negativas ?? [])]);
  const achadasNeg = negativas.filter(n => contemPalavra(tudo, n));
  if (achadasNeg.length) {
    const pontos = -Math.min(achadasNeg.length * pesos.negativa, pesos.teto_negativas);
    motivos.push({ regra: 'palavras_negativas', pontos, detalhe: achadasNeg.join(', ') });
  }

  // Tamanho
  const n = grupo.participantes;
  if (typeof n === 'number') {
    if (n >= pesos.tamanho_min && n <= pesos.tamanho_max) {
      motivos.push({ regra: 'tamanho_ideal', pontos: pesos.tamanho_ideal, detalhe: `${n} participantes` });
    } else if (n >= 20 && n < pesos.tamanho_min) {
      motivos.push({ regra: 'tamanho_pequeno', pontos: pesos.tamanho_pequeno, detalhe: `${n} participantes` });
    } else {
      motivos.push({ regra: 'tamanho_fora', pontos: 0, detalhe: `${n} participantes (fora de ${pesos.tamanho_min}-${pesos.tamanho_max})` });
    }
  }

  // Telefone visível: grupo em que quase todo mundo é LID rende poucos leads disparáveis.
  const pct = grupo.pctComTelefone;
  if (typeof pct === 'number') {
    if (pct >= pesos.telefone_alto_min) motivos.push({ regra: 'telefone_alto', pontos: pesos.telefone_alto, detalhe: `${Math.round(pct)}% com telefone` });
    else if (pct < pesos.telefone_baixo_max) motivos.push({ regra: 'telefone_baixo', pontos: -pesos.telefone_baixo, detalhe: `só ${Math.round(pct)}% com telefone` });
  }

  // Restrição a profissionais
  const frase = FRASES_RESTRITAS.find(f => contemPalavra(tudo, f));
  if (frase) motivos.push({ regra: 'restrito_profissionais', pontos: pesos.restrito_profissionais, detalhe: frase });

  const soma = motivos.reduce((s, m) => s + m.pontos, 0);
  return { score: Math.max(0, Math.min(100, Math.round(soma))), motivos };
}

/** Mescla pesos vindos do banco/tela com os padrões, aceitando só números finitos e não negativos. */
export function mesclarPesos(parcial: unknown): PesosScore {
  const out: PesosScore = { ...PESOS_PADRAO };
  if (parcial && typeof parcial === 'object') {
    for (const k of Object.keys(PESOS_PADRAO) as (keyof PesosScore)[]) {
      const v = (parcial as any)[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10000) out[k] = v;
    }
  }
  return out;
}

// ── Aderência: o grupo encontrado condiz com o que procuramos? (só regras, sem IA) ───────────────────

export type NivelAderencia = 'alta' | 'media' | 'baixa' | 'sem_dados';
export interface ResultadoAderencia { nivel: NivelAderencia; motivo: string }

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'por', 'com', 'em', 'e', 'a', 'o', 'as', 'os', 'um', 'uma']);

/** Palavras de ≥3 letras dos termos de busca (ex.: "corretores de imóveis" → corretores, imoveis). */
function palavrasDosTermos(termos: string[]): string[] {
  const out = new Set<string>();
  for (const t of termos) for (const p of normalizar(t).split(/[^a-z0-9]+/)) if (p.length >= 3 && !STOP.has(p)) out.add(p);
  return [...out];
}

/**
 * Compara nome (e descrição, se houver) com as palavras positivas e os termos de busca do nicho.
 *  alta  = palavra do nicho no NOME e nenhuma negativa
 *  media = palavra só na descrição, ou no nome mas com negativa junto
 *  baixa = nenhuma palavra do nicho (ou negativa sem nenhuma positiva no nome)
 */
export function avaliarAderencia(
  grupo: { nome: string | null; descricao: string | null },
  nicho: (CriteriosNicho & { termos_busca?: string[] }) | null,
  termosExtras: string[] = [],
): ResultadoAderencia {
  const nome = normalizar(grupo.nome);
  const desc = normalizar(grupo.descricao);
  if (!nome) return { nivel: 'sem_dados', motivo: 'Nome do grupo ainda não lido' };
  if (!nicho && !termosExtras.length) return { nivel: 'sem_dados', motivo: 'Grupo sem nicho para comparar' };

  const alvo = unicas([...(nicho?.palavras_positivas ?? []), ...palavrasDosTermos([...(nicho?.termos_busca ?? []), ...termosExtras])]);
  const noNome = alvo.filter(p => contemRaiz(nome, p));
  const naDesc = alvo.filter(p => contemRaiz(desc, p));
  const neg = unicas([...NEGATIVAS_PADRAO, ...(nicho?.palavras_negativas ?? [])]).filter(n => contemPalavra(`${nome} ${desc}`, n));

  if (noNome.length && !neg.length) return { nivel: 'alta', motivo: `Nome contém: ${noNome.slice(0, 4).join(', ')}` };
  if (noNome.length) return { nivel: 'media', motivo: `Nome contém ${noNome[0]}, mas também: ${neg.slice(0, 3).join(', ')}` };
  if (naDesc.length && !neg.length) return { nivel: 'media', motivo: `Só a descrição menciona: ${naDesc.slice(0, 3).join(', ')}` };
  return { nivel: 'baixa', motivo: neg.length ? `Sem palavras do nicho e com: ${neg.slice(0, 3).join(', ')}` : 'Nenhuma palavra do nicho no nome' };
}
