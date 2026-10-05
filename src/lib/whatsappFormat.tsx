/**
 * whatsappFormat.tsx — helpers de exibição do chat WhatsApp (/whatsapp).
 *
 * - renderWhatsAppText: converte a marcação do WhatsApp (*negrito*, _itálico_, ~tachado~,
 *   ```mono```, `código`, "> citação", listas) e links em nós React — sem dangerouslySetInnerHTML,
 *   todo texto vira nó de texto do React (escapado automaticamente).
 * - stripWhatsAppMarkup: mesma marcação, só removida (preview da lista de conversas).
 * - formatWaPhone / resolveDisplayName: telefone e nome de exibição com fallbacks (IDs @lid e
 *   números estrangeiros não recebem máscara BR).
 * - normalizeMessageType: o sync de histórico grava o `messageType` cru da Evolution
 *   ("imageMessage", "reactionMessage", "protocolMessage"...), o webhook grava a forma curta
 *   ("image") — aqui as duas convergem, e tipos técnicos são marcados como ocultos.
 */
import type { ReactNode } from "react";

// ── Telefone / nome ──────────────────────────────────────────────────────────

/** Formata um telefone/ID do WhatsApp para exibição. Retorna null quando não é telefone
 * (ID interno @lid, que tem 14+ dígitos e não começa com 55). */
