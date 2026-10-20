/**
 * maturadorStatus.ts — Sprint 10 do maturador v5 (2026-10-20, modelo ChipFlow — ver
 * docs/maturador/SPRINTS_MATURADOR_V5.md): status rico do chip.
 *
 *   - Por chip, até 20 imagens e 20 textos (500 caracteres) cadastrados pelo usuário
 *     (`maturador_status_itens`), publicados em sequência: sai sempre o que está há mais tempo sem
 *     publicar (nunca publicado primeiro, depois na ordem de cadastro) — a fila gira sozinha.
 *   - Sem nada cadastrado: a IA escreve uma frase do dia (com os mesmos freios de custo do
 *     roteiro) e, metade das vezes, vai com uma foto do banco (`maturadorMidia.prepararFoto`).
 *     Sem IA: frase do banco fixo `STATUS_TEXTOS`.
 *   - Imagem cadastrada é re-codificada a cada publicação (arquivo/hash diferente).
 *   - Quem vê: só os parceiros do maturador (padrão — nunca chega a cliente) ou todos os contatos
 *     (`maturador_controles.status_visibilidade`).
 *   - Horário (14–20 h, 1 por dia) e fase continuam no motor (`maturadorProcessor`).
 */
import { Pool } from 'pg';
import path from 'path';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import sharp from 'sharp';
import { log } from '../logger';
import { completarCurto, textoPermitido } from './maturadorIA';
import { prepararFoto } from './maturadorMidia';
import { STATUS_TEXTOS, STATUS_CORES } from './maturadorDialogos';
import type { StatusVisibilidade } from './maturadorControles';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.mentoark.com.br';
// Imagens cadastradas ficam numa pasta própria — a limpeza de 12 h só varre `variantes/`.
export const PASTA_STATUS = 'maturador_status';

export const MAX_ITENS_POR_TIPO = 20;
export const MAX_CARACTERES_TEXTO = 500;
export const MAX_CARACTERES_LEGENDA = 200;

export type ItemStatus = {
  id: string; tipo: 'imagem' | 'texto'; conteudo: string; legenda: string | null;
  ordem: number; publicado_em: string | null; vezes: number;
};

/** Próximo da fila: nunca publicado primeiro, depois o que publicou há mais tempo. */
export async function proximoItem(pool: Pool, agenteId: string): Promise<ItemStatus | null> {
  const r = await pool.query(
    `SELECT * FROM maturador_status_itens WHERE agente_id = $1
     ORDER BY publicado_em ASC NULLS FIRST, ordem ASC, created_at ASC LIMIT 1`, [agenteId]
  ).catch(() => ({ rows: [] as any[] }));
  return r.rows[0] ?? null;
}

export async function marcarPublicado(pool: Pool, itemId: string): Promise<void> {
  await pool.query(`UPDATE maturador_status_itens SET publicado_em = NOW(), vezes = vezes + 1 WHERE id = $1`, [itemId]).catch(() => {});
}

export function urlImagemStatus(conteudo: string): string {
  return `${API_BASE_URL}/uploads/${conteudo}`;
}

/** Re-codifica a imagem cadastrada para `variantes/` (hash novo a cada publicação). */
async function variarImagemCadastrada(conteudo: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(path.join(UPLOADS_DIR, conteudo));
    const out = await sharp(buf).rotate()
      .modulate({ brightness: 0.98 + Math.random() * 0.04 })
      .jpeg({ quality: 80 + Math.floor(Math.random() * 14) }).toBuffer();
    const nome = `mat_${crypto.randomUUID()}.jpg`;
    await fs.mkdir(path.join(UPLOADS_DIR, 'variantes'), { recursive: true });
    await fs.writeFile(path.join(UPLOADS_DIR, 'variantes', nome), out);
    return `${API_BASE_URL}/uploads/variantes/${nome}`;
  } catch (err: any) {
    log.warn('MATURADOR_STATUS', 'Falha ao variar imagem cadastrada', { err: err?.message });
    return null;
  }
}

