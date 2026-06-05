import { useState, useMemo, useEffect, useRef, useCallback } from "react";
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
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
import { useAuth } from "@/hooks/useAuth";

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';
function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getAuthToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

type ChatTab = "todos" | "fila" | "meus";

type DeliveryStatus = "sent" | "SERVER_ACK" | "DELIVERY_ACK" | "READ" | "PLAYED" | "received" | string;

interface Message {
  id: string;
  message_id?: string;
  role: "user" | "assistant" | "note";
  content: string;
  timestamp: string;
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
  source?: string;
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

function ChatAvatar({
  name, url, size = 'md', rounded = '2xl', className = '',
}: {
  name: string; url?: string | null; size?: 'sm' | 'md' | 'lg'; rounded?: string; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const color = getAvatarColor(name);
  const initial = (name[0] || '?').toUpperCase();
  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-24 h-24 text-3xl' : 'w-12 h-12 text-sm';

  return (
    <div
      className={`${sizeClass} rounded-${rounded} overflow-hidden flex items-center justify-center font-black text-white shrink-0 relative ${className}`}
      style={{ backgroundColor: color }}
    >
      <span className="select-none">{initial}</span>
      {url && !failed && (
        <img
          src={url}
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

export function WhatsAppInterface() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserName = user?.display_name || user?.email?.split('@')[0] || 'Agente';
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ChatTab>("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [inputMode, setInputMode] = useState<"responder" | "nota">("responder");
  const [connectionStatus, setConnectionStatus] = useState<StatusResult | null>(null);
  const [qrData, setQrData] = useState<CreateInstanceResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
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
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [replyTo, setReplyTo] = useState<{ message_id: string; content: string; senderName: string; role: "user" | "assistant" } | null>(null);

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
      const res = await fetch(`${API_BASE}/api/respostas_rapidas`, { headers: apiHeaders() });
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
      const res = await fetch(`${API_BASE}/api/whatsapp/ia-status/${encodeURIComponent(phone)}`, { headers: apiHeaders() });
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
        headers: apiHeaders(),
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
      const res = await fetch(`${API_BASE}/api/whatsapp/contatos-search?q=${encodeURIComponent(q)}`, { headers: apiHeaders() });
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
        headers: apiHeaders(),
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
        headers: apiHeaders(),
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
        headers: apiHeaders(),
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

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  const filteredChats = useMemo(() =>
    chats.filter(c =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm)
    ),
    [chats, searchTerm]
  );

  const fetchConversas = async () => {
    try {
      console.log('[WA] fetchConversas iniciando...');
      const res = await fetch(`${API_BASE}/api/whatsapp/conversas`, { headers: apiHeaders() });
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
            unread: hasUnread ? 1 : 0,
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
      const res = await fetch(`${API_BASE}/api/whatsapp/conversas/${encodeURIComponent(phone)}?limit=100`, { headers: apiHeaders() });
      if (!res.ok) {
        console.warn('[WA] fetchMensagens falhou', phone, res.status, await res.text().catch(() => ''));
        return;
      }
      const rows: any[] = await res.json();
      console.log('[WA] fetchMensagens', phone, '— msgs recebidas:', rows.length);
      const msgs: Message[] = rows.map((m, i) => ({
        id: String(m.id || `msg-${i}`),
        message_id: m.message_id,
        role: (m.role || (m.from_me ? 'assistant' : 'user')) as 'user' | 'assistant',
        content: m.content || m.conteudo || '',
        timestamp: formatTime(m.timestamp_wa || m.created_at),
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
          content: m.quoted_message?.content || m.quoted_message?.conteudo || 'Mensagem original',
          senderName: m.quoted_message?.sender_name || (m.quoted_message?.from_me ? 'Você' : (m.push_name || chatName)),
          role: m.quoted_message?.from_me ? 'assistant' : 'user'
        } : undefined
      }));
      // Só atualiza se houver mudança real (evita re-render/flickering)
      setChats(prev => {
        const atual = prev.find(c => c.id === phone);
        const currentIds = atual?.messages.map(m => m.id + (m.status || '')) ?? [];
        const newIds     = msgs.map(m => m.id + (m.status || ''));
        if (JSON.stringify(currentIds) === JSON.stringify(newIds)) return prev;
        
        const prevLen = prev.find(c => c.id === phone)?.messages.length ?? 0;
        if (msgs.length > prevLen) {
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
        }

        const now = new Date().toISOString();
        return prev.map(c => c.id === phone 
          ? { 
              ...c, 
              messages: msgs, 
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

  const checkStatus = async (silent = true) => {
    try {
      const res = await fetchConnectionStatus();
      setConnectionStatus(res);
      if (res.state === "open") setQrData(null);
    } catch (e) {
      if (!silent) toast.error("Erro ao verificar status");
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleConnect = async () => {
    if (!instanceName.trim()) {
      toast.error("Informe um nome para a instância");
      return;
    }
    
    try {
      setConnecting(true);
      try { await disconnectInstance(); } catch {}
      const phoneDigits = instancePhone.replace(/\D/g, '');
      const res = await createInstance(instanceName, phoneDigits || undefined);
      setQrData(res);
      setShowConnectModal(false);
      setShowQrModal(true);
      setShowConnectModal(false);
      
      if (res.state === "open") {
        setConnectionStatus({ state: "open", phoneNumber: res.phoneNumber });
        toast.success("WhatsApp conectado!");
      } else if (res.qrCode) {
        toast.info("Escaneie o QR Code");
        // Copiar mensagem ao conectar (simulado aqui pois a conexão real é via QR)
        const messageToCopy = "Olá, acabei de conectar minha instância!";
        navigator.clipboard.writeText(messageToCopy).then(() => {
          toast.success("Mensagem de boas-vindas copiada!");
        });
      } else {
        toast.error("Evolution não retornou QR Code");
      }
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    checkStatus();
    fetchConversas();
    fetchRespostasRapidas();
  }, [fetchRespostasRapidas]);

  useEffect(() => {
    const tStatus = setInterval(checkStatus, 30000);
    return () => clearInterval(tStatus);
  }, []);

  useEffect(() => {
    const ms = activeChatId ? 2000 : 5000;
    const t = setInterval(fetchConversas, ms);
    return () => clearInterval(t);
  }, [activeChatId]);

  useEffect(() => {
    if (!messagesEndRef.current) return;
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsAtBottom(entry.isIntersecting);
        if (entry.isIntersecting) {
          setShowScrollButton(false);
        }
      },
      { threshold: 0.1 }
    );
    
    observer.observe(messagesEndRef.current);
    return () => observer.disconnect();
  }, [activeChatId]);

  const handleScroll = (e: any) => {
    // Para ScrollArea do Radix, o evento pode ser diferente, 
    // mas aqui estamos pegando o viewport interno se possível
    const target = e.target as HTMLDivElement;
    const isBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 150;
    setIsAtBottom(isBottom);
    setShowScrollButton(!isBottom);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };


  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId) return;
    const chat = chats.find(c => c.id === activeChatId);
    const chatName = chat?.name || activeChatId;
    activeChatNameRef.current = chatName;
    if (chat) fetchMensagens(activeChatId, chatName, true);
    fetchIaStatus(activeChatId);
    if (chat && !chat.profile_pic) fetchProfilePic(activeChatId);
    const tMsgs = setInterval(() => {
      const currentId = activeChatIdRef.current;
      if (!currentId) return;
      // Usa ref para evitar stale closure sobre chats
      fetchMensagens(currentId, activeChatNameRef.current, false);
    }, 3000);
    return () => clearInterval(tMsgs);
  }, [activeChatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChatId, chats]);

  const handleSendMessage = async () => {
    if (inputMode === "nota") {
      // Nota privada — salva internamente, não envia ao WhatsApp
      if (!noteInput.trim() || !activeChatId) return;
      toast.success("Nota salva internamente");
      setNoteInput("");
      return;
    }

    if (!messageInput.trim() || !activeChatId) return;

    const text = messageInput.trim();
    const currentReplyTo = replyTo; // Captura para o corpo do POST
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
      const res = await fetch(`${API_BASE}/api/whatsapp/send`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ 
          phone: activeChatId, 
          text, 
          instancia: chat?.source,
          replyToMessageId: currentReplyTo?.message_id
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Erro ao enviar' }));
        toast.error(err.message || 'Erro ao enviar mensagem');
        setChats(prev => prev.map(c =>
          c.id === activeChatId
            ? { ...c, messages: c.messages.filter(m => m.id !== tempId) }
            : c
        ));
      }
    } catch {
      toast.error('Sem conexão com o servidor');
      setChats(prev => prev.map(c =>
        c.id === activeChatId
          ? { ...c, messages: c.messages.filter(m => m.id !== tempId) }
          : c
      ));
    }
  };

  const handleCriarTarefaIA = async (conversaId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/kanban/tarefas/da-conversa`, {
        method: 'POST',
        headers: apiHeaders(),
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

  const isConnected = connectionStatus?.state === "open";

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
              {!isConnected && (
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
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>

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
          <div className="flex gap-1 p-1 bg-muted/40 rounded-lg">
            {(["Meus", "Fila", "Todos"] as const).map(t => {
              const key = t.toLowerCase() as ChatTab;
              const isActive = activeTab === key;
              return (
                <button
                  key={t}
                  onClick={() => setActiveTab(key)}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                    isActive
                      ? "bg-white shadow-sm text-primary ring-1 ring-black/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/50"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b bg-card/20">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              className="pl-9 h-10 bg-background/50 border-muted focus:bg-background focus:ring-primary/20 transition-all text-sm rounded-xl"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
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
              {searchTerm 
                ? "Nenhuma conversa encontrada para esta busca."
                : "Nenhuma mensagem recebida ainda. Quando clientes enviarem mensagens para seu WhatsApp, elas aparecerão aqui automaticamente."}
            </div>
          )}
          <div className="divide-y divide-border/50">
            {filteredChats.map(chat => {
              const isActive = activeChatId === chat.id;
              return (
                <div
                  key={chat.id}
                  onClick={() => {
                    setActiveChatId(chat.id);
                    lastOpenedRef.current.set(chat.phone, new Date().toISOString());
                  }}
                  className={`flex items-start gap-4 px-5 py-4 cursor-pointer transition-all relative group ${
                    isActive
                      ? "bg-primary/[0.04] after:absolute after:left-0 after:top-0 after:bottom-0 after:w-1 after:bg-primary"
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
                      <span className={`text-sm font-bold truncate ${isActive ? "text-primary" : chat.unread ? "text-green-700 dark:text-green-400" : "text-foreground"}`}>{chat.name}</span>
                      <span className="text-[10px] font-medium text-muted-foreground shrink-0 ml-2">{chat.timestamp}</span>
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
                    <p className={`text-xs truncate ${isActive ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}>{chat.lastMessage.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')}</p>
                  </div>
                  {chat.unread ? (
                    <div className="min-w-[20px] h-5 px-1.5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-black shadow-lg shadow-green-500/20 shrink-0 animate-in zoom-in">
                      {chat.unread}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* ── CENTER: Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/40">
        
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
                onClick={handleConnect}
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
                    const res = await createInstance(instanceName, phoneDigits || undefined);
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
            <div className="flex items-center justify-between px-6 py-4 border-b bg-background/40 backdrop-blur-md shrink-0 z-10 shadow-sm">
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
                    <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                  </div>
                  <p className="text-[11px] font-medium text-muted-foreground">
                    <span className="text-primary font-bold">✓ {activeChat.source ?? "CRM"}</span> · {activeChat.phone}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Toggle IA — não interfere no envio/recebimento de mensagens */}
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
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-muted transition-colors">
                  <Info className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea 
              className="flex-1 bg-muted/10 relative" 
              ref={scrollAreaRef}
              onScroll={handleScroll}
            >
              <div className="px-8 py-6 space-y-1 relative z-1">
                {loadingMessages && (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando mensagens...
                  </div>
                )}
                {activeChat.messages.map((m, i) => {
                  const isOut = m.role === "assistant";
                  const isNote = m.role === "note";
                  const prevMsg = i > 0 ? activeChat.messages[i - 1] : null;
                  const prevRole = prevMsg?.role ?? null;
                  
                  // Lógica de separador de data
                  const currentDate = new Date(m.timestamp);
                  const prevDate = prevMsg ? new Date(prevMsg.timestamp) : null;
                  
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
                    <div key={m.id}>
                      {dateLabel && (
                        <div className="flex justify-center my-6 sticky top-2 z-10">
                          <div className="bg-background/80 backdrop-blur-sm border border-border/50 px-4 py-1.5 rounded-full shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">
                              {dateLabel}
                            </span>
                          </div>
                        </div>
                      )}
                      <div className={`flex ${isOut ? "justify-end" : isNote ? "justify-center px-4" : "justify-start"} ${i > 0 && !isDifferentDay && activeChat.messages[i-1].role === m.role ? "mt-0.5" : "mt-4"}`}>
                        <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm relative animate-in slide-in-from-bottom-2 duration-300 ${
                          isOut
                            ? "bg-primary text-primary-foreground rounded-tr-none shadow-primary/10"
                            : isNote
                              ? "bg-amber-100/90 border border-amber-200 text-amber-900 w-full text-center rounded-xl shadow-none"
                              : "bg-background rounded-tl-none border border-border/50 shadow-black/[0.02]"
                        }`}>
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
                            <img src={m.midia_url} alt="imagem" className="rounded max-w-[220px] mb-1" />
                          ) : m.tipo === 'audio' ? (
                            m.midia_url
                              ? <AudioPlayer src={m.midia_url} />
                              : <div className="flex items-center gap-2 text-xs text-muted-foreground py-1"><Mic className="h-4 w-4" /> Áudio</div>
                          ) : m.tipo === 'video' && m.midia_url ? (
                            <video controls className="rounded max-w-[260px] mb-1" preload="metadata">
                              <source src={`${API_BASE}/api/whatsapp/media?url=${encodeURIComponent(m.midia_url)}`} type={m.midia_mime || 'video/mp4'} />
                            </video>
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
                            <img src={m.midia_url} alt="sticker" className="w-24 h-24 object-contain mb-1" />
                          ) : null}
                          {m.content && <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">{m.content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')}</p>}
                          <div className={`flex items-center justify-end gap-1.5 mt-1.5 ${isOut ? "text-primary-foreground/70" : isNote ? "text-amber-700/60" : "text-muted-foreground/60"}`}>
                            <span className="text-[10px] font-bold">{formatTime(m.timestamp)}</span>
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
                    {inputMode === "nota" ? "Anotando privadamente..." : "Enviando como Agente..."}
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
                    ) : (
                      <div className="relative">
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
                  <div className="flex flex-col gap-2 p-1">
                    <Button
                      variant="ghost" size="icon"
                      className="h-9 w-9 rounded-xl hover:bg-amber-50 hover:text-amber-600 transition-colors"
                      title="Respostas Rápidas (/)"
                      onClick={() => { setMessageInput('/'); setShowQR(true); setQrSearch(''); textareaRef.current?.focus(); }}
                    >
                      <Zap className="h-4.5 w-4.5" />
                    </Button>
                    <Button
                      className={`h-9 w-9 rounded-xl shadow-lg transition-all active:scale-90 ${
                        (inputMode === "nota" ? noteInput.trim() : messageInput.trim())
                          ? (inputMode === "nota" ? "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20" : "bg-primary hover:bg-primary/90 shadow-primary/20")
                          : "bg-muted text-muted-foreground opacity-50"
                      }`}
                      disabled={!(inputMode === "nota" ? noteInput.trim() : messageInput.trim())}
                      onClick={handleSendMessage}
                    >
                      <Send className="h-4.5 w-4.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center bg-muted/5 text-center p-8 gap-6 animate-in fade-in duration-700">
            <div className="w-24 h-24 rounded-3xl bg-primary/5 shadow-inner flex items-center justify-center animate-bounce duration-[3000ms]">
              <MessageSquare className="h-10 w-10 text-primary/30" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold tracking-tight">Suas conversas aparecem aqui</h3>
              <p className="text-sm text-muted-foreground/70 max-w-[280px] mx-auto leading-relaxed">
                Selecione um contato na lista ao lado para começar a interagir ou visualizar o histórico.
              </p>
            </div>
            {!isConnected && !loadingStatus && (
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
            <img src={photoModal} alt="Foto do contato" className="max-w-[80vw] max-h-[80vh] rounded-2xl shadow-2xl object-contain" />
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
      {activeChat && (
        <div className="w-[300px] shrink-0 border-l bg-card/20 backdrop-blur-md flex flex-col animate-in slide-in-from-right duration-500">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b bg-background/40">
            <h3 className="text-sm font-bold tracking-tight">Detalhes do Contato</h3>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted"
              onClick={() => setActiveChatId(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            {/* Avatar + name + phone */}
            <div className="flex flex-col items-center pt-8 pb-6 px-5 bg-gradient-to-b from-primary/[0.03] to-transparent">
              {/* Avatar clicável para ampliar */}
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

              {/* Nome editável */}
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
                    <p className="font-black text-base tracking-tight">{activeChat.name}</p>
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
              <div className="bg-muted/50 rounded-full px-4 py-1 flex flex-col items-center">
                <p className="text-[9px] text-muted-foreground/60 uppercase font-black tracking-[0.15em] mb-0.5">
                  WhatsApp Principal
                </p>
                <p className="text-xs font-bold text-foreground/80 leading-none pb-0.5">{activeChat.phone}</p>
              </div>
            </div>

            {/* CRM Button */}
            <div className="px-5 pb-6">
              <Button className="w-full h-11 text-xs font-black gap-2.5 bg-primary hover:bg-primary/90 text-white rounded-2xl shadow-lg shadow-primary/20 transition-all active:scale-95">
                <LayoutGrid className="h-4 w-4" />
                ABRIR NO CRM
              </Button>
            </div>

            {/* Mídia, Links e Docs */}
            <div className="border-t border-border/40 px-5 py-5">
            <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Mídia Recente</p>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div
                    key={i}
                    className="aspect-square rounded-xl bg-primary/5 flex items-center justify-center cursor-pointer hover:bg-primary/10 border border-primary/5 transition-all hover:scale-105"
                  >
                    <Mic className="h-5 w-5 text-primary/40" />
                  </div>
                ))}
              </div>
            </div>

            {/* Observações do CRM */}
            <div className="border-t border-border/40 px-5 py-5 bg-amber-500/[0.02]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-black uppercase tracking-widest text-amber-600/70">Anotações do CRM</p>
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

            {/* Cofre de Documentos */}
            <div className="border-t border-border/40 px-5 py-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Documentos</p>
                <button className="p-1 rounded-md text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-all">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="bg-muted/10 border border-dashed border-border p-4 rounded-xl flex flex-col items-center">
                <Plus className="h-4 w-4 text-muted-foreground/20 mb-1" />
                <p className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-tighter">Adicionar Arquivo</p>
              </div>
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
