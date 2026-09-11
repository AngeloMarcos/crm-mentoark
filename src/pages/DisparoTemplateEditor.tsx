import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Bold, List, Loader2, Upload, Link as LinkIcon, Check, Phone,
  MessageSquare, Image as ImageIcon, FileText, Plus, X, Headphones,
  ChevronsUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { getAuthToken } from "@/lib/api-token";
import { BIBLIOTECA_VARIACOES, textoTemSpintax } from "@/lib/motorTexto";

// [AUDITORIA] LÓGICA (Sprint Editor Template WhatsApp, 2026-09-04 — mockup de referência trazido
// pelo usuário): esta tela substitui o antigo modal simples de `DisparoTemplates.tsx` por um
// editor de página cheia no formato de template do WhatsApp Business (Header/Corpo/Footer/
// Botões), mesma estrutura que a Meta usa pros templates oficiais dela. NENHUM dos campos novos
// (header_tipo, header_texto, footer, botoes, funil_estagio_id) é lido pelo envio de campanha de
// verdade (`disparoProcessor.ts`) — só `mensagem`/`tipo_midia`/`url_midia`/`legenda_midia`
// continuam sendo a fonte real do envio, exatamente como antes. Por isso `salvar()` abaixo sempre
// COMPÕE esses 4 campos legados a partir da estrutura nova (ver `montarTextoComposto`) antes de
// gravar — qualquer campanha que carregue este template em Disparos.tsx continua funcionando sem
// nenhuma mudança lá.
//
// Não existe integração real com a Meta WhatsApp Business Cloud API neste projeto (precisaria de
// WABA ID, número verificado pela Meta e fluxo de aprovação de template) — a aba "API Oficial" do
// preview é só uma pré-visualização de como o template ficaria SE essa integração existisse um
// dia; o envio de verdade (campanhas de Disparos) sempre sai pela Evolution, equivalente à aba
// "Extensão". Os botões, portanto, nunca viram botão nativo de WhatsApp no envio real — a Meta
// restringiu bastante interatividade nativa fora da API oficial, e usar o endpoint não-oficial de
// botão da Evolution arrisca a conta ser sinalizada em uso de campanha (alto volume). Em vez
// disso, cada botão vira uma linha de texto clicável dentro da própria mensagem: URL e telefone
// aproveitam o auto-link do próprio WhatsApp (ele já sublinha/deixa clicável link e telefone em
// texto puro); "Resposta Rápida" não tem como virar algo clicável de verdade sem botão nativo,
// então vira só uma chamada em negrito.
//
// Header "Vídeo" ficou de fora de propósito: a Galeria de Mídias (`galeria.ts`) não aceita nenhum
// mimetype de vídeo hoje, e `disparoProcessor.ts` não tem branch de envio de vídeo — declarar a
// opção sem esse suporte por trás vazaria como "configurei o header mas a campanha nunca manda o
// vídeo", a mesma classe de bug silencioso já documentada várias vezes em AUDITORIA_LOG.md.

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => getAuthToken();

type HeaderTipo = "nenhum" | "texto" | "imagem" | "documento" | "audio";
type BotaoTipo = "resposta_rapida" | "url" | "telefone";

interface TemplateBotao {
  id: string;
  tipo: BotaoTipo;
  texto: string;
  valor: string; // URL ou telefone; vazio para resposta_rapida
}

interface MidiaGaleria {
  id: string;
  url: string;
  titulo: string | null;
  filename: string;
  media_type: string;
}

interface FunilEstagio {
  id: string;
  nome: string;
  cor: string;
}

const HEADER_TIPOS: { id: HeaderTipo; label: string; icon: typeof MessageSquare }[] = [
  { id: "nenhum", label: "Nenhum", icon: X },
  { id: "texto", label: "Texto", icon: MessageSquare },
  { id: "imagem", label: "Imagem", icon: ImageIcon },
  { id: "documento", label: "Documento", icon: FileText },
  { id: "audio", label: "Áudio", icon: Headphones },
];