/** Frase de status escrita pela IA (curta, pessoa comum, sem negócio). null = usa o banco fixo. */
export async function fraseDoDiaIA(pool: Pool, userId: string, deps: { completar?: typeof completarCurto } = {}): Promise<string | null> {
  try {
    const dia = new Date().toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
    const texto = await (deps.completar ?? completarCurto)(pool, userId,
      `Escreva UM status de WhatsApp de uma pessoa comum brasileira numa ${dia} à tarde. Pode ser frase leve, ` +
      `reflexão curta, humor do dia a dia ou algo sobre o fim de semana. Máximo 120 caracteres, pode ter 1 emoji. ` +
      `PROIBIDO: empresa, produto, venda, preço, link, telefone, política, religião. Responda só o texto do status, sem aspas.`,
      'Você escreve status curtos e naturais de WhatsApp.', 80);
    if (!texto) return null;
    const limpo = texto.replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (limpo.length < 5 || !textoPermitido(limpo)) return null;
    return limpo;
  } catch (err: any) {
    log.warn('MATURADOR_STATUS', 'IA não escreveu o status — usando banco fixo', { err: err?.message });
    return null;
  }
}

export type StatusMontado = {
  payload: Record<string, any>;   // corpo do sendStatus sem os destinatários
  itemId: string | null;          // item cadastrado que saiu (para marcar como publicado)
  descricao: string;              // o que fica registrado em maturador_mensagens
};

export async function montarStatus(pool: Pool, p: { userId: string; agenteId: string },
  deps: { frase?: typeof fraseDoDiaIA; foto?: typeof prepararFoto; variar?: typeof variarImagemCadastrada } = {}): Promise<StatusMontado> {
  const cor = () => STATUS_CORES[Math.floor(Math.random() * STATUS_CORES.length)];
  const item = await proximoItem(pool, p.agenteId);
  if (item?.tipo === 'texto') {
    return { payload: { type: 'text', content: item.conteudo, backgroundColor: cor(), font: 1 + Math.floor(Math.random() * 3) }, itemId: item.id, descricao: item.conteudo };
  }
  if (item?.tipo === 'imagem') {
    const url = await (deps.variar ?? variarImagemCadastrada)(item.conteudo);
    if (url) {
      return { payload: { type: 'image', content: url, caption: item.legenda || '' }, itemId: item.id, descricao: `[imagem] ${item.legenda || ''}`.trim() };
    }
  }
  // Nada cadastrado (ou a imagem cadastrada falhou): IA escreve a frase; metade das vezes com foto.
  const frase = (await (deps.frase ?? fraseDoDiaIA)(pool, p.userId)) ?? STATUS_TEXTOS[Math.floor(Math.random() * STATUS_TEXTOS.length)];
  if (Math.random() < 0.5) {
    const f = await (deps.foto ?? prepararFoto)();
    if (f) return { payload: { type: 'image', content: f.url, caption: frase }, itemId: null, descricao: `[foto] ${frase}` };
  }
  return { payload: { type: 'text', content: frase, backgroundColor: cor(), font: 1 + Math.floor(Math.random() * 3) }, itemId: null, descricao: frase };
}

/**
 * Destinatários do status. "parceiros": todos os números com quem o chip conversa no maturador
 * (e o parceiro atual, garantido). "todos": todos os contatos do número.
 */
export async function destinatariosStatus(pool: Pool, agenteId: string, visibilidade: StatusVisibilidade, numeroParceiro: string):
  Promise<{ allContacts: boolean; statusJidList?: string[] }> {
  if (visibilidade === 'todos') return { allContacts: true };
  const numeros = new Set<string>([String(numeroParceiro).replace(/\D/g, '')]);
  const r = await pool.query(
    `SELECT CASE WHEN mp.agente_a_id = $1 THEN COALESCE(mp.numero_b, b.numero_conectado) ELSE COALESCE(mp.numero_a, a.numero_conectado) END AS outro
     FROM maturador_pares mp
     JOIN agentes a ON a.id = mp.agente_a_id
     JOIN agentes b ON b.id = mp.agente_b_id
     WHERE mp.ativo AND mp.banido_em IS NULL AND $1 IN (mp.agente_a_id, mp.agente_b_id)`, [agenteId]
  ).catch(() => ({ rows: [] as any[] }));
  for (const x of r.rows) {
    const d = String(x.outro || '').replace(/\D/g, '');
    if (d.length >= 10) numeros.add(d);
  }
  return { allContacts: false, statusJidList: [...numeros].filter(n => n.length >= 10).map(n => `${n}@s.whatsapp.net`) };
}

