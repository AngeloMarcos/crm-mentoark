import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Eye,
  EyeOff,
  Plug,
  MessageCircle,
  Brain,
  Database,
  Webhook,
  Cpu,
  Mic,
  Video,
  Wrench,
  Sparkles,
  Headset,
  Zap,
  Star,
  Heart,
  ShoppingCart,
  Check,
  Send,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

// [AUDITORIA] LÓGICA: página de CRUD de `agentes` (personalidade/modelo/RAG/MCP tools).
// O campo evolution_instancia aqui é só um "rótulo" de qual instância este agente
// usa — URL/API Key reais ficam centralizadas em Conectores (Integracoes.tsx). Esse
// mesmo campo evolution_instancia também existe em agent_configs (ver
// backend/src/routes/integracoes.ts syncEvolution()) — duas tabelas guardando o
// mesmo dado, sem sincronização automática entre si, é a causa do tipo de divergência
// já documentada em AUDITORIA_LOG.md (agent_configs desalinhado com agentes/
// integracoes_config para um usuário específico).
interface Agente {
  id: string;
  user_id: string;
  nome: string;
  descricao: string | null;
  persona: string | null;
  tom: string;
  idioma?: string;
  objetivo: string | null;
  mensagem_boas_vindas: string | null;
  regras: string | null;
  modelo: string;
  temperatura: number;
  max_tokens: number;
  evolution_instancia: string | null;
  evolution_api_key: string | null;
  evolution_server_url: string | null;
  n8n_webhook_url: string | null;
  rag_ativo: boolean | null;
  rag_threshold: number | null;
  rag_resultados: number | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  // Motor de IA nativo (novo)
  provider?: string | null;
  modelo_id?: string | null;
  modalidade_audio?: boolean | null;
  modalidade_imagem?: boolean | null;
  modalidade_video?: boolean | null;
  mcp_tools?: string[] | null;
  // Config unificada (Sprint 1 — antes vivia em agent_configs, tabela hoje aposentada)
  prompt_sistema?: string | null;
  saudacao_inicial?: string | null;
  bloco_qualificacao?: string | null;
  mensagem_encaminhamento?: string | null;
  mensagem_encerramento?: string | null;
  palavra_reativar?: string | null;
  sinal_pausa?: string | null;
  tempo_espera_mensagem?: number | null;
  tempo_espera_resposta?: number | null;
  grupo_notificacao?: string | null;
  // Perfil/Configurações avançadas (Sprint Agentes Configurações Avançadas, 2026-09-04)
  icone?: string | null;
  cor?: string | null;
  esforco_raciocinio?: string | null;
  tier_servico?: string | null;
  max_tokens_prompt_sistema?: number | null;
  limite_passos?: number | null;
  fallback_transcricao_falha?: string | null;
}

// Ícones fixos pra identidade visual do agente (renderizado na listagem, `AgenteIcone` abaixo) —
// conjunto pequeno de propósito, não é um picker de biblioteca inteira.
export const AGENTE_ICONES: Record<string, typeof Bot> = {
  bot: Bot,
  sparkles: Sparkles,
  message: MessageCircle,
  headset: Headset,
  zap: Zap,
  star: Star,
  heart: Heart,
  cart: ShoppingCart,
};

// Paleta fixa — mesmas cores já usadas nos badges/status do resto do app (ver TAG_COLORS em
// outras telas), só como ponto de partida coerente com o resto da UI.
export const AGENTE_CORES = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];

// [AUDITORIA] BUG CORRIGIDO (achado 2026-09-04, ao mover Provedor/Modelo pra aba Perfil): `agentes`
// não tem coluna `provider` nem `modelo_id` de verdade (`stripFields` em index.ts descarta os
// dois — só `modelo`, texto livre, é persistido) — `abrirEditar()` fazia `a.provider ?? "claude"`,
// que SEMPRE caía no default "claude" (o campo nunca vem preenchido de volta pela API, já que não
// existe), não importa qual provedor o agente realmente usa. Pra um agente configurado com um
// modelo OpenAI (ou qualquer um fora da lista curada de `PROVIDERS`, ex: um `gpt-4.1-mini`
// apontado direto no banco — caso real confirmado em produção, agente "Stella"), reabrir pra
// editar mostrava "Claude (Anthropic)" errado; se o operador salvasse qualquer outra coisa sem
// notar, o modelo real seria substituído pelo primeiro modelo Claude da lista, silenciosamente.
// [AUDITORIA] FIX APLICADO: infere o provedor a partir do `modelo` de verdade — primeiro tenta
// achar o id exato na lista curada; se não achar (modelo "solto", fora da lista), cai num
// heurístico por prefixo do nome do modelo, cobrindo o caso real acima.
function inferirProvider(modelo?: string | null): string {
  if (!modelo) return "claude";
  const exato = PROVIDERS.find((p) => p.modelos.some((m) => m.id === modelo));
  if (exato) return exato.id;
  if (/^(gpt-|o1|o3|o4)/i.test(modelo)) return "openai";
  if (/^claude/i.test(modelo)) return "claude";
  if (/^gemini/i.test(modelo)) return "gemini";
  return "claude";
}

const iconeDoAgente = (icone?: string | null) => (icone && AGENTE_ICONES[icone]) || Bot;
// bg em ~15% de opacidade da cor escolhida (mesmo padrão visual do `bg-primary/15` já usado no
// resto desta tela) — cai pro estilo default (classe `bg-primary/…`) quando o agente não tem cor.
const estiloIconeAgente = (cor?: string | null) => (cor ? { backgroundColor: `${cor}26`, color: cor } : undefined);

// Um passo do loop agêntico dentro de uma execução (ver `traceLoop` em agentEngine.ts) — resumo,
// não o payload bruto da API.
interface TracePasso {
  iter: number;
  texto: string | null;
  toolCalls: { nome: string; input: Record<string, unknown> }[];
  toolResultados?: (string | null)[];
  finishReason?: string;
}

// Uma linha de `agente_execucoes` (ver migrations.ts) — uma chamada real de IA completa (turno
// inteiro do loop agêntico, sucesso ou erro), não cada iteração individual do loop.
interface Execucao {
  id: string;
  trigger_origem: "sistema" | "playground";
  status: "sucesso" | "erro";
  modelo: string | null;
  latencia_ms: number | null;
  tokens_entrada: number;
  tokens_saida: number;
  custo_usd: number;
  entrada_texto: string | null;
  saida_texto: string | null;
  erro_msg: string | null;
  trace: TracePasso[];
  created_at: string;
}

// Resposta de POST /api/agentes/:id/testar (ver `testarAgentePlayground`, agentEngine.ts).
interface ResultadoTeste {
  resposta: string;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
  latenciaMs: number;
  modelo: string;
  trace: TracePasso[];
  erro?: string;
}

const TONS = ["profissional", "amigável", "consultivo", "formal", "descontraído"];

