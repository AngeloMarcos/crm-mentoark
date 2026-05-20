export type Plataforma = "facebook" | "instagram" | "ambos";
export type Objetivo = "leads" | "mensagens_whatsapp" | "trafego" | "conversoes" | "alcance" | "engajamento";
export type Segmento = "imoveis" | "seguros" | "educacao" | "saude" | "varejo" | "servicos" | "financeiro" | "automotivo";
export type FormatoAnuncio = "imagem" | "video" | "carrossel" | "stories" | "reels";

export interface ProjecaoInputs {
  plataforma: Plataforma;
  segmento: Segmento;
  objetivo: Objetivo;
  formato: FormatoAnuncio;
  orcamentoDiario: number;
  duracaoDias: number;
  publicoEstimado: number;
  cidade?: string;
  idadeMin: number;
  idadeMax: number;
}

export interface ProjecaoResultado {
  orcamentoTotal: number;
  alcanceTotal: number;
  impressoesTotal: number;
  cliquesTotal: number;
  ctr: number;
  cpc: number;
  leadsTotal: number;
  cpl: number;
  cplBenchmark: number;
  viabilidade: "excelente" | "boa" | "moderada" | "baixa";
  leadsPorSemana: number[];
  distribuicaoPlataforma: { facebook: number; instagram: number } | null;
  sugestoes: string[];
  fonte: "api" | "local";
}
