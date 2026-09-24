// Classificação de leads (nicho, B2B/B2C) e score 0-100. Funções puras, sem I/O e sem IA:
// só regras e pesos configuráveis, e cada ponto do score vem com o motivo que o explica.
// Cobertas por tests/classificacao.test.ts.

export type TipoPublico = 'b2b' | 'b2c' | 'indefinido';

export interface NichoDef {
  tipo: 'b2b' | 'b2c';
  palavras: string[];
}

// Pesos do score. Positivo soma, negativo subtrai. Tudo editável por conta.
export interface PesosScore {
  valido: number;           // WhatsApp confirmado
  business: number;         // conta WhatsApp Business
  nome_real: number;        // tem nome de pessoa/empresa aproveitável
  nicho_alvo: number;       // nicho detectado está entre os nichos-alvo
  nicho_detectado: number;  // nicho detectado, mas fora dos alvos
  ddd_interesse: number;    // DDD entre os de interesse
  multiplas_listas: number; // aparece em 2+ listas/grupos de negócios
  fixo: number;             // telefone fixo
  sem_whatsapp: number;     // número validado como sem WhatsApp
  sem_foto: number;         // sem foto de perfil conhecida
  grupo_b2c: number;        // só aparece em grupos de consumidor final
  admin_grupo: number;      // é admin de grupo: costuma ser dono de comunidade ou negócio
}

export interface ConfigClassificacao {
  pesos: PesosScore;
  ddds_interesse: string[];
  nichos_alvo: string[];
  dicionario: Record<string, NichoDef>;
  grupo_b2c_palavras: string[];
}

export const PESOS_PADRAO: PesosScore = {
  valido: 25,
  business: 20,
  nome_real: 10,
  nicho_alvo: 15,
  nicho_detectado: 5,
  ddd_interesse: 10,
  multiplas_listas: 10,
  fixo: -40,
  sem_whatsapp: -50,
  sem_foto: -3,
  grupo_b2c: -10,
  admin_grupo: 15,
};

// Palavras já sem acento (a comparação também remove acento). As categorias do WhatsApp Business
// vêm em inglês, então os termos em inglês entram no mesmo dicionário.
export const DICIONARIO_PADRAO: Record<string, NichoDef> = {
  imobiliario: { tipo: 'b2b', palavras: ['imovel', 'imoveis', 'corretor', 'corretora', 'creci', 'imobiliaria', 'lancamento', 'lancamentos', 'apartamento', 'locacao', 'aluguel', 'incorporadora', 'loteamento', 'real estate'] },
  financeiro_credito: { tipo: 'b2b', palavras: ['corban', 'consignado', 'credito', 'emprestimo', 'inss', 'fgts', 'financiamento', 'refinanciamento', 'portabilidade', 'correspondente bancario', 'investimento', 'investimentos', 'investidor', 'cripto', 'trader', 'finance', 'financial', 'banking'] },
  consorcio: { tipo: 'b2b', palavras: ['consorcio', 'consorcios', 'carta de credito', 'contemplada', 'contemplado'] },
  seguros_saude: { tipo: 'b2b', palavras: ['seguro', 'seguros', 'plano de saude', 'planos de saude', 'saude suplementar', 'odontologico', 'susep', 'insurance'] },
  estetica_beleza: { tipo: 'b2b', palavras: ['estetica', 'esteticista', 'beleza', 'salao', 'cabeleireiro', 'cabeleireira', 'barbearia', 'manicure', 'harmonizacao', 'depilacao', 'sobrancelha', 'beauty', 'spa', 'cosmetics'] },
  marketing_trafego: { tipo: 'b2b', palavras: ['trafego', 'trafego pago', 'marketing', 'marketing digital', 'gestor de trafego', 'social media', 'agencia', 'copywriter', 'growth', 'advertising'] },
  contabilidade: { tipo: 'b2b', palavras: ['contabilidade', 'contador', 'contadora', 'contabil', 'escritorio contabil', 'bpo financeiro', 'accounting', 'accountant'] },
  veiculos: { tipo: 'b2b', palavras: ['veiculo', 'veiculos', 'carro', 'carros', 'automoveis', 'seminovos', 'concessionaria', 'motos', 'oficina', 'autopecas', 'despachante', 'automotive'] },
  alimentacao: { tipo: 'b2b', palavras: ['restaurante', 'lanchonete', 'pizzaria', 'hamburgueria', 'delivery', 'confeitaria', 'padaria', 'marmita', 'buffet', 'restaurant', 'restaurants', 'bakery'] },
  tecnologia: { tipo: 'b2b', palavras: ['software', 'sistema', 'sistemas', 'tecnologia', 'desenvolvedor', 'desenvolvimento', 'chatbot', 'automacao', 'crm', 'aplicativo', 'technology', 'it services'] },
  juridico: { tipo: 'b2b', palavras: ['advogado', 'advogada', 'advocacia', 'juridico', 'oab', 'legal services', 'lawyer'] },
  saude_clinicas: { tipo: 'b2b', palavras: ['clinica', 'medico', 'medica', 'dentista', 'odontologia', 'psicologo', 'psicologa', 'fisioterapia', 'nutricionista', 'consultorio', 'laboratorio', 'medical', 'dental'] },
  educacao: { tipo: 'b2b', palavras: ['escola', 'curso', 'cursos', 'faculdade', 'professor', 'professora', 'treinamento', 'mentoria', 'cursinho', 'education', 'tutoring'] },
  construcao_reformas: { tipo: 'b2b', palavras: ['construtora', 'construcao', 'reforma', 'reformas', 'engenharia', 'engenheiro', 'arquiteto', 'arquiteta', 'pedreiro', 'material de construcao', 'construction', 'home improvement'] },
  varejo_comercio: { tipo: 'b2b', palavras: ['loja', 'lojas', 'comercio', 'atacado', 'varejo', 'distribuidora', 'mercado', 'confeccao', 'boutique', 'retail', 'apparel', 'clothing'] },
};

