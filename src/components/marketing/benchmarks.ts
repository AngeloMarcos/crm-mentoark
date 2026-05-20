import { Segmento, Objetivo, Plataforma, FormatoAnuncio } from "./tipos";

// CPL médio Brasil 2024 por segmento + objetivo (R$)
export const CPL_BENCHMARK: Record<Segmento, Record<Objetivo, number>> = {
  imoveis:    { leads: 38, mensagens_whatsapp: 20, trafego: 1.4, conversoes: 60, alcance: 0.05, engajamento: 0.12 },
  seguros:    { leads: 30, mensagens_whatsapp: 16, trafego: 1.0, conversoes: 45, alcance: 0.04, engajamento: 0.10 },
  educacao:   { leads: 14, mensagens_whatsapp: 9,  trafego: 0.6, conversoes: 22, alcance: 0.03, engajamento: 0.08 },
  saude:      { leads: 22, mensagens_whatsapp: 13, trafego: 0.9, conversoes: 38, alcance: 0.04, engajamento: 0.09 },
  varejo:     { leads: 9,  mensagens_whatsapp: 6,  trafego: 0.5, conversoes: 18, alcance: 0.02, engajamento: 0.06 },
  servicos:   { leads: 20, mensagens_whatsapp: 11, trafego: 0.8, conversoes: 32, alcance: 0.04, engajamento: 0.09 },
  financeiro: { leads: 45, mensagens_whatsapp: 25, trafego: 1.8, conversoes: 70, alcance: 0.06, engajamento: 0.15 },
  automotivo: { leads: 50, mensagens_whatsapp: 28, trafego: 2.0, conversoes: 80, alcance: 0.07, engajamento: 0.18 },
};

// CTR médio por objetivo (%)
export const CTR_OBJETIVO: Record<Objetivo, number> = {
  leads: 1.8, mensagens_whatsapp: 2.5, trafego: 1.4, conversoes: 1.6, alcance: 0.5, engajamento: 2.2,
};

// Taxa de conversão clique → lead (%)
export const CONV_RATE: Record<Objetivo, number> = {
  leads: 24, mensagens_whatsapp: 38, trafego: 9, conversoes: 20, alcance: 3, engajamento: 5,
};

// Multiplicadores de formato
export const FATOR_FORMATO: Record<FormatoAnuncio, number> = {
  imagem: 1.0, video: 1.25, carrossel: 1.15, stories: 0.90, reels: 1.35,
};

// Distribuição Facebook vs Instagram quando "ambos"
export const DIST_PLATAFORMA: Record<Plataforma, { facebook: number; instagram: number } | null> = {
  facebook:  null,
  instagram: null,
  ambos:     { facebook: 0.60, instagram: 0.40 },
};

// Frequência de exibição (vezes que o mesmo usuário vê o anúncio por semana)
export const FREQ_MEDIA: Record<Plataforma, number> = {
  facebook: 2.4, instagram: 3.1, ambos: 2.7,
};