// Motor nativo — providers e modelos disponíveis
export const PROVIDERS = [
  {
    id: "claude",
    label: "Claude (Anthropic)",
    modelos: [
      { id: "claude-3-5-haiku-latest",  label: "Haiku — rápido e barato",  custo: "~$0.0002/msg" },
      { id: "claude-3-5-sonnet-latest", label: "Sonnet — balanceado",      custo: "~$0.003/msg"  },
      { id: "claude-3-opus-latest",     label: "Opus — máxima qualidade",  custo: "~$0.015/msg"  },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    modelos: [
      { id: "gpt-4o",      label: "GPT-4o — multimodal",  custo: "~$0.005/msg"  },
      { id: "gpt-4o-mini", label: "GPT-4o mini — barato", custo: "~$0.0001/msg" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    modelos: [
      { id: "gemini-1.5-flash", label: "Flash — ultra barato", custo: "~$0.00004/msg" },
      { id: "gemini-1.5-pro",   label: "Pro — qualidade",      custo: "~$0.001/msg"   },
    ],
  },
] as const;

// [AUDITORIA] FIX APLICADO (Sprint 1 unificação, 2026-08-07): esta lista tinha vários ids que
// não correspondem a NENHUMA tool real do backend (`criar_contato`, `buscar_leads`, `criar_lead`,
// `atualizar_lead`, `buscar_agendamentos`, `registrar_pausa_ia`) e faltavam 3 tools reais
// (`consultar_faq`, `buscar_documentos`, `criar_corrida`) — os toggles nunca bateram com o que a
// IA de fato pode chamar. Lista abaixo agora espelha exatamente `backend/src/services/mcp/tools.ts`
// (MCP_TOOLS.map(t => t.name)) — mantenha as duas em sincronia manualmente se uma tool for
// adicionada/removida lá.
export const MCP_TOOLS = [
  { id: "buscar_contato",              label: "Buscar contato"              },
  { id: "criar_ou_atualizar_contato",  label: "Criar/atualizar contato"     },
  { id: "buscar_historico",            label: "Buscar histórico"            },
  { id: "registrar_pausa",             label: "Pausar IA p/ humano"         },
  { id: "buscar_produtos",             label: "Buscar produtos"             },
  { id: "criar_agendamento",           label: "Criar agendamento"           },
  { id: "consultar_faq",               label: "Consultar FAQ"               },
  { id: "buscar_documentos",           label: "Buscar documentos (RAG)"     },
  { id: "criar_corrida",               label: "Criar corrida"               },
];

const MCP_TOOLS_DEFAULT = MCP_TOOLS.map((t) => t.id);

const formInicial = {
  nome: "",
  descricao: "",
  persona: "",
  tom: "profissional",
  idioma: "Português BR",
  objetivo: "",
  mensagem_boas_vindas: "",
  regras: "",
  modelo: "gpt-4o-mini",
  temperatura: 0.7,
  max_tokens: 1000,
  evolution_server_url: "",
  evolution_api_key: "",
  evolution_instancia: "",
  n8n_webhook_url: "",
  rag_ativo: true,
  rag_threshold: 0.7,
  rag_resultados: 5,
  ativo: true,
  // Motor nativo
  provider: "claude",
  modelo_id: "claude-3-5-sonnet-latest",
  modalidade_audio: true,
  modalidade_imagem: true,
  modalidade_video: false,
  mcp_tools: MCP_TOOLS_DEFAULT as string[],
  // Config unificada (Sprint 1)
  prompt_sistema: "",
  saudacao_inicial: "",
  bloco_qualificacao: "",
  mensagem_encaminhamento: "",
  mensagem_encerramento: "",
  palavra_reativar: "atendimento finalizado",
  sinal_pausa: "251213",
  tempo_espera_mensagem: 3,
  tempo_espera_resposta: 0,
  grupo_notificacao: "",
  // Perfil/Configurações avançadas
  icone: "bot",
  cor: AGENTE_CORES[0],
  esforco_raciocinio: "",
  tier_servico: "auto",
  max_tokens_prompt_sistema: 40000,
  limite_passos: 5,
  fallback_transcricao_falha: "",
};

function formatarData(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AgentesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Agente | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [showKey, setShowKey] = useState(false);
  // Aba "Execuções" (Sprint Agentes Configurações Avançadas — fase 2, 2026-09-04)
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [loadingExecucoes, setLoadingExecucoes] = useState(false);
  const [traceAberto, setTraceAberto] = useState<Execucao | null>(null);
  // Aba "Teste" (playground — mesma fase)
  const [chatTeste, setChatTeste] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [mensagemTeste, setMensagemTeste] = useState("");
  const [enviandoTeste, setEnviandoTeste] = useState(false);
  const [ultimaMetricaTeste, setUltimaMetricaTeste] = useState<ResultadoTeste | null>(null);
  const [form, setForm] = useState(formInicial);

  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await api
      .from("agentes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Erro ao carregar agentes: ${error.message}`);
    } else {
      setAgentes((data ?? []) as Agente[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const abrirCriar = () => {
    setEditing(null);
    setForm(formInicial);
    setShowKey(false);
    setExecucoes([]); // agente diferente (ou nenhum ainda) — não reaproveita execuções de outro
    setChatTeste([]);
    setUltimaMetricaTeste(null);
    setModal(true);
  };

  const abrirEditar = (a: Agente) => {
    setEditing(a);
    setExecucoes([]); // idem — busca de novo (lazy, ver onValueChange do Tabs) pra ESTE agente
    setChatTeste([]);
    setUltimaMetricaTeste(null);
    setForm({
      nome: a.nome,
      descricao: a.descricao ?? "",
      persona: a.persona ?? "",
      tom: a.tom,
      idioma: a.idioma ?? "Português BR",
      objetivo: a.objetivo ?? "",
      mensagem_boas_vindas: a.mensagem_boas_vindas ?? "",
      regras: a.regras ?? "",
      modelo: a.modelo,
      temperatura: Number(a.temperatura),
      max_tokens: a.max_tokens,
      evolution_server_url: a.evolution_server_url ?? "",
      evolution_api_key: a.evolution_api_key ?? "",
      evolution_instancia: a.evolution_instancia ?? "",
      n8n_webhook_url: a.n8n_webhook_url ?? "",
      rag_ativo: a.rag_ativo ?? true,
      rag_threshold: a.rag_threshold ?? 0.7,
      rag_resultados: a.rag_resultados ?? 5,
      ativo: a.ativo,
      provider: a.provider ?? inferirProvider(a.modelo),
      modelo_id: a.modelo_id ?? a.modelo ?? "claude-3-5-sonnet-latest",
      modalidade_audio: a.modalidade_audio ?? true,
      modalidade_imagem: a.modalidade_imagem ?? true,
      modalidade_video: a.modalidade_video ?? false,
      mcp_tools: a.mcp_tools ?? MCP_TOOLS_DEFAULT,
      prompt_sistema: a.prompt_sistema ?? "",
      saudacao_inicial: a.saudacao_inicial ?? "",
      bloco_qualificacao: a.bloco_qualificacao ?? "",
      mensagem_encaminhamento: a.mensagem_encaminhamento ?? "",
      mensagem_encerramento: a.mensagem_encerramento ?? "",
      palavra_reativar: a.palavra_reativar ?? "atendimento finalizado",
      sinal_pausa: a.sinal_pausa ?? "251213",
      tempo_espera_mensagem: a.tempo_espera_mensagem ?? 3,
      tempo_espera_resposta: a.tempo_espera_resposta ?? 0,
      grupo_notificacao: a.grupo_notificacao ?? "",
      icone: a.icone ?? "bot",
      cor: a.cor ?? AGENTE_CORES[0],
      esforco_raciocinio: a.esforco_raciocinio ?? "",
      tier_servico: a.tier_servico ?? "auto",
      max_tokens_prompt_sistema: a.max_tokens_prompt_sistema ?? 40000,
      limite_passos: a.limite_passos ?? 5,
      fallback_transcricao_falha: a.fallback_transcricao_falha ?? "",
    });
    setShowKey(false);
    setModal(true);
  };

  const salvar = async () => {
    if (!user) return;
    if (!form.nome.trim()) {
      toast.error("Informe o nome do agente.");
      return;
    }
    // [AUDITORIA] LÓGICA (guard-rail do incidente "Cris", preservado na unificação — mesma regra
    // que existia em ConfigAgenteIA.tsx): não deixa ativar um agente sem prompt real. Sem isso,
    // agentEngine.ts simplesmente não responde (outro guard, no backend) — mas é melhor travar
    // aqui, na hora de salvar, do que deixar o operador achar que ativou e a IA ficar muda.
    if (form.ativo && !form.prompt_sistema.trim()) {
      toast.error("Este agente está marcado como ativo mas não tem Prompt do Sistema — a IA não vai responder. Preencha o prompt ou desative o agente.");
      return;
    }
    setSalvando(true);
    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      persona: form.persona.trim() || null,
      tom: form.tom,
      idioma: form.idioma,
      objetivo: form.objetivo.trim() || null,
      mensagem_boas_vindas: form.mensagem_boas_vindas.trim() || null,
      regras: form.regras.trim() || null,
      modelo: form.modelo_id || form.modelo,
      temperatura: form.temperatura,
      max_tokens: form.max_tokens,
      evolution_server_url: form.evolution_server_url.trim() || null,
      evolution_api_key: form.evolution_api_key.trim() || null,
      evolution_instancia: form.evolution_instancia.trim() || null,
      n8n_webhook_url: form.n8n_webhook_url.trim() || null,
      rag_ativo: form.rag_ativo,
      rag_threshold: form.rag_threshold,
      rag_resultados: form.rag_resultados,
      ativo: form.ativo,
      // Motor nativo
      provider: form.provider,
      modelo_id: form.modelo_id,
      modalidade_audio: form.modalidade_audio,
      modalidade_imagem: form.modalidade_imagem,
      modalidade_video: form.modalidade_video,
      mcp_tools: form.mcp_tools,
      // Config unificada (Sprint 1 — antes vivia em agent_configs)
      prompt_sistema: form.prompt_sistema.trim() || null,
      saudacao_inicial: form.saudacao_inicial.trim() || null,
      bloco_qualificacao: form.bloco_qualificacao.trim() || null,
      mensagem_encaminhamento: form.mensagem_encaminhamento.trim() || null,
      mensagem_encerramento: form.mensagem_encerramento.trim() || null,
      palavra_reativar: form.palavra_reativar.trim() || "atendimento finalizado",
      sinal_pausa: form.sinal_pausa.trim() || "251213",
      tempo_espera_mensagem: form.tempo_espera_mensagem,
      tempo_espera_resposta: form.tempo_espera_resposta,
      grupo_notificacao: form.grupo_notificacao.trim() || null,
      // Perfil/Configurações avançadas (Sprint Agentes Configurações Avançadas, 2026-09-04)
      icone: form.icone || null,
      cor: form.cor || null,
      esforco_raciocinio: form.esforco_raciocinio || null,
      tier_servico: form.tier_servico || null,
      max_tokens_prompt_sistema: form.max_tokens_prompt_sistema || null,
      limite_passos: form.limite_passos || null,
      fallback_transcricao_falha: form.fallback_transcricao_falha.trim() || null,
    };

    if (editing) {
      const { error } = await api
        .from("agentes")
        .update(payload)
        .eq("id", editing.id);
      setSalvando(false);
      if (error) {
        toast.error(`Erro ao salvar: ${error.message}`);
        return;
      }
      toast.success("✅ Agente salvo!");
    } else {
      const { error } = await api
        .from("agentes")
        .insert([{ ...payload, user_id: user.id }]);
      setSalvando(false);
      if (error) {
        toast.error(`Erro ao criar: ${error.message}`);
        return;
      }
      toast.success("✅ Agente criado!");
    }
    setModal(false);
    setEditing(null);
    setForm(formInicial);
    carregar();
  };

  const remover = async (a: Agente) => {
    if (!confirm(`Remover o agente "${a.nome}"?`)) return;
    const { error } = await api.from("agentes").delete().eq("id", a.id);
    if (error) {
      toast.error(`Erro ao remover: ${error.message}`);
      return;
    }
    toast.success("Agente removido");
    carregar();
  };

  // [AUDITORIA] BUG: testarEvolution() exige que form.evolution_instancia esteja
  // preenchido (linha abaixo), mas NUNCA envia esse valor pro backend — GET
  // /api/whatsapp/status não recebe instancia como parâmetro, então o backend
  // resolve e retorna o status de QUALQUER instância que ele conseguir achar pro
  // userId (via a mesma cadeia de fallback agent_configs → agentes →
  // [AUDITORIA] BUG (achado na Sprint Diagnóstico Config Conta IA+Disparo, 2026-07-31):
  // confirmado ao vivo (curl) que esta função sempre falhava — mandava `fetch()` sem
  // `method`, ou seja GET, mas `/api/whatsapp/status` só existe como `router.post(...)`
  // no backend (whatsapp.ts). Resultado: 404 GARANTIDO em toda chamada, então o botão
  // SEMPRE mostrava "❌ Falha na conexão", mesmo com a instância genuinamente conectada
  // — o oposto do falso positivo que a nota antiga (abaixo) descrevia, e pior: falso
  // negativo permanente. [AUDITORIA] FIX APLICADO: troca pra POST + Content-Type, e
  // aproveita que o backend JÁ aceita `instancia` no body com checagem de ownership
  // (whatsapp.ts, achado 2026-07-22) pra resolver de vez a nota antiga também — testa a
  // instância ESPECÍFICA deste agente, não mais "qualquer instância que o backend
  // resolver primeiro pro usuário". Sucesso agora é decidido por `data.state === 'open'`
  // (a rota sempre responde 200 com o estado real, não só pelo HTTP status).
  const testarEvolution = async () => {
    if (!form.evolution_instancia) {
      toast.error("Informe o nome da instância antes de testar.");
      return;
    }
    setTestando(true);
    try {
      const token = localStorage.getItem("crm_access_token");
      const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
      const res = await fetch(`${API_URL}/api/whatsapp/status`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ instancia: form.evolution_instancia }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.state === "open") {
        toast.success(`✅ Evolution conectada — instância: ${data.instancia ?? form.evolution_instancia}`);
      } else {
        toast.error(`❌ Instância desconectada (${data.state ?? "erro"}) — ${data.message ?? "reconecte em Conectores"}`);
      }
    } catch (e: any) {
      toast.error(`❌ Erro: ${e?.message ?? "sem resposta do servidor"}`);
    } finally {
      setTestando(false);
    }
  };

  // [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas — fase 2, 2026-09-04): busca
  // sob demanda (só quando a aba "Execuções" é aberta, ver `onValueChange` do Tabs abaixo) —
  // agente ainda não salvo (`editing` null) não tem `id`, não tem o que buscar.
  const carregarExecucoes = async () => {
    if (!editing) return;
    setLoadingExecucoes(true);
    try {
      const token = localStorage.getItem("crm_access_token");
      const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
      const res = await fetch(`${API_URL}/api/agentes/${editing.id}/execucoes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setExecucoes(await res.json());
    } catch {
      // falha na busca não trava a tela — operador pode tentar de novo trocando de aba
    } finally {
      setLoadingExecucoes(false);
    }
  };

  // [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas — fase 2, 2026-09-04): manda o
  // HISTÓRICO inteiro da conversa de teste a cada mensagem (não só a última) — o backend
  // (`testarAgentePlayground`) não guarda estado de sessão nenhum entre chamadas, cada POST é
  // isolado; sem reenviar o histórico, o agente "esqueceria" tudo a cada mensagem nova no chat de
  // teste.
  const enviarMensagemTeste = async () => {
    if (!editing || !mensagemTeste.trim() || enviandoTeste) return;
    const novoHistorico = [...chatTeste, { role: "user" as const, content: mensagemTeste.trim() }];
    setChatTeste(novoHistorico);
    setMensagemTeste("");
    setEnviandoTeste(true);
    try {
      const token = localStorage.getItem("crm_access_token");
      const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
      const res = await fetch(`${API_URL}/api/agentes/${editing.id}/testar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ historico: novoHistorico }),
      });
      const data: ResultadoTeste = await res.json();
      if (!res.ok || data.erro) {
        toast.error(data.erro || "Erro ao testar o agente.");
        setChatTeste(novoHistorico); // mantém a mensagem do operador visível mesmo sem resposta
        return;
      }
      setChatTeste([...novoHistorico, { role: "assistant", content: data.resposta || "(sem resposta de texto — só ação de ferramenta)" }]);
      setUltimaMetricaTeste(data);
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? "sem resposta do servidor"}`);
    } finally {
      setEnviandoTeste(false);
    }
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Agentes</h1>
              <p className="text-muted-foreground text-sm">
                Gerencie seus agentes de atendimento
              </p>
            </div>
          </div>
          <Button onClick={abrirCriar}>
            <Plus className="h-4 w-4" /> Novo Agente
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : agentes.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center text-center py-12 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <Bot className="h-7 w-7" />
              </div>
              <div>
                <p className="font-semibold">Nenhum agente criado ainda</p>
                <p className="text-sm text-muted-foreground">
                  Crie seu primeiro agente de atendimento para começar.
                </p>
              </div>
              <Button onClick={abrirCriar}>Criar primeiro agente</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agentes.map((a) => (
              <Card
                key={a.id}
                className="hover:border-primary/30 transition-colors"
              >
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${a.cor ? "" : "bg-primary/10 text-primary"}`}
                      style={estiloIconeAgente(a.cor)}
                    >
                      {(() => { const Icon = iconeDoAgente(a.icone); return <Icon className="h-6 w-6" />; })()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{a.nome}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {a.descricao || "Sem descrição"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-xs">
                      {a.modelo}
                    </Badge>
                    <Badge
                      className={`text-xs border-0 ${
                        a.ativo
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {a.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                    {a.n8n_webhook_url && (
                      <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 text-xs">
                        Via n8n
                      </Badge>
                    )}
                    {!a.n8n_webhook_url && (
                      <Badge variant="outline" className="text-gray-500 text-xs">
                        IA Interna
                      </Badge>
                    )}
                  </div>


                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => abrirEditar(a)}
                    >
                      <Pencil className="h-4 w-4" /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remover(a)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* [AUDITORIA] LÓGICA: Sheet lateral em vez de Dialog centralizado — mesmo padrão já
          aplicado em kanban/ModalTarefa e InstanceManagementPanel ("Configurar Instância").
          Com 10 abas e ~100 campos, um Dialog centralizado arrisca perder preenchimento com um
          clique fora sem querer; o Sheet não fecha em onInteractOutside e mantém o rodapé
          (Cancelar/Salvar) sempre visível, sem depender de rolar até o fim. */}
      <Sheet
        open={modal}
        onOpenChange={(o) => {
          setModal(o);
          if (!o) {
            setEditing(null);
            setForm(formInicial);
          }
        }}
      >
        <SheetContent
          side="right"
          onInteractOutside={(e) => e.preventDefault()}
          className="w-full sm:max-w-3xl flex flex-col p-0 gap-0"
        >
          <SheetHeader className="p-6 pb-4 border-b text-left">
            <SheetTitle>
              {editing ? "Editar agente" : "Novo agente"}
            </SheetTitle>
            <SheetDescription>
              Configure perfil, parâmetros de execução, comportamento, integração e status.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-6">
          <Tabs
            defaultValue="perfil"
            onValueChange={(v) => { if (v === "execucoes" && !execucoes.length) carregarExecucoes(); }}
          >
            <TabsList className="grid grid-cols-3 sm:grid-cols-10 w-full">
              <TabsTrigger value="perfil">Perfil</TabsTrigger>
              <TabsTrigger value="configuracoes">Configurações</TabsTrigger>
              <TabsTrigger value="execucoes" disabled={!editing}>Execuções</TabsTrigger>
              <TabsTrigger value="teste" disabled={!editing}>Teste</TabsTrigger>
              <TabsTrigger value="comportamento">Comportamento</TabsTrigger>
              <TabsTrigger value="motor">Motor</TabsTrigger>
              <TabsTrigger value="conhecimento">Conhecimento</TabsTrigger>
              <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
              <TabsTrigger value="integracao">Integração</TabsTrigger>
              <TabsTrigger value="status">Status</TabsTrigger>
            </TabsList>

            <TabsContent value="perfil" className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
                <div className="space-y-1.5">
                  <Label>Nome do Agente *</Label>
                  <Input
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    placeholder="Ex: Ana – Atendente Digital"
                  />
                </div>
                {/* [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas, 2026-09-04):
                    ícone/cor são só identidade visual — usados na listagem de agentes
                    (`AGENTE_ICONES`/`estiloIconeAgente` no topo do arquivo), não afetam o
                    comportamento da IA em nada. */}
                <div className="space-y-1.5">
                  <Label>Ícone e cor</Label>
                  <div className="flex items-center gap-2">
                    <Select value={form.icone} onValueChange={(v) => setForm({ ...form, icone: v })}>
                      <SelectTrigger className="w-[72px]">
                        {(() => { const Icon = iconeDoAgente(form.icone); return <Icon className="h-4 w-4" style={{ color: form.cor }} />; })()}
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(AGENTE_ICONES).map(([id, Icon]) => (
                          <SelectItem key={id} value={id}>
                            <div className="flex items-center gap-2"><Icon className="h-4 w-4" /> {id}</div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      {AGENTE_CORES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          title={c}
                          onClick={() => setForm({ ...form, cor: c })}
                          className="h-6 w-6 rounded-full flex items-center justify-center ring-offset-1 ring-offset-background"
                          style={{ backgroundColor: c, boxShadow: form.cor === c ? `0 0 0 2px ${c}` : undefined }}
                        >
                          {form.cor === c && <Check className="h-3.5 w-3.5 text-white" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Textarea
                  value={form.descricao}
                  onChange={(e) =>
                    setForm({ ...form, descricao: e.target.value })
                  }
                  placeholder="Ex: Agente de vendas para WhatsApp"
                  rows={2}
                />
              </div>
              {/* [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas, 2026-09-04): Provedor
                  e Modelo moveram pra cá (antes na aba Motor) — são identidade do agente tanto
                  quanto o nome, faz mais sentido junto do resto do "quem é este agente" do que ao
                  lado de modalidades/ferramentas MCP. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Integração de IA</Label>
                  <Select
                    value={form.provider}
                    onValueChange={(v) => {
                      const p = PROVIDERS.find((x) => x.id === v);
                      const novoModelo = p?.modelos[0]?.id ?? form.modelo_id;
                      setForm({ ...form, provider: v, modelo_id: novoModelo });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Modelo</Label>
                  {/* [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas, 2026-09-04): `modelo`
                      é texto livre no banco (sem CHECK) — um agente configurado direto no banco
                      com um modelo fora desta lista curada (caso real confirmado em produção,
                      "Stella" com `gpt-4.1-mini-2025-04-14`) não bate com nenhum `SelectItem`
                      existente e o Select ficaria em branco, arriscando trocar silenciosamente
                      pro primeiro modelo da lista no próximo save sem o operador notar. Injeta uma
                      opção sintética com o valor real gravado quando ele não está na lista, pra
                      nunca ficar em branco nem se perder sem escolha deliberada. */}
                  <Select
                    value={form.modelo_id}
                    onValueChange={(v) => setForm({ ...form, modelo_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!PROVIDERS.find((p) => p.id === form.provider)?.modelos.some((m) => m.id === form.modelo_id) && form.modelo_id && (
                        <SelectItem value={form.modelo_id}>{form.modelo_id} (atual, fora da lista)</SelectItem>
                      )}
                      {(PROVIDERS.find((p) => p.id === form.provider)?.modelos ?? []).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(() => {
                const m = PROVIDERS.find((p) => p.id === form.provider)?.modelos.find(
                  (mm) => mm.id === form.modelo_id,
                );
                return m ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-xs">Custo estimado: {m.custo}</Badge>
                    <Badge variant="outline" className="text-xs">ID: {m.id}</Badge>
                  </div>
                ) : null;
              })()}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Prompt do Sistema {form.ativo && "*"}</Label>
                  <span
                    className={`text-xs ${
                      form.prompt_sistema.length > (form.max_tokens_prompt_sistema || 40000)
                        ? "text-destructive font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {form.prompt_sistema.length} / {form.max_tokens_prompt_sistema || 40000}
                  </span>
                </div>
                <Textarea
                  value={form.prompt_sistema}
                  onChange={(e) => setForm({ ...form, prompt_sistema: e.target.value })}
                  placeholder="Ex: Você é Ana, atendente da Mentoark. Seja simpática, objetiva, e sempre..."
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Este é o texto que a IA realmente recebe e usa pra responder (config unificada,
                  antes ficava numa tela separada). Sem isso preenchido, um agente ativo não
                  responde — é proposital, pra nunca sair no ar com uma persona genérica ou de
                  outro cliente. O limite de caracteres ao lado é configurável na aba
                  Configurações.
                </p>
              </div>
              {/* [AUDITORIA] LÓGICA (Sprint 1 unificação, 2026-08-07): Persona/Objetivo abaixo
                  NUNCA foram lidos por agentEngine.ts (confirmado no código) — são só anotação
                  interna, não vão pra IA. Mantidos por não apagar dado já preenchido por quem já
                  usava; Prompt do Sistema acima é o campo que de fato importa. */}
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Persona (anotação interna, não é enviada pra IA)</Label>
                <Textarea
                  value={form.persona}
                  onChange={(e) => setForm({ ...form, persona: e.target.value })}
                  placeholder="Ex: Você é Ana, uma atendente simpática e profissional..."
                  rows={3}
                />
              </div>
              {/* [AUDITORIA] FIX APLICADO (achado 2026-07-28 — auditoria de responsividade):
                  2 colunas fixas ficavam apertadas pros rótulos dos Select num celular
                  (dialog já é `w-[95vw]`, sobra pouco por coluna); empilha abaixo de `sm`. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Tom de Voz</Label>
                  <Select
                    value={form.tom}
                    onValueChange={(v) => setForm({ ...form, tom: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Idioma</Label>
                  <Select
                    value={form.idioma || "Português BR"}
                    onValueChange={(v) => setForm({ ...form, idioma: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Português BR">Português BR</SelectItem>
                      <SelectItem value="Português PT">Português PT</SelectItem>
                      <SelectItem value="Espanhol">Espanhol</SelectItem>
                      <SelectItem value="Inglês">Inglês</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Objetivo Principal (anotação interna, não é enviado pra IA)</Label>
                <Textarea
                  value={form.objetivo}
                  onChange={(e) =>
                    setForm({ ...form, objetivo: e.target.value })
                  }
                  placeholder="Ex: Qualificar leads e agendar demonstrações"
                  rows={2}
                />
              </div>
            </TabsContent>

            {/* [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas, 2026-09-04): aba nova
                — "como o modelo pensa e processa cada mensagem" (mesma moldura conceitual do
                mockup de referência trazido pelo usuário). Temperatura/Max Tokens migraram de
                Comportamento pra cá; Suporte a Imagens migrou de Motor; os outros 4 campos
                (esforço de raciocínio, fallback de transcrição, limite do prompt, limite de
                passos, tier de serviço) são novos — todos lidos de verdade por
                `agentEngine.ts`/`providers/index.ts`/`webhook.ts` (ver comentários lá), nenhum é
                só decorativo. */}
            <TabsContent value="configuracoes" className="space-y-5 pt-4">
              <div className="rounded-lg border p-4 bg-muted/20 space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <Cpu className="h-5 w-5" />
                  <h3 className="font-semibold">Modelo &amp; Raciocínio</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Define como o modelo de IA pensa e processa cada mensagem.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Temperatura</Label>
                      <span className="text-sm font-medium">{form.temperatura.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[form.temperatura]}
                      min={0}
                      max={1}
                      step={0.1}
                      onValueChange={(v) => setForm({ ...form, temperatura: v[0] })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Controla a criatividade das respostas. 0 = sempre igual e previsível, 1 =
                      bem variado. Para bots de atendimento, use entre 0.3 e 0.7.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Esforço de raciocínio</Label>
                    <Select
                      value={form.esforco_raciocinio || "__nenhum"}
                      onValueChange={(v) => setForm({ ...form, esforco_raciocinio: v === "__nenhum" ? "" : v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__nenhum">Padrão do modelo</SelectItem>
                        <SelectItem value="minimal">Mínimo</SelectItem>
                        <SelectItem value="low">Baixo</SelectItem>
                        <SelectItem value="medium">Médio</SelectItem>
                        <SelectItem value="high">Alto</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Quanto o modelo pensa antes de responder. Só tem efeito em modelos com
                      raciocínio (o1/o3/o4, gpt-5-thinking) — nenhum dos modelos oferecidos hoje
                      (aba Perfil) é dessa família, então fica sem efeito até isso mudar.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Suporte a imagens</Label>
                    <Select
                      value={form.modalidade_imagem ? "on" : "off"}
                      onValueChange={(v) => setForm({ ...form, modalidade_imagem: v === "on" })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">Habilitado</SelectItem>
                        <SelectItem value="off">Desabilitado</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Quando ativo, imagens enviadas pelo cliente entram como parte multimodal da
                      mensagem. Nunca se aplica a mensagens de grupo (ver aba Motor).
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Quando a transcrição de áudio falhar</Label>
                  <Textarea
                    value={form.fallback_transcricao_falha}
                    onChange={(e) => setForm({ ...form, fallback_transcricao_falha: e.target.value })}
                    placeholder="Deixe vazio para o agente ignorar áudios que não puderam ser transcritos"
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Vazio (padrão): o agente não responde a um áudio que falhou — mesmo
                    comportamento de antes da transcrição existir. Preenchido: este texto entra na
                    conversa no lugar do áudio, pra o agente poder reagir (ex.: pedir que o
                    cliente escreva).
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Tokens máx. de resposta</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.max_tokens}
                      onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Tamanho máximo da resposta do bot. 1000 tokens ≈ 750 palavras.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tokens máx. do system prompt</Label>
                    <Input
                      type="number"
                      min={1000}
                      value={form.max_tokens_prompt_sistema}
                      onChange={(e) => setForm({ ...form, max_tokens_prompt_sistema: Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Limite pro Prompt do Sistema (aba Perfil) — aumente se suas instruções forem
                      muito longas.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Limite de passos</Label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={form.limite_passos}
                      onChange={(e) => setForm({ ...form, limite_passos: Math.min(20, Math.max(1, Number(e.target.value))) })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Quantas ações (consultar dados, criar registros etc) o bot pode fazer num
                      único turno antes de responder. Máximo 20.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Tier de serviço (OpenAI)</Label>
                  <Select
                    value={form.tier_servico || "auto"}
                    onValueChange={(v) => setForm({ ...form, tier_servico: v })}
                  >
                    <SelectTrigger className="sm:w-[280px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automático</SelectItem>
                      <SelectItem value="default">Standard (padrão)</SelectItem>
                      <SelectItem value="flex">Flex</SelectItem>
                      <SelectItem value="priority">Priority</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Nível de processamento na OpenAI. Flex custa menos mas pode demorar mais pra
                    responder; Priority dá latência menor pagando mais. Só afeta integrações
                    OpenAI.
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas — fase 2, 2026-09-04):
                lê `agente_execucoes`, gravada de verdade em `agentEngine.ts` a cada turno do loop
                agêntico (sucesso ou erro) — não existia log nenhum de execução individual antes
                disso (as tabelas antigas que pareciam servir pra isso, `ai_mensagens`/
                `ai_conversas`, têm 0 linhas em produção, nunca foram escritas). "Re-executar" do
                mockup de referência NÃO entrou aqui de propósito: repetir uma execução real
                ('sistema') reenviaria uma mensagem de WhatsApp de verdade pro cliente — always
                fica pra aba Teste (dry-run isolado), não pra este histórico. */}
            <TabsContent value="execucoes" className="space-y-3 pt-4">
              {loadingExecucoes ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : execucoes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  Nenhuma execução registrada ainda — aparece aqui assim que o agente responder a primeira mensagem real.
                </p>
              ) : (
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="p-2 font-medium">Quando</th>
                        <th className="p-2 font-medium">Trigger</th>
                        <th className="p-2 font-medium">Status</th>
                        <th className="p-2 font-medium">Latência</th>
                        <th className="p-2 font-medium">Tokens</th>
                        <th className="p-2 font-medium">Custo</th>
                        <th className="p-2 font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {execucoes.map((ex) => (
                        <tr key={ex.id} className="border-b last:border-0">
                          <td className="p-2 whitespace-nowrap">{formatarData(ex.created_at)}</td>
                          <td className="p-2 capitalize">{ex.trigger_origem}</td>
                          <td className="p-2">
                            <Badge className={`text-xs border-0 ${ex.status === "sucesso" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                              {ex.status === "sucesso" ? "Sucesso" : "Erro"}
                            </Badge>
                          </td>
                          <td className="p-2 whitespace-nowrap">{ex.latencia_ms != null ? `${(ex.latencia_ms / 1000).toFixed(1)}s` : "—"}</td>
                          <td className="p-2 whitespace-nowrap">{ex.tokens_entrada} → {ex.tokens_saida}</td>
                          <td className="p-2 whitespace-nowrap">${Number(ex.custo_usd).toFixed(4)}</td>
                          <td className="p-2">
                            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setTraceAberto(ex)}>
                              Ver trace
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas — fase 2, 2026-09-04):
                chat de teste isolado (`testarAgentePlayground`, agentEngine.ts) — nunca envia
                WhatsApp real, ferramentas que escrevem dado voltam preview (banner abaixo avisa
                isso explicitamente, mesmo texto de intenção do mockup de referência). */}
            <TabsContent value="teste" className="pt-4">
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2 mb-3">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>Modo dry-run</strong> — ferramentas que criariam/alterariam dados (contatos, agendamentos, corridas, pausa de IA) retornam só uma prévia, sem afetar o banco.
                </span>
              </div>
              <div className="grid lg:grid-cols-[1fr_260px] gap-3">
                <div className="border rounded-lg flex flex-col h-[420px]">
                  <div className="flex items-center justify-between p-2.5 border-b">
                    <span className="text-sm font-medium">Teste o agente</span>
                    {chatTeste.length > 0 && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setChatTeste([]); setUltimaMetricaTeste(null); }}>
                        Limpar conversa
                      </Button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {chatTeste.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        Envie uma mensagem pra ver como o agente responde, com o prompt e as configurações atuais.
                      </p>
                    )}
                    {chatTeste.map((m, i) => (
                      <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                          m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}>
                          {m.content}
                        </div>
                      </div>
                    ))}
                    {enviandoTeste && (
                      <div className="flex justify-start">
                        <div className="rounded-lg px-3 py-2 bg-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>
                      </div>
                    )}
                  </div>
                  <div className="p-2.5 border-t flex gap-2">
                    <Textarea
                      value={mensagemTeste}
                      onChange={(e) => setMensagemTeste(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); enviarMensagemTeste(); }
                      }}
                      placeholder="Digite sua mensagem... (Cmd+Enter para enviar)"
                      rows={2}
                      className="resize-none text-sm"
                      disabled={!editing}
                    />
                    <Button onClick={enviarMensagemTeste} disabled={!editing || enviandoTeste || !mensagemTeste.trim()}>
                      {enviandoTeste ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="border rounded-lg p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Métricas</p>
                    {ultimaMetricaTeste ? (
                      <div className="text-xs space-y-1">
                        <p>Modelo: <span className="font-medium">{ultimaMetricaTeste.modelo}</span></p>
                        <p>Latência: <span className="font-medium">{(ultimaMetricaTeste.latenciaMs / 1000).toFixed(1)}s</span></p>
                        <p>Tokens: <span className="font-medium">{ultimaMetricaTeste.tokensEntrada} → {ultimaMetricaTeste.tokensSaida}</span></p>
                        <p>Custo: <span className="font-medium">${ultimaMetricaTeste.custoUsd.toFixed(4)}</span></p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Envie uma mensagem para ver métricas</p>
                    )}
                  </div>
                  <div className="border rounded-lg p-3 space-y-1.5 max-h-[260px] overflow-y-auto">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Trace</p>
                    {ultimaMetricaTeste?.trace.length ? (
                      <div className="space-y-2">
                        {ultimaMetricaTeste.trace.map((passo, i) => (
                          <div key={i} className="text-xs border-b last:border-0 pb-1.5 last:pb-0">
                            <p className="font-medium">Passo {passo.iter + 1}</p>
                            {passo.toolCalls.length > 0 ? (
                              passo.toolCalls.map((tc, j) => <p key={j} className="text-muted-foreground">🔧 {tc.nome}</p>)
                            ) : (
                              <p className="text-muted-foreground">resposta de texto</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Envie uma mensagem para ver o trace</p>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="comportamento" className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label>Saudação Inicial</Label>
                <Textarea
                  value={form.saudacao_inicial}
                  onChange={(e) => setForm({ ...form, saudacao_inicial: e.target.value })}
                  placeholder="Ex: Olá! Aqui é a Ana da Mentoark 😊"
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bloco de Qualificação</Label>
                <Textarea
                  value={form.bloco_qualificacao}
                  onChange={(e) => setForm({ ...form, bloco_qualificacao: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Mensagem de Encaminhamento</Label>
                  <Textarea
                    value={form.mensagem_encaminhamento}
                    onChange={(e) => setForm({ ...form, mensagem_encaminhamento: e.target.value })}
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Mensagem de Encerramento</Label>
                  <Textarea
                    value={form.mensagem_encerramento}
                    onChange={(e) => setForm({ ...form, mensagem_encerramento: e.target.value })}
                    rows={2}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Palavra pra Reativar a IA</Label>
                  <Input
                    value={form.palavra_reativar}
                    onChange={(e) => setForm({ ...form, palavra_reativar: e.target.value })}
                    placeholder="atendimento finalizado"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Sinal de Pausa (código interno)</Label>
                  <Input
                    value={form.sinal_pausa}
                    onChange={(e) => setForm({ ...form, sinal_pausa: e.target.value })}
                    placeholder="251213"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Espera antes de responder (segundos)</Label>
                  <Input
                    type="number" min={0}
                    value={form.tempo_espera_mensagem ?? 0}
                    onChange={(e) => setForm({ ...form, tempo_espera_mensagem: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Grupo de Notificação (JID, opcional)</Label>
                  <Input
                    value={form.grupo_notificacao}
                    onChange={(e) => setForm({ ...form, grupo_notificacao: e.target.value })}
                    placeholder="120363...@g.us"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Mensagem de Boas-Vindas (anotação interna, não é enviada pra IA)</Label>
                <Textarea
                  value={form.mensagem_boas_vindas}
                  onChange={(e) =>
                    setForm({ ...form, mensagem_boas_vindas: e.target.value })
                  }
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Regras e Restrições (anotação interna, não é enviada pra IA)</Label>
                <Textarea
                  value={form.regras}
                  onChange={(e) => setForm({ ...form, regras: e.target.value })}
                  placeholder="Ex: Não mencionar concorrentes. Não inventar preços."
                  rows={2}
                />
              </div>
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground bg-muted/30">
                Provedor/modelo estão na aba <strong>Perfil</strong>; temperatura, tokens e outros
                parâmetros de execução ficam na aba <strong>Configurações</strong>; modalidades
                (áudio/imagem) e ferramentas MCP ficam na aba <strong>Motor</strong>.
              </div>
            </TabsContent>

            <TabsContent value="motor" className="space-y-5 pt-4">
              <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
                <div className="flex items-center gap-2 text-primary">
                  <Mic className="h-5 w-5" />
                  <h3 className="font-semibold">Modalidades suportadas</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Quando ligado, o agente aceita mensagens nesse formato e processa via pipeline
                  multimodal (transcrição/visão).
                </p>
                {/* [AUDITORIA] FIX APLICADO (Sprint Modalidades Opcionais, 2026-08-23 — pedido
                    explícito do usuário: "não tire essa funcionalidade... deixe como opcional"):
                    até aqui estes 2 toggles (Áudio/Imagem) não controlavam nada no backend —
                    ficaram assim de propósito desde 2026-08-07 (decisão de escopo, não limitação
                    técnica; ver AUDITORIA_LOG.md). Agora lidos de verdade em webhook.ts/
                    agentEngine.ts antes de pagar Whisper/Vision — desligar aqui impede a chamada
                    de verdade, não só esconde a config.
                    [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas, 2026-09-04): o
                    toggle de Imagem mudou pra aba Configurações (junto do resto de "como o modelo
                    processa a mensagem"); Áudio continua aqui — o texto abaixo ainda descreve os
                    dois porque a mesma regra de grupo vale pra ambos, onde quer que estejam. */}
                <p className="text-xs text-muted-foreground">
                  Desligar aqui impede a chamada de Whisper de verdade (economiza token) — o áudio
                  continua sendo salvo normalmente no chat, só sem transcrição automática. Mesma
                  regra vale pro toggle de Imagem, na aba <strong>Configurações</strong>.{" "}
                  <span className="font-medium text-foreground">Nunca se aplica a mensagens de
                  grupo</span>, ligado ou desligado: grupo só processa mídia com IA se estiver
                  explicitamente autorizado em "Tarefa por Grupo", e mesmo assim é uma trava
                  totalmente separada desta.
                </p>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Mic className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Áudio (transcrição via Whisper)</p>
                      <p className="text-xs text-muted-foreground">
                        Transcreve mensagens de voz do WhatsApp.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={!!form.modalidade_audio}
                    onCheckedChange={(v) => setForm({ ...form, modalidade_audio: v })}
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border p-3 opacity-60">
                  <div className="flex items-center gap-2">
                    <Video className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        Vídeo <Badge variant="outline" className="ml-1 text-[10px]">em breve</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Extração de áudio + frames-chave.
                      </p>
                    </div>
                  </div>
                  <Switch checked={false} disabled />
                </div>
              </div>

              <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
                <div className="flex items-center gap-2 text-primary">
                  <Wrench className="h-5 w-5" />
                  <h3 className="font-semibold">Ferramentas MCP</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Funções do CRM que o motor pode chamar durante uma conversa. Desligue as que esse
                  agente não deve usar.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MCP_TOOLS.map((t) => {
                    const ativa = form.mcp_tools.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        className="flex items-center justify-between rounded-md border p-2.5 cursor-pointer hover:bg-muted/40"
                      >
                        <span className="text-sm">{t.label}</span>
                        <Switch
                          checked={ativa}
                          onCheckedChange={(v) => {
                            setForm({
                              ...form,
                              mcp_tools: v
                                ? Array.from(new Set([...form.mcp_tools, t.id]))
                                : form.mcp_tools.filter((id) => id !== t.id),
                            });
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="conhecimento" className="space-y-4 pt-4">

              <div className="rounded-lg border p-4 bg-muted/20 space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <Brain className="h-5 w-5" />
                  <h3 className="font-semibold">Configuração da IA (RAG)</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  A Configuração da IA permite que o agente consulte informações específicas sobre seu negócio, FAQ e scripts em tempo real.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>RAG Ativo</Label>
                    <div className="flex items-center gap-2">
                      <Switch 
                        checked={form.rag_ativo ?? true} 
                        onCheckedChange={(v) => setForm({ ...form, rag_ativo: v })} 
                      />
                      <span className="text-xs text-muted-foreground">{form.rag_ativo ? "Ligado" : "Desligado"}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Resultados RAG</Label>
                    <Input 
                      type="number" 
                      value={form.rag_resultados ?? 5} 
                      onChange={(e) => setForm({ ...form, rag_resultados: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Confiança Mínima (Threshold)</Label>
                    <span className="text-xs font-medium">{(form.rag_threshold ?? 0.7).toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[form.rag_threshold ?? 0.7]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={(v) => setForm({ ...form, rag_threshold: v[0] })}
                  />
                </div>
                <Button 
                  variant="outline" 
                  className="w-full gap-2"
                  onClick={() => navigate("/cerebro")}
                >
                  <Database className="h-4 w-4" /> Gerenciar Base de Conhecimento
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="whatsapp" className="space-y-4 pt-4">
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-3 text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
                <span className="mt-0.5">🔗</span>
                <span>
                  A URL e API Key da Evolution são configuradas globalmente em{" "}
                  <a href="/integracoes" className="font-semibold underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-100">
                    Conectores
                  </a>
                  . Aqui você define apenas o nome da instância usada por este agente.
                </span>
              </div>
              <div className="space-y-1.5">
                <Label>Nome da Instância</Label>
                <Input
                  value={form.evolution_instancia}
                  onChange={(e) =>
                    setForm({ ...form, evolution_instancia: e.target.value })
                  }
                  placeholder="ex: mentoark-principal"
                />
              </div>
              <div className="space-y-2">
                <Label>URL do Webhook n8n</Label>
                <Input
                  placeholder="https://seu-n8n.com/webhook/..."
                  value={form.n8n_webhook_url}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, n8n_webhook_url: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Quando preenchido, mensagens são processadas pelo n8n em vez da IA interna.
                </p>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={testarEvolution}
                disabled={testando}
              >
                {testando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                Testar conexão
              </Button>
            </TabsContent>

            <TabsContent value="integracao" className="space-y-4 pt-4">
              <div className="rounded-lg border p-4 bg-muted/20 space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <Webhook className="h-5 w-5" />
                  <h3 className="font-semibold">Integrações externas</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  O webhook n8n agora é configurado diretamente na aba <strong>WhatsApp</strong>, junto da instância Evolution.
                </p>
              </div>
            </TabsContent>


            <TabsContent value="status" className="space-y-4 pt-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="font-medium text-sm">Agente ativo</p>
                  <p className="text-xs text-muted-foreground">
                    Quando inativo, não responde mensagens.
                  </p>
                </div>
                <Switch
                  checked={form.ativo}
                  onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                />
              </div>

              {editing && (
                <div className="rounded-md border p-3 space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Criado em: </span>
                    {formatarData(editing.created_at)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Última atualização: </span>
                    {formatarData(editing.updated_at)}
                  </p>
                </div>
              )}

              {editing?.evolution_instancia && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    navigate(
                      `/whatsapp?instancia=${encodeURIComponent(
                        editing.evolution_instancia!,
                      )}`,
                    )
                  }
                >
                  <MessageCircle className="h-4 w-4" /> Ver Histórico WhatsApp
                </Button>
              )}
            </TabsContent>
          </Tabs>
          </div>

          <SheetFooter className="p-6 pt-4 border-t bg-muted/30 sm:justify-between">
            <Button variant="outline" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Salvar alterações" : "Criar agente"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* [AUDITORIA] LÓGICA (Sprint Agentes Configurações Avançadas — fase 2, 2026-09-04): "Ver
          trace" da aba Execuções — resumo por iteração do loop agêntico (texto parcial + tool
          calls/resultados), gravado em `agente_execucoes.trace` por `agentEngine.ts`. Não é o
          payload bruto da API (ver comentário na migration) — o suficiente pra entender O QUE o
          agente fez naquele turno sem duplicar dado já salvo em `whatsapp_messages`. */}
      <Dialog open={!!traceAberto} onOpenChange={(o) => !o && setTraceAberto(null)}>
        <DialogContent className="w-[95vw] max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Trace da execução</DialogTitle>
            <DialogDescription>
              {traceAberto && formatarData(traceAberto.created_at)}
            </DialogDescription>
          </DialogHeader>
          {traceAberto && (
            <div className="space-y-3 text-sm">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Entrada</p>
                <p className="rounded-md border p-2 whitespace-pre-wrap">{traceAberto.entrada_texto || "(vazio)"}</p>
              </div>
              {traceAberto.status === "erro" ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive">Erro</p>
                  <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 whitespace-pre-wrap">{traceAberto.erro_msg}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Resposta final</p>
                  <p className="rounded-md border p-2 whitespace-pre-wrap">{traceAberto.saida_texto || "(vazio)"}</p>
                </div>
              )}
              {traceAberto.trace.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Passos ({traceAberto.trace.length})</p>
                  {traceAberto.trace.map((passo: TracePasso, i: number) => (
                    <div key={i} className="rounded-md border p-2 space-y-1">
                      <p className="text-xs font-semibold">Passo {passo.iter + 1}</p>
                      {passo.texto && <p className="text-xs whitespace-pre-wrap">{passo.texto}</p>}
                      {passo.toolCalls?.length > 0 && (
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          {passo.toolCalls.map((tc, j: number) => (
                            <p key={j}>
                              🔧 <code className="bg-muted px-1 rounded">{tc.nome}</code>
                              {passo.toolResultados?.[j] ? ` → ${passo.toolResultados[j]}` : ""}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CRMLayout>
  );
}
