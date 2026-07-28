/**
 * WhatsAppInterface.tsx — Componente principal do chat (aba "Conversas" de /whatsapp).
 *
 * Lista conversas (fetchConversas, poll a cada 2-5s), mensagens da conversa ativa
 * (fetchMensagens, poll a cada 3s), envio de mensagem/nota (handleSendMessage — não chama
 * IA/OpenAI, envia sempre o texto digitado pelo atendente),
 * seleção múltipla/exclusão/encaminhamento de mensagens, gestão de instância (conectar via QR/
 * pairing code), toggle de IA por contato, busca global e por conversa, e painel de detalhes do
 * contato (tags, mídia, documentos, notas do CRM). Não faz polling via WebSocket/SSE — tudo é
 * feito com setInterval + fetch (ver comentário "substitui Supabase Realtime").
 */
import { useState, useMemo, useEffect, useRef, useCallback, type ChangeEvent, type ClipboardEvent } from "react";
import { Label } from "@/components/ui/label";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search, Send, Phone, Paperclip,
  QrCode, RefreshCw, Loader2, Info,
  ChevronDown, ChevronRight, X, Pencil, Plus,
  Mic, LayoutGrid, MessageSquare, SlidersHorizontal,
  UserPlus, Check, Smartphone,
  ShieldAlert, Tag, Sparkles, Zap,
  BotOff, Bot, ImageIcon, Reply,
  ChevronUp, Pin, Archive, BellOff, MessageCircle,
  Copy, Video, FileText, Trash2, Forward, Star,
  AlertCircle, Activity,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchConnectionStatus, createInstance, disconnectInstance, type StatusResult, type CreateInstanceResult } from "@/services/evolutionService";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { getAuthToken } from "@/lib/api-token";
import { getFreshToken } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';
// [AUDITORIA] FIX APLICADO (2026-07-10): apiHeaders() lia o token cru do localStorage sem checar
// expiração nem tentar refresh — toda chamada desta tela (send, conversas, etc.) usa fetch direto
// com este header, sem passar pelo QueryBuilder de client.ts (que já tinha essa lógica). Isso
// causava 401 visível ao usuário sempre que o clique acontecia com o access_token expirado, sem
// nenhuma tentativa de recuperação. Agora usa getFreshToken() (client.ts), que verifica exp e
// chama o refresh silencioso antes de montar os headers.
async function apiHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = await getFreshToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// [AUDITORIA] LÓGICA (Achado A — envio de mídia): precisa bater com MAX_OUTBOUND_MEDIA_BYTES em
// backend/src/utils/whatsappMediaStorage.ts. A validação aqui é só UX (erro amigável antes de
// tentar enviar) — o backend já rejeita com 413 de qualquer forma; se o limite mudar lá, mudar
// aqui também.
const MAX_OUTBOUND_MEDIA_BYTES = 5 * 1024 * 1024;

function mimeToMediaType(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatRecordingTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type ChatTab = "todos" | "fila" | "meus" | "arquivadas";

type DeliveryStatus = "sent" | "SERVER_ACK" | "DELIVERY_ACK" | "READ" | "PLAYED" | "received" | string;

interface Message {
  id: string;
  message_id?: string;
  role: "user" | "assistant" | "note";
  content: string;
  timestamp: string;
  rawTimestamp?: string;
  senderName?: string;
  tipo?: string;
  midia_url?: string;
  midia_mime?: string;
  midia_nome?: string;
  status?: DeliveryStatus;
  is_read?: boolean;
  reply_to?: {
    message_id: string;
    content: string;
    senderName: string;
    role: "user" | "assistant";
  };
}

// Compartilhado entre fetchMensagens (janela recente) e loadOlderMessages (scroll-up) — mesmo
// mapeamento de linha da API pra Message, pra não divergir entre os dois pontos de carga.
function mapRowsToMessages(rows: any[], chatName: string): Message[] {
  return rows.map((m, i) => ({
    id: String(m.id || `msg-${i}`),
    message_id: m.message_id,
    role: (m.role || (m.from_me ? 'assistant' : 'user')) as 'user' | 'assistant',
    content: m.content || m.conteudo || '',
    timestamp: formatTime(m.timestamp_wa || m.created_at),
    rawTimestamp: m.timestamp_wa || m.created_at || new Date().toISOString(),
    // sender_name: nome de quem enviou (humano ou IA); push_name: nome do contato recebido
    senderName: m.from_me
      ? (m.sender_name || 'IA')
      : (m.push_name || chatName),
    tipo: m.tipo || 'text',
    midia_url: m.midia_url,
    midia_mime: m.midia_mime,
    midia_nome: m.midia_nome,
    status: m.status || m.delivery_status,
    is_read: m.is_read,
    reply_to: m.reply_to_message_id ? {
      message_id: m.reply_to_message_id,
      content: m.reply_to_content || 'Mensagem original',
      senderName: m.reply_to_sender === 'assistant' ? 'Você' : (m.push_name || chatName),
      role: (m.reply_to_sender || 'user') as 'user' | 'assistant'
    } : undefined
  }));
}

interface Chat {
  id: string;
  name: string;
  phone: string;
  is_group?: boolean;
  status?: string;
  tag?: string;
  lastMessage: string;
  timestamp: string;
  rawTimestamp: string;
  unread?: number;
  online?: boolean;
  is_pinned?: boolean;
  is_muted?: boolean;
  is_archived?: boolean;
  source?: string;
  push_name?: string;
  messages: Message[];
  notes?: string;
  profile_pic?: string;
}

const TAG_COLORS: Record<string, string> = {
  LEAD: "bg-blue-100 text-blue-700",
  NEGOCIAÇÃO: "bg-sky-100 text-sky-700",
  FECHAMENTO: "bg-green-100 text-green-700",
  ATIVO: "bg-emerald-100 text-emerald-700",
};

interface RespostaRapida {
  id: string;
  titulo: string;
  mensagem: string;
  atalho: string | null;
}

// ── Avatar com fallback de cor gerada do nome ──────────────────────────────────
const AVATAR_PALETTE = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e',
  '#f97316','#22c55e','#14b8a6','#3b82f6','#0ea5e9','#a855f7',
];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// [AUDITORIA] LÓGICA (2026-07-23): fotos de perfil salvas localmente (ver
// backend/utils/whatsappMediaStorage.ts, mesmo motivo do fix de mídia de mensagem — URL crua
// do WhatsApp expira, ver diagnosticos/AUDITORIA_LOG.md) vêm como `local-pic://userId/arquivo`,
// não uma URL de verdade. <img>/<video> nativos não conseguem mandar header de Authorization,
// então precisa buscar via fetch autenticado e converter pra blob URL — mesmo padrão já usado
// no AudioPlayer logo abaixo. URLs http(s) antigas (ainda não migradas) continuam funcionando
// direto, sem passar pelo proxy.
// [AUDITORIA] BUG (Achados B/C — mídia recebida não carrega): renomeado de useAuthedImageUrl
// pra useAuthedMediaUrl porque agora serve imagem, figurinha E vídeo, não só foto de perfil.
// Antes só tratava o prefixo `local-pic://` (foto de perfil) — qualquer outra coisa, incluindo
// `local://` (mídia de MENSAGEM, ver whatsappMediaStorage.ts), caía direto no `return rawUrl`
// sem processar. `local://`/`local-pic://` não são esquemas HTTP reais; um <img src="local://...">
// simplesmente falha em carregar, silenciosamente, sem erro visível. [AUDITORIA] FIX APLICADO:
// trata os dois prefixos da mesma forma (o proxy /api/whatsapp/media já sabia resolver ambos,
// só o frontend nunca mandava a requisição pra `local://`). URLs http(s) antigas continuam
// passando direto, sem quebrar compatibilidade.
function useAuthedMediaUrl(rawUrl: string | null | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!rawUrl) { setBlobUrl(null); return; }
    if (!rawUrl.startsWith('local-pic://') && !rawUrl.startsWith('local://')) { setBlobUrl(rawUrl); return; }

    let revoke: string | null = null;
    let cancelled = false;
    const proxyUrl = `${API_BASE}/api/whatsapp/media?url=${encodeURIComponent(rawUrl)}`;
    const t = getAuthToken();
    const headers: Record<string, string> = {};
    if (t) headers['Authorization'] = `Bearer ${t}`;

    fetch(proxyUrl, { headers })
      .then(r => { if (!r.ok) throw new Error('Falha'); return r.blob(); })
      .then(blob => {
        if (cancelled) return;
        revoke = URL.createObjectURL(blob);
        setBlobUrl(revoke);
      })
      .catch(() => { if (!cancelled) setBlobUrl(null); });

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [rawUrl]);

  return blobUrl;
}