// ── Cadastro (rotas) ────────────────────────────────────────────────────────────────────────
export async function contarItens(pool: Pool, agenteId: string): Promise<{ imagem: number; texto: number }> {
  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE tipo = 'imagem')::int AS imagem, COUNT(*) FILTER (WHERE tipo = 'texto')::int AS texto
     FROM maturador_status_itens WHERE agente_id = $1`, [agenteId]);
  return r.rows[0];
}

async function proximaOrdem(pool: Pool, agenteId: string): Promise<number> {
  const r = await pool.query(`SELECT COALESCE(MAX(ordem), 0) + 1 AS o FROM maturador_status_itens WHERE agente_id = $1`, [agenteId]);
  return r.rows[0].o;
}

export async function adicionarTexto(pool: Pool, userId: string, agenteId: string, texto: string): Promise<{ erro?: string; item?: ItemStatus }> {
  const t = String(texto || '').trim();
  if (!t) return { erro: 'Escreva o texto do status' };
  if (t.length > MAX_CARACTERES_TEXTO) return { erro: `Máximo de ${MAX_CARACTERES_TEXTO} caracteres` };
  if ((await contarItens(pool, agenteId)).texto >= MAX_ITENS_POR_TIPO) return { erro: `Máximo de ${MAX_ITENS_POR_TIPO} textos por número` };
  const r = await pool.query(
    `INSERT INTO maturador_status_itens (user_id, agente_id, tipo, conteudo, ordem) VALUES ($1, $2, 'texto', $3, $4) RETURNING *`,
    [userId, agenteId, t, await proximaOrdem(pool, agenteId)]);
  return { item: r.rows[0] };
}

/** Recebe a imagem em data URL (base64), normaliza (até 1600 px, JPEG) e guarda. */
export async function adicionarImagem(pool: Pool, userId: string, agenteId: string, dataUrl: string, legenda?: string | null):
  Promise<{ erro?: string; item?: ItemStatus }> {
  const m = /^data:image\/(png|jpe?g|webp|heic|heif);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return { erro: 'Envie uma imagem (JPG, PNG ou WEBP)' };
  const leg = String(legenda || '').trim();
  if (leg.length > MAX_CARACTERES_LEGENDA) return { erro: `Legenda com no máximo ${MAX_CARACTERES_LEGENDA} caracteres` };
  if ((await contarItens(pool, agenteId)).imagem >= MAX_ITENS_POR_TIPO) return { erro: `Máximo de ${MAX_ITENS_POR_TIPO} imagens por número` };
  let jpg: Buffer;
  try {
    jpg = await sharp(Buffer.from(m[2], 'base64')).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  } catch {
    return { erro: 'Não consegui ler essa imagem' };
  }
  const conteudo = `${PASTA_STATUS}/${crypto.randomUUID()}.jpg`;
  await fs.mkdir(path.join(UPLOADS_DIR, PASTA_STATUS), { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, conteudo), jpg);
  const r = await pool.query(
    `INSERT INTO maturador_status_itens (user_id, agente_id, tipo, conteudo, legenda, ordem) VALUES ($1, $2, 'imagem', $3, $4, $5) RETURNING *`,
    [userId, agenteId, conteudo, leg || null, await proximaOrdem(pool, agenteId)]);
  return { item: r.rows[0] };
}

export async function removerItem(pool: Pool, userId: string, itemId: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM maturador_status_itens WHERE id = $1 AND user_id = $2 RETURNING tipo, conteudo`, [itemId, userId]);
  if (!r.rowCount) return false;
  const x = r.rows[0];
  if (x.tipo === 'imagem' && String(x.conteudo).startsWith(`${PASTA_STATUS}/`)) {
    await fs.unlink(path.join(UPLOADS_DIR, x.conteudo)).catch(() => {});
  }
  return true;
}
