/**
 * maturadorIA.ts — Sprint 8 do maturador v5 (2026-10-19, modelo ChipFlow — ver
 * docs/maturador/SPRINTS_MATURADOR_V5.md): conversa do aquecimento escrita por IA em vez de só o
 * banco fixo de 24 temas (`maturadorDialogos.ts`), pra que dois chips nunca repitam o mesmo
 * diálogo — repetição de frase entre números é um dos sinais que o WhatsApp usa pra achar
 * fazenda de chips.
 *
 * Como funciona:
 *   - UMA chamada por sessão (3–7 falas alternadas) com modelo pequeno, saída em JSON — não uma
 *     chamada por mensagem. Custo medido: ~700 tokens de entrada + ~250 de saída por roteiro
 *     (≈ US$ 0,0003 no gpt-4o-mini).
 *   - Persona FIXA por chip (sorteio determinístico pelo id do agente): faixa de idade, cidade e
 *     jeito de escrever. O mesmo chip escreve sempre do mesmo jeito.
 *   - Assunto do dia a dia brasileiro com o dia da semana/horário de verdade no contexto. Nunca
 *     fala de empresa, produto, venda, link ou dado de cliente (regra no prompt + filtro no código).
 *   - Erros de digitação, abreviações e minúsculas são colocados NO CÓDIGO (`humanizar`), não pela
 *     IA — a IA escreve limpo e o código suja conforme a persona, de forma controlada.
 *   - Freio de custo: teto de roteiros por conta por dia (MATURADOR_IA_MAX_SESSOES_DIA_CONTA,
 *     padrão 30), respeita o freio global `AI_LIMITE_DIARIO_USD` (orcamentoDiarioExcedido) e
 *     registra o gasto em `ai_uso_diario` como qualquer outra IA do CRM.
 *   - Qualquer falha (sem chave, teto, timeout, JSON ruim) → volta pro banco fixo de temas. O
 *     maturador nunca para por causa da IA. MATURADOR_IA=off desliga de vez.
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { criarProvider, OpenAIProvider, AIProvider } from './index';
import { registrarUsoIA, estimarCustoUsd, orcamentoDiarioExcedido } from '../utils/aiCusto';

export type Roteiro = { assunto: string; linhas: string[] };

export const MIN_FALAS = 3;
// Sprint 13: o ChipFlow faz conversas de 3 a 13 falas (mais comum 5–6); aqui 3 a 10.
export const MAX_FALAS = 10;
const MAX_CARACTERES_FALA = 160;
const TIMEOUT_MS = 20_000;

// ── Persona por chip ─────────────────────────────────────────────────────────────────────────
export type Persona = {
  idade: string;
  cidade: string;
  estilo: 'caprichado' | 'normal' | 'apressado';
  risada: string;
  emoji: number; // chance de terminar a fala com emoji (0–1)
};

const IDADES = ['20 e poucos anos', 'uns 30 anos', '35 a 40 anos', '40 e poucos anos', 'uns 50 anos'];
const CIDADES = ['São Paulo', 'Campinas', 'Santo André', 'Guarulhos', 'Belo Horizonte', 'Curitiba', 'Rio de Janeiro',
  'Sorocaba', 'Ribeirão Preto', 'Osasco', 'Santos', 'São José dos Campos'];
const ESTILOS: Persona['estilo'][] = ['caprichado', 'normal', 'normal', 'apressado', 'apressado'];
const RISADAS = ['kkkk', 'kkkkk', 'hahaha', 'rsrs', 'kkk', 'hauahua'];
const EMOJIS = ['😂', '😅', '👍', '🙏', '😄', '🤣', '😬', '🙌'];

function hash(s: string): number {
  return [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17);
}

export function personaDoChip(agenteId: string): Persona {
  const h = hash(agenteId);
  return {
    idade: IDADES[h % IDADES.length],
    cidade: CIDADES[(h >>> 3) % CIDADES.length],
    estilo: ESTILOS[(h >>> 7) % ESTILOS.length],
    risada: RISADAS[(h >>> 11) % RISADAS.length],
    emoji: [0.05, 0.15, 0.3][(h >>> 13) % 3],
  };
}

// ── Erros de digitação (no código, não na IA) ───────────────────────────────────────────────
// `\b` do JS não entende acento ("você"), então a borda da palavra é por letra Unicode.
const palavra = (p: string) => new RegExp(`(?<!\\p{L})${p}(?!\\p{L})`, 'giu');
const ABREVIACOES: [RegExp, string][] = [
  [palavra('você'), 'vc'], [palavra('também'), 'tbm'], [palavra('porque'), 'pq'], [palavra('quando'), 'qnd'],
  [palavra('beleza'), 'blz'], [palavra('verdade'), 'vdd'], [palavra('hoje'), 'hj'], [palavra('qualquer'), 'qlqr'],
  [palavra('mesmo'), 'msm'], [palavra('não'), 'n'], [palavra('para'), 'pra'], [palavra('está'), 'tá'],
];
const SEM_ACENTO: Record<string, string> = { á: 'a', à: 'a', â: 'a', ã: 'a', é: 'e', ê: 'e', í: 'i', ó: 'o', ô: 'o', õ: 'o', ú: 'u', ç: 'c' };

function trocarLetras(palavra: string, rnd: () => number): string {
  if (palavra.length < 4) return palavra;
  const i = 1 + Math.floor(rnd() * (palavra.length - 2));
  return palavra.slice(0, i) + palavra[i + 1] + palavra[i] + palavra.slice(i + 2);
}

/** Suja a fala conforme a persona. `rnd` injetável pra teste. */
export function humanizar(texto: string, persona: Persona, rnd: () => number = Math.random): string {
  let t = texto.trim();
  const { estilo } = persona;
  const chance = estilo === 'apressado' ? 0.7 : estilo === 'normal' ? 0.35 : 0.08;

  if (rnd() < chance) for (const [re, ab] of ABREVIACOES) if (rnd() < 0.6) t = t.replace(re, ab);
  if (estilo !== 'caprichado' && rnd() < chance) t = t.replace(/[áàâãéêíóôõúç]/g, c => SEM_ACENTO[c] ?? c);
  if (estilo !== 'caprichado' && rnd() < chance) t = t.charAt(0).toLowerCase() + t.slice(1);
  if (estilo === 'apressado' && rnd() < 0.6) t = t.replace(/[.!]+$/, '');
  // Um erro de digitação de vez em quando (nunca mais de um por fala).
  if (rnd() < chance * 0.35) {
    const palavras = t.split(' ');
    const idx = Math.floor(rnd() * palavras.length);
    palavras[idx] = trocarLetras(palavras[idx], rnd);
    t = palavras.join(' ');
  }
  t = t.replace(/\b(k{3,}|(?:ha){2,}h?|(?:rs){2,})\b/gi, persona.risada);
  if (rnd() < persona.emoji && !/\p{Extended_Pictographic}$/u.test(t)) t = `${t} ${EMOJIS[Math.floor(rnd() * EMOJIS.length)]}`;
  return t.replace(/ {2,}/g, ' ').trim();
}