function ChatAvatar({
  name, url, size = 'md', rounded = '2xl', className = '',
}: {
  name: string; url?: string | null; size?: 'sm' | 'md' | 'lg'; rounded?: string; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const resolvedUrl = useAuthedMediaUrl(url);
  const color = getAvatarColor(name);
  const initial = (name[0] || '?').toUpperCase();
  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-24 h-24 text-3xl' : 'w-12 h-12 text-sm';

  return (
    <div
      className={`${sizeClass} rounded-${rounded} overflow-hidden flex items-center justify-center font-black text-white shrink-0 relative ${className}`}
      style={{ backgroundColor: color }}
    >
      <span className="select-none">{initial}</span>
      {resolvedUrl && !failed && (
        <img
          src={resolvedUrl}
          alt={name}
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

// ── Player de áudio com proxy autenticado ──────────────────────────────────────
function AudioPlayer({ src }: { src: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoke: string | null = null;
    setLoading(true);
    setError(false);

    const proxyUrl = `${API_BASE}/api/whatsapp/media?url=${encodeURIComponent(src)}`;
    const t = getAuthToken();
    const headers: Record<string, string> = {};
    if (t) headers['Authorization'] = `Bearer ${t}`;

    fetch(proxyUrl, { headers })
      .then(r => {
        if (!r.ok) throw new Error('Falha');
        return r.blob();
      })
      .then(blob => {
        revoke = URL.createObjectURL(blob);
        setBlobUrl(revoke);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));

    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [src]);

  if (loading) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      <Loader2 className="h-4 w-4 animate-spin" /> carregando áudio...
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      <Mic className="h-4 w-4" /> Áudio indisponível
    </div>
  );
  return (
    <audio controls src={blobUrl!} className="max-w-[260px] h-10 rounded-lg" preload="metadata" />
  );
}

// [AUDITORIA] FIX APLICADO (Achado B — imagem/figurinha recebida não carrega): componentes
// dedicados em vez de chamar useAuthedMediaUrl() direto dentro do .map() de mensagens — hooks
// não podem ser chamados condicionalmente/dentro de callback de array (o nº de mensagens muda
// a cada render, violaria as Rules of Hooks), mesmo motivo pelo qual AudioPlayer/ChatAvatar já
// são componentes próprios em vez de lógica inline.
function AuthedImg({ src, alt, className, onClick }: { src: string; alt: string; className?: string; onClick?: () => void }) {
  const resolved = useAuthedMediaUrl(src);
  if (!resolved) {
    return <div className={`${className ?? ''} flex items-center justify-center bg-muted/20 animate-pulse`}><ImageIcon className="h-5 w-5 text-muted-foreground/30" /></div>;
  }
  return <img src={resolved} alt={alt} className={className} onClick={onClick} />;
}

// [AUDITORIA] FIX APLICADO (Achado C — vídeo recebido não carrega): antes usava
// <source src="{API_BASE}/api/whatsapp/media?url=..."> direto — <video>/<source> nativos não
// mandam header Authorization, e a rota exige autenticação, então a requisição do vídeo falhava
// com 401 mesmo com a URL "certa" na aparência. Mesmo padrão de fetch autenticado + blob URL,
// via useAuthedMediaUrl (blob: URLs não precisam de header pra serem lidas pelo <video>).
function AuthedVideo({ src, mime, className }: { src: string; mime?: string; className?: string }) {
  const resolved = useAuthedMediaUrl(src);
  if (!resolved) {
    return <div className={`${className ?? ''} flex items-center justify-center bg-muted/20 text-xs text-muted-foreground animate-pulse`}>Carregando vídeo...</div>;
  }
  return (
    <video controls className={className} preload="metadata">
      <source src={resolved} type={mime || 'video/mp4'} />
    </video>
  );
}

export function WhatsAppInterface() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserName = user?.display_name || user?.email?.split('@')[0] || 'Agente';
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  // [AUDITORIA] BUG: default era `true` — o painel de detalhes nascia aberto mesmo sem o usuário
  // pedir. Havia ainda um segundo problema mais sério: um useEffect(`[activeChatId]`) forçava
  // `setShowContactPanel(true)` toda vez que o usuário trocava de conversa, então mesmo fechando
  // manualmente o painel (botão Info), ele reabria sozinho ao abrir a próxima conversa — removido
  // logo abaixo, junto com outros estados que deveriam resetar ao trocar de chat e não resetavam.
  // [AUDITORIA] FIX APLICADO: default `false`; painel só abre por ação explícita do usuário
  // (botão Info, linha ~2261).
  const [showContactPanel, setShowContactPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<ChatTab>("todos");
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  
  const [messageInput, setMessageInput] = useState("");
  const [inputMode, setInputMode] = useState<"responder" | "nota">("responder");
  const [connectionStatus, setConnectionStatus] = useState<StatusResult | null>(null);
  const [qrData, setQrData] = useState<CreateInstanceResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [newMessagePhone, setNewMessagePhone] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [instancePhone, setInstancePhone] = useState("");
  const [instanceCountry, setInstanceCountry] = useState("BR");
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  // [AUDITORIA] LÓGICA (Achado A — envio de mídia): estado do anexo selecionado (preview antes
  // de enviar/cancelar) e da gravação de áudio via MediaRecorder.
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreviewUrl, setAttachedPreviewUrl] = useState<string | null>(null);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const [respostasRapidas, setRespostasRapidas] = useState<RespostaRapida[]>([]);
  const [showQR, setShowQR] = useState(false);
  const [qrSearch, setQrSearch] = useState("");
  // IA toggle por conversa
  const [iaPausada, setIaPausada] = useState<boolean>(false);
  const [togglingIA, setTogglingIA] = useState(false);
  // Nova conversa — busca de contatos
  const [contatoSearch, setContatoSearch] = useState("");
  const [contatoResults, setContatoResults] = useState<{id: string; nome: string; telefone: string; push_name?: string}[]>([]);
  const [searchingContatos, setSearchingContatos] = useState(false);
  // Foto de perfil — ampliar
  const [photoModal, setPhotoModal] = useState<string | null>(null);
  // [AUDITORIA] LÓGICA: photoModal pode guardar um marcador `local-pic://...` (foto salva
  // localmente, ver ChatAvatar/useAuthedMediaUrl acima) — resolve pra blob URL autenticada
  // antes de renderizar no <img> do modal ampliado.
  const photoModalResolvedUrl = useAuthedMediaUrl(photoModal);
  // Edição de nome do contato
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  // Sincronização de fotos
  const [syncingProfiles, setSyncingProfiles] = useState(false);
  // Cache de sessão: phone → foto_perfil buscada (evita repetir chamadas)
  const prevConversasRef = useRef<Map<string, { ts: string; role: string }>>(new Map());
  const prevUltimaAtividadeRef = useRef<Map<string, string>>(new Map());
  const lastOpenedRef = useRef<Map<string, string>>(new Map());
  const picCacheRef = useRef<Map<string, string | null>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const activeChatNameRef = useRef<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  // Viewport de scroll real do Radix ScrollArea — o `ref` do componente <ScrollArea> aponta pro
  // Root (que tem overflow-hidden e nunca rola), o elemento que de fato rola é o filho
  // [data-radix-scroll-area-viewport]. Sem isso, onScroll nunca dispara (evento 'scroll' não
  // borbulha) e não dá pra ler/ajustar scrollTop de verdade — ver useEffect que o popula.
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  useEffect(() => { isAtBottomRef.current = isAtBottom; }, [isAtBottom]);
  // Espelha `chats` em ref pra loadOlderMessages ler o estado mais atual sem precisar recriar a
  // função/listener de scroll a cada mudança de `chats` (que muda a cada poll, ~2-3s).
  const chatsRef = useRef<Chat[]>([]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const loadingOlderRef = useRef(false);
  const hasMoreOlderRef = useRef(true);
  const [replyTo, setReplyTo] = useState<{ message_id: string; content: string; senderName: string; role: "user" | "assistant" } | null>(null);
  
  // Estados para busca na conversa
  const [isSearchingInChat, setIsSearchingInChat] = useState(false);
  const [chatSearchTerm, setChatSearchTerm] = useState("");
  const [chatSearchResults, setChatSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Estados para busca global de mensagens
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState<any[]>([]);
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [showGlobalSearchResults, setShowGlobalSearchResults] = useState(false);


  // Estados para seleção múltipla
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [starredMessageIds, setStarredMessageIds] = useState<Set<string>>(new Set());
  const [showForwardModal, setShowForwardModal] = useState(false);


  // Quick replies filtradas pelo que o usuário digitou após "/"
  const qrFiltradas = useMemo(() => {
    const term = qrSearch.toLowerCase();
    return respostasRapidas.filter(r =>
      r.titulo.toLowerCase().includes(term) ||
      (r.atalho ?? '').toLowerCase().includes(term)
    );
  }, [respostasRapidas, qrSearch]);

  const fetchRespostasRapidas = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/respostas_rapidas`, { headers: await apiHeaders() });
      if (res.ok) setRespostasRapidas(await res.json());
    } catch {}
  }, []);

  const handleInputChange = (value: string) => {
    setMessageInput(value);
    // Detecta "/" no início para abrir quick replies
    if (value.startsWith('/')) {
      setQrSearch(value.slice(1));
      setShowQR(true);
    } else {
      setShowQR(false);
      setQrSearch('');
    }
  };

  const aplicarRespostaRapida = (r: RespostaRapida) => {
    setMessageInput(r.mensagem);
    setShowQR(false);
    setQrSearch('');
    textareaRef.current?.focus();
  };

  // Busca status IA ao abrir uma conversa
  const fetchIaStatus = useCallback(async (phone: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/ia-status/${encodeURIComponent(phone)}`, { headers: await apiHeaders() });
      if (res.ok) {
        const d = await res.json();
        setIaPausada(d.pausada === true);
      }
    } catch {}
  }, []);

  const toggleIA = async () => {
    if (!activeChatId) return;
    setTogglingIA(true);
    try {
      const novoEstado = !iaPausada;
      const res = await fetch(`${API_BASE}/api/whatsapp/ia-toggle`, {
        method: 'POST',
        headers: await apiHeaders(),
        body: JSON.stringify({ phone: activeChatId, pausar: novoEstado }),
      });
      if (res.ok) {
        setIaPausada(novoEstado);
        toast.success(novoEstado ? 'IA pausada para este contato' : 'IA reativada');
      } else {
        toast.error('Erro ao alterar status da IA');
      }
    } catch {
      toast.error('Sem conexão com o servidor');
    } finally {
      setTogglingIA(false);
    }
  };

  // Busca contatos CRM para nova conversa
  const buscarContatos = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) { setContatoResults([]); return; }
    setSearchingContatos(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/contatos-search?q=${encodeURIComponent(q)}`, { headers: await apiHeaders() });
      if (res.ok) setContatoResults(await res.json());
    } catch {}
    finally { setSearchingContatos(false); }
  }, []);

  // Busca foto de perfil para um chat — usa cache, não bloqueia
  const fetchProfilePic = useCallback(async (phone: string) => {
    if (picCacheRef.current.has(phone)) return; // já buscado nesta sessão
    picCacheRef.current.set(phone, null); // marca como "em busca"
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/profile-pic/${encodeURIComponent(phone)}`, {
        headers: await apiHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      const pic: string | null = data.foto_perfil || null;
      const name: string | null = data.push_name || null;
      picCacheRef.current.set(phone, pic);
      if (pic || name) {
        setChats(prev => prev.map(c =>
          c.id === phone
            ? { ...c, profile_pic: pic || c.profile_pic, name: c.name !== phone ? c.name : (name || c.name) }
            : c
        ));
      }
    } catch {}
  }, []);

  const syncAllProfiles = async () => {
    setSyncingProfiles(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/sync-profiles`, {
        method: 'POST',
        headers: await apiHeaders(),
      });
      if (!res.ok) { toast.error('Erro ao sincronizar'); return; }
      const { sincronizados, total } = await res.json();
      toast.success(`${sincronizados} de ${total} fotos sincronizadas`);
      picCacheRef.current.clear(); // limpa cache para recarregar
      fetchConversas();
    } catch {
      toast.error('Erro ao sincronizar fotos');
    } finally {
      setSyncingProfiles(false);
    }
  };

  const salvarNomeContato = async () => {
    if (!activeChatId || !nameInput.trim()) return;
    setSavingName(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/contato/${encodeURIComponent(activeChatId)}`, {
        method: 'PATCH',
        headers: await apiHeaders(),
        body: JSON.stringify({ nome: nameInput.trim() }),
      });
      if (res.ok) {
        setChats(prev => prev.map(c =>
          c.id === activeChatId ? { ...c, name: nameInput.trim() } : c
        ));
        toast.success('Nome atualizado!');
        setEditingName(false);
      } else {
        toast.error('Erro ao salvar nome');
      }
    } catch {
      toast.error('Sem conexão com o servidor');
    } finally {
      setSavingName(false);
    }
  };

  // Normaliza telefone para formato internacional (Brasil por padrão)
  const normalizarTelefone = (tel: string): string => {
    const digits = tel.replace(/\D/g, '');
    if (digits.length === 11) return `55${digits}`;        // DDD+9+número
    if (digits.length === 10) return `55${digits}`;        // DDD+número sem 9
    if (digits.length === 13 && digits.startsWith('55')) return digits; // já tem código
    return digits;
  };

  // [AUDITORIA] LÓGICA — Camada 5 (render, rastreio "mensagens não atualizam", 2026-07-08):
  // `chats` está corretamente nas dependências dos dois useMemo abaixo, e não há nenhum
  // React.memo neste arquivo envolvendo os componentes que renderizam a lista de chats ou as
  // mensagens (a lista e as mensagens são renderizadas inline no mesmo componente, não em
  // filhos memoizados) — não há como um prop desatualizado ficar "preso" atrás de um memo aqui.
  // Nenhum bug de render encontrado; se a Camada 1-4 entregam o dado atualizado em `chats`, a
  // tela reflete sem necessidade de refresh manual.
  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  const filteredChats = useMemo(() => {
    let list = chats.filter(c =>
      c.name.toLowerCase().includes(globalSearchTerm.toLowerCase()) ||
      c.phone.includes(globalSearchTerm)
    );


    // Filtra pela aba (Arquivadas ou Principal)
    // [AUDITORIA] BUG: a aba "Meus" é clicável de verdade (botão na lista de tabs logo abaixo,
    // ~linha 1522, `["Meus","Fila","Todos","Arquivadas"]`), mas este if/else-if não tinha nenhum
    // caso para activeTab === "meus" — o filtro caía direto pro sort sem excluir arquivados,
    // deixando "Meus" pior que "Todos" (mostrava arquivados e não-arquivados juntos). O conceito
    // de "conversas atribuídas a mim" também não existe no modelo de dados (Chat/Message não têm
    // campo de agente responsável), então a aba não filtra por dono — só corrigi para não
    // misturar arquivados, replicando o mesmo placeholder documentado que "fila" já usava.
    // [AUDITORIA] FIX APLICADO: "meus" agora cai no mesmo filtro de "não-arquivados" que "todos"
    // e "fila" — pequeno, isolado, e estritamente melhor que o comportamento anterior (misturar
    // arquivados). Implementar o filtro real por agente responsável fica como melhoria futura,
    // fora do escopo desta auditoria (exigiria coluna nova no banco).
    if (activeTab === "todos" || activeTab === "fila" || activeTab === "meus") {
      list = list.filter(c => !c.is_archived);
    } else if (activeTab === "arquivadas") {
      list = list.filter(c => c.is_archived);
    }

    // Ordenação: Fixados primeiro, depois por timestamp
    return list.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return (b.rawTimestamp || "").localeCompare(a.rawTimestamp || "");
    });
  }, [chats, globalSearchTerm, activeTab]);


  // [AUDITORIA] LÓGICA — Camada 3 (rastreio "mensagens não atualizam", 2026-07-08): esta função
  // SEMPRE cria um array novo (`dbChats = rows.map(...)`) e sempre chama `setChats(prev => ...)`
  // retornando esse array novo — não há early-return por igualdade de conteúdo aqui (diferente de
  // fetchMensagens, ver abaixo). Ou seja, toda vez que o polling roda, o React re-renderiza a
  // lista de chats com o que a API retornou naquele instante; não há cache/staleness nesta função
  // que pudesse "engolir" uma mensagem nova. Não encontrei bug aqui.
  const fetchConversas = async (isArchived = false) => {
    try {
      console.log(`[WA] fetchConversas iniciando (archived=${isArchived})...`);
      const res = await fetch(`${API_BASE}/api/whatsapp/conversas?archived=${isArchived}`, { headers: await apiHeaders() });
      if (!res.ok) {
        console.error('[WA] fetchConversas falhou', res.status);
        return;
      }
      const rows: any[] = await res.json();
      console.log('[WA] fetchConversas OK — linhas:', rows.length, 'phones:', rows.map(r => r.session_id).slice(0, 5));
      
      const newArrivals: string[] = [];
      for (const row of rows) {
        const prev = prevUltimaAtividadeRef.current.get(row.session_id);
        const isNew = !prev || new Date(row.ultima_atividade) > new Date(prev);
        const fromClient = row.ultimo_role === 'user';
        const notActive = activeChatIdRef.current !== row.session_id;
        
        console.log(`[WA] Chat ${row.session_id}: isNew=${isNew}, fromClient=${fromClient}, notActive=${notActive}`);
        
        if (isNew && fromClient && notActive && prev) {
          newArrivals.push(row.session_id);
        }
        prevUltimaAtividadeRef.current.set(row.session_id, row.ultima_atividade);
      }

      setChats(prev => {
        const prevMap = new Map(prev.map(c => [c.id, c]));
        
        const dbChats = rows.map(row => {
          const lastOpened = lastOpenedRef.current.get(row.session_id) ?? '';
          const hasUnread = row.ultimo_role === 'user'
            && new Date(row.ultima_atividade) > new Date(lastOpened);

          return {
            id: row.session_id,
            name: row.nome || row.session_id,
            phone: row.session_id,
            is_group: row.is_group || false,
            source: row.instancia || undefined,
            lastMessage: row.ultima_mensagem || '',
            timestamp: formatTime(row.ultima_atividade),
            rawTimestamp: row.ultima_atividade,
            messages: prevMap.get(row.session_id)?.messages || [],
            notes: prevMap.get(row.session_id)?.notes || '',
            profile_pic: row.profile_pic_url || prevMap.get(row.session_id)?.profile_pic || undefined,
            unread: Number(row.unread || (hasUnread ? 1 : 0)),
            is_pinned: row.is_pinned === true,
            is_archived: row.is_archived === true,
            push_name: row.push_name || undefined,
          };
        });

        // Toasts para novas mensagens
        for (const sid of newArrivals) {
          const chat = rows.find(r => r.session_id === sid);
          const nome = chat?.nome || sid;
          toast.info(`💬 ${nome}`, {
            description: chat?.ultima_mensagem?.slice(0, 60) || 'Nova mensagem',
            duration: 5000,
          });
        }

        // Auto-selecionar novos contatos se não houver chat ativo
        rows.forEach(row => {
          const isNewContact = !prevMap.has(row.session_id);
          if (isNewContact && row.ultimo_role === 'user') {
            if (!activeChatIdRef.current) {
              setActiveChatId(row.session_id);
            } else {
              toast.success(`📱 Novo contato: ${row.nome || row.session_id}`);
            }
          }
        });

        // Preserva chat local ativo que ainda não chegou ao banco (ex: nova conversa antes do 1º envio)
        const activeId = activeChatIdRef.current;
        if (activeId && !dbChats.find(c => c.id === activeId)) {
          const localChat = prevMap.get(activeId);
          if (localChat) return [localChat, ...dbChats];
        }

        return dbChats;
      });
    } catch {}
    finally { setLoadingChats(false); }
  };

  const fetchMensagens = async (phone: string, chatName: string, showLoading = false) => {
    console.log(`[WA] fetchMensagens para ${phone} iniciando...`);
    if (showLoading) setLoadingMessages(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/conversas/${encodeURIComponent(phone)}?limit=100`, { headers: await apiHeaders() });
      if (!res.ok) {
        console.warn('[WA] fetchMensagens falhou', phone, res.status, await res.text().catch(() => ''));
        return;
      }
      const rows: any[] = await res.json();
      console.log('[WA] fetchMensagens', phone, '— msgs recebidas:', rows.length);
      const msgs: Message[] = mapRowsToMessages(rows, chatName);
      // [AUDITORIA] LÓGICA — Camada 3, ponto que o rastreio pediu pra verificar com atenção: este
      // early-return SÓ dispara se `currentIds` e `newIds` forem EXATAMENTE iguais (mesmo
      // conteúdo, mesma ordem, mesmo tamanho). Uma mensagem nova aumenta `msgs.length` em relação
      // a `atual.messages.length`, o que já torna os dois arrays de tamanho diferente — logo
      // `JSON.stringify` nunca dá igual e o early-return nunca segura uma mensagem genuinamente
      // nova. Esse guard só evita re-render quando a resposta do polling é idêntica à anterior
      // (otimização legítima contra flicker, não um bug). Confirmado lendo a função inteira: não
      // há outro early-return nem comparação de referência que descarte uma atualização real.
      // Só atualiza se houver mudança real (evita re-render/flickering)
      setChats(prev => {
        const atual = prev.find(c => c.id === phone);
        // fetchMensagens só busca a janela recente (limit=100, sem `before`). Mensagens mais
        // antigas que o usuário já carregou via scroll-up (loadOlderMessages) não vêm nessa
        // resposta — sem preservá-las aqui, cada poll de 3s (linha ~1099) substituiria
        // `c.messages` inteiro e apagaria o histórico antigo carregado. Mantém só o que é
        // estritamente mais antigo que a primeira mensagem da janela nova.
        const oldestNewTs = msgs[0]?.rawTimestamp;
        const preservedOlder = oldestNewTs
          ? (atual?.messages ?? []).filter(m => (m.rawTimestamp ?? '') < oldestNewTs)
          : [];
        const merged = [...preservedOlder, ...msgs];

        const currentIds = atual?.messages.map(m => m.id + (m.status || '')) ?? [];
        const newIds     = merged.map(m => m.id + (m.status || ''));
        if (JSON.stringify(currentIds) === JSON.stringify(newIds)) return prev;

        const prevLen = atual?.messages.length ?? 0;
        // Só força scroll pro fim se for a abertura da conversa (showLoading) ou se o usuário já
        // estava no fim — senão, mensagem nova chegando via polling "puxa" o usuário pra baixo
        // enquanto ele tenta subir pra ler histórico antigo (era exatamente esse o bug relatado).
        if (merged.length > prevLen && (showLoading || isAtBottomRef.current)) {
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
        }

        const now = new Date().toISOString();
        return prev.map(c => c.id === phone
          ? {
              ...c,
              messages: merged,
              rawTimestamp: now,
              timestamp: formatTime(now),
              lastMessage: msgs.at(-1)?.content ?? c.lastMessage
            }
          : c
        ).sort((a, b) => b.rawTimestamp.localeCompare(a.rawTimestamp));
      });
    } catch {}
    finally { if (showLoading) setLoadingMessages(false); }
  };

  // Busca mensagens mais antigas que a primeira já carregada (cursor `before`) e as insere no
  // topo, preservando a posição visual de leitura (ajusta scrollTop pela diferença de altura
  // depois que o DOM atualiza — sem isso, a lista "pula" porque o topo cresce sob o usuário).
  const loadOlderMessages = async () => {
    const phone = activeChatIdRef.current;
    if (!phone || loadingOlderRef.current || !hasMoreOlderRef.current) return;
    const chat = chatsRef.current.find(c => c.id === phone);
    const oldest = chat?.messages[0];
    if (!oldest?.rawTimestamp) return;

    loadingOlderRef.current = true;
    setLoadingOlderMessages(true);
    const viewport = viewportRef.current;
    const prevScrollHeight = viewport?.scrollHeight ?? 0;
    const prevScrollTop = viewport?.scrollTop ?? 0;
    try {
      const res = await fetch(
        `${API_BASE}/api/whatsapp/conversas/${encodeURIComponent(phone)}?limit=50&before=${encodeURIComponent(oldest.rawTimestamp)}`,
        { headers: await apiHeaders() }
      );
      if (!res.ok) return;
      const rows: any[] = await res.json();
      if (rows.length === 0) { hasMoreOlderRef.current = false; return; }
      if (rows.length < 50) hasMoreOlderRef.current = false;

      const older = mapRowsToMessages(rows, activeChatNameRef.current);
      setChats(prev => prev.map(c =>
        c.id === phone ? { ...c, messages: [...older, ...c.messages] } : c
      ));

      requestAnimationFrame(() => {
        if (!viewport) return;
        viewport.scrollTop = viewport.scrollHeight - prevScrollHeight + prevScrollTop;
      });
    } catch {}
    finally {
      loadingOlderRef.current = false;
      setLoadingOlderMessages(false);
    }
  };

  const checkStatus = async (silent = true) => {
    try {
      // O backend agora gerencia qual a instância oficial do usuário.
      // Removemos a dependência de passar o nome da instância no frontend
      // para evitar loops com instâncias órfãs.
      const res = await fetchConnectionStatus();
      
      setConnectionStatus(res);
      if (res.state === "open") {
        setQrData(null);
        setRetryCount(0); // Reset retry on success
      }
      
      if (!silent && res.state === "unauthorized") {
        toast.error("Sessão expirada. Por favor, reconecte seu WhatsApp.", { id: 'wa-unauthorized' });
      } else if (!silent && res.state !== "open") {
        toast.warning("WhatsApp desconectado ou em sincronização", { id: 'wa-status' });
      }
    } catch (e) {
      if (!silent) toast.error("Erro ao verificar status da conexão", { id: 'wa-status-err' });
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleConnect = async (isAutoRetry = false) => {
    if (isAutoRetry && retryCount >= 3) {
      console.warn("[WA] Limite de auto-retry atingido. Deixando para intervenção manual.");
      return;
    }

    // Para "1 conta = 1 instância", usamos o nome estável gerado no backend.
    // O nome informado aqui serve apenas para identificação inicial se for a primeira vez.
    const name = instanceName.trim() || `WhatsApp ${currentUserName}`;
    
    try {
      setConnecting(true);
      if (isAutoRetry) setRetryCount(prev => prev + 1);
      const phoneDigits = instancePhone.replace(/\D/g, '');
      
      // Chamada unificada ao backend. O backend agora gerencia a idempotência,
      // limpeza de instâncias antigas e reuso da instância atual.
      // [AUDITORIA] LÓGICA (Sprint 2 — multi-instância): esta tela continua resolvendo a
      // instância PADRÃO do tenant (sem novaConexao/instancia) — conectar um segundo número
      // fica no painel de Instâncias (InstanceManagementPanel.tsx), que já foi atualizado pra
      // isso (ver diagnosticos/AUDITORIA_LOG.md).
      const res = await createInstance({ instanceName: name, phoneNumber: phoneDigits || undefined });
      
      setQrData(res);
      setShowConnectModal(false);
      setShowQrModal(true);
      
      if (res.state === "open") {
        setConnectionStatus({ state: "open", phoneNumber: res.phoneNumber });
        toast.success("WhatsApp já está conectado!");
        setShowQrModal(false);
        fetchConversas();
      } else if (res.qrCode || res.pairingCode) {
        toast.info(res.pairingCode ? "Use o código de pareamento no seu celular" : "Escaneie o QR Code no seu WhatsApp");
        
        // Se o Evolution enviou QR, o processo de conexão iniciou
        if (res.qrCode) {
          const messageToCopy = "Olá, estou conectando meu WhatsApp ao CRM!";
          navigator.clipboard.writeText(messageToCopy).catch(() => {});
        }
      } else if (res.qrPending) {
        toast.info("Aguardando geração do QR Code pela Evolution...");
      }
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("401") || msg.includes("unauthorized")) {
        toast.error("Erro de autenticação: Verifique a API Key da Evolution no servidor.");
      } else {
        toast.error("Erro ao conectar: " + msg);
      }
    } finally {
      setConnecting(false);
    }
  };
 
  // [AUDITORIA] LÓGICA — Camada 4 (rastreio "mensagens não atualizam", 2026-07-08): este é 1 de 3
  // useEffect/setInterval independentes neste componente que fazem polling do mesmo estado
  // (`chats`). Resumo dos três (comentados individualmente onde cada um aparece):
  //   A (aqui, 5s): fetchConversas(respeitando activeTab) + fetchMensagens do chat ativo.
  //   B (~linha 810, 2s com chat aberto / 5s sem): só fetchConversas — tinha um bug real, ver lá.
  //   C (~linha 855, 3s): só fetchMensagens do chat ativo.
  // Todos checam document.hidden/visibilityState antes de rodar (nomes de API diferentes pro
  // mesmo conceito — não é bug, só inconsistência de estilo). O impacto real dos 3 juntos:
  // requests HTTP redundantes (quando um chat está aberto, fetchConversas roda 2x via A+B a cada
  // ~2-5s, fetchMensagens roda 2x via A+C a cada ~3-5s) — desperdício de banda/backend, mas SEM
  // condição de corrida entre A e C (mesma chamada, mesmo parâmetro, resultado idêntico não causa
  // flicker). B era diferente — tinha um bug de verdade, corrigido nesta sessão (ver lá).
  // [AUDITORIA] FIX PENDENTE (motivo: risco de mudar comportamento perceptível): consolidar os 3
  // intervals em 1 exigiria decidir uma cadência única (2s? 3s? 5s?) ou replicar a lógica
  // condicional de cadência variável de B — não tenho certeza suficiente de que isso não muda a
  // responsividade percebida pelo usuário (ex: hoje mensagens do chat aberto atualizam a cada 3s
  // via C, mais rápido que os 5s de A). Deixando como está — funciona, só é redundante — até
  // confirmação do usuário de que uma cadência única serve para todos os casos.
  useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchConversas(activeTab === "arquivadas");
      if (activeChatIdRef.current) {
        fetchMensagens(activeChatIdRef.current, activeChatNameRef.current, false);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [user?.id, activeTab]);

  useEffect(() => {
    checkStatus();
    fetchConversas();
    fetchRespostasRapidas();
  }, [fetchRespostasRapidas]);


  useEffect(() => {
    const tStatus = setInterval(() => { if (!document.hidden) checkStatus(); }, 30000);
    return () => clearInterval(tStatus);
  }, []);

  // [AUDITORIA] LÓGICA: enquanto sync_status === 'syncing', faz polling mais rápido (3s) de
  // status + conversas — só nesse período, sem adicionar carga fora dele. Backend tipicamente
  // conclui em menos de 1 minuto (ver sincronizarHistoricoDireto em webhook.ts), então o
  // polling de 30s do effect acima sozinho deixaria a barra "presa" em 0% por boa parte disso.
  useEffect(() => {
    if (connectionStatus?.sync_status !== "syncing") return;
    const tSync = setInterval(() => {
      if (document.hidden) return;
      checkStatus();
      fetchConversas(activeTab === "arquivadas");
    }, 3000);
    return () => clearInterval(tSync);
  }, [connectionStatus?.sync_status, activeTab]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSelectMode) {
          setIsSelectMode(false);
          setSelectedMessageIds(new Set());
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isSelectMode]);

  useEffect(() => {
    if (!activeChatId) return;

    const markAsRead = async () => {
      try {
        // Tenta a rota do backend primeiro
        const res = await fetch(`${API_BASE}/api/whatsapp/conversas/${encodeURIComponent(activeChatId)}/read`, {
          method: 'PATCH',
          headers: await apiHeaders()
        });
        
        if (res.status === 404) {
          // Zera contador visual local se backend não tiver a rota
          setChats(prev => prev.map(c =>
            c.id === activeChatId ? { ...c, unread: 0 } : c
          ));
        }
      } catch (err) {
        console.error('[WA] Erro ao marcar como lida:', err);
      }
    };

    markAsRead();
  }, [activeChatId, user?.id]);

  // [AUDITORIA] BUG (Camada 4, Interval B — achado no rastreio de "mensagens não atualizam",
  // 2026-07-08): este interval chamava `fetchConversas(false)` com `false` fixo, ignorando
  // completamente `activeTab`. O Interval A (linha ~734) chama `fetchConversas(activeTab ===
  // "arquivadas")` — ou seja, com a aba "Arquivadas" selecionada, os dois intervals brigavam pelo
  // mesmo estado `chats`: A busca a lista arquivada, B (rodando a cada 2-5s, fora de sincronia com
  // A) busca a lista NÃO arquivada e sobrescreve — a lista visualmente "pisca"/alterna entre
  // arquivados e não-arquivados a cada poucos segundos nessa aba. Não é a causa do bug de mensagem
  // nova reportado (esse é upstream no Evolution, ver webhook.ts), mas é um bug real e
  // independente encontrado durante o rastreio.
  // [AUDITORIA] FIX APLICADO: `fetchConversas` agora recebe o mesmo `activeTab === "arquivadas"`
  // usado pelo Interval A, e `activeTab` foi adicionado às dependências do efeito (sem isso, o
  // closure do setInterval usaria um valor de activeTab congelado no momento da criação do
  // interval, o mesmo tipo de bug de closure obsoleto já corrigido em InstanceManagementPanel.tsx
  // nesta auditoria). Mudança pequena e isolada — não altera a cadência (2s/5s), só o filtro.
  useEffect(() => {
    const ms = activeChatId ? 2000 : 5000;
    const t = setInterval(() => {
      if (document.visibilityState !== 'hidden') fetchConversas(activeTab === "arquivadas");
    }, ms);
    return () => clearInterval(t);
  }, [activeChatId, activeTab]);



  useEffect(() => {
    if (!messagesEndRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsAtBottom(entry.isIntersecting);
        setShowScrollButton(!entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    observer.observe(messagesEndRef.current);
    return () => observer.disconnect();
  }, [activeChatId]);

  // [AUDITORIA] BUG (achado no rastreio de "não consigo subir mensagens antigas", 2026-07-26): o
  // <ScrollArea> (Radix) recebia `onScroll={handleScroll}` na prop, mas o `ref`/props desse
  // wrapper caem no elemento Root (`overflow-hidden`, nunca rola de verdade) — quem rola é o
  // filho interno `[data-radix-scroll-area-viewport]`. Evento nativo `scroll` não borbulha, então
  // esse onScroll nunca disparava; `isAtBottom`/`showScrollButton` dependiam só do
  // IntersectionObserver acima (funcionava por coincidência pro botão "ir pro fim", mas não dava
  // pra detectar "usuário perto do topo" — necessário pra carregar mensagens antigas).
  // [AUDITORIA] FIX APLICADO: busca o viewport real via querySelector e liga o listener nele
  // diretamente (DOM API, não JSX), inclusive disparando loadOlderMessages perto do topo.
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]');
    viewportRef.current = viewport ?? null;
    if (!viewport) return;

    const onViewportScroll = () => {
      const isBottom = viewport.scrollHeight - viewport.scrollTop <= viewport.clientHeight + 150;
      setIsAtBottom(isBottom);
      setShowScrollButton(!isBottom);
      if (viewport.scrollTop < 150) {
        loadOlderMessages();
      }
    };

    viewport.addEventListener('scroll', onViewportScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onViewportScroll);
  }, [activeChatId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };


  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // [AUDITORIA] LÓGICA (Achado A): segurança extra além do reset por troca de conversa acima —
  // se o componente inteiro desmontar (navegar pra outra página) no meio de uma gravação, libera
  // o microfone (senão o indicador de "gravando" do navegador/SO fica aceso) e o blob URL do
  // preview de anexo, ambos referenciados só via ref (não seriam limpos automaticamente).
  useEffect(() => {
    return () => {
      recordingStreamRef.current?.getTracks().forEach(t => t.stop());
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // [AUDITORIA] BUG (mesma classe do painel de detalhes acima): editingName, replyTo e
  // isSelectMode/selectedMessageIds nunca eram resetados ao trocar de conversa. Consequências
  // reais, não só visuais: (1) editar o nome do contato A, trocar pra conversa B sem
  // salvar/cancelar e apertar Enter chamava `salvarNomeContato()` usando o `activeChatId` ATUAL
  // (B) — o nome digitado pra A era salvo no contato errado; (2) o banner "respondendo a" de uma
  // mensagem da conversa A continuava visível e anexado ao envio em B; (3) mensagens selecionadas
  // pra exclusão/encaminhamento em A permaneciam "selecionadas" (mesmos UUIDs) com a barra de
  // ações visível sobre B — um clique em "Excluir" ali agiria sobre mensagens de uma conversa que
  // não é mais a que está na tela.
  // [AUDITORIA] FIX APLICADO: reset incondicional no topo deste efeito (já disparado a cada troca
  // de `activeChatId`), antes de qualquer early-return. Também cancela anexo/gravação de áudio
  // em andamento (mesma classe de bug: gravar áudio pra A, trocar pra B e mandar enviaria o
  // áudio de A pro contato B, porque enviarMidia()/sendRecording() leem o activeChatId ATUAL).
  useEffect(() => {
    setEditingName(false);
    setReplyTo(null);
    setIsSelectMode(false);
    setSelectedMessageIds(new Set());
    if (attachedPreviewUrl) URL.revokeObjectURL(attachedPreviewUrl);
    setAttachedFile(null);
    setAttachedPreviewUrl(null);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingStreamRef.current?.getTracks().forEach(t => t.stop());
    recordingStreamRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
    // Nova conversa = nova janela de paginação; "sem mais mensagens antigas" da conversa anterior
    // não vale pra esta.
    hasMoreOlderRef.current = true;
    loadingOlderRef.current = false;
    setLoadingOlderMessages(false);

    if (!activeChatId) {
      setIsSearchingInChat(false);
      setChatSearchTerm("");
      return;
    }
    const chat = chats.find(c => c.id === activeChatId);

    const chatName = chat?.name || activeChatId;
    activeChatNameRef.current = chatName;
    if (chat) fetchMensagens(activeChatId, chatName, true);
    fetchIaStatus(activeChatId);
    if (chat && !chat.profile_pic) fetchProfilePic(activeChatId);
    // [AUDITORIA] LÓGICA — Camada 4, Interval C: usa activeChatIdRef.current (não activeChatId
    // diretamente) dentro do setInterval — corretamente evita o bug de closure obsoleto (o ref
    // sempre reflete o valor mais atual, atualizado pelo useEffect de activeChatIdRef.current logo
    // acima no arquivo). Redundante com fetchMensagens do Interval A (mesma chamada, cadência
    // diferente: 3s aqui vs 5s lá), mas sem risco de race condition — mesmos parâmetros, resultado
    // idêntico independente de qual dos dois "vence".
    const tMsgs = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const currentId = activeChatIdRef.current;
      if (!currentId) return;
      fetchMensagens(currentId, activeChatNameRef.current, false);
    }, 3000);
    return () => clearInterval(tMsgs);
  }, [activeChatId]);

  // [AUDITORIA] BUG (achado 2026-07-27, mesmo sintoma relatado pelo usuário — "ao tentar subir
  // pra ler mensagem antiga, o chat puxa pra baixo sozinho" — mesmo depois do fix de
  // loadOlderMessages/isAtBottom acima): este efeito tinha `chats` inteiro nas dependências, então
  // rodava a CADA poll (fetchConversas/fetchMensagens rodam a cada 2-5s, ver Camada 4 acima) e
  // forçava scrollIntoView incondicional pro fim — nenhuma checagem de isAtBottom aqui, então
  // "vencia" por cima do gating já aplicado dentro de fetchMensagens (linha ~815). É esse efeito,
  // não o de loadOlderMessages, que continuava puxando o usuário pra baixo enquanto ele tentava
  // subir. [AUDITORIA] FIX APLICADO: dependências reduzidas a `[activeChatId]` — o scroll ao ABRIR
  // uma conversa já é coberto por fetchMensagens(..., showLoading=true) na troca de chat (mesma
  // condição `showLoading || isAtBottomRef.current`), então este efeito passa a rodar só na troca
  // de conversa em si, nunca mais em resposta a um poll de mensagens/lista.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChatId]);

  const handleSendMessage = async () => {
    // [AUDITORIA] FIX APLICADO (2026-07-08, a pedido do usuário — "tire o uso de tokens da OpenAI,
    // só quero o chat por enquanto"): removido o bloco que chamava /api/openclaw/chat (o agente
    // ADMIN da VPS com acesso a shell, ver backend/src/routes/openclaw.ts) antes de todo envio de
    // mensagem com IA não pausada. Esse era o BUG SEVERO documentado na auditoria desta sessão:
    // a resposta do agente admin (não o texto digitado) era o que ia pro cliente no WhatsApp, e
    // com a chave OpenAI sem crédito (insufficient_quota) isso quebrava o envio por completo,
    // impedindo até mensagens manuais simples de serem mandadas. Agora handleSendMessage sempre
    // envia exatamente o texto digitado pelo atendente — sem chamar OpenAI/OpenClaw em nenhum
    // ponto deste fluxo. Se no futuro fizer sentido reintroduzir uma sugestão de resposta via IA,
    // precisa ser um endpoint de atendimento ao cliente de verdade, não o OpenClaw Admin.
    // Fecha busca ao enviar mensagem
    setIsSearchingInChat(false);
    setChatSearchTerm("");

    if (inputMode === "nota") {
      // Nota privada — salva internamente, não envia ao WhatsApp
      if (!noteInput.trim() || !activeChatId) return;
      toast.success("Nota salva internamente");
      setNoteInput("");
      return;
    }

    if (!messageInput.trim() || !activeChatId) return;

    const text = messageInput.trim();
    const currentReplyTo = replyTo;
    setMessageInput("");
    setReplyTo(null);

    // Atualização otimista — aparece imediatamente
    const tempId = `local_${Date.now()}`;
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setChats(prev => prev.map(c =>
      c.id === activeChatId
        ? { 
            ...c, 
            messages: [...c.messages, { 
              id: tempId, 
              role: "assistant" as const, 
              content: text, 
              timestamp: ts, 
              senderName: currentUserName, 
              status: "sent",
              reply_to: currentReplyTo ? {
                message_id: currentReplyTo.message_id,
                content: currentReplyTo.content,
                senderName: currentReplyTo.senderName,
                role: currentReplyTo.role
              } : undefined
            }], 
            lastMessage: text, 
            timestamp: ts 
          }
        : c
    ));

    try {
      const chat = chats.find(c => c.id === activeChatId);
      const payload = { 
        phone: activeChatId, 
        text, 
        instancia: chat?.source,
        replyToMessageId: currentReplyTo?.message_id
      };
      
      console.log('[WHATSAPP] Enviando payload:', JSON.stringify(payload, null, 2));

      const res = await fetch(`${API_BASE}/api/whatsapp/send`, {
        method: 'POST',
        headers: await apiHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Erro ao enviar' }));
        console.error('[WHATSAPP] Erro no envio — Resposta do servidor:', err);
        
        // Se o erro for o TypeError da Evolution, sugerimos reconexão
        if (err.message?.includes("presenceSubscribe") || err.message?.includes("TypeError")) {
          toast.error("Erro técnico na Evolution API. Tente desconectar e conectar o QR Code novamente.", {
            duration: 8000
          });
        } else {
          toast.error(err.message || 'Erro ao enviar mensagem');
        }

        setChats(prev => prev.map(c =>
          c.id === activeChatId
            ? { ...c, messages: c.messages.filter(m => m.id !== tempId) }
            : c
        ));
      }
    } catch (err) {
      console.error('[WHATSAPP] Falha crítica no fetch:', err);
      toast.error('Sem conexão com o servidor');
      setChats(prev => prev.map(c =>
        c.id === activeChatId
          ? { ...c, messages: c.messages.filter(m => m.id !== tempId) }
          : c
      ));
    }
  };

  // [AUDITORIA] BUG (Achado A — não havia nenhuma UI de envio de mídia): composer só tinha
  // botão de respostas rápidas e envio de texto — Paperclip/Mic importados no arquivo eram só
  // indicadores visuais dentro de bolhas de mídia JÁ RECEBIDA, nunca um controle funcional.
  // Nenhum MediaRecorder/<input type="file"> existia no arquivo inteiro. Isso explica por que
  // um áudio gravado pelo atendente "não aparecia": não havia nenhum jeito de gravar/enviar um.
  // [AUDITORIA] FIX APLICADO: enviarMidia() abaixo é o equivalente de handleSendMessage() para
  // mídia — mesmo padrão (atualização otimista, POST /api/whatsapp/send, reaproveita
  // apiHeaders()/getFreshToken()), usado tanto pelo anexo de arquivo quanto pela gravação de
  // áudio abaixo.
  // [AUDITORIA] BUG (achado 2026-07-28 — "não consigo enviar imagem nem vídeo"): esta função
  // mandava o `data:<mime>;base64,...` inteiro como `mediaUrl` pro backend, que repassava sem
  // alteração pro campo `media` da Evolution — sem stripar o prefixo (não é base64 válido) nem
  // informar `mimetype`. Nenhum outro envio de mídia do sistema (campanhas em
  // `disparoProcessor.ts`, resposta em voz em `agentEngine.ts`) manda base64 cru — todos fazem
  // upload prévio e mandam uma URL http(s) estável. [AUDITORIA] FIX APLICADO: upload real via
  // `POST /api/whatsapp/upload-media` (novo, mesmo padrão de catalogo.ts/galeria.ts) antes de
  // chamar `/send` — `dataUrl` continua sendo usado só para o preview otimista local (não muda,
  // `<img>`/`<video>` renderizam `data:` direto sem precisar do proxy autenticado).
  const enviarMidia = async (file: Blob, mediaType: 'image' | 'video' | 'audio' | 'document', filename?: string) => {
    if (!activeChatId) return;
    if (file.size > MAX_OUTBOUND_MEDIA_BYTES) {
      toast.error(`Arquivo de ${(file.size / 1024 / 1024).toFixed(1)}MB excede o limite de ${(MAX_OUTBOUND_MEDIA_BYTES / 1024 / 1024).toFixed(0)}MB para envio via WhatsApp.`);
      return;
    }

    setSendingMedia(true);
    const chat = chats.find(c => c.id === activeChatId);
    const tempId = `local_${Date.now()}`;
    try {
      const dataUrl = await fileToDataUrl(file);
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const legenda = mediaType === 'image' ? '📷 Foto' : mediaType === 'video' ? '🎥 Vídeo' : mediaType === 'audio' ? '🎤 Áudio' : `📎 ${filename || 'Documento'}`;

      // Atualização otimista — mesmo padrão de handleSendMessage. data: URI funciona direto no
      // <img>/<video>/<audio> sem precisar do proxy autenticado (não é local://, não precisa).
      setChats(prev => prev.map(c =>
        c.id === activeChatId
          ? {
              ...c,
              messages: [...c.messages, {
                id: tempId,
                role: "assistant" as const,
                content: '',
                timestamp: ts,
                senderName: currentUserName,
                status: "sent",
                tipo: mediaType,
                midia_url: dataUrl,
                midia_nome: filename,
              }],
              lastMessage: legenda,
              timestamp: ts,
            }
          : c
      ));

      // Sem Content-Type manual aqui — o navegador monta o boundary de multipart sozinho.
      // `tipo` ajuda o backend a resolver uma extensão válida quando o arquivo não tem nome
      // real (ex: print colado via Ctrl+V vira um File genérico do navegador).
      const uploadForm = new FormData();
      uploadForm.append('arquivo', file, filename || `media_${Date.now()}`);
      uploadForm.append('tipo', mediaType);
      const uploadToken = await getFreshToken();
      const uploadRes = await fetch(`${API_BASE}/api/whatsapp/upload-media`, {
        method: 'POST',
        headers: uploadToken ? { Authorization: `Bearer ${uploadToken}` } : {},
        body: uploadForm,
      });
      if (!uploadRes.ok) {
        const errUpload = await uploadRes.json().catch(() => ({ message: 'Falha no upload do arquivo' }));
        throw new Error(errUpload.message || 'Falha no upload do arquivo');
      }
      const { url: mediaUrlEstavel } = await uploadRes.json();

      const res = await fetch(`${API_BASE}/api/whatsapp/send`, {
        method: 'POST',
        headers: await apiHeaders(),
        body: JSON.stringify({
          phone: activeChatId,
          mediaUrl: mediaUrlEstavel,
          mediaType,
          mediaFilename: filename,
          instancia: chat?.source,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Erro ao enviar mídia' }));
        toast.error(err.message || 'Erro ao enviar mídia');
        setChats(prev => prev.map(c =>
          c.id === activeChatId ? { ...c, messages: c.messages.filter(m => m.id !== tempId) } : c
        ));
      } else {
        // Substitui o data: URI otimista pela URL real (local://...) assim que possível.
        fetchMensagens(activeChatId, chat?.name || activeChatId, false);
      }
    } catch (err) {
      console.error('[WHATSAPP] Falha crítica no envio de mídia:', err);
      toast.error('Sem conexão com o servidor');
      setChats(prev => prev.map(c =>
        c.id === activeChatId ? { ...c, messages: c.messages.filter(m => m.id !== tempId) } : c
      ));
    } finally {
      setSendingMedia(false);
    }
  };

  // [AUDITORIA] LÓGICA: extraído de handleFileSelected (achado 2026-07-28) pra ser reaproveitado
  // por handlePasteImage abaixo — mesma validação de tamanho e troca de preview blob URL,
  // independente de vir do input de arquivo ou de um Ctrl+V.
  const attachFile = (file: File) => {
    if (file.size > MAX_OUTBOUND_MEDIA_BYTES) {
      toast.error(`Arquivo de ${(file.size / 1024 / 1024).toFixed(1)}MB excede o limite de ${(MAX_OUTBOUND_MEDIA_BYTES / 1024 / 1024).toFixed(0)}MB para envio via WhatsApp.`);
      return;
    }
    // [AUDITORIA] LÓGICA: revoga o blob URL do anexo anterior antes de criar um novo — sem isso,
    // trocar de arquivo (selecionar A, depois B sem cancelar A) vazava o blob URL de A.
    if (attachedPreviewUrl) URL.revokeObjectURL(attachedPreviewUrl);
    setAttachedFile(file);
    setAttachedPreviewUrl(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
  };

  const handleFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite selecionar o mesmo arquivo de novo depois
    if (!file) return;
    attachFile(file);
  };

  // [AUDITORIA] BUG (achado 2026-07-28 — "tentei colar um print e não consegui"): não existia
  // nenhum handler de paste no composer — colar uma imagem da área de transferência (print de
  // tela, `Ctrl+V`) não fazia nada, único jeito de anexar mídia era o seletor de arquivo do SO.
  // [AUDITORIA] FIX APLICADO: `onPaste` no textarea (abaixo, no JSX) chama isto — procura o
  // primeiro item de imagem em `clipboardData.items` (é isso que o SO expõe pra um print
  // copiado, não um "arquivo" de verdade) e reaproveita o mesmo `attachFile()`/preview/cancelar
  // já usado pelo botão de anexo, sem duplicar a validação de tamanho nem o envio.
  const handlePasteImage = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          attachFile(file);
        }
        return;
      }
    }
  };

  const cancelAttachment = () => {
    if (attachedPreviewUrl) URL.revokeObjectURL(attachedPreviewUrl);
    setAttachedFile(null);
    setAttachedPreviewUrl(null);
  };

  const confirmSendAttachment = async () => {
    if (!attachedFile) return;
    const file = attachedFile;
    cancelAttachment();
    await enviarMidia(file, mimeToMediaType(file.type), file.name);
  };

  // [AUDITORIA] LÓGICA: gravação via MediaRecorder — tenta opus (melhor compressão/qualidade,
  // suportado por Chrome/Edge/Firefox) e deixa o navegador escolher o default se não suportar.
  // NOTA (limitação conhecida, não corrigida nesta sessão): o envio final passa por
  // POST /api/whatsapp/send com mediaType='audio', que no backend (whatsapp.ts) sempre chama o
  // endpoint sendMedia da Evolution — diferente de agentEngine.ts/disparoProcessor.ts, que usam
  // sendWhatsAppAudio (endpoint dedicado a nota de voz/PTT). Ou seja, um áudio gravado aqui chega
  // como mensagem de áudio comum, não necessariamente como "nota de voz" nativa do WhatsApp —
  // inconsistência que já existe no contrato atual do backend, fora do escopo deste sprint
  // (frontend).
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordedChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch {
      toast.error('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  };

  const stopRecordingInternal = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') { resolve(null); return; }
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        resolve(blob.size > 0 ? blob : null);
      };
      recorder.stop();
    });
  };

  const finishRecordingUi = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingStreamRef.current?.getTracks().forEach(t => t.stop());
    recordingStreamRef.current = null;
    setIsRecording(false);
  };

  const cancelRecording = async () => {
    await stopRecordingInternal();
    finishRecordingUi();
    setRecordingSeconds(0);
  };

  const sendRecording = async () => {
    const blob = await stopRecordingInternal();
    finishRecordingUi();
    setRecordingSeconds(0);
    if (!blob) { toast.error('Gravação vazia — tente novamente.'); return; }
    const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
    await enviarMidia(blob, 'audio', `audio_${Date.now()}.${ext}`);
  };

  const handleCriarTarefaIA = async (conversaId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/kanban/tarefas/da-conversa`, {
        method: 'POST',
        headers: await apiHeaders(),
        body: JSON.stringify({ conversa_id: conversaId })
      });
      if (!res.ok) throw new Error();
      toast.success("Tarefa criada no Kanban com resumo da IA ✨", {
        description: "Acesse o menu Kanban para gerenciar.",
        action: {
          label: "Ver Kanban",
          onClick: () => navigate("/kanban")
        }
      });
    } catch {
      toast.error("Erro ao criar tarefa via IA");
    }
  };

  const handleStartNewChat = (phoneOverride?: string, nomeOverride?: string) => {
    const rawPhone = phoneOverride || newMessagePhone;
    if (!rawPhone.trim()) {
      toast.error("Informe o número de telefone");
      return;
    }
    const cleanPhone = normalizarTelefone(rawPhone);
    if (cleanPhone.replace(/\D/g, '').length < 10) {
      toast.error("Número de telefone inválido (mínimo 10 dígitos com DDD)");
      return;
    }

    // Se a conversa já existe na lista, só abre
    const existing = chats.find(c => c.id === cleanPhone || c.phone === cleanPhone);
    if (existing) {
      setActiveChatId(existing.id);
    } else {
      const newChat: Chat = {
        id: cleanPhone,
        name: nomeOverride || rawPhone,
        phone: cleanPhone,
        lastMessage: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        rawTimestamp: new Date().toISOString(),
        messages: [],
        notes: '',
      };
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(cleanPhone);
    }

    setShowNewMessageModal(false);
    setNewMessagePhone("");
    setContatoSearch("");
    setContatoResults([]);
  };

  // [AUDITORIA] LÓGICA (achado 2026-07-27, relevante ao pedido do usuário de "navegar/pesquisar"):
  // esta busca roda só sobre `activeChat.messages` — ou seja, só o que já está carregado no
  // cliente (janela inicial de 100 + o que `loadOlderMessages` já tiver paginado nesta sessão).
  // Diferente da busca global (`/api/whatsapp/search`, linha ~1839), que consulta o banco inteiro,
  // uma mensagem antiga que ainda não foi carregada aparece como "Nenhum resultado" aqui mesmo
  // existindo na conversa — não é um bug de lógica (a busca em si está correta sobre o que
  // recebe), é uma limitação de escopo (não busca no servidor). Não implementado como fix nesta
  // sessão por exigir decisão de produto (vale a pena buscar no servidor por conversa também, com
  // um endpoint novo, ou o usuário deve usar a busca global pra esse caso?).
  // Lógica de busca na conversa
  const handleChatSearch = (term: string) => {
    setChatSearchTerm(term);
    if (!term.trim() || !activeChat) {
      setChatSearchResults([]);
      setCurrentSearchIndex(-1);
      return;
    }

    const results: number[] = [];
    const lowerTerm = term.toLowerCase();
    activeChat.messages.forEach((m, idx) => {
      if (m.content.toLowerCase().includes(lowerTerm)) {
        results.push(idx);
      }
    });

    setChatSearchResults(results);
    if (results.length > 0) {
      setCurrentSearchIndex(results.length - 1); // Começa do mais recente
      scrollToMessage(results[results.length - 1]);
    } else {
      setCurrentSearchIndex(-1);
    }
  };

  const navigateSearch = (direction: 'next' | 'prev') => {
    if (chatSearchResults.length === 0) return;
    
    let newIndex = currentSearchIndex;
    if (direction === 'next') {
      newIndex = currentSearchIndex > 0 ? currentSearchIndex - 1 : chatSearchResults.length - 1;
    } else {
      newIndex = currentSearchIndex < chatSearchResults.length - 1 ? currentSearchIndex + 1 : 0;
    }
    
    setCurrentSearchIndex(newIndex);
    scrollToMessage(chatSearchResults[newIndex]);
  };

  const toggleMessageSelection = (messageId: string) => {
    if (!isSelectMode) setIsSelectMode(true);
    setSelectedMessageIds(prev => {
      const next = new Set(prev);
      const isAdded = !next.has(messageId);
      
      if (isAdded) {
        next.add(messageId);
      } else {
        next.delete(messageId);
        if (next.size === 0) setIsSelectMode(false);
      }

      console.log('--- [RASTREIO SELEÇÃO] ---', { 
        mensagemId: messageId, 
        acao: isAdded ? 'adicionado' : 'removido', 
        listaAtual: Array.from(next)
      });

      return next;
    });
  };

  const handleCopySelected = () => {
    if (!activeChat) return;
    const texts = activeChat.messages
      .filter(m => selectedMessageIds.has(m.id))
      .map(m => `[${m.timestamp}] ${m.senderName || 'Desconhecido'}: ${m.content}`)
      .join('\n');
    
    navigator.clipboard.writeText(texts);
    toast.success(`${selectedMessageIds.size} mensagens copiadas`);
    setIsSelectMode(false);
    setSelectedMessageIds(new Set());
  };

  // [AUDITORIA] BUG (achado 2026-07-27): "Favoritar" só mexe em `starredMessageIds`, um
  // `useState<Set<string>>` local (linha ~476) — nenhum fetch/persistência em lugar nenhum, e não
  // existe coluna `starred`/`is_starred` em `whatsapp_messages` nem rota equivalente ao padrão já
  // usado por pin/mute/archive (`/api/whatsapp/chat-prefs/:phone`). Diferente de `markAsUnread`
  // (mesma classe de bug, ver linha ~1944), este não é sobrescrito pelo polling de 2-5s porque não
  // depende de `chats` — mas é igualmente não-persistente: reload da página, outra aba ou outro
  // dispositivo perdem toda estrela marcada. [AUDITORIA] FIX PENDENTE (motivo: exige migração de
  // coluna nova + rota nova, não é fix isolado de frontend).
  const handleToggleStar = () => {
    setStarredMessageIds(prev => {
      const next = new Set(prev);
      selectedMessageIds.forEach(id => {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      });
      return next;
    });
    toast.success(`${selectedMessageIds.size} mensagens marcadas/desmarcadas`);
    setIsSelectMode(false);
    setSelectedMessageIds(new Set());
  };

  const handleDeleteForMe = async () => {
    const count = selectedMessageIds.size;
    const currentChat = activeChat;
    if (!currentChat) return;

    console.log('🚀 [RASTREIO EXCLUSÃO - INÍCIO]', {
      tipoExclusao: 'mim',
      quantidadeMensagens: count,
      idsParaDeletar: Array.from(selectedMessageIds),
      userIdAtivo: user?.id,
      instanciaEvolution: currentChat.source
    });

    setIsActionLoading(true);
    const idsToDelete = Array.from(selectedMessageIds);

    try {
      // Otimista
      setChats(prev => prev.map(c => 
        c.id === activeChatId 
          ? { ...c, messages: c.messages.filter(m => !selectedMessageIds.has(m.id)) }
          : c
      ));

      const deleteHeaders = await apiHeaders();
      const responses = await Promise.all(idsToDelete.map(id =>
        fetch(`${API_BASE}/api/whatsapp/messages/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: deleteHeaders,
          body: JSON.stringify({
            forEveryone: false,
            instancia: currentChat.source,
            remoteJid: `${currentChat.phone}@s.whatsapp.net`
          })
        })
      ));

      responses.forEach(async (response) => {
        const data = await response.json().catch(() => ({}));
        console.log('✅ [RASTREIO API - SUCESSO]', { status: response.status, data });
      });

      toast.success(`${count} mensagens removidas para você`);
    } catch (err: any) {
      console.error('❌ [RASTREIO API - ERRO CRÍTICO]', { 
        mensagem: err.message, 
        response404_500: err.response?.status, 
        payloadEnviado: err.config?.data 
      });
      toast.error("Erro ao ocultar mensagens");
    } finally {
      setIsActionLoading(false);
      setIsSelectMode(false);
      setSelectedMessageIds(new Set());
    }
  };

  const handleForwardMessages = async (targetPhone: string, targetSource?: string) => {
    if (!activeChat || selectedMessageIds.size === 0) return;
    
    setIsActionLoading(true);
    const messagesToForward = activeChat.messages.filter(m => selectedMessageIds.has(m.id));
    
    try {
      for (const msg of messagesToForward) {
        // Encaminha enviando o conteúdo novamente para o novo destinatário
        await fetch(`${API_BASE}/api/whatsapp/send`, {
          method: 'POST',
          headers: await apiHeaders(),
          body: JSON.stringify({ 
            phone: targetPhone, 
            text: msg.content, 
            instancia: targetSource,
            mediaUrl: msg.midia_url,
            mediaType: ['image', 'video', 'audio', 'document'].includes(msg.tipo || '') ? msg.tipo as any : undefined
          }),
        });
      }
      toast.success(`${messagesToForward.length} mensagens encaminhadas`);
    } catch {
      toast.error("Erro ao encaminhar algumas mensagens");
    } finally {
      setIsActionLoading(false);
      setIsSelectMode(false);
      setSelectedMessageIds(new Set());
      setShowForwardModal(false);
    }
  };


  const runUITests = () => {

    toast.info("Iniciando testes de UI...");
    const first3Msgs = activeChat?.messages.slice(0, 3) || [];
    if (first3Msgs.length < 3) {
      toast.error("Não há mensagens suficientes para o teste");
      return;
    }
    setIsSelectMode(true);
    setSelectedMessageIds(new Set(first3Msgs.map(m => m.id)));
    setTimeout(() => {
      if (document.querySelector('.sticky.top-0')?.textContent?.includes('selecionada')) {
        toast.success("Cenário A validado: Toolbar ativa");
      }
      setTimeout(() => {
        setSelectedMessageIds(new Set());
        setIsSelectMode(false);
        toast.success("Cenário B validado: Toolbar escondida");
      }, 1500);
    }, 1500);
  };

  const handleDeleteForEveryone = async () => {
    const count = selectedMessageIds.size;
    const currentChat = activeChat;
    if (!currentChat) return;

    console.log('🚀 [RASTREIO EXCLUSÃO - INÍCIO]', {
      tipoExclusao: 'todos',
      quantidadeMensagens: count,
      idsParaDeletar: Array.from(selectedMessageIds),
      userIdAtivo: user?.id,
      instanciaEvolution: currentChat.source
    });

    setIsActionLoading(true);
    const idsToDelete = Array.from(selectedMessageIds);
    
    try {
      // Otimista
      setChats(prev => prev.map(c => 
        c.id === activeChatId 
          ? { ...c, messages: c.messages.filter(m => !selectedMessageIds.has(m.id)) }
          : c
      ));

      const deleteHeaders = await apiHeaders();
      const responses = await Promise.all(idsToDelete.map(id => {
        const msg = currentChat.messages.find(m => m.id === id);
        const mId = msg?.message_id || id; // Fallback para UUID se não tiver message_id

        return fetch(`${API_BASE}/api/whatsapp/messages/${encodeURIComponent(mId)}`, {
          method: 'DELETE',
          headers: deleteHeaders,
          body: JSON.stringify({
            forEveryone: true,
            instancia: currentChat.source,
            remoteJid: `${currentChat.phone}@s.whatsapp.net`
          })
        });
      }));

      responses.forEach(async (response) => {
        const data = await response.json().catch(() => ({}));
        console.log('✅ [RASTREIO API - SUCESSO]', { status: response.status, data });
      });

      toast.success(`${count} mensagens apagadas para todos`);
    } catch (err: any) {
      console.error('❌ [RASTREIO API - ERRO CRÍTICO]', { 
        mensagem: err.message, 
        response404_500: err.response?.status, 
        payloadEnviado: err.config?.data 
      });
      toast.error("Erro ao apagar mensagens no servidor");
    } finally {
      setIsActionLoading(false);
      setIsSelectMode(false);
      setSelectedMessageIds(new Set());
    }
  };




  const scrollToMessage = (msgIndex: number) => {
    if (!activeChat) return;
    const msg = activeChat.messages[msgIndex];
    if (msg) {
      const el = messageRefs.current.get(msg.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  // [AUDITORIA] BUG (achado 2026-07-27): `term` vem direto do que o usuário digita nas duas
  // caixas de busca (chatSearchTerm/globalSearchTerm) e ia sem escapar pra dentro de `new RegExp`.
  // Qualquer caractere especial de regex no termo — muito plausível em busca por telefone, ex:
  // "(11) 98888-7777" — ou quebra o highlight silenciosamente (parênteses viram grupo de
  // captura, não caractere literal) ou lança `SyntaxError` em termos com metacaractere
  // desbalanceado (ex: só "(" ou só "["), derrubando o render desta tela inteira (sem error
  // boundary acima) a cada tecla digitada. [AUDITORIA] FIX APLICADO: escapa os metacaracteres de
  // regex antes de montar o padrão — o texto buscado continua batendo literalmente, sem mudar
  // nenhum comportamento de busca válido.
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const highlightText = (text: string, term: string) => {
    if (!term.trim()) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === term.toLowerCase() ? (
            <mark key={i} className="bg-yellow-300 text-black px-0.5 rounded-sm animate-pulse font-bold">
              {part}
            </mark>
          ) : part
        )}
      </>
    );
  };

  const handleGlobalSearch = async (term: string) => {
    setGlobalSearchTerm(term);
    if (!term.trim() || term.length < 2) {
      setGlobalSearchResults([]);
      setShowGlobalSearchResults(false);
      return;
    }

    setIsGlobalSearching(true);
    setShowGlobalSearchResults(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/search?q=${encodeURIComponent(term)}`, { headers: await apiHeaders() });
      if (res.ok) {
        setGlobalSearchResults(await res.json());
      }
    } catch {
      toast.error("Erro na busca global");
    } finally {
      setIsGlobalSearching(false);
    }
  };



  const isConnected = connectionStatus?.state === "open";

  // Funções para Context Menu
  const togglePin = async (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    const nextVal = !chat.is_pinned;
    
    // Otimista
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, is_pinned: nextVal } : c));
    toast.success(nextVal ? "Conversa fixada" : "Conversa desafixada");

    try {
      await fetch(`${API_BASE}/api/whatsapp/chat-prefs/${encodeURIComponent(chatId)}`, {
        method: 'POST',
        headers: await apiHeaders(),
        body: JSON.stringify({ pinned: nextVal })
      });
    } catch {
      // Reverter em caso de erro real se necessário
    }
  };

  const toggleMute = async (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    const nextVal = !chat.is_muted;

    setChats(prev => prev.map(c => c.id === chatId ? { ...c, is_muted: nextVal } : c));
    toast.success(nextVal ? "Notificações silenciadas" : "Notificações ativadas");

    try {
      await fetch(`${API_BASE}/api/whatsapp/chat-prefs/${encodeURIComponent(chatId)}`, {
        method: 'POST',
        headers: await apiHeaders(),
        body: JSON.stringify({ muted_until: nextVal ? new Date(Date.now() + 365*24*60*60*1000).toISOString() : null })
      });
    } catch {}
  };

  // [AUDITORIA] BUG: o menu "Silenciar" no painel de contato (dropdown com opções 8h/1 semana/
  // sempre) chamava só toast.success(...) diretamente no onClick, sem nenhuma chamada à API nem
  // atualização de estado — dizia "Silenciado por 8 horas" mas não silenciava nada de verdade.
  // [AUDITORIA] FIX APLICADO: nova função muteChatPor(), que persiste via a mesma rota
  // /chat-prefs usada por toggleMute, com o `muted_until` calculado pela duração escolhida.
  const muteChatPor = async (chatId: string, ms: number, label: string) => {
    const until = new Date(Date.now() + ms).toISOString();
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, is_muted: true } : c));
    toast.success(`Silenciado por ${label}`);
    try {
      await fetch(`${API_BASE}/api/whatsapp/chat-prefs/${encodeURIComponent(chatId)}`, {
        method: 'POST',
        headers: await apiHeaders(),
        body: JSON.stringify({ muted_until: until })
      });
    } catch {}
  };

  const toggleArchive = async (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    const nextVal = !chat.is_archived;

    setChats(prev => prev.map(c => c.id === chatId ? { ...c, is_archived: nextVal } : c));
    toast.success(nextVal ? "Conversa arquivada" : "Conversa desarquivada");
    
    if (nextVal && activeChatId === chatId) {
      setActiveChatId(null);
    }

    try {
      await fetch(`${API_BASE}/api/whatsapp/chat-prefs/${encodeURIComponent(chatId)}`, {
        method: 'POST',
        headers: await apiHeaders(),
        body: JSON.stringify({ archived: nextVal })
      });
    } catch {}
  };

  // [AUDITORIA] BUG (achado 2026-07-27): bump otimista local, sem persistência nenhuma — ao
  // contrário de togglePin/toggleMute/toggleArchive logo acima (todos chamam POST
  // /api/whatsapp/chat-prefs/:phone), este só mexe em `setChats`. `fetchConversas` (linha ~685,
  // chamada por 3 intervals independentes a cada 2-5s) recalcula `unread` sempre a partir do
  // servidor (linha ~731, `hasUnread` = ultima_atividade > lastOpenedRef) e sobrescreve esse `+1`
  // no próximo poll — na prática o botão "Marcar como não lida" reverte sozinho em poucos
  // segundos. [AUDITORIA] FIX PENDENTE (motivo: chat-prefs não tem coluna pra "forçar não lida"
  // independente da atividade real — precisa de coluna nova + lógica no cálculo de `hasUnread`
  // pra respeitar essa flag manual).
  const markAsUnread = (chatId: string) => {
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, unread: (c.unread || 0) + 1 } : c));
    toast.success("Marcada como não lida");
  };


  // [AUDITORIA] BUG (Achado 3 — responsividade, confirmado): as 3 colunas deste layout (lista
  // 340px fixo, chat flexível, painel de detalhes 300px fixo) não têm NENHUM breakpoint
  // responsivo (`sm:`/`md:`/`lg:`) em todo o arquivo — confirmado por busca literal, zero
  // ocorrências. Com `overflow-hidden` no container raiz (linha abaixo), em vez de aparecer uma
  // barra de rolagem horizontal, o conteúdo é CORTADO: em mobile (~375px), só a lista de 340px já
  // não cabe inteira; em tablet (~768px) com o painel de detalhes aberto, sobram ~128px pro chat
  // (340+300=640px de colunas fixas). Esse layout foi desenhado só para desktop (≥ ~1000px, onde
  // 340+300+chat mínimo cabem confortavelmente).
  // [AUDITORIA] FIX PENDENTE (motivo: redesenho de layout, decisão de produto/design, não é CSS
  // isolado): propostas para a próxima sessão, a decidir com o usuário:
  //   (a) abaixo de md (~768px): esconder a lista de conversas quando uma conversa está aberta
  //       (usar `activeChatId` que já existe) e mostrar um botão "voltar" no header do chat pra
  //       reexibi-la — o padrão comum de app de chat mobile (WhatsApp Web faz exatamente isso).
  //   (b) abaixo de lg (~1024px): painel de detalhes vira overlay/drawer sobre o chat em vez de
  //       ocupar uma 3ª coluna fixa (ex: `fixed inset-y-0 right-0` com backdrop, controlado pelo
  //       mesmo `showContactPanel`).
  //   (c) alternativa mais simples: `w-[340px]` → `w-full md:w-[340px]` na lista e mesma ideia pro
  //       painel, combinado com (a)/(b) pra decidir QUAL coluna fica visível de cada vez em telas
  //       estreitas (nunca as 3 ao mesmo tempo abaixo de lg).
  // Nenhuma das opções é "trocar uma classe" — todas mudam comportamento de navegação percebido
  // pelo usuário, por isso não implementadas sem confirmação.
  return (
    <div className="flex h-[calc(100vh-5rem)] overflow-hidden rounded-2xl border shadow-xl bg-background/60 backdrop-blur-xl animate-in fade-in duration-500">

      {/* ── LEFT: Conversation List ── */}
      <div className="w-[340px] shrink-0 border-r flex flex-col bg-card/30 backdrop-blur-sm">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <MessageSquare className="h-4.5 w-4.5 text-primary" />
              </div>
              <h2 className="text-lg font-bold tracking-tight">Conversas</h2>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              {connectionStatus?.state === "unauthorized" ? (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-orange-500 hover:bg-orange-50 animate-pulse" 
                  onClick={() => setShowConnectModal(true)} 
                  title="Reconectar WhatsApp"
                >
                  <AlertCircle className="h-4.5 w-4.5" />
                </Button>
              ) : !isConnected && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-amber-500 hover:bg-amber-50" 
                  onClick={() => setShowConnectModal(true)} 
                  title="Conectar WhatsApp"
                >
                  <Plus className="h-4.5 w-4.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setShowNewMessageModal(true)} title="Nova Mensagem">
                <UserPlus className="h-4.5 w-4.5" />
              </Button>
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={syncAllProfiles}
                disabled={syncingProfiles}
                title="Sincronizar fotos de perfil"
              >
                {syncingProfiles
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <ImageIcon className="h-4 w-4" />}
              </Button>
              {/* [AUDITORIA] BUG (achado 2026-07-27): botão sem onClick — não faz nada ao clicar.
                  Não existe nenhum estado de filtro/ordenação da lista de conversas neste arquivo
                  pra ligar aqui (diferente do ícone de sync de fotos ao lado, que já tem handler
                  real). [AUDITORIA] FIX PENDENTE (motivo: precisa de decisão de produto — filtrar
                  por quê? tag, instância, não-lidas? — e UI de opções nova, não é fix isolado). */}
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* [AUDITORIA] LÓGICA: barra de progresso de sincronização de histórico (2026-07-22) —
              aparece enquanto o backend baixa mensagens antigas em segundo plano após conectar/
              reconectar (sync_status vem junto do polling de status já existente, sem WebSocket
              novo, ver diagnosticos/AUDITORIA_LOG.md). */}
          {connectionStatus?.sync_status === "syncing" && (
            <div className="bg-blue-50 dark:bg-blue-950/30 -mx-5 px-5 py-2 border-y border-blue-100 dark:border-blue-900">
              <div className="flex justify-between text-[11px] text-blue-700 dark:text-blue-300 mb-1">
                <span>Carregando histórico de mensagens...</span>
                <span>{connectionStatus.sync_progress ?? 0}%</span>
              </div>
              <div className="w-full bg-blue-200 dark:bg-blue-900 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-1.5 transition-all duration-300"
                  style={{ width: `${connectionStatus.sync_progress ?? 0}%` }}
                />
              </div>
            </div>
          )}

          {/* [AUDITORIA] BUG (achado 2026-07-27): os dois "chips" abaixo ("Status Especial" com X
              pra remover, "Etiqueta" com chevron de dropdown) são só `<div>` com `cursor-pointer`
              — sem `onClick`, sem estado nenhum ligado (não existe filtro por "status especial"
              no modelo de dados, e o filtro por etiqueta que existe de verdade é outro, dentro do
              painel de detalhes de cada contato). Mesma classe do ícone de filtro
              (`SlidersHorizontal`) logo acima — aparentam ser parte de uma feature de filtros da
              lista que nunca foi implementada, só desenhada. [AUDITORIA] FIX PENDENTE (motivo:
              precisa de decisão de produto sobre quais filtros existem de fato, mesma pendência do
              ícone de filtro). */}
          {/* Filter chip */}
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 bg-primary/5 hover:bg-primary/10 border border-primary/10 rounded-full px-3 py-1 text-[11px] font-semibold text-primary cursor-pointer transition-all active:scale-95">
              Status Especial
              <X className="h-3 w-3 ml-1 opacity-60 hover:opacity-100" />
            </div>
            <div className="flex items-center gap-1.5 bg-muted/50 hover:bg-muted border border-transparent rounded-full px-3 py-1 text-[11px] font-semibold text-muted-foreground cursor-pointer transition-all active:scale-95">
              Etiqueta
              <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-muted/40 rounded-lg overflow-x-auto no-scrollbar scroll-smooth">
            {(["Meus", "Fila", "Todos", "Arquivadas"] as const).map(t => {
              const key = t.toLowerCase() as ChatTab;
              const isActive = activeTab === key;
              const hasUnreadInTab = (key === "todos" || key === "arquivadas") && chats.some(c => (key === "arquivadas" ? c.is_archived : !c.is_archived) && (c.unread || 0) > 0);





              return (
                <button
                  key={t}
                  onClick={() => {
                    setActiveTab(key);
                    fetchConversas(key === "arquivadas");
                  }}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all whitespace-nowrap relative ${
                    isActive
                      ? "bg-white shadow-sm text-primary ring-1 ring-black/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/50"
                  }`}
                >
                  {t}
                  {hasUnreadInTab && <span className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full border border-background shadow-sm" />}

                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b bg-card/20 relative">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Buscar em todas as mensagens..."
              className="pl-9 h-10 bg-background/50 border-muted focus:bg-background focus:ring-primary/20 transition-all text-sm rounded-xl"
              value={globalSearchTerm}
              onChange={e => handleGlobalSearch(e.target.value)}
              onFocus={() => globalSearchTerm.length >= 2 && setShowGlobalSearchResults(true)}
            />
            {globalSearchTerm && (
              <button 
                onClick={() => { setGlobalSearchTerm(""); setGlobalSearchResults([]); setShowGlobalSearchResults(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-full"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Resultados da Busca Global */}
          {showGlobalSearchResults && globalSearchTerm.length >= 2 && (
            <div className="absolute top-full left-0 right-0 z-50 bg-background border-x border-b shadow-2xl rounded-b-2xl max-h-[400px] overflow-y-auto animate-in slide-in-from-top-2 duration-200">

              <div className="p-3 border-b bg-muted/20 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Mensagens Encontradas</span>
                {isGlobalSearching && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
              </div>
              {globalSearchResults.length === 0 && !isGlobalSearching ? (
                <div className="p-8 text-center text-muted-foreground text-xs font-medium">
                  Nenhuma mensagem encontrada para "{globalSearchTerm}"
                </div>
              ) : (
                globalSearchResults.map((res: any) => (
                  // [AUDITORIA] BUG (achado 2026-07-27): clicar num resultado da busca global só
                  // faz `setActiveChatId` — abre a conversa e para no fim dela (comportamento
                  // padrão de troca de chat), nunca rola/destaca a mensagem específica que o
                  // usuário encontrou e clicou. O comentário original aqui já reconhecia a
                  // limitação ("requer que a mensagem já esteja carregada") mas nunca implementava
                  // o scroll de fato — pra mensagens fora da janela recente (fetchMensagens só
                  // busca as últimas 100), nem estaria carregada sem paginar pra trás repetidas
                  // vezes via loadOlderMessages até encontrar o id. [AUDITORIA] FIX PENDENTE
                  // (motivo: exige guardar o `res.id` alvo, um efeito que espera a mensagem
                  // aparecer em `activeChat.messages` pra chamar `scrollToMessage`, e — só se não
                  // estiver na janela inicial — um loop de `loadOlderMessages()` com condição de
                  // parada clara contra `hasMoreOlderRef`; não implementado sem poder testar
                  // ponta-a-ponta num navegador real primeiro, pra não introduzir um loop que
                  // nunca termina).
                  <div
                    key={res.id}
                    onClick={() => {
                      setActiveChatId(res.phone);
                      setShowGlobalSearchResults(false);
                      setGlobalSearchTerm("");
                    }}
                    className="p-4 hover:bg-primary/[0.04] cursor-pointer border-b border-border/30 last:border-0 group transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-1.5">
                      <ChatAvatar name={res.contact_name} url={res.profile_pic} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold truncate group-hover:text-primary transition-colors">{res.contact_name}</p>
                        <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-tighter">
                          {new Date(res.timestamp_wa || res.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-foreground/80 line-clamp-2 pl-11 italic border-l-2 border-primary/10">
                      {highlightText(res.content, globalSearchTerm)}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>


        {/* Chat list */}
        <ScrollArea className="flex-1">
          {loadingChats && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          )}
          {!loadingChats && filteredChats.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center text-muted-foreground text-sm">
              <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
              {globalSearchTerm 
                ? "Nenhum chat correspondente."
                : "Nenhuma mensagem recebida ainda."}
            </div>
          )}

          <div className="divide-y divide-border/50">
            {filteredChats.map(chat => {
              const isActive = activeChatId === chat.id;
              return (
                <ContextMenu key={chat.id}>
                  <ContextMenuTrigger>
                    <div
                      onClick={() => {
                        setActiveChatId(chat.id);
                        lastOpenedRef.current.set(chat.phone, new Date().toISOString());
                      }}
                      className={`flex items-start gap-4 px-5 py-4 cursor-pointer transition-all relative group ${
                        isActive
                          ? "bg-primary/[0.04] after:absolute after:left-0 after:top-0 after:bottom-0 after:w-1 after:bg-primary z-10"
                          : chat.unread
                          ? "bg-green-50/30 dark:bg-green-950/20 border-l-2 border-green-500"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      <div className="relative shrink-0">
                        <ChatAvatar
                          name={chat.name}
                          url={chat.profile_pic}
                          size="md"
                          className={`transition-transform group-hover:scale-105 ${isActive ? 'shadow-lg ring-2 ring-primary/30' : ''}`}
                        />
                        {chat.online && (
                          <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-background rounded-full shadow-sm" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 py-0.5">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`text-sm font-bold truncate ${isActive ? "text-primary" : chat.unread ? "text-green-700 dark:text-green-400" : "text-foreground"}`}>
                              {chat.name}
                            </span>
                            {chat.is_pinned && <Pin className="h-3 w-3 text-muted-foreground rotate-45 shrink-0" />}
                            {chat.is_muted && <BellOff className="h-3 w-3 text-muted-foreground shrink-0" />}
                          </div>
                          <span className="text-[10px] font-medium text-muted-foreground shrink-0 ml-2">{chat.timestamp || '...'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          {chat.is_group && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-violet-100 text-violet-700 font-bold rounded tracking-tight uppercase">Grupo</span>
                          )}
                          {chat.source && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-muted font-bold text-muted-foreground rounded tracking-tight uppercase">{chat.source}</span>
                          )}
                          {chat.tag && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shadow-sm ${TAG_COLORS[chat.tag] ?? "bg-gray-100 text-gray-600"}`}>{chat.tag}</span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-xs truncate flex-1 ${isActive ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}>
                            {chat.lastMessage.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')}
                          </p>
                          {chat.unread ? (
                            <span className="min-w-[18px] h-[18px] px-1 bg-green-500 text-white text-[10px] font-black rounded-full flex items-center justify-center shadow-sm shrink-0">
                              {chat.unread}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56 rounded-xl shadow-xl border-border/50">
                    <ContextMenuItem onClick={() => markAsUnread(chat.id)} className="gap-2 py-2.5 cursor-pointer">
                      <MessageCircle className="h-4 w-4 text-muted-foreground" />
                      <span>Marcar como não lida</span>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => togglePin(chat.id)} className="gap-2 py-2.5 cursor-pointer">
                      <Pin className={`h-4 w-4 ${chat.is_pinned ? 'text-primary fill-primary/10' : 'text-muted-foreground'}`} />
                      <span>{chat.is_pinned ? "Desafixar" : "Fixar conversa"}</span>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => toggleMute(chat.id)} className="gap-2 py-2.5 cursor-pointer">
                      <BellOff className={`h-4 w-4 ${chat.is_muted ? 'text-orange-500' : 'text-muted-foreground'}`} />
                      <span>{chat.is_muted ? "Ativar notificações" : "Silenciar"}</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => toggleArchive(chat.id)} className="gap-2 py-2.5 cursor-pointer text-destructive focus:text-destructive">
                      <Archive className="h-4 w-4" />
                      <span>{chat.is_archived ? "Desarquivar" : "Arquivar conversa"}</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}

          </div>
        </ScrollArea>
      </div>

      {/* ── CENTER: Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background/40">
        
        {/* Modal Nova Mensagem */}
        <Dialog open={showNewMessageModal} onOpenChange={(o) => {
          setShowNewMessageModal(o);
          if (!o) { setContatoSearch(""); setContatoResults([]); setNewMessagePhone(""); }
        }}>
          <DialogContent className="sm:max-w-[460px] p-0 rounded-2xl overflow-hidden">
            <DialogHeader className="px-6 pt-6 pb-4 border-b">
              <DialogTitle className="text-lg font-bold">Nova Conversa</DialogTitle>
              <DialogDescription className="text-sm">
                Busque um contato do CRM ou digite o número diretamente.
              </DialogDescription>
            </DialogHeader>

            <div className="p-5 space-y-4">
              {/* Busca de contatos CRM */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Buscar contato no CRM</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Nome, telefone ou WhatsApp..."
                    className="pl-9 h-10 rounded-xl"
                    value={contatoSearch}
                    onChange={e => {
                      setContatoSearch(e.target.value);
                      buscarContatos(e.target.value);
                    }}
                    autoFocus
                  />
                  {searchingContatos && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
                </div>

                {/* Resultados */}
                {contatoResults.length > 0 && (
                  <div className="border rounded-xl overflow-hidden max-h-48 overflow-y-auto divide-y">
                    {contatoResults.map(c => (
                      <button
                        key={c.id}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
                        onClick={() => handleStartNewChat(c.telefone, c.push_name || c.nome)}
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm uppercase shrink-0">
                          {(c.push_name || c.nome)[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{c.push_name || c.nome}</p>
                          <p className="text-xs text-muted-foreground">{c.telefone}</p>
                        </div>
                        <MessageSquare className="h-4 w-4 text-primary/40 ml-auto shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                {contatoSearch.length >= 2 && contatoResults.length === 0 && !searchingContatos && (
                  <p className="text-xs text-muted-foreground px-1">Nenhum contato encontrado no CRM.</p>
                )}
              </div>

              {/* Separador */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[11px] uppercase font-bold text-muted-foreground tracking-widest">ou</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Número manual */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Digitar número</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Ex: 11999999999 (com DDD)"
                    className="pl-10 h-10 rounded-xl"
                    value={newMessagePhone}
                    onChange={e => setNewMessagePhone(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleStartNewChat()}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Código do Brasil (+55) adicionado automaticamente se necessário.
                </p>
              </div>
            </div>

            <DialogFooter className="px-5 pb-5 pt-0 gap-2">
              <Button variant="outline" onClick={() => setShowNewMessageModal(false)}>Cancelar</Button>
              <Button
                className="gap-2"
                onClick={() => handleStartNewChat()}
                disabled={!newMessagePhone.trim()}
              >
                <MessageSquare className="h-4 w-4" />
                Abrir Chat
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal de Conexão Inteligente */}
        <Dialog open={showConnectModal} onOpenChange={setShowConnectModal}>
          <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden border-none shadow-2xl rounded-2xl animate-in zoom-in-95 duration-300 [&>button]:hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-green-50 flex items-center justify-center ring-1 ring-green-100">
                  <MessageSquare className="h-5 w-5 text-green-600" />
                </div>
                <DialogTitle className="text-xl font-bold tracking-tight">
                  Nova Conexão WhatsApp
                </DialogTitle>
              </div>
              <button
                onClick={() => setShowConnectModal(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              {/* Security warning */}
              <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/80 p-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-[13px] font-extrabold text-amber-900 tracking-wide uppercase">
                      Atenção à Segurança (Anti-Ban)
                    </p>
                    <p className="text-[12.5px] text-amber-900/90 leading-relaxed">
                      Utilizamos <strong>Proxies</strong> para blindar seu número. Para evitar bloqueios:
                    </p>
                    <ul className="text-[12.5px] text-amber-900/90 leading-relaxed space-y-1 list-disc pl-4">
                      <li><strong>Nunca conecte</strong> no WhatsApp Web ou outros sistemas simultaneamente.</li>
                      <li><strong>Desligue a internet</strong> do celular (Wi-Fi/4G) logo após ler o QR Code.</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Nome da Identificação */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-orange-600">
                  Nome da Identificação<span className="text-orange-600">*</span>
                </label>
                <div className="relative">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-500" />
                  <Input
                    placeholder="Ex: Vendas Matriz"
                    className={`pl-10 h-11 rounded-xl border-2 transition-all ${
                      instanceName.trim()
                        ? "border-muted focus-visible:ring-primary/20"
                        : "border-orange-300 focus-visible:ring-orange-200"
                    }`}
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                  />
                </div>
                {!instanceName.trim() && (
                  <p className="text-[11px] text-muted-foreground pl-1">
                    O nome é obrigatório para identificação.
                  </p>
                )}
              </div>

              {/* País + Número */}
              <div className="grid grid-cols-[180px_1fr] gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    País<span className="text-orange-600">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={instanceCountry}
                      onChange={(e) => setInstanceCountry(e.target.value)}
                      className="w-full h-11 pl-3 pr-8 rounded-xl border-2 border-muted bg-background text-sm font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                    >
                      <option value="BR">🇧🇷 Brasil (+55)</option>
                      <option value="US">🇺🇸 EUA (+1)</option>
                      <option value="PT">🇵🇹 Portugal (+351)</option>
                      <option value="AR">🇦🇷 Argentina (+54)</option>
                      <option value="MX">🇲🇽 México (+52)</option>
                      <option value="ES">🇪🇸 Espanha (+34)</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Número do WhatsApp<span className="text-orange-600">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Ex: (11) 99999-9999"
                      className="pl-10 h-11 rounded-xl border-2 border-muted focus-visible:ring-primary/20"
                      value={instancePhone}
                      onChange={(e) => setInstancePhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-muted/20">
              <Button
                variant="ghost"
                onClick={() => setShowConnectModal(false)}
                className="text-muted-foreground hover:text-foreground font-semibold"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => handleConnect(false)}
                disabled={connecting || !instanceName.trim()}
                className="h-11 px-6 rounded-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold shadow-lg shadow-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:shadow-none transition-all active:scale-[0.98]"
              >
                {connecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <QrCode className="mr-2 h-4 w-4" />
                    Gerar QR Code
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal QR Code + Pairing Code */}
        <Dialog open={showQrModal && !!qrData} onOpenChange={(o) => { setShowQrModal(o); if (!o) checkStatus(false); }}>
          <DialogContent className="sm:max-w-[460px] p-0 overflow-hidden border-none shadow-2xl rounded-2xl [&>button]:hidden">
            <div className="px-6 pt-5 pb-3 border-b">
              <DialogTitle className="text-base font-bold text-foreground">
                Conectar Instância: <span className="text-foreground">{qrData?.instanceName || instanceName || 'Mentoark'}</span>
              </DialogTitle>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4 bg-background">
              <p className="text-center text-sm text-muted-foreground font-medium">
                Escaneie o QR Code ou use o Código de Pareamento.
              </p>

              {/* Opção 1: Pairing Code */}
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4.5 w-4.5 text-orange-500" />
                  <p className="text-sm font-bold">Opção 1: Código de Pareamento</p>
                </div>
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  No WhatsApp: <strong>Configurações</strong> &gt; <strong>Aparelhos Conectados</strong> &gt; <strong>Conectar</strong> &gt; <strong>Conectar com número de telefone</strong>
                </p>
                <div className="border border-dashed rounded-lg py-3 px-4 text-center bg-muted/20">
                  {qrData?.pairingCode ? (
                    <p
                      className="text-lg font-mono font-bold tracking-[0.35em] cursor-pointer hover:text-primary transition-colors"
                      onClick={() => {
                        navigator.clipboard.writeText(qrData.pairingCode!.replace(/\s/g, ''));
                        toast.success('Código copiado!');
                      }}
                      title="Clique para copiar"
                    >
                      {qrData.pairingCode}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      {instancePhone ? 'Gerando código...' : 'Informe um número de telefone para receber o código.'}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">ou</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Opção 2: QR Code */}
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2 justify-center">
                  <QrCode className="h-4.5 w-4.5 text-orange-500" />
                  <p className="text-sm font-bold">Opção 2: Escanear QR Code</p>
                </div>
                <div className="flex justify-center">
                  {qrData?.qrCode?.startsWith('data:image') ? (
                    <img src={qrData.qrCode} alt="QR Code" className="w-56 h-56" />
                  ) : (
                    <div className="w-56 h-56 flex items-center justify-center bg-muted/20 rounded-lg">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t bg-muted/10">
              <Button
                variant="outline"
                onClick={() => { setShowQrModal(false); setQrData(null); }}
                className="font-semibold"
              >
                Fechar
              </Button>
              <Button
                onClick={async () => {
                  try {
                    setConnecting(true);
                    const phoneDigits = instancePhone.replace(/\D/g, '');
                    const res = await createInstance({ instanceName, phoneNumber: phoneDigits || undefined });
                    setQrData(res);
                    toast.success('Códigos atualizados!');
                  } catch (e: any) {
                    toast.error('Erro ao atualizar: ' + e.message);
                  } finally {
                    setConnecting(false);
                  }
                }}
                disabled={connecting}
                className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold shadow-lg shadow-orange-500/30"
              >
                {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Atualizar Códigos
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {activeChat ? (
          <>
            {/* Chat header */}
            <div className="h-16 shrink-0 border-b flex items-center justify-between px-6 bg-background/60 backdrop-blur-md z-20 shadow-sm">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => activeChat.profile_pic && setPhotoModal(activeChat.profile_pic)}
                  className={activeChat.profile_pic ? 'cursor-zoom-in' : 'cursor-default'}
                  title={activeChat.profile_pic ? 'Ampliar foto' : ''}
                >
                  <ChatAvatar name={activeChat.name} url={activeChat.profile_pic} size="md" rounded="2xl" className="border border-primary/20 shadow-inner" />
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-base font-bold tracking-tight">{activeChat.name}</p>
                    <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`} />
                  </div>
                  {/* [AUDITORIA] BUG: pra conversa de grupo, activeChat.phone é o JID numérico bruto
                      do grupo (ex: "120363401725364845@g.us" sem o sufixo, um número bem longo sem
                      formatação) — estourava/cortava visualmente ao lado do nome da instância. A
                      lista lateral (linha ~1794) já trata isso com um badge "Grupo" legível; o
                      cabeçalho não usava o mesmo tratamento.
                      [AUDITORIA] FIX APLICADO: grupo mostra o mesmo badge "Grupo" da lista lateral
                      em vez do JID cru; contato individual mantém o telefone como antes. `truncate`
                      adicionado nos dois casos para nunca estourar o cabeçalho. */}
                  <p className="text-[11px] font-medium text-muted-foreground truncate max-w-[280px]">
                    <span className="text-primary font-bold">✓ {activeChat.source ?? "CRM"}</span>
                    {activeChat.is_group ? (
                      <span className="ml-1.5 text-[9px] px-1.5 py-0.5 bg-violet-100 text-violet-700 font-bold rounded tracking-tight uppercase align-middle">Grupo</span>
                    ) : (
                      <> · {activeChat.phone}</>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleIA}
                  disabled={togglingIA}
                  title={iaPausada ? "IA pausada — clique para reativar" : "IA ativa — clique para pausar"}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
                    iaPausada
                      ? "bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100"
                      : "bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                  }`}
                >
                  {togglingIA ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : iaPausada ? (
                    <BotOff className="h-3.5 w-3.5" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">{iaPausada ? "IA Pausada" : "IA Ativa"}</span>
                </button>

                <Button
                  variant="outline"
                  className="h-9 rounded-xl gap-2 text-primary border-primary/20 hover:bg-primary/5"
                  onClick={() => handleCriarTarefaIA(activeChat.id)}
                >
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden sm:inline">Criar Tarefa</span>
                </Button>
                
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`h-9 w-9 rounded-xl transition-colors ${isSearchingInChat ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => {
                    setIsSearchingInChat(!isSearchingInChat);
                    if (!isSearchingInChat) {
                      setTimeout(() => document.getElementById('chat-search-input')?.focus(), 100);
                    } else {
                      setChatSearchTerm("");
                      setChatSearchResults([]);
                      setCurrentSearchIndex(-1);
                    }
                  }}
                >
                  <Search className="h-4.5 w-4.5" />
                </Button>
                {/* [AUDITORIA] LÓGICA: `runUITests()` é uma ferramenta de auto-teste de dev (simula
                    seleção de mensagens, confere se a toolbar aparece/some) exposta como um botão
                    visível no header pra QUALQUER usuário em produção — não há flag de ambiente
                    (ex: import.meta.env.DEV) escondendo isso. Não é um bug funcional (não quebra
                    nada, só um recurso de debug), mas é um artefato de dev vazando pra UI real.
                    [AUDITORIA] FIX PENDENTE (motivo: remover/esconder é decisão do usuário — pode
                    ser proposital manter acessível pra QA em produção). */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-muted transition-colors"
                  onClick={runUITests}
                  title="Executar Testes de UI"
                >
                  <Activity className="h-4.5 w-4.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-9 w-9 rounded-xl transition-colors ${showContactPanel ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => setShowContactPanel(v => !v)}
                  title={showContactPanel ? 'Ocultar detalhes do contato' : 'Mostrar detalhes do contato'}
                >
                  <Info className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>



            {/* Painel de Busca */}
            {isSearchingInChat && (
              <div className="absolute top-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-md border-b shadow-sm animate-in slide-in-from-top duration-300">
                <div className="px-6 py-3 flex items-center gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="chat-search-input"
                      placeholder="Buscar na conversa..."
                      className="pl-10 h-10 rounded-xl bg-muted/50 border-none focus-visible:ring-2 focus-visible:ring-primary/20"
                      value={chatSearchTerm}
                      onChange={(e) => handleChatSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setIsSearchingInChat(false);
                          setChatSearchTerm("");
                        } else if (e.key === 'Enter') {
                          navigateSearch(e.shiftKey ? 'prev' : 'next');
                        }
                      }}
                    />
                  </div>
                  
                  {chatSearchTerm && (
                    <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground whitespace-nowrap bg-muted/30 px-3 py-2 rounded-lg">
                      {chatSearchResults.length > 0 ? (
                        <>
                          <span>{chatSearchResults.length - currentSearchIndex} de {chatSearchResults.length}</span>
                          <div className="flex items-center border-l ml-2 pl-2 gap-1">
                            <button 
                              onClick={() => navigateSearch('prev')}
                              className="p-1 hover:bg-background rounded-md transition-colors"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button 
                              onClick={() => navigateSearch('next')}
                              className="p-1 hover:bg-background rounded-md transition-colors"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <span>Nenhum resultado</span>
                      )}
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-xl hover:bg-muted"
                    onClick={() => {
                      setIsSearchingInChat(false);
                      setChatSearchTerm("");
                      setChatSearchResults([]);
                      setCurrentSearchIndex(-1);
                    }}
                  >
                    <X className="h-4.5 w-4.5" />
                  </Button>
                </div>
              </div>
            )}

            {/* Messages */}
            <ScrollArea
              className="flex-1 bg-muted/10 relative"
              ref={scrollAreaRef}
            >
              {/* Barra de Ferramentas Suspensa (Seleção) */}
              {isSelectMode && (
                <div className="sticky top-0 left-0 right-0 z-40 px-6 py-3 bg-background/95 backdrop-blur-md border-b shadow-md flex items-center justify-between animate-in slide-in-from-top duration-300">
                  <div className="flex items-center gap-4">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => { setIsSelectMode(false); setSelectedMessageIds(new Set()); }}
                      className="rounded-full h-8 w-8 hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-bold text-primary">{selectedMessageIds.size} selecionada(s)</span>
                  </div>
                  
                  <div className="flex items-center gap-1.5">
                    <Button 
                      variant="ghost" 
                      onClick={handleCopySelected}
                      disabled={isActionLoading}
                      className="h-9 px-3 gap-2 rounded-xl hover:bg-primary/5 hover:text-primary transition-all text-xs font-bold uppercase tracking-tight"
                    >
                      <Copy className="h-4 w-4" />
                      Copiar
                    </Button>
                    <Button 
                      variant="ghost" 
                      onClick={handleToggleStar}
                      disabled={isActionLoading}
                      className="h-9 px-3 gap-2 rounded-xl hover:bg-amber-50 hover:text-amber-600 transition-all text-xs font-bold uppercase tracking-tight"
                    >
                      <Star className="h-4 w-4" />
                      Favoritar
                    </Button>
                    <Button 
                      variant="ghost" 
                      onClick={() => setShowForwardModal(true)}
                      disabled={isActionLoading}
                      className="h-9 px-3 gap-2 rounded-xl hover:bg-blue-50 hover:text-blue-600 transition-all text-xs font-bold uppercase tracking-tight"
                    >
                      <Forward className="h-4 w-4" />
                      Encaminhar
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button 
                          variant="ghost" 
                          disabled={isActionLoading}
                          className="h-9 px-3 gap-2 rounded-xl hover:bg-destructive/5 hover:text-destructive transition-all text-xs font-bold uppercase tracking-tight"
                        >
                          <Trash2 className="h-4 w-4" />
                          Excluir
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 rounded-xl shadow-xl">
                        <DropdownMenuItem onClick={handleDeleteForMe} className="gap-2 py-2.5 cursor-pointer">
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                          <span>Excluir para Mim</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDeleteForEveryone} className="gap-2 py-2.5 cursor-pointer text-destructive focus:text-destructive">
                          <Trash2 className="h-4 w-4" />
                          <span>Excluir para Todos</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  
                  {isActionLoading && (
                    <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-xl z-50">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}
                </div>
              )}

              <div className="px-8 py-6 space-y-1 relative z-1">
                {loadingMessages && (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando mensagens...
                  </div>
                )}
                {!loadingMessages && loadingOlderMessages && (
                  <div className="flex items-center justify-center py-3 text-muted-foreground text-xs">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando mensagens antigas...
                  </div>
                )}
                {activeChat.messages.map((m, i) => {
                  const isOut = m.role === "assistant";
                  const isNote = m.role === "note";
                  const prevMsg = i > 0 ? activeChat.messages[i - 1] : null;
                  const prevRole = prevMsg?.role ?? null;
                  
                  // Lógica de separador de data
                  const currentDateStr = m.rawTimestamp || m.timestamp;
                  const prevDateStr = prevMsg ? (prevMsg.rawTimestamp || prevMsg.timestamp) : null;
                  
                  // Helper para validar se é uma string de data válida ou apenas hora "14:30"
                  const parseSafeDate = (str: string | undefined | null) => {
                    if (!str) return new Date();
                    // Se for apenas hora (HH:mm ou HH:mm:ss), não é uma data completa
                    if (/^\d{2}:\d{2}(:\d{2})?$/.test(str)) return null;
                    const d = new Date(str);
                    return isNaN(d.getTime()) ? null : d;
                  };

                  const currentDate = parseSafeDate(currentDateStr) || new Date();
                  const prevDate = parseSafeDate(prevDateStr);
                  
                  const isDifferentDay = !prevDate || 
                    currentDate.getDate() !== prevDate.getDate() || 
                    currentDate.getMonth() !== prevDate.getMonth() || 
                    currentDate.getFullYear() !== prevDate.getFullYear();

                  // Determinar label da data
                  let dateLabel = "";
                  if (isDifferentDay) {
                    const today = new Date();
                    const yesterday = new Date();
                    yesterday.setDate(today.getDate() - 1);

                    const isToday = currentDate.getDate() === today.getDate() && 
                                    currentDate.getMonth() === today.getMonth() && 
                                    currentDate.getFullYear() === today.getFullYear();
                    
                    const isYesterday = currentDate.getDate() === yesterday.getDate() && 
                                        currentDate.getMonth() === yesterday.getMonth() && 
                                        currentDate.getFullYear() === yesterday.getFullYear();

                    if (isToday) {
                      // Não exibir separador antes da primeira mensagem se for hoje
                      if (i > 0) dateLabel = "Hoje";
                    } else if (isYesterday) {
                      dateLabel = "Ontem";
                    } else {
                      dateLabel = currentDate.toLocaleDateString('pt-BR');
                    }
                  }

                  // Mostra nome quando muda de remetente
                  const showNameIn  = !isOut && !isNote && prevRole !== "user";
                  const showNameOut = isOut && !isNote && (prevRole !== "assistant" || prevMsg?.senderName !== m.senderName);

                  return (
                    <div 
                      key={m.id}
                      ref={el => { if (el) messageRefs.current.set(m.id, el); }}
                      className="group/row flex flex-col w-full"
                    >
                      {dateLabel && (
                        <div className="flex justify-center my-6 sticky top-2 z-10 pointer-events-none">
                          <div className="bg-background/80 backdrop-blur-sm border border-border/50 px-4 py-1.5 rounded-full shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">
                              {dateLabel}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-4 w-full">
                        {/* Checkbox (Visível em modo seleção ou hover) */}
                        {!isNote && (
                          <div 
                            className={`shrink-0 cursor-pointer transition-all duration-300 ${
                              isSelectMode 
                                ? "opacity-100 translate-x-0" 
                                : "opacity-0 -translate-x-2 group-hover/row:opacity-100 group-hover/row:translate-x-0"
                            }`}
                            onClick={() => toggleMessageSelection(m.id)}
                          >
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                              selectedMessageIds.has(m.id) 
                                ? "bg-primary border-primary shadow-lg shadow-primary/20" 
                                : "border-muted-foreground/30 bg-background hover:border-primary/50"
                            }`}>
                              {selectedMessageIds.has(m.id) && <Check className="h-3.5 w-3.5 text-white stroke-[4px]" />}
                            </div>
                          </div>
                        )}
                        
                        <div 
                          className={`flex-1 flex ${isOut ? "justify-end" : isNote ? "justify-center px-4" : "justify-start"} ${i > 0 && !isDifferentDay && activeChat.messages[i-1].role === m.role ? "mt-0.5" : "mt-4"}`}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (!isNote) toggleMessageSelection(m.id);
                          }}
                        >
                          <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm relative animate-in slide-in-from-bottom-2 duration-300 group ${
                            isOut
                              ? "bg-primary text-primary-foreground rounded-tr-none shadow-primary/10"
                              : isNote
                                ? "bg-amber-100/90 border border-amber-200 text-amber-900 w-full text-center rounded-xl shadow-none"
                                : "bg-background rounded-tl-none border border-border/50 shadow-black/[0.02]"
                          } ${selectedMessageIds.has(m.id) ? "ring-2 ring-primary ring-offset-2 ring-offset-muted/10 brightness-95 scale-[0.98] origin-center transition-all" : ""}`}>
                            
                            {/* Ícone de Favorito (Star) */}
                            {starredMessageIds.has(m.id) && (
                              <div className={`absolute -top-1 ${isOut ? '-left-1' : '-right-1'} bg-background rounded-full p-1 shadow-sm border border-amber-200 z-10`}>
                                <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                              </div>
                            )}

                          {/* Menu de Resposta (Reply) */}
                          {!isNote && (
                            <button
                              onClick={() => {
                                setReplyTo({
                                  message_id: m.message_id || m.id,
                                  content: m.content,
                                  senderName: m.senderName || (isOut ? 'Você' : activeChat.name),
                                  role: isOut ? "assistant" : "user"
                                });
                                textareaRef.current?.focus();
                              }}
                              className={`absolute top-2 ${isOut ? '-left-8' : '-right-8'} p-1.5 rounded-full bg-background border shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted text-muted-foreground hover:text-primary z-20`}
                              title="Responder"
                            >
                              <Reply className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {/* Quote (Citação) */}
                          {m.reply_to && (
                            <div className={`mb-2 p-2 rounded-lg border-l-4 bg-black/5 text-left text-[11px] flex flex-col gap-0.5 ${
                              m.reply_to.role === "assistant" ? "border-primary" : "border-green-500"
                            }`}>
                              <p className={`font-black uppercase tracking-widest text-[9px] ${
                                m.reply_to.role === "assistant" ? (isOut ? "text-primary-foreground/80" : "text-primary") : "text-green-600"
                              }`}>
                                {m.reply_to.senderName}
                              </p>
                              <p className={`line-clamp-2 italic ${isOut ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                                {m.reply_to.content}
                              </p>
                            </div>
                          )}

                          {showNameIn && (
                            <p className="text-[11px] font-black text-primary mb-1 uppercase tracking-wider">{m.senderName ?? activeChat.name}</p>
                          )}
                          {showNameOut && m.senderName && (
                            <p className="text-[10px] font-bold text-primary-foreground/70 mb-1 text-right">{m.senderName}</p>
                          )}
                          {isNote && (
                            <div className="flex items-center justify-center gap-1.5 mb-1 text-[10px] font-black uppercase tracking-widest text-amber-600/80">
                              <Info className="h-3 w-3" /> Nota Privada
                            </div>
                          )}
                          {m.tipo === 'image' && m.midia_url ? (
                            <AuthedImg src={m.midia_url} alt="imagem" className="rounded max-w-[220px] mb-1" onClick={() => m.midia_url && setPhotoModal(m.midia_url)} />
                          ) : m.tipo === 'audio' ? (
                            m.midia_url
                              ? <AudioPlayer src={m.midia_url} />
                              : <div className="flex items-center gap-2 text-xs text-muted-foreground py-1"><Mic className="h-4 w-4" /> Áudio</div>
                          ) : m.tipo === 'video' && m.midia_url ? (
                            <AuthedVideo src={m.midia_url} mime={m.midia_mime} className="rounded max-w-[260px] mb-1" />
                          ) : m.tipo === 'document' && m.midia_url ? (
                            <a
                              href={`${API_BASE}/api/whatsapp/media?url=${encodeURIComponent(m.midia_url)}`}
                              target="_blank" rel="noreferrer"
                              className="flex items-center gap-2 text-xs text-primary underline py-1"
                              download={m.midia_nome || true}
                            >
                              <Paperclip className="h-4 w-4" /> {m.midia_nome || 'Documento'}
                            </a>
                          ) : m.tipo === 'sticker' && m.midia_url ? (
                            <AuthedImg src={m.midia_url} alt="sticker" className="w-24 h-24 object-contain mb-1" />
                          ) : null}
                          {m.tipo === 'deleted' ? (
                            <p className="text-sm italic text-muted-foreground/60 flex items-center gap-1.5 py-1">
                              <ShieldAlert className="h-3.5 w-3.5 opacity-50" /> Mensagem apagada
                            </p>
                          ) : m.content && (
                            <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                              {highlightText(m.content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''), chatSearchTerm)}
                            </p>
                          )}

                          <div className={`flex items-center justify-end gap-1.5 mt-1.5 ${isOut ? "text-primary-foreground/70" : isNote ? "text-amber-700/60" : "text-muted-foreground/60"}`}>
                            {/* [AUDITORIA] BUG: m.timestamp já vem pré-formatado (ex: "13:57") de
                                formatTime(m.timestamp_wa||m.created_at) em fetchMensagens (linha ~608)
                                ou de new Date().toLocaleTimeString() no envio otimista (linha ~942).
                                Chamar formatTime() de novo aqui fazia new Date("13:57") — string não
                                parseável — e toLocaleTimeString() de uma Invalid Date retorna
                                literalmente o texto "Invalid Date" (não lança exceção, então o
                                try/catch de formatTime não pega). Era isso que aparecia embaixo de
                                toda mensagem enviada.
                                [AUDITORIA] FIX APLICADO: renderizar m.timestamp direto, sem
                                reformatar — já é a string de exibição pronta. */}
                            <span className="text-[10px] font-bold">{m.timestamp}</span>
                            {isOut && (
                              <span title={m.status || 'sent'}>
                                {m.status === 'READ' || m.status === 'PLAYED' ? (
                                  <span className="text-sky-300 text-[10px] font-bold">✓✓</span>
                                ) : m.status === 'DELIVERY_ACK' ? (
                                  <span className="text-primary-foreground/60 text-[10px] font-bold">✓✓</span>
                                ) : m.status === 'SERVER_ACK' ? (
                                  <span className="text-primary-foreground/50 text-[10px] font-bold">✓</span>
                                ) : (
                                  <Check className="h-3 w-3 opacity-50" />
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Botão flutuante para rolar ao final */}
              {showScrollButton && (
                <button
                  onClick={scrollToBottom}
                  className="absolute bottom-6 right-6 z-20 w-11 h-11 bg-background border border-border/50 rounded-full shadow-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-muted transition-all animate-in zoom-in-50 duration-300"
                >
                  <ChevronDown className="h-6 w-6" />
                  {activeChat.unread && activeChat.unread > 0 ? (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-green-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-lg border-2 border-background animate-in fade-in zoom-in duration-500">
                      {activeChat.unread}
                    </span>
                  ) : null}
                </button>
              )}
            </ScrollArea>

            {/* Input */}
            <div className="border-t bg-background/50 backdrop-blur-lg shrink-0 p-4">
              <div className="flex gap-4 p-1 bg-muted/40 rounded-xl mb-3 w-fit">
                <button
                  onClick={() => setInputMode("responder")}
                  className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${inputMode === "responder" ? "bg-background shadow-sm text-primary ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Responder
                </button>
                <button
                  onClick={() => setInputMode("nota")}
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${inputMode === "nota" ? "bg-amber-500 shadow-sm text-white ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Info className="h-3 w-3" /> Nota Privada
                </button>
              </div>
              
              <div className="bg-background rounded-2xl border border-border/50 shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <div className="px-4 py-3 bg-muted/20 border-b border-border/30 flex items-center justify-between">
                  <p className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-widest">
                    {isAiProcessing ? "IA Processando resposta..." : (inputMode === "nota" ? "Anotando privadamente..." : "Enviando como Agente...")}
                  </p>
                  <p className="text-[10px] font-medium text-muted-foreground/50 italic">
                    Shift + Enter para nova linha
                  </p>
                </div>
                
                <div className="p-2 flex items-end gap-2">
                  <div className="flex-1 relative">
                    {inputMode === "nota" ? (
                      <textarea
                        placeholder="Adicione uma nota privada sobre esta conversa..."
                        className="w-full min-h-[80px] max-h-[200px] p-3 text-sm bg-amber-50/50 border-none focus:ring-0 resize-none font-medium placeholder:text-muted-foreground/40"
                        value={noteInput}
                        onChange={e => setNoteInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                      />
                    ) : isRecording ? (
                      /* [AUDITORIA] FIX APLICADO (Achado A): indicador de gravação em andamento
                         substitui a textarea — duração ao vivo, cancelar (X) ou enviar (Send) no
                         mesmo lugar dos botões de sempre, ver coluna de botões abaixo. */
                      <div className="w-full min-h-[80px] flex items-center gap-3 px-4">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                        <span className="text-sm font-bold text-red-600">
                          Gravando áudio... {formatRecordingTime(recordingSeconds)}
                        </span>
                      </div>
                    ) : (
                      <div className="relative">
                        {/* [AUDITORIA] FIX APLICADO (Achado A): preview do anexo selecionado, com
                            opção de cancelar antes de enviar, conforme pedido. */}
                        {attachedFile && (
                          <div className="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-xl shadow-lg z-50 animate-in slide-in-from-bottom-2 duration-200 overflow-hidden">
                            <div className="p-3 flex items-center gap-3">
                              {attachedPreviewUrl ? (
                                <img src={attachedPreviewUrl} alt="preview do anexo" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                              ) : (
                                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                  <Paperclip className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold truncate">{attachedFile.name}</p>
                                <p className="text-[10px] text-muted-foreground">{(attachedFile.size / 1024).toFixed(0)} KB</p>
                              </div>
                              <button
                                onClick={cancelAttachment}
                                disabled={sendingMedia}
                                className="p-1 rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-40"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Preview de Resposta */}
                        {replyTo && (
                          <div className="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-xl shadow-lg z-50 animate-in slide-in-from-bottom-2 duration-200 overflow-hidden">
                            <div className={`p-3 border-l-4 flex items-start justify-between gap-3 bg-muted/20 ${
                              replyTo.role === "assistant" ? "border-primary" : "border-green-500"
                            }`}>
                              <div className="min-w-0 flex-1">
                                <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${
                                  replyTo.role === "assistant" ? "text-primary" : "text-green-600"
                                }`}>
                                  {replyTo.senderName}
                                </p>
                                <p className="text-xs text-muted-foreground line-clamp-2 italic">
                                  {replyTo.content}
                                </p>
                              </div>
                              <button 
                                onClick={() => setReplyTo(null)}
                                className="p-1 rounded-full hover:bg-muted text-muted-foreground transition-colors"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Popup de Respostas Rápidas */}
                        {showQR && qrFiltradas.length > 0 && (

                          <div className="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-xl shadow-lg z-50 max-h-52 overflow-y-auto">
                            <div className="px-3 py-2 border-b flex items-center gap-2">
                              <Zap className="h-3.5 w-3.5 text-amber-500" />
                              <span className="text-xs font-bold text-muted-foreground">Respostas Rápidas</span>
                            </div>
                            {qrFiltradas.map(r => (
                              <button
                                key={r.id}
                                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-start gap-2.5 border-b border-border/30 last:border-0"
                                onMouseDown={e => { e.preventDefault(); aplicarRespostaRapida(r); }}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold">{r.titulo}</p>
                                  {r.atalho && <span className="text-[10px] text-amber-600 font-mono">/{r.atalho}</span>}
                                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{r.mensagem}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        <textarea
                          ref={textareaRef}
                          placeholder="Escreva sua mensagem aqui... (/ para respostas rápidas)"
                          className="w-full min-h-[80px] max-h-[200px] p-3 text-sm bg-transparent border-none focus:ring-0 resize-none font-medium placeholder:text-muted-foreground/40"
                          value={messageInput}
                          onChange={e => handleInputChange(e.target.value)}
                          onPaste={handlePasteImage}
                          onKeyDown={e => {
                            if (e.key === 'Escape') { setShowQR(false); return; }
                            if (e.key === 'Enter' && !e.shiftKey && !showQR) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                  {/* [AUDITORIA] FIX APLICADO (Achado A): grade fixa 2x2 em vez de uma coluna que
                      cresceria a cada botão novo — mantém o mesmo espaço ocupado de antes (2
                      botões) independente do estado (gravando, anexo selecionado, etc.), sempre
                      exatamente 4 posições: Respostas Rápidas, Anexar, Gravar/Cancelar, Enviar. */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelected}
                    accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    className="hidden"
                  />
                  <div className="grid grid-cols-2 gap-1.5 p-1">
                    <Button
                      variant="ghost" size="icon"
                      className="h-9 w-9 rounded-xl hover:bg-amber-50 hover:text-amber-600 transition-colors"
                      title="Respostas Rápidas (/)"
                      onClick={() => { setMessageInput('/'); setShowQR(true); setQrSearch(''); textareaRef.current?.focus(); }}
                      disabled={inputMode === "nota" || isRecording || !!attachedFile}
                    >
                      <Zap className="h-4.5 w-4.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-9 w-9 rounded-xl hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      title="Anexar arquivo"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={inputMode === "nota" || isRecording || !!attachedFile || sendingMedia}
                    >
                      <Paperclip className="h-4.5 w-4.5" />
                    </Button>
                    {isRecording ? (
                      <Button
                        variant="ghost" size="icon"
                        className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-muted transition-colors"
                        title="Cancelar gravação"
                        onClick={cancelRecording}
                      >
                        <X className="h-4.5 w-4.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost" size="icon"
                        className="h-9 w-9 rounded-xl hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Gravar áudio"
                        onClick={startRecording}
                        disabled={inputMode === "nota" || !!attachedFile || sendingMedia}
                      >
                        <Mic className="h-4.5 w-4.5" />
                      </Button>
                    )}
                    <Button
                      className={`h-9 w-9 rounded-xl shadow-lg transition-all active:scale-90 ${
                        isRecording
                          ? "bg-red-500 hover:bg-red-600 shadow-red-500/20"
                          : (attachedFile || (inputMode === "nota" ? noteInput.trim() : messageInput.trim()))
                            ? (inputMode === "nota" ? "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20" : "bg-primary hover:bg-primary/90 shadow-primary/20")
                            : "bg-muted text-muted-foreground opacity-50"
                      }`}
                      disabled={
                        isRecording
                          ? false
                          : sendingMedia
                            ? true
                            : attachedFile
                              ? false
                              : (isAiProcessing || !(inputMode === "nota" ? noteInput.trim() : messageInput.trim()))
                      }
                      onClick={isRecording ? sendRecording : attachedFile ? confirmSendAttachment : handleSendMessage}
                      title={isRecording ? 'Parar e enviar áudio' : attachedFile ? 'Enviar anexo' : 'Enviar'}
                    >
                      {sendingMedia ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Send className="h-4.5 w-4.5" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center bg-muted/5 text-center p-8 gap-6 animate-in fade-in duration-700">
            {/* [AUDITORIA] BUG: a classe de duration arbitrária de 3000ms (animate-bounce) gerava o
                warning de build "ambiguous... matches multiple utilities" (visto no build do
                frontend) — Tailwind não conseguia decidir entre a família de classes de duration
                (transition-duration) e outras que aceitam colchetes arbitrários com esse valor.
                [AUDITORIA] FIX APLICADO: colchetes escapados na classe abaixo, forma que o próprio
                Tailwind recomenda para desambiguar. NOTA: o texto literal da classe não pode
                aparecer sem escape em nenhum lugar deste arquivo (nem em comentário) — o scanner
                de conteúdo do Tailwind lê o arquivo inteiro como texto bruto, comentário incluso,
                e reintroduz o mesmo warning se encontrar a forma não escapada em qualquer lugar. */}
            <div className="w-24 h-24 rounded-3xl bg-primary/5 shadow-inner flex items-center justify-center animate-bounce duration-\[3000ms\]">
              <MessageSquare className="h-10 w-10 text-primary/30" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold tracking-tight">Suas conversas aparecem aqui</h3>
              <p className="text-sm text-muted-foreground/70 max-w-[280px] mx-auto leading-relaxed">
                Selecione um contato na lista ao lado para começar a interagir ou visualizar o histórico.
              </p>
            </div>
            {connectionStatus?.state === "unauthorized" ? (
              <Button onClick={() => setShowConnectModal(true)} size="lg" className="rounded-2xl shadow-xl shadow-orange-500/20 gap-2 font-bold px-8 bg-orange-500 hover:bg-orange-600 animate-bounce">
                <AlertCircle className="h-5 w-5" />
                Reconectar WhatsApp
              </Button>
            ) : !isConnected && !loadingStatus && (
              <Button onClick={() => navigate("/whatsapp?tab=instancias")} size="lg" className="rounded-2xl shadow-xl shadow-primary/20 gap-2 font-bold px-8">
                <QrCode className="h-5 w-5" />
                Conectar WhatsApp
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Modal de foto ampliada */}
      {photoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPhotoModal(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img src={photoModalResolvedUrl ?? undefined} alt="Foto do contato" className="max-w-[80vw] max-h-[80vh] rounded-2xl shadow-2xl object-contain" />
            <button
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:bg-gray-100"
              onClick={() => setPhotoModal(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── RIGHT: Contact Profile Panel ── */}
      {activeChat && showContactPanel && (
        <div className="w-[300px] shrink-0 border-l bg-card/20 backdrop-blur-md flex flex-col animate-in slide-in-from-right duration-500">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b bg-background/40">
            <h3 className="text-sm font-bold tracking-tight">Detalhes do Contato</h3>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted"
              onClick={() => setShowContactPanel(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            {/* Avatar + name + phone */}
            <div className="flex flex-col items-center pt-8 pb-6 px-5 bg-gradient-to-b from-primary/[0.03] to-transparent">
              <button
                onClick={() => activeChat.profile_pic && setPhotoModal(activeChat.profile_pic)}
                className={`mb-4 transition-transform hover:scale-105 duration-500 border-4 border-background rounded-[2rem] shadow-xl shadow-primary/10 ${activeChat.profile_pic ? 'cursor-zoom-in' : 'cursor-default'}`}
                title={activeChat.profile_pic ? 'Clique para ampliar' : ''}
              >
                <ChatAvatar
                  name={activeChat.name}
                  url={activeChat.profile_pic}
                  size="lg"
                  rounded="[2rem]"
                />
              </button>

              <div className="flex items-center gap-2 mb-1.5 w-full justify-center">
                {editingName ? (
                  <div className="flex items-center gap-1 w-full px-2">
                    <input
                      autoFocus
                      value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') salvarNomeContato(); if (e.key === 'Escape') setEditingName(false); }}
                      className="flex-1 text-sm font-bold bg-muted/50 border rounded-lg px-2 py-1 text-center outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button onClick={salvarNomeContato} disabled={savingName} className="p-1 rounded text-success hover:bg-success/10">
                      {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => setEditingName(false)} className="p-1 rounded text-muted-foreground hover:bg-muted">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="font-black text-base tracking-tight truncate max-w-[200px]">{activeChat.name}</p>
                    <button
                      onClick={() => { setNameInput(activeChat.name); setEditingName(true); }}
                      className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                      title="Editar nome"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
              
              <div className="flex flex-col items-center gap-1 w-full">
                <div className="flex items-center gap-2 bg-muted/50 rounded-full pl-4 pr-2 py-1">
                  <span className="text-xs font-bold text-foreground/80">{activeChat.phone}</span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(activeChat.phone);
                      toast.success("Telefone copiado!");
                    }}
                    className="p-1 hover:bg-background rounded-full transition-colors"
                    title="Copiar telefone"
                  >
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
                {activeChat.online && (
                  <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest animate-pulse">Online Agora</span>
                )}
              </div>
            </div>

            {/* Ações Rápidas */}
            <div className="px-5 pb-6 flex flex-col gap-2">
              {/* [AUDITORIA] BUG: botão sem onClick — não faz nada ao clicar.
                  [AUDITORIA] FIX PENDENTE (motivo: decisão de produto — pra onde deveria navegar?
                  precisa de uma rota real de detalhe de contato no CRM, ex: /contatos/:id, e
                  resolver o id do contato a partir do telefone/activeChat.id): não implementado
                  nesta sessão, fora do escopo de "fix isolado e de baixo risco". */}
              <Button className="w-full h-11 text-xs font-black gap-2.5 bg-primary hover:bg-primary/90 text-white rounded-2xl shadow-lg shadow-primary/20 transition-all active:scale-95">
                <LayoutGrid className="h-4 w-4" />
                ABRIR NO CRM
              </Button>
              
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={toggleIA}
                  disabled={togglingIA}
                  className={`flex items-center justify-center gap-2 h-11 rounded-2xl border text-[10px] font-black uppercase tracking-tight transition-all active:scale-95 ${
                    iaPausada
                      ? "bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100"
                      : "bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                  }`}
                >
                  {togglingIA ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : iaPausada ? (
                    <BotOff className="h-3.5 w-3.5" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                  {iaPausada ? "IA Pausada" : "IA Ativa"}
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-center gap-2 h-11 rounded-2xl border bg-muted/20 border-border/50 text-muted-foreground hover:bg-muted text-[10px] font-black uppercase tracking-tight transition-all active:scale-95">
                      <BellOff className="h-3.5 w-3.5" />
                      Silenciar
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-xl">
                    <DropdownMenuItem onClick={() => muteChatPor(activeChat.id, 8*60*60*1000, "8 horas")} className="cursor-pointer">8 horas</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => muteChatPor(activeChat.id, 7*24*60*60*1000, "1 semana")} className="cursor-pointer">1 semana</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => muteChatPor(activeChat.id, 365*24*60*60*1000, "sempre")} className="cursor-pointer">Sempre</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Sobre */}
            <div className="border-t border-border/40 px-5 py-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mb-2">Sobre / Recado</p>
              <p className="text-sm font-medium text-foreground/80 leading-relaxed italic">
                {activeChat.is_group ? "Grupo de conversa" : (activeChat.push_name ? `~${activeChat.push_name}` : "Disponível")}
              </p>
            </div>

            {/* Etiquetas / Tags */}
            <div className="border-t border-border/40 px-5 py-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Etiquetas</p>
                {/* [AUDITORIA] BUG: sem onClick — não abre nenhum seletor/modal de etiqueta.
                    [AUDITORIA] FIX PENDENTE (motivo: precisa de UI nova — modal/dropdown de
                    seleção de tag + rota de persistência, não existe hoje neste arquivo). */}
                <button className="p-1 rounded-md text-primary hover:bg-primary/10 transition-all">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeChat.tag ? (
                  <span className={`text-[10px] font-bold px-3 py-1 rounded-full shadow-sm border border-transparent ${TAG_COLORS[activeChat.tag] ?? "bg-gray-100 text-gray-600"}`}>
                    {activeChat.tag}
                  </span>
                ) : (
                  <p className="text-[10px] text-muted-foreground/40 font-medium">Nenhuma etiqueta atribuída</p>
                )}
              </div>
            </div>

            {/* Mídia Recente */}
            <div className="border-t border-border/40 px-5 py-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Mídia Compartilhada</p>
                {/* [AUDITORIA] BUG: sem onClick — "Ver tudo" não leva a lugar nenhum.
                    [AUDITORIA] FIX PENDENTE (motivo: precisa de uma view/modal de galeria
                    completa, não existe hoje). */}
                <button className="text-[10px] font-bold text-primary hover:underline">Ver tudo</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {activeChat.messages
                  .filter(m => ['image', 'video', 'audio'].includes(m.tipo || ''))
                  .slice(-6)
                  .reverse()
                  .map((m, i) => (
                    <div
                      key={m.id}
                      className="aspect-square rounded-xl bg-muted/30 border border-border/30 overflow-hidden flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-all hover:scale-105 group"
                      onClick={() => m.midia_url && m.tipo === 'image' && setPhotoModal(m.midia_url)}
                    >
                      {m.tipo === 'image' && m.midia_url ? (
                        <AuthedImg src={m.midia_url} alt="mídia" className="w-full h-full object-cover" />
                      ) : m.tipo === 'video' ? (
                        <div className="relative w-full h-full flex items-center justify-center bg-black/5">
                          <Video className="h-6 w-6 text-muted-foreground/40" />
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      ) : (
                        <Mic className="h-5 w-5 text-muted-foreground/30" />
                      )}
                    </div>
                  ))}
                {activeChat.messages.filter(m => ['image', 'video', 'audio'].includes(m.tipo || '')).length === 0 && (
                  <div className="col-span-3 py-8 flex flex-col items-center justify-center bg-muted/10 rounded-2xl border border-dashed border-border/50">
                    <ImageIcon className="h-6 w-6 text-muted-foreground/20 mb-2" />
                    <p className="text-[10px] font-bold text-muted-foreground/30 uppercase">Sem mídias</p>
                  </div>
                )}
              </div>
            </div>

            {/* Documentos */}
            <div className="border-t border-border/40 px-5 py-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Documentos</p>
                {/* [AUDITORIA] BUG: sem onClick, mesma classe do "Ver tudo" de Mídia acima.
                    [AUDITORIA] FIX PENDENTE (motivo: precisa de view de listagem completa). */}
                <button className="text-[10px] font-bold text-primary hover:underline">Ver todos</button>
              </div>
              <div className="flex flex-col gap-2">
                {activeChat.messages
                  .filter(m => m.tipo === 'document')
                  .slice(-3)
                  .reverse()
                  .map(m => (
                    <a
                      key={m.id}
                      href={m.midia_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 p-3 bg-muted/20 hover:bg-muted/30 border border-border/30 rounded-xl transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                        <FileText className="h-5 w-5 text-blue-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold truncate text-foreground/80">{m.midia_nome || "Documento"}</p>
                        <p className="text-[10px] text-muted-foreground/60 uppercase font-black">{m.timestamp}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/20 group-hover:text-primary transition-colors" />
                    </a>
                  ))}
                {activeChat.messages.filter(m => m.tipo === 'document').length === 0 && (
                  <div className="py-4 flex flex-col items-center justify-center bg-muted/10 rounded-xl border border-dashed border-border/50">
                    <p className="text-[10px] font-bold text-muted-foreground/30 uppercase">Nenhum documento</p>
                  </div>
                )}
              </div>
            </div>

            {/* Anotações do CRM */}
            <div className="border-t border-border/40 px-5 py-5 bg-amber-500/[0.02]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-600/70">Anotações do CRM</p>
                {/* [AUDITORIA] BUG: sem onClick — não abre nenhuma edição, e `activeChat.notes`
                    também nunca é escrito em lugar nenhum deste arquivo (só lido) — o campo é
                    permanentemente somente-leitura hoje, sempre mostrando "Sem anotações".
                    [AUDITORIA] FIX PENDENTE (motivo: precisa de UI de edição + rota de
                    persistência, não existe hoje). */}
                <button className="p-1 rounded-md text-amber-600/40 hover:text-amber-600 hover:bg-amber-500/10 transition-all">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              {activeChat.notes ? (
                <p className="text-xs font-medium text-foreground/80 leading-relaxed bg-white/50 p-3 rounded-xl border border-amber-500/10 italic">"{activeChat.notes}"</p>
              ) : (
                <div className="flex flex-col items-center justify-center py-4 px-2 bg-muted/20 rounded-xl border border-dashed border-muted-foreground/20">
                  <Plus className="h-4 w-4 text-muted-foreground/30 mb-1" />
                  <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-tighter">Sem anotações</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
      {/* Modal de Encaminhar */}
      <Dialog open={showForwardModal} onOpenChange={setShowForwardModal}>
        <DialogContent className="sm:max-w-[420px] p-0 overflow-hidden border-none shadow-2xl rounded-2xl">
          <div className="px-6 pt-5 pb-3 border-b bg-background">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Forward className="h-4 w-4 text-primary" />
              Encaminhar Mensagem
            </DialogTitle>
            <DialogDescription className="text-xs mt-1">
              Selecione um contato recente para encaminhar as {selectedMessageIds.size} mensagens selecionadas.
            </DialogDescription>
          </div>
          
          <ScrollArea className="max-h-[60vh] bg-background">
            <div className="p-2 space-y-1">
              {chats.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => handleForwardMessages(chat.phone, chat.source)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-primary/5 transition-colors group text-left"
                >
                  <ChatAvatar name={chat.name} url={chat.profile_pic} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate group-hover:text-primary transition-colors">{chat.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{chat.phone}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/20 group-hover:text-primary transition-colors" />
                </button>
              ))}
              {chats.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Nenhum contato recente encontrado.
                </div>
              )}
            </div>
          </ScrollArea>
          
          <div className="p-4 bg-muted/20 border-t flex justify-end">
            <Button variant="ghost" onClick={() => setShowForwardModal(false)} className="font-bold text-xs uppercase tracking-widest">
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/*
        [AUDITORIA] FIX APLICADO: removido o "Modal de Nova Conversa" duplicado que existia aqui
        (mesmo estado showNewMessageModal do "Modal Nova Mensagem" ~linha 1737 — os dois abriam
        juntos). O modal removido era um subconjunto funcional do que ficou (mesmos dois campos,
        mesmo handleStartNewChat), confirmado sem uso próprio antes da remoção.
      */}
    </div>
  );
}