export function formatWaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.split("@")[0].replace(/\D/g, "");
  if (!d) return null;
  if (raw.includes("@lid")) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    return num.length === 9
      ? `+55 (${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`
      : `+55 (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  // JID do WhatsApp sempre traz o DDI — sem "55" na frente não é BR (ex: EUA 1+10 dígitos).
  // 14+ dígitos fora do padrão BR: na prática é um ID @lid (o sufixo @ já foi removido pelo
  // backend em session_id), não um telefone — E.164 tem no máximo 15 dígitos, mas números reais
  // com 14-15 são raríssimos comparados a IDs @lid.
  if (d.length >= 14) return null;
  if (d.length < 8) return null;
  return `+${d}`;
}

/** Máscara que o backend (GET /conversas) aplica quando o contato não tem nome — usada para
 * detectar "nome" que na verdade é só o telefone mascarado (e às vezes mascarado errado,
 * ex: "966(45) 55547-4650" num ID @lid). */
function backendPhoneMask(sessionId: string): string {
  return sessionId.replace(/^55/, "").replace(/(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
}

/** Nome "de verdade": pelo menos 2 letras/dígitos (descarta ".", "-", só emoji etc.). */
export function isValidName(name: string | null | undefined): boolean {
  if (!name) return false;
  const matches = name.trim().match(/[\p{L}\p{N}]/gu);
  return !!matches && matches.length >= 2;
}

/** Remove o "~" que o WhatsApp usa na frente de pushName e o sufixo " (grupo)" que o webhook
 * acrescenta ao push_name de mensagens de grupo. */
export function cleanPushName(name: string | null | undefined): string {
  return (name || "").replace(/^~\s*/, "").replace(/\s*\(grupo\)\s*$/i, "").trim();
}

export interface DisplayName {
  name: string;
  /** true quando o nome é um fallback (telefone formatado ou "Contato sem nome"), não um nome
   * de verdade — não deve ir pra {{nome}} de resposta rápida, por exemplo. */
  isFallback: boolean;
}

/** Nome de exibição: nome válido → pushName → telefone formatado → "Contato sem nome". */
export function resolveDisplayName(opts: {
  name?: string | null;
  pushName?: string | null;
  sessionId: string;
  isGroup?: boolean;
}): DisplayName {
  const { sessionId, isGroup } = opts;
  const name = (opts.name || "").trim();
  const looksLikePhone =
    !name || name === sessionId || name === backendPhoneMask(sessionId) || /^[\d\s()+-]+$/.test(name);
  if (isGroup) {
    return isValidName(name) ? { name, isFallback: false } : { name: "Grupo sem nome", isFallback: true };
  }
  if (!looksLikePhone && isValidName(name)) return { name, isFallback: false };
  const push = cleanPushName(opts.pushName);
  if (isValidName(push) && !/^[\d\s()+-]+$/.test(push)) return { name: push, isFallback: false };
  const phone = formatWaPhone(sessionId);
  return { name: phone || "Contato sem nome", isFallback: true };
}

// ── Cor determinística por participante ──────────────────────────────────────

const PARTICIPANT_COLORS = [
  "text-rose-600 dark:text-rose-400",
  "text-orange-600 dark:text-orange-400",
  "text-amber-700 dark:text-amber-400",
  "text-emerald-700 dark:text-emerald-400",
  "text-teal-700 dark:text-teal-400",
  "text-sky-700 dark:text-sky-400",
  "text-indigo-600 dark:text-indigo-400",
  "text-fuchsia-700 dark:text-fuchsia-400",
];

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash);
}

export function participantColorClass(key: string): string {
  return PARTICIPANT_COLORS[hashString(key) % PARTICIPANT_COLORS.length];
}

const INSTANCE_COLORS = [
  "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "bg-teal-500/10 text-teal-700 dark:text-teal-300",
];

export function instanceColorClass(key: string): string {
  return INSTANCE_COLORS[hashString(key) % INSTANCE_COLORS.length];
}

// ── Horário da lista ─────────────────────────────────────────────────────────

/** HH:mm se hoje, "Ontem", senão dd/MM. */
export function formatListTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameDay(d, now)) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ontem = new Date(now);
  ontem.setDate(now.getDate() - 1);
  if (sameDay(d, ontem)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// ── Tipos de mensagem ────────────────────────────────────────────────────────

export type CanonicalMessageType =
  | "text" | "image" | "video" | "audio" | "document" | "sticker"
  | "location" | "contact" | "reaction" | "poll" | "deleted" | "hidden" | "unknown";

const TYPE_MAP: Record<string, CanonicalMessageType> = {
  text: "text", conversation: "text", extendedTextMessage: "text",
  image: "image", imageMessage: "image",
  video: "video", videoMessage: "video", ptvMessage: "video",
  audio: "audio", ptt: "audio", audioMessage: "audio", pttMessage: "audio",
  document: "document", documentMessage: "document", documentWithCaptionMessage: "document",
  sticker: "sticker", stickerMessage: "sticker",
  location: "location", locationMessage: "location", liveLocationMessage: "location",
  contact: "contact", contactMessage: "contact", contactsArrayMessage: "contact",
  reaction: "reaction", reactionMessage: "reaction",
  poll: "poll", pollCreationMessage: "poll", pollCreationMessageV3: "poll",
  deleted: "deleted",
  // Técnicos — não são conteúdo visível pra ninguém.
  protocolMessage: "hidden",
  senderKeyDistributionMessage: "hidden",
  messageContextInfo: "hidden",
  pollUpdateMessage: "hidden",
  editedMessage: "hidden",
  keepInChatMessage: "hidden",
  encReactionMessage: "hidden",
};

export function normalizeMessageType(tipo: string | null | undefined): CanonicalMessageType {
  if (!tipo) return "text";
  return TYPE_MAP[tipo] ?? "unknown";
}

/** Rótulo curto de mídia, pro preview da lista/placeholder de bolha. */
export function mediaLabel(tipo: string | null | undefined): string | null {
  switch (normalizeMessageType(tipo)) {
    case "image": return "📷 Foto";
    case "video": return "🎥 Vídeo";
    case "audio": return "🎤 Áudio";
    case "document": return "📄 Documento";
    case "sticker": return "Figurinha";
    case "location": return "📍 Localização";
    case "contact": return "👤 Contato";
    case "reaction": return "Reagiu a uma mensagem";
    case "poll": return "📊 Enquete";
    case "deleted": return "Mensagem apagada";
    default: return null;
  }
}

// ── Marcação do WhatsApp ─────────────────────────────────────────────────────

/** Remove marcadores (*, _, ~, ```) mantendo o texto — pro preview de uma linha. */
export function stripWhatsAppMarkup(text: string): string {
  return text
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?!\s)([^_\n]+?)_(?!\w)/g, "$1$2")
    .replace(/(^|[^\w~])~(?!\s)([^~\n]+?)~(?!\w)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Highlighter = (s: string, key: string) => ReactNode;

function makeHighlighter(term?: string): Highlighter {
  const t = term?.trim();
  if (!t) return (s) => s;
  const re = new RegExp(`(${escapeRegExp(t)})`, "gi");
  return (s, key) => {
    const parts = s.split(re);
    if (parts.length === 1) return s;
    return parts.map((p, i) =>
      i % 2 === 1 ? (
        <mark key={`${key}-m${i}`} className="bg-yellow-300 text-black px-0.5 rounded-sm">{p}</mark>
      ) : (
        p
      )
    );
  };
}

// URL (http/https/www) ou telefone internacional explícito (+DDI...).
const LINK_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[^\s<>"']+|\+\d[\d\s-]{9,17}\d)/g;

function linkify(text: string, key: string, hl: Highlighter): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const idx = m.index ?? 0;
    let raw = m[0];
    // pontuação de fim de frase colada no link não faz parte dele
    const trail = raw.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
    if (trail) raw = raw.slice(0, -trail.length);
    if (idx > last) out.push(hl(text.slice(last, idx), `${key}-t${i}`));
    const isPhone = raw.startsWith("+");
    const href = isPhone ? `tel:${raw.replace(/[\s-]/g, "")}` : raw.startsWith("www.") ? `https://${raw}` : raw;
    out.push(
      <a
        key={`${key}-a${i}`}
        href={href}
        target={isPhone ? undefined : "_blank"}
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all hover:opacity-80"
        onClick={(e) => e.stopPropagation()}
      >
        {hl(raw, `${key}-al${i}`)}
      </a>
    );
    last = idx + raw.length;
    i++;
  }
  if (last < text.length) out.push(hl(text.slice(last), `${key}-t${i}`));
  return out;
}