// ── Validação do roteiro ────────────────────────────────────────────────────────────────────
// Nada de negócio, link, número, e-mail ou dinheiro — o aquecimento não pode parecer prospecção.
const PROIBIDO = /(https?:\/\/|www\.|\.com\b|@\w+\.|\b\d{8,}\b|r\$|\bpix\b|\bpromo|\bdesconto|\bcompre|\bproduto|\bempresa|\bcliente|\bvenda|\boferta|\bwhatsapp business)/i;

export function validarRoteiro(bruto: string): Roteiro | null {
  let obj: any;
  try {
    const limpo = bruto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    obj = JSON.parse(limpo);
  } catch { return null; }
  const linhas: unknown = obj?.linhas;
  if (!Array.isArray(linhas)) return null;
  const ok = linhas
    .filter((l): l is string => typeof l === 'string')
    .map(l => l.replace(/\s+/g, ' ').trim().slice(0, MAX_CARACTERES_FALA))
    .filter(l => l.length > 0);
  if (ok.length < MIN_FALAS) return null;
  if (ok.some(l => PROIBIDO.test(l))) return null;
  return { assunto: String(obj?.assunto || '').slice(0, 60), linhas: ok.slice(0, MAX_FALAS) };
}

// ── Prompt ──────────────────────────────────────────────────────────────────────────────────
// Sprint 13 (v5, 27/10/2026): assuntos ESPECÍFICOS do dia a dia, como os observados nas conversas reais do
// ChipFlow ("pedágio caro", "goteira no teto", "sinusite") — assunto específico gera conversa mais variada
// que assunto amplo ("trânsito"). ~100 itens.
export const ASSUNTOS = [
  // casa
  'goteira no teto', 'chuveiro queimou', 'vizinho fazendo obra cedo', 'máquina de lavar fazendo barulho', 'geladeira vazia',
  'conta de luz veio alta', 'internet caindo toda hora', 'faxina do fim de semana', 'planta que morreu', 'barata na cozinha',
  'mudança de apartamento', 'condomínio aumentou', 'cachorro do vizinho latindo', 'controle remoto sumiu', 'louça acumulada',
  // trânsito e transporte
  'pedágio caro', 'metrô na hora do rush', 'ônibus atrasado', 'uber cancelou a corrida', 'gasolina subiu de novo',
  'multa de velocidade', 'achar vaga pra estacionar', 'pneu furado', 'viagem de ônibus demorada', 'rodízio de carro',
  'trânsito na marginal', 'bicicleta pro trabalho', 'mecânico careiro', 'carro fazendo barulho estranho',
  // comida
  'café sem açúcar', 'pedir pizza hoje', 'marmita da semana', 'churrasco de domingo', 'receita de bolo que deu errado',
  'pastel de feira', 'açaí com tudo', 'dieta que não dura', 'mercado caro', 'feijoada de sábado', 'coxinha da padaria',
  'restaurante novo do bairro', 'vontade de comer doce', 'café da manhã reforçado', 'lanche da madrugada',
  // trabalho e estudo
  'trabalhar com sono', 'home office', 'reunião que podia ser email', 'chefe mandando mensagem de noite', 'segunda-feira',
  'entrevista de emprego', 'prova da faculdade', 'dormir na aula', 'hora extra', 'férias chegando', 'salário que não dura',
  'colega de trabalho que fala demais', 'currículo atualizado', 'curso online parado na metade',
  // saúde
  'ir no dentista', 'sinusite', 'dor nas costas', 'academia depois de muito tempo', 'atestado médico', 'insônia',
  'gripe que não passa', 'fazer exame de sangue', 'beber mais água', 'caminhada de manhã', 'alergia de tempo seco',
  // tecnologia e redes
  'limpar a galeria do celular', 'algoritmo do instagram', 'viciou no reels', 'bateria do celular acabando rápido',
  'senha esquecida', 'grupo da família no whatsapp', 'figurinha nova', 'tela do celular rachada', 'notificação demais',
  // lazer e cultura
  'série nova', 'final do campeonato', 'jogo do time no domingo', 'show que vai ter', 'filme no cinema', 'BBB',
  'música que não sai da cabeça', 'livro parado na cabeceira', 'videogame até tarde', 'novela das nove',
  // tempo e passeios
  'chuva na praia', 'calor insuportável', 'frio de repente', 'saudade de viajar pra praia', 'feriado prolongado',
  'parque no domingo', 'acampamento', 'viagem de fim de ano', 'passeio com o cachorro',
  // vida
  'aniversário de amigo', 'presente de última hora', 'ghosting', 'fazer terapia', 'mãe ligando toda hora',
  'sobrinho que não para quieto', 'reencontrar amigo antigo', 'fim do mundo segundo o tiktok', 'horóscopo do dia',
  'promessa de começar segunda', 'organizar as finanças', 'perder as chaves',
];
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function montarPrompt(pA: Persona, pB: Persona, falas: number, assunto: string, agora: Date): string {
  const sp = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const periodo = sp.getHours() < 12 ? 'manhã' : sp.getHours() < 18 ? 'tarde' : 'noite';
  return `Escreva uma conversa curta de WhatsApp entre dois amigos brasileiros (A e B), em português do Brasil bem informal.
A: ${pA.idade}, mora em ${pA.cidade}. B: ${pB.idade}, mora em ${pB.cidade}.
Agora é ${DIAS[sp.getDay()]} de ${periodo}. Assunto: ${assunto}.
REGRAS:
- Exatamente ${falas} falas, alternando A, B, A, B... A começa.
- Cada fala com no máximo 15 palavras, como mensagem de celular de verdade. Pode ter gíria e "kkk".
- Conversa natural, com pergunta e resposta; a última fala fecha o papo (tipo "bora", "falou", "depois te conto").
- PROIBIDO: falar de empresa, trabalho específico, produto, venda, preço, dinheiro, link, telefone, e-mail, política ou religião.
- Não use nomes próprios de pessoas reais nem de marcas.
Responda SÓ com JSON, sem markdown: {"assunto": "<2 a 4 palavras>", "linhas": ["fala de A", "fala de B", ...]}`;
}