// [AUDITORIA] LÓGICA: header com mídia de verdade (tem endpoint de envio funcionando em
// disparoProcessor.ts E é aceito pela Galeria, `galeria.ts`) — "vídeo" fica de fora dos dois de
// propósito (ver nota grande no topo do arquivo); "áudio" faz parte desde sempre (Galeria já
// aceita mp3/ogg/wav/m4a, processor já manda via sendWhatsAppAudio).
const HEADER_TIPOS_COM_MIDIA: HeaderTipo[] = ["imagem", "documento", "audio"];

// Mesmo mapeamento tipo_midia→media_type da Galeria já usado em DisparoTemplates.tsx.
const HEADER_TIPO_PARA_GALERIA: Record<string, string | null> = { imagem: "image", documento: "pdf", audio: "audio" };

const BOTAO_TIPOS: { id: BotaoTipo; label: string; icon: typeof MessageSquare }[] = [
  { id: "resposta_rapida", label: "Resposta Rápida", icon: MessageSquare },
  { id: "url", label: "URL", icon: LinkIcon },
  { id: "telefone", label: "Telefone", icon: Phone },
];

const LIMITE_BOTOES_TOTAL = 10;
const LIMITE_BOTOES_URL = 2;
const LIMITE_BOTOES_TELEFONE = 1;
const LIMITE_FOOTER = 60;
const LIMITE_HEADER_TEXTO = 60;
const LIMITE_BOTAO_TEXTO = 25;

// [AUDITORIA] LÓGICA (melhoria Variáveis do Template, 2026-09-11 — pedido do usuário: "as
// variáveis não tão muito intuitivas"): antes, as variáveis apareciam só como texto estático de
// ajuda abaixo do Corpo ("Use {{nome}}, ..."), sem nenhum jeito de inserir com clique — o operador
// tinha que digitar a sintaxe à mão. `Disparos.tsx` (passo "Mensagem" de campanha) já resolve isso
// com chips clicáveis que inserem o placeholder direto; mesma lista de 5 variáveis usada lá (a
// única diferença real antes desta mudança era a página de Template omitir {{data}} do texto de
// ajuda, apesar de dizer "mesmas variáveis do passo Mensagem em Disparos" — corrigido junto).
const PLACEHOLDERS = ["{{nome}}", "{{primeiro_nome}}", "{{telefone}}", "{{data}}", "{{empresa}}"];

// [AUDITORIA] LÓGICA: agrupa botões por tipo (resposta_rapida primeiro, depois url, depois
// telefone) — exigência real da Meta pra templates oficiais ("respostas rápidas ficam juntas"),
// replicada aqui só visualmente pro preview/organização; não afeta o envio real (que não usa
// botão nativo, ver nota grande no topo do arquivo). Rodado só ao adicionar/remover um botão, não
// a cada tecla digitada no texto — reordenar durante a digitação tiraria o foco do campo.
const ORDEM_TIPO: Record<BotaoTipo, number> = { resposta_rapida: 0, url: 1, telefone: 2 };
function agruparBotoes(botoes: TemplateBotao[]): TemplateBotao[] {
  return [...botoes].sort((a, b) => ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo]);
}

function contarBotoesPorTipo(botoes: TemplateBotao[]) {
  return {
    url: botoes.filter(b => b.tipo === "url").length,
    telefone: botoes.filter(b => b.tipo === "telefone").length,
  };
}

