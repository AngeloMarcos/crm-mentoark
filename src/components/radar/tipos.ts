import * as XLSX from "xlsx";

export interface StatusRadar {
  provider: string;
  busca_real: boolean;
  aviso: string | null;
  fila: "redis" | "inline";
  consultas_hoje: number;
  limite_consultas_dia: number;
  redis: { usadoMb: number; maxMb: number; alerta: boolean } | null;
  leitura_convites: { configurada: boolean; instancia: string | null };
}

export interface Nicho {
  id: string;
  nome: string;
  termos_busca: string[];
  palavras_positivas: string[];
  palavras_negativas: string[];
  regioes: string[];
  ativo: boolean;
}

export interface Motivo { regra: string; pontos: number; detalhe: string }

export interface Grupo {
  id: string;
  plataforma: "whatsapp" | "telegram";
  codigo_convite: string;
  url: string;
  nome: string | null;
  titulo_origem: string | null;
  descricao: string | null;
  nicho_id: string | null;
  nicho_nome: string | null;
  regiao: string | null;
  status: string;
  fonte: string;
  consulta: string | null;
  participantes: number | null;
  link_ativo: boolean | null;
  validado_em: string | null;
  erro_validacao: string | null;
  score: number | null;
  score_motivos: Motivo[] | null;
  created_at: string;
}

export interface Busca {
  id: string;
  nicho_nome: string | null;
  provider: string | null;
  consultas: string[];
  max_consultas: number;
  status: "queued" | "running" | "concluida" | "falhou";
  consultas_feitas: number;
  custo_usd: string | number;
  novos: number;
  existentes: number;
  links_vistos: number;
  interrompida_por: string | null;
  aviso: string | null;
  erro: string | null;
  created_at: string;
}

export type Pesos = Record<string, number>;

export const ROTULOS_REGRA: Record<string, string> = {
  palavras_positivas: "Palavras do nicho",
  palavras_negativas: "Palavras negativas",
  regiao: "Região",
  tamanho_ideal: "Tamanho ideal",
  tamanho_pequeno: "Grupo pequeno",
  tamanho_fora: "Tamanho fora da faixa",
  restrito_profissionais: "Restrito a profissionais",
};

export const ROTULOS_PESO: Record<string, { rotulo: string; ajuda: string }> = {
  positiva_nome: { rotulo: "Palavra do nicho no nome", ajuda: "Pontos por palavra positiva distinta achada no nome do grupo." },
  positiva_descricao: { rotulo: "Palavra do nicho na descrição", ajuda: "Pontos por palavra positiva achada só na descrição." },
  teto_positivas: { rotulo: "Teto das palavras positivas", ajuda: "Máximo de pontos que as palavras positivas somam." },
  negativa: { rotulo: "Palavra negativa (desconto)", ajuda: "Pontos descontados por palavra negativa (promoção, cupom, pix…)." },
  teto_negativas: { rotulo: "Teto do desconto", ajuda: "Máximo de pontos que as negativas podem descontar." },
  regiao: { rotulo: "Região do nicho", ajuda: "Pontos quando a região do nicho aparece no nome ou descrição." },
  tamanho_ideal: { rotulo: "Tamanho ideal", ajuda: "Pontos quando o nº de participantes está na faixa ideal." },
  tamanho_pequeno: { rotulo: "Grupo pequeno", ajuda: "Pontos para grupos de 20 até o mínimo da faixa ideal." },
  tamanho_min: { rotulo: "Mínimo da faixa ideal", ajuda: "Nº mínimo de participantes da faixa ideal." },
  tamanho_max: { rotulo: "Máximo da faixa ideal", ajuda: "Nº máximo de participantes da faixa ideal." },
  restrito_profissionais: { rotulo: "Restrito a profissionais", ajuda: "Pontos para frases como “somente corretores”." },
};

export function rotuloMotivo(m: Motivo): string {
  const nome = ROTULOS_REGRA[m.regra] ?? m.regra;
  return `${m.pontos > 0 ? "+" : ""}${m.pontos} ${nome}`;
}

export function statusLabel(s: string): string {
  return ({
    descoberto: "Descoberto", aprovado: "Aprovado", rejeitado: "Rejeitado", invalido: "Inválido",
    na_fila: "Na fila", entrou: "Entrou", extraido: "Extraído",
  } as Record<string, string>)[s] ?? s;
}

/** Converte CSV/TXT/XLSX em texto CSV. Em XLSX inclui o destino de células com hyperlink (o link fica fora do texto visível). */
export async function planilhaParaCsv(file: File): Promise<string> {
  if (!/\.(xlsx|xls)$/i.test(file.name)) return file.text();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const linhas: string[] = [];
  for (const nome of wb.SheetNames) {
    const ws = wb.Sheets[nome];
    if (!ws["!ref"]) continue;
    const r = XLSX.utils.decode_range(ws["!ref"]);
    for (let y = r.s.r; y <= r.e.r; y++) {
      const cols: string[] = [];
      for (let x = r.s.c; x <= r.e.c; x++) {
        const cel = ws[XLSX.utils.encode_cell({ r: y, c: x })];
        const partes = [cel?.w ?? (cel?.v != null ? String(cel.v) : ""), cel?.l?.Target ?? ""].filter(Boolean);
        cols.push(`"${partes.join(" ").replace(/"/g, '""')}"`);
      }
      linhas.push(cols.join(";"));
    }
  }
  return linhas.join("\n");
}