// ── Freio de custo ──────────────────────────────────────────────────────────────────────────
// Contador em memória por conta+dia; o banco (ai_uso_diario) guarda o gasto de verdade.
const sessoesHoje = new Map<string, number>();
function chaveDia(userId: string): string {
  return `${userId}:${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}`;
}
export function maxSessoesDia(): number {
  const n = Number(process.env.MATURADOR_IA_MAX_SESSOES_DIA_CONTA);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}
export function iaDesligada(): boolean {
  return /^(off|0|false|nao|não)$/i.test(String(process.env.MATURADOR_IA || '').trim());
}

/** Custo estimado (US$) de um roteiro no modelo padrão — ~700 tokens de entrada, ~250 de saída. */
export function estimativaCustoSessao(modelo = process.env.MATURADOR_IA_MODELO || 'gpt-4o-mini'): number {
  return estimarCustoUsd(modelo, 700, 250);
}

/** Só para testes. */
export function _zerarContadores(): void { sessoesHoje.clear(); }

// ── Chamada curta (usada pelo roteiro e pelo status) ─────────────────────────────────────────
export type ProviderIA = { provider: AIProvider; modelo: string; providerSlug: string };

/**
 * Uma chamada pequena à IA com os freios do CRM: respeita MATURADOR_IA=off e o teto global
 * `AI_LIMITE_DIARIO_USD`, usa sempre modelo pequeno, tem timeout e registra o gasto em
 * `ai_uso_diario`. Devolve o texto ou null (sem chave, teto, erro).
 */