// Monta o texto final (plain text) que sai de verdade no envio — header texto + corpo + footer +
// botões-como-linha-clicável. É o que vira `mensagem`/`legenda_midia` legado (ver nota no topo).
function montarTextoComposto(form: {
  headerTipo: HeaderTipo; headerTexto: string; corpo: string; footer: string; botoes: TemplateBotao[];
}): string {
  const partes: string[] = [];
  if (form.headerTipo === "texto" && form.headerTexto.trim()) partes.push(`*${form.headerTexto.trim()}*`);
  if (form.corpo.trim()) partes.push(form.corpo.trim());
  if (form.footer.trim()) partes.push(`_${form.footer.trim()}_`);
  const linhasBotoes = form.botoes
    .map(b => {
      if (b.tipo === "url" && b.valor.trim()) return `🔗 ${b.texto.trim() || "Acessar"}: ${b.valor.trim()}`;
      if (b.tipo === "telefone" && b.valor.trim()) return `📞 ${b.texto.trim() || "Ligar"}: ${b.valor.trim()}`;
      if (b.tipo === "resposta_rapida" && b.texto.trim()) return `👉 *${b.texto.trim()}*`;
      return null;
    })
    .filter((l): l is string => !!l);
  if (linhasBotoes.length) partes.push(linhasBotoes.join("\n"));
  return partes.join("\n\n");
}

