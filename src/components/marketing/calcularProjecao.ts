import { ProjecaoInputs, ProjecaoResultado } from "./tipos";
import { CPL_BENCHMARK, CTR_OBJETIVO, CONV_RATE, FATOR_FORMATO, DIST_PLATAFORMA, FREQ_MEDIA } from "./benchmarks";

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export async function calcularProjecao(inputs: ProjecaoInputs, token: string): Promise<ProjecaoResultado> {
  // Tenta API do backend (que pode enriquecer com dados reais da conta Meta)
  try {
    const r = await fetch(`${BASE}/api/marketing/projecao`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(inputs),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      return { ...data, fonte: "api" };
    }
  } catch { /* fallback para cálculo local */ }

  // Cálculo local com benchmarks
  return calcularLocal(inputs);
}

function calcularLocal(inputs: ProjecaoInputs): ProjecaoResultado {
  const { plataforma, segmento, objetivo, formato, orcamentoDiario, duracaoDias, publicoEstimado } = inputs;
  const orcamentoTotal = orcamentoDiario * duracaoDias;

  const cplBenchmark = CPL_BENCHMARK[segmento][objetivo];
  const ctr = CTR_OBJETIVO[objetivo];
  const convRate = CONV_RATE[objetivo];
  const fatorFormato = FATOR_FORMATO[formato];
  const freq = FREQ_MEDIA[plataforma];

  // Alcance diário: limitado pelo tamanho do público e pelo orçamento disponível
  const alcancePorOrçamento = orcamentoDiario / (cplBenchmark * (convRate / 100) * (ctr / 100) || 0.01);
  const alcancePorPublico = publicoEstimado * 0.018;
  const alcanceDiario = Math.min(alcancePorOrçamento, alcancePorPublico);
  const alcanceTotal = Math.round(alcanceDiario * duracaoDias);

  // Impressões (frequência média)
  const impressoesTotal = Math.round(alcanceTotal * freq);

  // Cliques
  const cliquesTotal = Math.round(impressoesTotal * (ctr / 100) * fatorFormato);

  // Resultado (leads, mensagens, etc.)
  const leadsTotal = Math.round(cliquesTotal * (convRate / 100));

  // Custos reais
  const cpc = cliquesTotal > 0 ? orcamentoTotal / cliquesTotal : 0;
  const cpl = leadsTotal > 0 ? orcamentoTotal / leadsTotal : 0;

  // Viabilidade
  const ratio = cpl / cplBenchmark;
  const viabilidade = ratio <= 0.8 ? "excelente" : ratio <= 1.2 ? "boa" : ratio <= 1.6 ? "moderada" : "baixa";

  // Distribuição semanal com curva de aprendizado Meta
  const semanas = Math.ceil(duracaoDias / 7);
  const fatoresSemana = [0.65, 0.85, 1.0, 1.05, 1.08, 1.10, 1.10, 1.10, 1.10, 1.10, 1.10, 1.10, 1.10];
  const leadsPorSemana = Array.from({ length: semanas }, (_, i) => {
    const f = fatoresSemana[Math.min(i, fatoresSemana.length - 1)];
    return Math.round((leadsTotal / semanas) * f);
  });

  // Distribuição por plataforma
  const distribuicaoPlataforma = DIST_PLATAFORMA[plataforma]
    ? {
        facebook: Math.round(leadsTotal * DIST_PLATAFORMA[plataforma]!.facebook),
        instagram: Math.round(leadsTotal * DIST_PLATAFORMA[plataforma]!.instagram),
      }
    : null;

  // Sugestões automáticas
  const sugestoes: string[] = [];
  if (viabilidade === "baixa" || viabilidade === "moderada") {
    sugestoes.push("Aumente o orçamento diário para reduzir o CPL.");
    if (formato !== "video" && formato !== "reels") sugestoes.push("Experimente vídeo ou Reels — geram até 35% mais engajamento.");
  }
  if (plataforma === "facebook" && (segmento === "educacao" || segmento === "varejo")) {
    sugestoes.push("Instagram tende a performar melhor para este segmento — teste 'Ambas as plataformas'.");
  }
  if (inputs.idadeMin < 25 && segmento === "imoveis") {
    sugestoes.push("Para imóveis, público 30-55 anos tende a converter melhor.");
  }
  if (leadsTotal < 10) {
    sugestoes.push("Projeção de leads muito baixa. Considere aumentar o orçamento ou o período da campanha.");
  }

  return {
    orcamentoTotal, alcanceTotal, impressoesTotal, cliquesTotal,
    ctr, cpc, leadsTotal, cpl, cplBenchmark,
    viabilidade, leadsPorSemana, distribuicaoPlataforma, sugestoes,
    fonte: "local",
  };
}