// Nomes de grupo/lista típicos de consumidor final.
export const GRUPO_B2C_PADRAO: string[] = [
  'promocao', 'promocoes', 'oferta', 'ofertas', 'cupom', 'cupons', 'achadinhos', 'desapego', 'desapegos',
  'moradores', 'bairro', 'brecho', 'familia',
];

export const CONFIG_PADRAO: ConfigClassificacao = {
  pesos: PESOS_PADRAO,
  ddds_interesse: ['11', '12', '13', '14', '15', '16', '17', '18', '19'],
  nichos_alvo: ['imobiliario', 'financeiro_credito', 'consorcio', 'seguros_saude'],
  dicionario: DICIONARIO_PADRAO,
  grupo_b2c_palavras: GRUPO_B2C_PADRAO,
};

// ── Texto ────────────────────────────────────────────────────────────────────────────────
export function normalizarTexto(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Casa a palavra inteira (não dentro de outra): "corban" não casa em "corbano", "spa" não em "espaco".
function regexPalavra(palavra: string): RegExp {
  return new RegExp(`(?:^| )${escaparRegex(normalizarTexto(palavra))}(?: |$)`);
}

// ── Configuração (validação e mescla com o padrão) ──────────────────────────────────────
export class ConfigInvalida extends Error {}

export function mesclarConfig(parcial: unknown): ConfigClassificacao {
  const p: any = parcial && typeof parcial === 'object' ? parcial : {};
  const pesos: PesosScore = { ...PESOS_PADRAO };
  if (p.pesos !== undefined) {
    if (typeof p.pesos !== 'object' || p.pesos === null) throw new ConfigInvalida('pesos inválidos');
    for (const chave of Object.keys(PESOS_PADRAO) as (keyof PesosScore)[]) {
      if (p.pesos[chave] === undefined) continue;
      const n = Number(p.pesos[chave]);
      if (!Number.isFinite(n) || n < -100 || n > 100) throw new ConfigInvalida(`peso "${chave}" deve estar entre -100 e 100`);
      pesos[chave] = Math.trunc(n);
    }
  }

  let ddds = CONFIG_PADRAO.ddds_interesse;
  if (p.ddds_interesse !== undefined) {
    if (!Array.isArray(p.ddds_interesse)) throw new ConfigInvalida('ddds_interesse deve ser uma lista');
    ddds = Array.from(new Set(p.ddds_interesse.map((d: unknown) => String(d).replace(/\D/g, ''))));
    if (!ddds.every(d => /^\d{2}$/.test(d))) throw new ConfigInvalida('DDD deve ter 2 dígitos');
  }

  let dicionario = CONFIG_PADRAO.dicionario;
  if (p.dicionario !== undefined) {
    if (typeof p.dicionario !== 'object' || p.dicionario === null || Array.isArray(p.dicionario)) throw new ConfigInvalida('dicionário inválido');
    const novo: Record<string, NichoDef> = {};
    const nomes = Object.keys(p.dicionario);
    if (nomes.length > 60) throw new ConfigInvalida('máximo de 60 nichos');
    for (const nome of nomes) {
      if (!/^[a-z0-9_]{2,40}$/.test(nome)) throw new ConfigInvalida(`nome de nicho inválido: "${nome}" (use minúsculas, números e _)`);
      const def = p.dicionario[nome];
      const palavras = Array.isArray(def?.palavras)
        ? Array.from(new Set(def.palavras.map((w: unknown) => normalizarTexto(String(w))).filter((w: string) => w.length >= 2)))
        : [];
      if (!palavras.length) throw new ConfigInvalida(`nicho "${nome}" precisa de ao menos uma palavra`);
      if (palavras.length > 300) throw new ConfigInvalida(`nicho "${nome}" tem palavras demais (máx. 300)`);
      novo[nome] = { tipo: def?.tipo === 'b2c' ? 'b2c' : 'b2b', palavras: palavras as string[] };
    }
    dicionario = novo;
  }

  let nichosAlvo = CONFIG_PADRAO.nichos_alvo;
  if (p.nichos_alvo !== undefined) {
    if (!Array.isArray(p.nichos_alvo)) throw new ConfigInvalida('nichos_alvo deve ser uma lista');
    nichosAlvo = p.nichos_alvo.map(String);
  }
  nichosAlvo = nichosAlvo.filter(n => n in dicionario);

  let b2c = CONFIG_PADRAO.grupo_b2c_palavras;
  if (p.grupo_b2c_palavras !== undefined) {
    if (!Array.isArray(p.grupo_b2c_palavras)) throw new ConfigInvalida('grupo_b2c_palavras deve ser uma lista');
    b2c = Array.from(new Set(p.grupo_b2c_palavras.map((w: unknown) => normalizarTexto(String(w))).filter((w: string) => w.length >= 2))) as string[];
  }

  return { pesos, ddds_interesse: ddds, nichos_alvo: nichosAlvo, dicionario, grupo_b2c_palavras: b2c };
}

// ── Compilação (uma vez por execução, não por contato) ──────────────────────────────────
export interface ConfigCompilada {
  cfg: ConfigClassificacao;
  nichos: { nome: string; tipo: 'b2b' | 'b2c'; regexes: RegExp[] }[];
  b2c: RegExp[];
  ddds: Set<string>;
  alvos: Set<string>;
}

export function compilarConfig(cfg: ConfigClassificacao): ConfigCompilada {
  return {
    cfg,
    nichos: Object.entries(cfg.dicionario).map(([nome, def]) => ({
      nome, tipo: def.tipo, regexes: def.palavras.map(regexPalavra),
    })),
    b2c: cfg.grupo_b2c_palavras.map(regexPalavra),
    ddds: new Set(cfg.ddds_interesse),
    alvos: new Set(cfg.nichos_alvo),
  };
}

// ── Classificação e score ───────────────────────────────────────────────────────────────
export interface EntradaLead {
  nome?: string | null;
  pushName?: string | null;
  businessCategoria?: string | null;
  businessDescricao?: string | null;
  isBusiness?: boolean | null;
  tipoTelefone?: string | null;
  telefoneNormalizado?: string | null;
  whatsappStatus?: string | null;
  nomeConfiavel?: boolean | null;
  temFoto?: boolean;
  /** Papel no grupo de origem ("admin" quando o WhatsApp o lista como administrador). */
  papelGrupo?: string | null;
  /** Nomes das listas/grupos de origem do contato. */
  listas: string[];
}

export interface MotivoScore {
  regra: keyof PesosScore;
  pontos: number;
  detalhe?: string;
}

export interface ResultadoClassificacao {
  nicho: string | null;
  tipoPublico: TipoPublico;
  score: number;
  motivos: MotivoScore[];
  /** De onde veio o nicho: categoria | descricao | nome | grupo. */
  fontesNicho: string[];
}

// Peso de cada fonte na detecção do nicho. A categoria do WhatsApp Business é o sinal mais forte.
const PESO_FONTE = { categoria: 3, descricao: 2, nome: 2, grupo: 2 } as const;
const LIMIAR_NICHO = 2;

function nomeDoGrupo(lista: string): string {
  // "Importação Grupo Corretores SP 20/09/2026" -> "Corretores SP"
  return lista.replace(/^importa\S+\s+grupo\s+/i, '').replace(/\s+\d{2}\/\d{2}\/\d{4}\s*$/, '');
}

export function classificarLead(e: EntradaLead, cc: ConfigCompilada): ResultadoClassificacao {
  const { pesos } = cc.cfg;
  const motivos: MotivoScore[] = [];
  const somar = (regra: keyof PesosScore, detalhe?: string) => {
    const pontos = pesos[regra];
    if (pontos) motivos.push({ regra, pontos, detalhe });
  };

  const textos = {
    categoria: normalizarTexto(e.businessCategoria),
    descricao: normalizarTexto(e.businessDescricao),
    nome: normalizarTexto(`${e.nome ?? ''} ${e.pushName ?? ''}`),
    grupo: e.listas.map(l => normalizarTexto(nomeDoGrupo(l))),
  };

  // 1) Nicho: pontua por fonte (uma vez por nicho e fonte) e fica com o de maior pontuação.
  let melhor: { nome: string; tipo: 'b2b' | 'b2c'; pontos: number; fontes: string[] } | null = null;
  for (const n of cc.nichos) {
    let pontos = 0;
    const fontes: string[] = [];
    const casa = (t: string) => t !== '' && n.regexes.some(r => r.test(t));
    if (casa(textos.categoria)) { pontos += PESO_FONTE.categoria; fontes.push('categoria'); }
    if (casa(textos.descricao)) { pontos += PESO_FONTE.descricao; fontes.push('descricao'); }
    if (casa(textos.nome)) { pontos += PESO_FONTE.nome; fontes.push('nome'); }
    if (textos.grupo.some(casa)) { pontos += PESO_FONTE.grupo; fontes.push('grupo'); }
    if (pontos >= LIMIAR_NICHO && (!melhor || pontos > melhor.pontos)) melhor = { nome: n.nome, tipo: n.tipo, pontos, fontes };
  }

  // 2) Tipo de público.
  const listasB2c = e.listas.map(l => cc.b2c.some(r => r.test(normalizarTexto(nomeDoGrupo(l)))));
  const soGruposB2c = e.listas.length > 0 && listasB2c.every(Boolean);
  const sinalProprio = !!e.isBusiness || (melhor?.fontes.some(f => f !== 'grupo') ?? false);
  let tipoPublico: TipoPublico = 'indefinido';
  if (melhor && melhor.tipo === 'b2c') tipoPublico = 'b2c';
  else if (sinalProprio || (melhor && !soGruposB2c)) tipoPublico = 'b2b';
  else if (soGruposB2c) tipoPublico = 'b2c';

  // 3) Score.
  if (e.whatsappStatus === 'valido') somar('valido');
  if (e.whatsappStatus === 'sem_whatsapp' && e.tipoTelefone !== 'fixo') somar('sem_whatsapp');
  if (e.tipoTelefone === 'fixo') somar('fixo');
  if (e.isBusiness) somar('business');
  if (e.nomeConfiavel) somar('nome_real');
  if (melhor) somar(cc.alvos.has(melhor.nome) ? 'nicho_alvo' : 'nicho_detectado', melhor.nome);

  const tel = e.telefoneNormalizado ?? '';
  const ddd = tel.startsWith('55') && tel.length >= 12 ? tel.slice(2, 4) : '';
  if (ddd && cc.ddds.has(ddd)) somar('ddd_interesse', `DDD ${ddd}`);

  const listasNegocio = listasB2c.filter(b => !b).length;
  if (listasNegocio >= 2) somar('multiplas_listas', `${listasNegocio} listas`);
  if (e.temFoto === false) somar('sem_foto');
  if (soGruposB2c) somar('grupo_b2c');
  if (e.papelGrupo === 'admin') somar('admin_grupo');

  const bruto = motivos.reduce((s, m) => s + m.pontos, 0);
  return {
    nicho: melhor?.nome ?? null,
    tipoPublico,
    score: Math.max(0, Math.min(100, bruto)),
    motivos,
    fontesNicho: melhor?.fontes ?? [],
  };
}

// ── Nota da lista (A/B/C/D) ─────────────────────────────────────────────────────────────
export interface ResumoLista {
  total: number;
  /** Contatos com situação de WhatsApp já resolvida (não "pendente"). */
  verificados: number;
  validos: number;
  business: number;
  com_nome: number;
  score_medio: number | null;
}

// Só dá nota quando ao menos metade da lista já foi verificada: lista não higienizada mostra
// "sem nota", e não um D injusto só porque ninguém validou ainda.
export function notaDaLista(r: ResumoLista): 'A' | 'B' | 'C' | 'D' | null {
  if (r.total <= 0 || r.verificados / r.total < 0.5 || r.score_medio == null) return null;
  const pct = (n: number) => (n / r.total) * 100;
  const composto = 0.4 * r.score_medio + 0.3 * pct(r.validos) + 0.15 * pct(r.business) + 0.15 * pct(r.com_nome);
  if (composto >= 60) return 'A';
  if (composto >= 40) return 'B';
  if (composto >= 25) return 'C';
  return 'D';
}