export default function DisparoTemplateEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const editando = id !== "novo" && !!id;

  const [carregando, setCarregando] = useState(editando);
  const [salvando, setSalvando] = useState(false);

  const [nome, setNome] = useState("");
  const [funilId, setFunilId] = useState<string>("");
  const [funis, setFunis] = useState<FunilEstagio[]>([]);

  const [headerTipo, setHeaderTipo] = useState<HeaderTipo>("nenhum");
  const [headerTexto, setHeaderTexto] = useState("");
  const [headerMidiaUrl, setHeaderMidiaUrl] = useState("");
  const [corpo, setCorpo] = useState("");
  const [footer, setFooter] = useState("");
  const [botoes, setBotoes] = useState<TemplateBotao[]>([]);

  const corpoRef = useRef<HTMLTextAreaElement>(null);

  // ── Galeria (reaproveita o mesmo padrão de DisparoTemplates.tsx) ──────────────────────────
  const [galeriaItens, setGaleriaItens] = useState<MidiaGaleria[]>([]);
  const [loadingGaleria, setLoadingGaleria] = useState(false);
  const [uploadingGaleria, setUploadingGaleria] = useState(false);
  const [mostrarUrlManual, setMostrarUrlManual] = useState(false);

  const carregarGaleria = useCallback(async (tipo: HeaderTipo) => {
    const tipoGaleria = HEADER_TIPO_PARA_GALERIA[tipo];
    if (!tipoGaleria) { setGaleriaItens([]); return; }
    setLoadingGaleria(true);
    try {
      const r = await fetch(`${API_BASE}/api/galeria?tipo=${tipoGaleria}&limit=24`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (r.ok) setGaleriaItens((await r.json()).images ?? []);
    } catch {
      // falha na galeria não trava o editor — link manual continua disponível
    } finally {
      setLoadingGaleria(false);
    }
  }, []);

  useEffect(() => {
    if (HEADER_TIPOS_COM_MIDIA.includes(headerTipo)) carregarGaleria(headerTipo);
  }, [headerTipo, carregarGaleria]);

  const handleUploadGaleria = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingGaleria(true);
    try {
      const formData = new FormData();
      formData.append("imagens", file);
      const r = await fetch(`${API_BASE}/api/galeria/upload`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}` }, body: formData,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Erro no upload");
      const novo = await r.json();
      const item: MidiaGaleria = Array.isArray(novo) ? novo[0] : novo;
      setGaleriaItens(prev => [item, ...prev]);
      setHeaderMidiaUrl(item.url);
      toast.success("Arquivo enviado e selecionado");
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar arquivo");
    } finally {
      setUploadingGaleria(false);
    }
  };

  // ── Carregar template existente + funis ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await (api as any).from("funil_estagios").select("*").order("ordem", { ascending: true });
      setFunis((data ?? []) as FunilEstagio[]);
    })();
  }, []);

  useEffect(() => {
    if (!editando) return;
    (async () => {
      setCarregando(true);
      const { data, error } = await (api as any).from("disparo_templates").select("*").eq("id", id).single();
      if (error || !data) {
        toast.error("Template não encontrado");
        navigate("/disparos/templates");
        return;
      }
      setNome(data.nome || "");
      setFunilId(data.funil_estagio_id || "");
      const hTipo = (data.header_tipo || "nenhum") as HeaderTipo;
      setHeaderTipo(hTipo);
      setHeaderTexto(data.header_texto || "");
      // Templates criados antes desta sprint não têm header_tipo/header_texto preenchidos — cai
      // pro comportamento antigo (tipo_midia da mídia vira o header, mensagem/legenda vira corpo).
      if (hTipo === "nenhum" && data.tipo_midia && data.tipo_midia !== "texto") {
        setHeaderTipo(data.tipo_midia as HeaderTipo);
        setHeaderMidiaUrl(data.url_midia || "");
        setCorpo(data.legenda_midia || "");
      } else {
        setHeaderMidiaUrl(data.url_midia || "");
        setCorpo(data.tipo_midia === "texto" ? (data.mensagem || "") : (data.legenda_midia || data.mensagem || ""));
      }
      setFooter(data.footer || "");
      setMostrarUrlManual(!!data.url_midia);
      try {
        const b = Array.isArray(data.botoes) ? data.botoes : JSON.parse(data.botoes || "[]");
        setBotoes(b);
      } catch { setBotoes([]); }
      setCarregando(false);
    })();
  }, [id, editando, navigate]);

  // ── Botões ──────────────────────────────────────────────────────────────────────────────
  const contagem = contarBotoesPorTipo(botoes);

  const adicionarBotao = (tipo: BotaoTipo) => {
    if (botoes.length >= LIMITE_BOTOES_TOTAL) {
      toast.error(`Máximo de ${LIMITE_BOTOES_TOTAL} botões por template.`);
      return;
    }
    if (tipo === "url" && contagem.url >= LIMITE_BOTOES_URL) {
      toast.error(`Máximo de ${LIMITE_BOTOES_URL} botões de URL por template.`);
      return;
    }
    if (tipo === "telefone" && contagem.telefone >= LIMITE_BOTOES_TELEFONE) {
      toast.error(`Máximo de ${LIMITE_BOTOES_TELEFONE} botão de Telefone por template.`);
      return;
    }
    const novo: TemplateBotao = { id: crypto.randomUUID(), tipo, texto: "", valor: "" };
    setBotoes(prev => agruparBotoes([...prev, novo]));
  };

  const removerBotao = (idBotao: string) => setBotoes(prev => prev.filter(b => b.id !== idBotao));
  const atualizarBotao = (idBotao: string, patch: Partial<TemplateBotao>) =>
    setBotoes(prev => prev.map(b => (b.id === idBotao ? { ...b, ...patch } : b)));

  // ── Toolbar do corpo (negrito/lista — sintaxe real de formatação do WhatsApp) ──────────────
  const aplicarFormato = (tipo: "negrito" | "lista") => {
    const el = corpoRef.current;
    if (!el) return;
    const inicio = el.selectionStart;
    const fim = el.selectionEnd;
    const selecionado = corpo.slice(inicio, fim);
    let novoTexto: string;
    let novoCursorIni: number;
    let novoCursorFim: number;
    if (tipo === "negrito") {
      const trecho = selecionado || "texto";
      novoTexto = `${corpo.slice(0, inicio)}*${trecho}*${corpo.slice(fim)}`;
      novoCursorIni = inicio + 1;
      novoCursorFim = novoCursorIni + trecho.length;
    } else {
      const linhas = (selecionado || "item").split("\n").map(l => (l.startsWith("- ") ? l : `- ${l}`));
      const trecho = linhas.join("\n");
      novoTexto = `${corpo.slice(0, inicio)}${trecho}${corpo.slice(fim)}`;
      novoCursorIni = inicio;
      novoCursorFim = inicio + trecho.length;
    }
    setCorpo(novoTexto);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(novoCursorIni, novoCursorFim);
    });
  };

  // [AUDITORIA] LÓGICA (melhoria Variáveis do Template, 2026-09-11): insere `texto` na posição do
  // cursor do Corpo (substitui a seleção, se houver) — usado pelos chips de variável/spintax
  // abaixo. Mais intuitivo que só concatenar no final (padrão do `Disparos.tsx`): clicar
  // "{{nome}}" com o cursor no meio da frase insere ali, não joga pro fim do texto.
  const inserirNoCursor = (texto: string) => {
    const el = corpoRef.current;
    if (!el) { setCorpo(corpo + texto); return; }
    const inicio = el.selectionStart;
    const fim = el.selectionEnd;
    const novoTexto = `${corpo.slice(0, inicio)}${texto}${corpo.slice(fim)}`;
    const novoCursor = inicio + texto.length;
    setCorpo(novoTexto);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(novoCursor, novoCursor);
    });
  };

  // ── Salvar ──────────────────────────────────────────────────────────────────────────────
  const salvar = async () => {
    if (!user) return;
    if (!nome.trim()) { toast.error("Nome do template é obrigatório"); return; }
    if (!corpo.trim()) { toast.error("Corpo da mensagem é obrigatório"); return; }
    if (HEADER_TIPOS_COM_MIDIA.includes(headerTipo) && !headerMidiaUrl.trim()) {
      toast.error("Selecione ou informe um arquivo para o header");
      return;
    }
    setSalvando(true);
    // [AUDITORIA] LÓGICA: campos legados compostos aqui — ver nota grande no topo do arquivo
    // sobre por que `mensagem`/`tipo_midia`/`url_midia`/`legenda_midia` continuam existindo e
    // sendo a fonte real de envio de campanha.
    const textoComposto = montarTextoComposto({ headerTipo, headerTexto, corpo, footer, botoes });
    // [AUDITORIA] BUG CORRIGIDO (achado 2026-09-04, revisão pós-build): esta checagem só cobria
    // imagem/documento — um template pré-existente com `tipo_midia='audio'` (suportado desde
    // sempre, `DisparoTemplates.tsx`/Disparos.tsx) caía aqui como "sem mídia" ao ser aberto nesta
    // tela nova, e salvar de novo APAGAVA de vez `url_midia`/`legenda_midia` (virava um template de
    // texto puro, silenciosamente). [AUDITORIA] FIX APLICADO: usa a mesma lista central
    // `HEADER_TIPOS_COM_MIDIA` (inclui áudio) em todo lugar que precisa dessa checagem.
    const temMidia = HEADER_TIPOS_COM_MIDIA.includes(headerTipo);
    const payload = {
      user_id: user.id,
      nome: nome.trim(),
      funil_estagio_id: funilId || null,
      header_tipo: headerTipo,
      header_texto: headerTipo === "texto" ? headerTexto.trim() : null,
      footer: footer.trim() || null,
      // [AUDITORIA] BUG EVITADO: `botoes` é um array de objetos indo pra uma coluna JSONB — o
      // driver `pg` serializa qualquer JS Array que chega como parâmetro cru usando a sintaxe de
      // ARRAY do Postgres (`{...}`), não JSON, não importa o tipo real da coluna de destino (só
      // acontece com Array; um objeto solto como `regra_variante_por_tag`, que já funciona hoje
      // em disparo_templates, não passa por esse caminho — só array top-level tem esse problema).
      // Gravar assim quebraria com "invalid input syntax for type json" ou, pior, gravaria
      // `{}` (objeto vazio, não array vazio) pro caso `[]`. `JSON.stringify` aqui evita os dois:
      // vira uma string comum, e o Postgres converte texto→jsonb normalmente na escrita.
      botoes: JSON.stringify(botoes),
      tipo_midia: temMidia ? headerTipo : "texto",
      mensagem: temMidia ? "" : textoComposto,
      url_midia: temMidia ? headerMidiaUrl.trim() : null,
      legenda_midia: temMidia ? textoComposto : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = editando
      ? await (api as any).from("disparo_templates").update(payload).eq("id", id)
      : await (api as any).from("disparo_templates").insert(payload);
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editando ? "Template atualizado!" : "Template criado!");
    navigate("/disparos/templates");
  };

  const textoPreview = montarTextoComposto({ headerTipo, headerTexto, corpo, footer, botoes });

  if (carregando) {
    return (
      <CRMLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </CRMLayout>
    );
  }

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/disparos/templates")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{editando ? "Editar Template" : "Novo Template"}</h1>
            <p className="text-muted-foreground text-sm">Configure o template WhatsApp com header, corpo, footer e botões</p>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          As alterações não são enviadas automaticamente a nenhum provedor — o envio real de campanhas (Disparos) sempre usa o texto composto abaixo, enviado pela Evolution. Não há integração com a API oficial da Meta neste CRM.
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
          {/* ── Formulário ── */}
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: CORBAN" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>Funil</Label>
                <Select value={funilId || "__nenhum"} onValueChange={v => setFunilId(v === "__nenhum" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__nenhum">Nenhum</SelectItem>
                    {funis.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="space-y-1.5">
                  <Label>Header</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {HEADER_TIPOS.map(h => (
                      <Button
                        key={h.id}
                        type="button"
                        variant={headerTipo === h.id ? "default" : "outline"}
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setHeaderTipo(h.id)}
                      >
                        <h.icon className="h-3.5 w-3.5" /> {h.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {headerTipo === "texto" && (
                  <div className="space-y-1">
                    <Input
                      value={headerTexto}
                      maxLength={LIMITE_HEADER_TEXTO}
                      onChange={e => setHeaderTexto(e.target.value)}
                      placeholder="Título curto no topo da mensagem"
                    />
                    <p className="text-[11px] text-muted-foreground text-right">{headerTexto.length}/{LIMITE_HEADER_TEXTO}</p>
                  </div>
                )}

                {HEADER_TIPOS_COM_MIDIA.includes(headerTipo) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Arquivo do header</Label>
                      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-primary cursor-pointer hover:underline">
                        {uploadingGaleria ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        Fazer upload
                        <input
                          type="file"
                          accept={headerTipo === "imagem" ? "image/*" : headerTipo === "audio" ? "audio/*" : "application/pdf"}
                          className="hidden"
                          disabled={uploadingGaleria}
                          onChange={handleUploadGaleria}
                        />
                      </label>
                    </div>
                    {loadingGaleria ? (
                      <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                    ) : galeriaItens.length > 0 ? (
                      <div className="grid grid-cols-6 gap-2 max-h-32 overflow-y-auto p-1 border rounded-lg">
                        {galeriaItens.map(item => {
                          const selecionado = headerMidiaUrl === item.url;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              title={item.titulo || item.filename}
                              onClick={() => setHeaderMidiaUrl(item.url)}
                              className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${
                                selecionado ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-muted-foreground/30"
                              }`}
                            >
                              {item.media_type === "image" ? (
                                <img src={item.url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-muted">
                                  {item.media_type === "audio" ? <Headphones className="h-4 w-4 text-muted-foreground" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                                </div>
                              )}
                              {selecionado && <div className="absolute top-0.5 right-0.5 bg-primary text-primary-foreground rounded-full p-0.5"><Check className="h-2.5 w-2.5" /></div>}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground/70 py-1">Nenhuma mídia deste tipo na Galeria ainda.</p>
                    )}
                    <button
                      type="button"
                      onClick={() => setMostrarUrlManual(v => !v)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <LinkIcon className="h-3 w-3" /> {mostrarUrlManual ? "Ocultar link manual" : "Ou colar um link externo"}
                    </button>
                    {mostrarUrlManual && (
                      <Input value={headerMidiaUrl} onChange={e => setHeaderMidiaUrl(e.target.value)} placeholder="https://..." />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-1.5">
              <Label>Corpo da mensagem *</Label>
              <div className="flex items-center gap-1 border rounded-t-md border-b-0 bg-muted/40 px-2 py-1">
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Negrito" onClick={() => aplicarFormato("negrito")}>
                  <Bold className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Lista" onClick={() => aplicarFormato("lista")}>
                  <List className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Textarea
                ref={corpoRef}
                value={corpo}
                onChange={e => setCorpo(e.target.value)}
                placeholder="Olá {{primeiro_nome}}, tudo bem?"
                className="min-h-[140px] resize-y font-mono text-sm rounded-t-none"
              />
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">Inserir variável:</span>
                  {PLACEHOLDERS.map(v => (
                    <Button
                      key={v}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="text-[10px] h-7"
                      onClick={() => inserirNoCursor(v)}
                    >
                      +{v}
                    </Button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Preenchidas com o dado real do contato ao enviar — mesmas variáveis do passo Mensagem em Disparos.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">Variar texto:</span>
                  {BIBLIOTECA_VARIACOES.map(v => (
                    <Button
                      key={v.label}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-7"
                      onClick={() => inserirNoCursor(v.spintax)}
                    >
                      🎲 {v.label}
                    </Button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {textoTemSpintax(corpo)
                    ? "Cada contato recebe uma opção sorteada dos blocos acima, sem custo de IA."
                    : <>💡 Use <code className="bg-muted px-1 rounded">{"{opção 1|opção 2|opção 3}"}</code> pra variar o texto por contato sem custo de IA — os botões acima já inserem blocos prontos.</>}
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Footer</Label>
              <Input value={footer} maxLength={LIMITE_FOOTER} onChange={e => setFooter(e.target.value)} placeholder="Ex: MentoArk | CRM + Automação + IA" />
              <p className="text-[11px] text-muted-foreground text-right">{footer.length}/{LIMITE_FOOTER}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Botões</Label>
                <Badge variant="outline">{botoes.length}/{LIMITE_BOTOES_TOTAL}</Badge>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground/80 flex items-center gap-1.5"><ChevronsUpDown className="h-3 w-3" /> Regras do WhatsApp (Meta) para botões</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Até <strong>{LIMITE_BOTOES_TOTAL}</strong> botões por template, misturando Resposta Rápida, URL e Telefone.</li>
                  <li>Limites por tipo: até <strong>{LIMITE_BOTOES_URL} URL</strong> e <strong>{LIMITE_BOTOES_TELEFONE} Telefone</strong> por template.</li>
                  <li>Ao misturar tipos, as Respostas Rápidas ficam agrupadas (exigência da Meta) — o editor reordena automaticamente.</li>
                  <li>Aqui (envio via Evolution), todo botão vira uma linha de texto clicável dentro da mensagem — não existe botão nativo fora da API oficial.</li>
                </ul>
              </div>

              <div className="space-y-2">
                {botoes.map(b => (
                  <div key={b.id} className="flex items-start gap-2 border rounded-lg p-2">
                    <Badge variant="secondary" className="mt-1.5 shrink-0 gap-1">
                      {BOTAO_TIPOS.find(t => t.id === b.tipo)?.label}
                    </Badge>
                    <div className="flex-1 space-y-1.5">
                      <Input
                        value={b.texto}
                        maxLength={LIMITE_BOTAO_TEXTO}
                        onChange={e => atualizarBotao(b.id, { texto: e.target.value })}
                        placeholder={b.tipo === "url" ? "Ex: Quero conhecer" : b.tipo === "telefone" ? "Ex: Ligar agora" : "Ex: Falar com especialista"}
                      />
                      {b.tipo === "url" && (
                        <Input value={b.valor} onChange={e => atualizarBotao(b.id, { valor: e.target.value })} placeholder="https://..." />
                      )}
                      {b.tipo === "telefone" && (
                        <Input value={b.valor} onChange={e => atualizarBotao(b.id, { valor: e.target.value })} placeholder="+55 11 99999-9999" />
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => removerBotao(b.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 flex-wrap">
                {BOTAO_TIPOS.map(t => (
                  <Button key={t.id} type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => adicionarBotao(t.id)}>
                    <Plus className="h-3 w-3" /> <t.icon className="h-3.5 w-3.5" /> {t.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Preview ── */}
          {/* [AUDITORIA] FIX APLICADO (2026-09-11 — pedido do usuário: "não temos api oficial,
              tire essas opções e coloque só a mensagem"): removidas as abas "API Oficial"/
              "Extensão" — não existe integração real com a Meta Cloud API neste CRM (só a
              simulação visual que a aba "API Oficial" mostrava), e ter as duas abas passava a
              impressão de uma escolha que não existe de verdade. Preview agora mostra direto o
              único modo real de envio (o que já era a aba "Extensão": botões como linha de texto
              clicável, via Evolution). */}
          <div className="lg:sticky lg:top-6 space-y-3">
            <p className="text-xs font-medium text-muted-foreground px-1">Como a mensagem chega no WhatsApp</p>
            <PreviewBubble
              headerTipo={headerTipo} headerTexto={headerTexto} headerMidiaUrl={headerMidiaUrl}
              corpo={corpo} footer={footer} botoes={botoes} nativo={false}
            />
            <p className="text-[11px] text-muted-foreground px-1">
              Texto que realmente sai numa campanha via Disparos: <span className="italic">"{textoPreview.slice(0, 80)}{textoPreview.length > 80 ? "…" : ""}"</span>
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pb-4">
          <Button variant="outline" onClick={() => navigate("/disparos/templates")}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {editando ? "Salvar alterações" : "Criar template"}
          </Button>
        </div>
      </div>
    </CRMLayout>
  );
}

// Bolha de mensagem no estilo WhatsApp — botões sempre como linha de texto clicável, o único modo
// real de envio por Disparos/Evolution (removido o modo "nativo"/chip que só existia pra simular
// a API oficial da Meta, que este CRM não integra — ver nota grande no topo do arquivo).
function PreviewBubble({ headerTipo, headerTexto, headerMidiaUrl, corpo, footer, botoes }: {
  headerTipo: HeaderTipo; headerTexto: string; headerMidiaUrl: string; corpo: string; footer: string;
  botoes: TemplateBotao[];
}) {
  return (
    <Card className="bg-[#efeae2] dark:bg-neutral-900 border-none">
      <CardContent className="p-4">
        <div className="bg-white dark:bg-neutral-800 rounded-lg rounded-tl-none shadow-sm p-3 max-w-full">
          {headerTipo === "imagem" && (
            headerMidiaUrl
              ? <img src={headerMidiaUrl} alt="" className="w-full h-32 object-cover rounded-md mb-2" />
              : <div className="w-full h-24 rounded-md bg-muted flex items-center justify-center mb-2"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>
          )}
          {headerTipo === "documento" && (
            <div className="flex items-center gap-2 rounded-md bg-muted p-2 mb-2">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{headerMidiaUrl ? headerMidiaUrl.split("/").pop() : "documento.pdf"}</span>
            </div>
          )}
          {headerTipo === "audio" && (
            <div className="flex items-center gap-2 rounded-md bg-muted p-2 mb-2">
              <Headphones className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Mensagem de áudio</span>
            </div>
          )}
          {headerTipo === "texto" && headerTexto.trim() && (
            <p className="font-bold text-sm mb-1">{headerTexto}</p>
          )}
          <p className="text-sm whitespace-pre-wrap break-words">{corpo || "Sua mensagem aparece aqui…"}</p>
          {footer.trim() && <p className="text-xs text-muted-foreground mt-1.5">{footer}</p>}
          <p className="text-right text-[10px] text-muted-foreground mt-1">14:32 ✓✓</p>
        </div>

        {botoes.length > 0 && (
          <div className="mt-1.5 space-y-1 pl-1">
            {botoes.map(b => (
              <p key={b.id} className="text-sm text-primary font-medium">
                {b.tipo === "url" && `🔗 ${b.texto || "Acessar"}`}
                {b.tipo === "telefone" && `📞 ${b.texto || "Ligar"}`}
                {b.tipo === "resposta_rapida" && `👉 ${b.texto || "(sem texto)"}`}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
