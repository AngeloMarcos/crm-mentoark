/**
 * integracoesIA.ts — Integrações de IA no modelo do Cubo (2026-10-29, ver
 * diagnosticos/engenharia_reversa_suite/RELATORIO_INTEGRACOES_E_DESCARTE.md): a integração guarda
 * só a chave; os modelos vêm AO VIVO da própria chave e o agente escolhe integração + modelo.
 * Armazenamento continua em `ai_providers` (slug = tipo).
 */

export type TipoIA = 'openai' | 'claude' | 'openrouter' | 'gemini';

export interface TipoIAInfo {
  tipo: TipoIA;
  rotulo: string;
  descricao: string;
  /** Endpoint compatível com a API da OpenAI (NULL = API nativa do provedor). */
  baseUrl: string | null;
  modeloSugerido: string;
  dicaChave: string;
  linkChave: string;
}

export const TIPOS_IA: TipoIAInfo[] = [
  {
    tipo: 'openai', rotulo: 'OpenAI (ChatGPT)', descricao: 'Modelos GPT. Também usada para transcrever áudio (Whisper) e ler imagens.',
    baseUrl: null, modeloSugerido: 'gpt-4o-mini', dicaChave: 'sk-...', linkChave: 'https://platform.openai.com/api-keys',
  },
  {
    tipo: 'claude', rotulo: 'Anthropic (Claude)', descricao: 'Modelos Claude.',
    baseUrl: null, modeloSugerido: 'claude-haiku-4-5-20251001', dicaChave: 'sk-ant-...', linkChave: 'https://console.anthropic.com/settings/keys',
  },
  {
    tipo: 'gemini', rotulo: 'Google AI (Gemini)', descricao: 'Modelos Gemini.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', modeloSugerido: 'gemini-2.5-flash',
    dicaChave: 'AIza...', linkChave: 'https://aistudio.google.com/apikey',
  },
  {
    tipo: 'openrouter', rotulo: 'OpenRouter', descricao: 'Uma chave para centenas de modelos de vários provedores.',
    baseUrl: 'https://openrouter.ai/api/v1', modeloSugerido: 'openai/gpt-4o-mini', dicaChave: 'sk-or-...', linkChave: 'https://openrouter.ai/keys',
  },
];

export const ehTipoIA = (t: string): t is TipoIA => TIPOS_IA.some(x => x.tipo === t);
export const infoTipoIA = (t: string) => TIPOS_IA.find(x => x.tipo === t) ?? null;
/** URL base efetiva: a gravada na integração ou a padrão do tipo. */
export const baseUrlDoTipo = (tipo: string, gravada?: string | null) => (gravada && gravada.trim()) || infoTipoIA(tipo)?.baseUrl || null;

export interface ModeloIA { id: string; rotulo: string; ferramentas: boolean | null }

/** Só modelos de conversa (a lista da OpenAI traz embeddings, áudio, imagem, moderação...). */
export function ehModeloDeChat(tipo: TipoIA, id: string): boolean {
  if (tipo === 'openai') {
    if (!/^(gpt-|o\d|chatgpt-4o)/i.test(id)) return false;
    return !/(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct|codex)/i.test(id);
  }
  if (tipo === 'gemini') return /gemini/i.test(id) && !/(embedding|imagen|aqa|tts|image)/i.test(id);
  return true;
}

type FetchLike = typeof fetch;

async function chamar(f: FetchLike, url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await f(url, { headers, signal: controller.signal });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

function erroLegivel(status: number, json: any): string {
  const msg = json?.error?.message || json?.error?.status || json?.message;
  if (status === 401 || status === 403) return 'Chave recusada pelo provedor (inválida, revogada ou sem permissão).';
  if (status === 429) return 'Limite ou crédito esgotado no provedor.';
  return msg ? String(msg).slice(0, 300) : `Erro ${status} do provedor.`;
}

/**
 * Lista os modelos que a chave enxerga. Serve também de teste da chave: `ok:false` = chave
 * recusada ou provedor fora do ar, com motivo legível.
 */
export async function listarModelosIA(
  tipo: TipoIA, chave: string, baseUrlGravada?: string | null, f: FetchLike = fetch,
): Promise<{ ok: boolean; status: number; erro?: string; modelos: ModeloIA[] }> {
  try {
    let r: { ok: boolean; status: number; json: any };
    let modelos: ModeloIA[] = [];
    if (tipo === 'claude') {
      r = await chamar(f, 'https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': chave, 'anthropic-version': '2023-06-01' });
      if (r.ok) modelos = (r.json?.data ?? []).map((m: any) => ({ id: m.id, rotulo: m.display_name || m.id, ferramentas: true }));
    } else if (tipo === 'openrouter') {
      r = await chamar(f, 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${chave}` });
      if (r.ok) {
        const lista = await chamar(f, 'https://openrouter.ai/api/v1/models', { Authorization: `Bearer ${chave}` });
        modelos = (lista.json?.data ?? []).map((m: any) => ({
          id: m.id, rotulo: m.name || m.id,
          ferramentas: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : null,
        }));
      }
    } else {
      const base = (baseUrlDoTipo(tipo, baseUrlGravada) || 'https://api.openai.com/v1').replace(/\/$/, '');
      r = await chamar(f, `${base}/models`, { Authorization: `Bearer ${chave}` });
      if (r.ok) {
        modelos = (r.json?.data ?? [])
          .map((m: any) => String(m.id).replace(/^models\//, ''))
          .filter((id: string) => ehModeloDeChat(tipo, id))
          .map((id: string) => ({ id, rotulo: id, ferramentas: null }));
      }
    }
    if (!r.ok) return { ok: false, status: r.status, erro: erroLegivel(r.status, r.json), modelos: [] };
    modelos.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, status: r.status, modelos };
  } catch (err: any) {
    return { ok: false, status: 0, erro: err?.name === 'AbortError' ? 'O provedor não respondeu em 10 s.' : (err?.message || 'Falha de rede'), modelos: [] };
  }
}