// Estilos inline. Delimitador precisa "encostar" no texto (sem espaço logo dentro) e não pode
// estar colado em letra/dígito do lado de fora — mesma regra do WhatsApp (evita que
// "2*3*4" ou "snake_case_name" virem formatação).
const INLINE_RE = /(`[^`\n]+`|(?<![\p{L}\p{N}*])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_(?!\s)[^_\n]+?(?<!\s)_(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}~])~(?!\s)[^~\n]+?(?<!\s)~(?![\p{L}\p{N}~]))/gu;

function renderInline(text: string, key: string, hl: Highlighter): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    const tok = m[0];
    // Não formata dentro de URL (ex: https://site.com/a_b_c)
    const before = text.slice(0, idx);
    const lastSpace = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"));
    if (/https?:\/\/|www\./.test(before.slice(lastSpace + 1))) continue;
    if (idx > last) out.push(...linkify(text.slice(last, idx), `${key}-p${i}`, hl));
    const inner = tok.slice(1, -1);
    const k = `${key}-f${i}`;
    const ch = tok[0];
    if (ch === "`") out.push(<code key={k} className="rounded bg-black/10 dark:bg-white/10 px-1 font-mono text-[0.85em]">{inner}</code>);
    else if (ch === "*") out.push(<strong key={k} className="font-semibold">{renderInline(inner, k, hl)}</strong>);
    else if (ch === "_") out.push(<em key={k}>{renderInline(inner, k, hl)}</em>);
    else out.push(<s key={k}>{renderInline(inner, k, hl)}</s>);
    last = idx + tok.length;
    i++;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), `${key}-p${i}`, hl));
  return out;
}

/** Renderiza texto com a formatação do WhatsApp. `highlight` destaca um termo de busca. */
export function renderWhatsAppText(text: string, highlight?: string): ReactNode {
  const hl = makeHighlighter(highlight);
  // eslint-disable-next-line no-control-regex -- remove caracteres de controle que vêm em mensagens
  const clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  const blocks: ReactNode[] = [];

  // Blocos ```monoespaçados``` primeiro (podem ter várias linhas)
  const segments = clean.split(/```/);
  segments.forEach((seg, si) => {
    if (si % 2 === 1 && si < segments.length - 1) {
      blocks.push(
        <pre key={`pre${si}`} className="my-1 whitespace-pre-wrap break-words rounded-md bg-black/10 dark:bg-white/10 px-2 py-1 font-mono text-[0.85em]">
          {hl(seg.replace(/^\n|\n$/g, ""), `pre${si}`)}
        </pre>
      );
      return;
    }
    const lines = (si % 2 === 1 ? "```" + seg : seg).split("\n");
    let listItems: { ordered: boolean; content: ReactNode; key: string }[] = [];
    const flushList = (k: string) => {
      if (!listItems.length) return;
      const ordered = listItems[0].ordered;
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={k} className={`my-0.5 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {listItems.map((li) => <li key={li.key}>{li.content}</li>)}
        </Tag>
      );
      listItems = [];
    };
    lines.forEach((line, li) => {
      const k = `s${si}l${li}`;
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (bullet || num) {
        const ordered = !!num;
        if (listItems.length && listItems[0].ordered !== ordered) flushList(`${k}-flush`);
        listItems.push({ ordered, content: renderInline(num ? num[2] : bullet![1], k, hl), key: k });
        return;
      }
      flushList(`${k}-list`);
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        blocks.push(
          <span key={k} className="block border-l-2 border-current pl-2 opacity-80">
            {renderInline(quote[1], k, hl)}
          </span>
        );
        return;
      }
      const next = lines[li + 1];
      const nextIsBlock = next !== undefined && /^(\s*[-*•]\s+|\s*\d+[.)]\s+|>)/.test(next);
      blocks.push(
        <span key={k}>
          {renderInline(line, k, hl)}
          {li < lines.length - 1 && !nextIsBlock ? "\n" : null}
        </span>
      );
    });
    flushList(`s${si}-endlist`);
  });

  return <>{blocks}</>;
}

/** Trecho de ~`radius` caracteres centrado na primeira ocorrência de `term`. */
export function snippetAround(text: string, term: string, radius = 60): string {
  const plain = stripWhatsAppMarkup(text);
  const idx = plain.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0 || plain.length <= radius * 2) return plain.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(plain.length, idx + term.length + radius);
  return `${start > 0 ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}