export async function completarCurto(pool: Pool, userId: string, prompt: string, sistema: string, maxTokens: number,
  override?: ProviderIA | null): Promise<string | null> {
  if (iaDesligada()) return null;
  if ((await orcamentoDiarioExcedido(pool)).excedido) return null;
  let info = override ?? null;
  if (!info) {
    const p = await criarProvider(pool, userId, null).catch(() => null);
    const envKey = process.env.OPENAI_API_KEY || '';
    // Conta com provider próprio: usa o dela. Senão, chave do servidor.
    if (p) info = { provider: p.provider, modelo: p.modelo, providerSlug: p.providerSlug };
    else if (envKey) info = { provider: new OpenAIProvider(envKey), modelo: '', providerSlug: 'openai' };
    else return null;
  }
  // Modelo pequeno sempre: o aquecimento não precisa do modelo caro da conta.
  const modelo = process.env.MATURADOR_IA_MODELO || (info.providerSlug === 'claude' ? 'claude-3-5-haiku-latest' : 'gpt-4o-mini');
  const resp = await Promise.race([
    info.provider.complete([{ role: 'user', content: prompt }], sistema, [], { model: modelo, temperature: 1, maxTokens }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
  const tokensIn = resp.inputTokens ?? 0;
  const tokensOut = resp.outputTokens ?? 0;
  await registrarUsoIA(pool, {
    userId, providerSlug: info.providerSlug, modelo,
    tokensEntrada: tokensIn, tokensSaida: tokensOut, custoUsd: estimarCustoUsd(modelo, tokensIn, tokensOut),
  });
  return resp.text || null;
}

/** Texto curto não pode falar de negócio, link, número, dinheiro (mesma regra do roteiro). */
export function textoPermitido(texto: string): boolean {
  return !PROIBIDO.test(texto);
}

// ── Geração ─────────────────────────────────────────────────────────────────────────────────
export async function gerarRoteiro(pool: Pool, params: {
  userId: string;
  agenteQueAbre: string;
  agenteQueResponde: string;
  assuntoAnterior?: string | null;
  providerOverride?: ProviderIA | null;
}): Promise<Roteiro | null> {
  if (iaDesligada()) return null;
  const chave = chaveDia(params.userId);
  const usadas = sessoesHoje.get(chave) ?? 0;
  if (usadas >= maxSessoesDia()) return null;

  try {
    sessoesHoje.set(chave, usadas + 1);
    const falas = MIN_FALAS + Math.floor(Math.random() * (MAX_FALAS - MIN_FALAS + 1));
    let assunto = ASSUNTOS[Math.floor(Math.random() * ASSUNTOS.length)];
    if (params.assuntoAnterior && assunto === params.assuntoAnterior) assunto = ASSUNTOS[(ASSUNTOS.indexOf(assunto) + 1) % ASSUNTOS.length];
    const prompt = montarPrompt(personaDoChip(params.agenteQueAbre), personaDoChip(params.agenteQueResponde), falas, assunto, new Date());

    const texto = await completarCurto(pool, params.userId, prompt,
      'Você escreve diálogos curtos e realistas de WhatsApp. Responde só JSON.', 700, params.providerOverride);
    if (texto === null) return null;

    const roteiro = validarRoteiro(texto);
    if (!roteiro) { log.warn('MATURADOR_IA', 'Roteiro inválido — usando banco de temas', { userId: params.userId }); return null; }
    return { assunto: roteiro.assunto || assunto, linhas: roteiro.linhas };
  } catch (err: any) {
    log.warn('MATURADOR_IA', 'Falha ao gerar roteiro — usando banco de temas', { err: err?.message });
    return null;
  }
}
