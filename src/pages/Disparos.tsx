import { useState, useMemo, useEffect } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  ShieldCheck, ShieldAlert, Shield, Play, Pause, Square,
  Settings2, AlertOctagon, RefreshCw, Users, Upload, 
  Clock, Calendar, MessageSquare, Image as ImageIcon, 
  FileText, Headphones, AlertTriangle, CheckCircle2,
  Table as TableIcon, Send, XCircle, Activity, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";

// [AUDITORIA] BUG (Sprint Disparos/Importação, revisão 2026-07-25): usuário reportou nomes
// corrompidos na importação real (ex: "GraÃ§a" em vez de "Graça", "JosÃ©" em vez de "José") —
// assinatura clássica de um CSV exportado pelo Excel em Windows-1252/"ANSI" (o padrão do Excel
// pt-BR pra "Salvar como > CSV", não "CSV UTF-8") sendo decodificado como se fosse UTF-8.
// `file.text()` SEMPRE decodifica como UTF-8 (é fixo na spec do navegador, não dá pra escolher
// outra codificação com esse método) — não tem como esse método sozinho ler um arquivo
// Windows-1252 corretamente. [AUDITORIA] FIX APLICADO: lê o arquivo como bytes crus
// (`arrayBuffer`) e tenta decodificar como UTF-8 estrito (`fatal: true`); bytes acentuados em
// Windows-1252 (ex: "ç" = 0xE7 sozinho) não formam uma sequência UTF-8 válida e o decoder estoura
// — nesse caso, cai pro fallback Windows-1252, que sempre decodifica com sucesso (todo byte
// 0-255 mapeia pra algum caractere nessa codificação) e é o padrão de fato do Excel brasileiro.
function decodeTextoTolerante(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

// [AUDITORIA] LÓGICA (Sprint Disparos/Importação, 2026-07-25): parser de CSV tolerante — separa
// campos por vírgula OU ponto e vírgula (detecta o delimitador pela linha de cabeçalho, contando
// qual aparece mais vezes: exportações de Excel em pt-BR costumam usar ";"), e remove aspas duplas
// que envelopam valores (inclusive `""` escapado dentro de um campo entre aspas). Usado só pra CSV
// — XLSX/XLS é lido nativamente via XLSX.read + sheet_to_json (ver handleImportFile), sem precisar
// desse parser.
function parseCsvRowsTolerante(text: string): string[][] {
  // [AUDITORIA] FIX APLICADO (Sprint Disparos/Importação, revisão 2026-07-25): CSV exportado pelo
  // Excel em "UTF-8 com BOM" começa com o caractere invisível BOM (code point U+FEFF, decimal
  // 65279), que gruda no primeiro cabeçalho (ex: vira "<BOM>Nome Completo") e faz o mapeamento de
  // coluna por nome falhar silenciosamente pra esse campo específico. Removido via
  // String.fromCharCode(65279) em vez de um caractere/escape literal no código-fonte — invisível
  // direto no arquivo é frágil (fácil de corromper sem perceber num editor ou diff).
  const BOM = String.fromCharCode(65279);
  const clean = (text.startsWith(BOM) ? text.slice(BOM.length) : text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const firstLine = clean.split("\n", 1)[0] || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delim = semiCount > commaCount ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '"') {
      if (inQuotes && clean[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      row.push(cur.trim()); cur = "";
    } else if (ch === "\n" && !inQuotes) {
      row.push(cur.trim()); cur = "";
      if (row.some(c => c.length > 0)) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur.trim());
    if (row.some(c => c.length > 0)) rows.push(row);
  }
  return rows;
}

interface TelefoneImportado {
  telefone: string | null; // já com DDI 55, ou null se descartado
  corrigido: boolean;      // true se o 55 e/ou o 9º dígito foram adicionados automaticamente
}

// [AUDITORIA] LÓGICA (Sprint Disparos/Importação, 2026-07-25): sanitização de telefone própria
// desta tela — DELIBERADAMENTE diferente de `normalizarTelefoneBR` (src/lib/phone.ts, usada por
// Leads.tsx e pelo motor de disparo/whatsapp). Aquela função rejeita fixos e exige formato exato
// de celular (9 dígitos após o DDD); aqui a instrução explícita foi "nunca descartar um lead" a
// não ser por telefone com menos de 10 dígitos após a sanitização — ou seja, mais permissiva de
// propósito, pra não perder contatos importados por um filtro rígido demais. Não é duplicação por
// descuido: é uma política de validação diferente para este fluxo específico de importação.
function sanitizarTelefoneImportacao(raw: string): TelefoneImportado {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length < 10) return { telefone: null, corrigido: false };

  // Já tem DDI 55 (12 ou 13 dígitos) — mantém como está.
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) {
    return { telefone: d, corrigido: false };
  }

  // 10 ou 11 dígitos sem DDI — insere o 9º dígito preventivamente (celular antigo: DDD + 8
  // dígitos começando em 6-9) antes de adicionar o "55" na frente.
  if (d.length === 10 || d.length === 11) {
    const ddd = d.slice(0, 2);
    let resto = d.slice(2);
    if (resto.length === 8 && /^[6-9]/.test(resto)) {
      resto = "9" + resto;
    }
    return { telefone: "55" + ddd + resto, corrigido: true };
  }

  // Comprimento fora do esperado (ex: 12/13 dígitos sem começar com 55) — não descarta (único
  // critério de descarte é <10 dígitos), mantém os dígitos como vieram.
  return { telefone: d, corrigido: false };
}

interface ContatoImportado {
  nome: string; telefone: string; email: string; empresa: string; cargo: string; notas: string;
}

interface AnaliseImportacao {
  novos: ContatoImportado[];
  totalLinhas: number;
  corrigidos: number;
  descartados: number;
}

// [AUDITORIA] LÓGICA (Sprint Disparos/Importação, revisão 2026-07-25): extraída de dentro de
// `confirmarImportacao` pra ser compartilhada com o resumo de pré-validação mostrado assim que o
// arquivo é lido (antes de clicar "Confirmar Importação") — usuário reportou achar que a
// importação estava "trazendo contatos com telefone vazio" porque a PREVIEW (5 primeiras linhas
// cruas do arquivo, sem filtro nenhum) mostra o telefone em branco tal como está no arquivo; o
// filtro de verdade só acontecia no clique de confirmar, sem nenhum retorno visual antes disso.
// Mesma função agora roda nos dois lugares — sem duplicar a regra de validação, e garantindo que
// o número mostrado no resumo bate exatamente com o que será importado de fato.
function analisarLinhasImportacao(rows: string[][]): AnaliseImportacao {
  const headers = rows[0].map(h => (h || "").toLowerCase().trim());
  const getPorSubstring = (cols: string[], ...keys: string[]) => {
    for (const key of keys) {
      const idx = headers.findIndex(h => h.includes(key));
      if (idx >= 0 && cols[idx]) return cols[idx];
    }
    return "";
  };

  const totalLinhas = rows.length - 1;
  let corrigidos = 0;
  let descartados = 0;
  const novos: ContatoImportado[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = (rows[i] || []).map(c => (c || "").replace(/^["']|["']$/g, "").trim());
    const telefoneRaw = getPorSubstring(cols, "telefone", "celular", "whatsapp", "phone", "mobile", "tel", "fone", "contato");
    const { telefone, corrigido } = sanitizarTelefoneImportacao(telefoneRaw);

    // [AUDITORIA] LÓGICA: único critério de descarte é telefone inválido (<10 dígitos após
    // sanitização) — nome, e-mail e demais campos vazios NUNCA descartam o lead, só ficam
    // em branco no contato criado.
    if (!telefone) {
      descartados++;
      continue;
    }
    if (corrigido) corrigidos++;

    const nome = getPorSubstring(cols, "nome completo", "nome", "cliente", "name");
    // [AUDITORIA] LÓGICA: contatos.cpf não existe como coluna própria (confirmado por grep em
    // migrations.ts) — CPF, quando presente na planilha, é preservado em `notas` em vez de
    // descartado, sem exigir migração de schema pra este sprint.
    const cpf = getPorSubstring(cols, "cpf", "documento");
    novos.push({
      nome: nome || telefone,
      telefone,
      email: getPorSubstring(cols, "e-mail", "email", "mail"),
      empresa: getPorSubstring(cols, "empresa", "company"),
      cargo: getPorSubstring(cols, "cargo", "função", "role"),
      notas: cpf ? `CPF: ${cpf}` : "",
    });
  }

  return { novos, totalLinhas, corrigidos, descartados };
}

const Steps = ["Lista de Contatos", "Mensagem", "Proteção Anti-ban", "Revisar e Agendar"];

export default function DisparosPage() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [activeCampaign, setActiveCampaign] = useState<any>(null);
  const [targetContacts, setTargetContacts] = useState<any[]>([]);
  const [loadingCount, setLoadingCount] = useState(false);

  const [form, setForm] = useState({
    nome: "",
    tipo_midia: "texto" as "texto" | "imagem" | "audio" | "documento",
    mensagem: "",
    perfil_velocidade: "safe" as "safe" | "moderate" | "fast",
    janela_inicio: "08:00",
    janela_fim: "21:00",
    pausa_fins_semana: true,
    pausa_erros_consecutivos: true,
    limite_erros_consecutivos: 5,
    pausa_bloqueios_detectados: true,
    instancias_ids: [] as string[],
    contatos: [] as any[],
    tags_selecionadas: [] as string[],
    estagios_selecionados: [] as string[],
    listas_selecionadas: [] as string[],
    url_midia: "",
    legenda_midia: "",
    humanizar_ia: true,
  });

  // Live contact count — recalcula sempre que os filtros mudam
  useEffect(() => {
    const fetchCount = async () => {
      if (
        form.tags_selecionadas.length === 0 &&
        form.estagios_selecionados.length === 0 &&
        form.listas_selecionadas.length === 0
      ) {
        setTargetContacts([]);
        return;
      }
      setLoadingCount(true);
      let list: any[] = [];
      // [AUDITORIA] LÓGICA: `opt_out` incluído no select das 3 fontes de alvo (tag/estágio/lista)
      // pra dar pro filtro final abaixo o que precisa — sem isso, contato que pediu remoção
      // entrava na campanha do mesmo jeito (ver diagnosticos/AUDITORIA_LOG.md).
      if (form.tags_selecionadas.length > 0) {
        const { data } = await api.from("contatos").select("id, nome, telefone, tags, opt_out");
        if (data) {
          const filtered = data.filter((c: any) =>
            Array.isArray(c.tags) && form.tags_selecionadas.some((t: string) => c.tags.includes(t))
          );
          list = [...list, ...filtered];
        }
      }
      if (form.estagios_selecionados.length > 0) {
        const { data } = await api
          .from("contatos")
          .select("id, nome, telefone, opt_out")
          .in("funil_estagio_id", form.estagios_selecionados);
        if (data) list = [...list, ...data];
      }
      if (form.listas_selecionadas.length > 0) {
        if (form.listas_selecionadas.includes("__all__")) {
          const { data } = await api.from("contatos").select("id, nome, telefone, lista_id, opt_out");
          if (data) list = [...list, ...data];
        } else {
          const { data } = await api
            .from("contatos")
            .select("id, nome, telefone, lista_id, opt_out")
            .in("lista_id", form.listas_selecionadas);
          if (data) list = [...list, ...data];
        }
      }
      // [AUDITORIA] FIX APLICADO (2026-07-23): contato com opt_out=true nunca entra na lista de
      // alvos de campanha, independente de por qual filtro (tag/estágio/lista) ele foi
      // encontrado — mesma checagem reforçada no backend (get_next_disparo_batch, ver
      // migrations.ts), essa aqui evita que ele nem apareça na prévia/contagem.
      const semOptOut = list.filter((c: any) => c.opt_out !== true);
      const unique = Array.from(new Map(semOptOut.map(c => [c.telefone, c])).values());
      setTargetContacts(unique);
      setLoadingCount(false);
    };
    fetchCount();
  }, [form.tags_selecionadas, form.estagios_selecionados, form.listas_selecionadas]);

  // Validação por etapa — habilita "Próximo" só quando OK
  const stepValid = useMemo(() => {
    if (step === 0) return form.nome.trim().length > 0 && targetContacts.length > 0;
    if (step === 1) {
      if (form.tipo_midia === "texto") return form.mensagem.trim().length > 0;
      return form.url_midia.trim().length > 0;
    }
    if (step === 2) return form.instancias_ids.length > 0;
    return true;
  }, [step, form, targetContacts.length]);

  const stepHint = useMemo(() => {
    if (stepValid) return null;
    if (step === 0) {
      if (!form.nome.trim()) return "Informe o nome da campanha";
      return "Selecione ao menos uma tag, lista, estágio ou importe um CSV";
    }
    if (step === 1) return form.tipo_midia === "texto" ? "Escreva a mensagem" : "Informe a URL do arquivo";
    if (step === 2) return "Selecione ao menos uma instância";
    return null;
  }, [stepValid, step, form]);

  if (activeCampaign) {
    return <MonitoringDashboard campaign={activeCampaign} onCancel={() => setActiveCampaign(null)} />;
  }

  return (
    <CRMLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Novo Disparo em Massa</h1>
            <p className="text-sm text-muted-foreground">Configure em 4 passos rápidos</p>
          </div>
          {/* Resumo ao vivo — sempre visível */}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="gap-1 py-1.5 px-3">
              <Users className="h-3 w-3" />
              {loadingCount ? "..." : targetContacts.length} contato{targetContacts.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className="gap-1 py-1.5 px-3">
              <Send className="h-3 w-3" />
              {form.instancias_ids.length} instância{form.instancias_ids.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className="gap-1 py-1.5 px-3 capitalize">
              <ShieldCheck className="h-3 w-3" />
              {form.perfil_velocidade}
            </Badge>
          </div>
        </div>

        {/* Stepper clicável (só permite voltar) */}
        <div className="flex gap-2 sm:gap-4 mb-2 flex-wrap">
          {Steps.map((s, i) => {
            const clickable = i < step;
            return (
              <button
                key={s}
                type="button"
                onClick={() => clickable && setStep(i)}
                disabled={!clickable && i !== step}
                className={`flex items-center gap-2 transition-opacity ${i <= step ? "text-primary" : "text-muted-foreground"} ${clickable ? "hover:opacity-80 cursor-pointer" : i === step ? "" : "cursor-not-allowed"}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${i < step ? "bg-primary/80 text-primary-foreground" : i === step ? "bg-primary text-primary-foreground" : ""}`}>
                  {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className="text-sm font-medium hidden sm:inline">{s}</span>
              </button>
            );
          })}
        </div>

        <div className="min-h-[400px]">
          {step === 0 && <StepContacts form={form} setForm={setForm} liveCount={targetContacts.length} loadingCount={loadingCount} targetContacts={targetContacts} />}
          {step === 1 && <StepMessage form={form} setForm={setForm} />}
          {step === 2 && <StepAntiBan form={form} setForm={setForm} />}
          {step === 3 && <StepReview form={form} targetContacts={targetContacts} loadingContacts={loadingCount} onStart={(campaignData: any) => setActiveCampaign(campaignData)} />}
        </div>

        {/* Footer: na revisão escondemos para evitar duplicidade com os CTAs internos */}
        {step < 3 && (
          <div className="flex justify-between items-center pt-6 border-t gap-4">
            <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Voltar</Button>
            <div className="flex items-center gap-3">
              {stepHint && <span className="text-xs text-muted-foreground hidden sm:inline">{stepHint}</span>}
              <Button onClick={() => setStep(Math.min(3, step + 1))} disabled={!stepValid}>
                Próximo
              </Button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="flex justify-start pt-6 border-t">
            <Button variant="outline" onClick={() => setStep(2)}>Voltar</Button>
          </div>
        )}
      </div>
    </CRMLayout>
  );
}

function StepContacts({ form, setForm, liveCount, loadingCount, targetContacts = [] }: any) {
  const { user } = useAuth();
  const [previewSearch, setPreviewSearch] = useState("");
  const filteredPreview = targetContacts.filter((c: any) => {
    if (!previewSearch.trim()) return true;
    const q = previewSearch.toLowerCase();
    return (c.nome || "").toLowerCase().includes(q) || (c.telefone || "").toLowerCase().includes(q);
  });
  const [tags, setTags] = useState<any[]>([]);
  const [estagios, setEstagios] = useState<any[]>([]);
  const [listas, setListas] = useState<any[]>([]);
  const [listasCounts, setListasCounts] = useState<Record<string, number>>({});
  const [totalContatos, setTotalContatos] = useState<number>(0);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const [tagSearch, setTagSearch] = useState("");

  // [AUDITORIA] FIX APLICADO (Sprint Disparos/Importação, 2026-07-25): extraída pra fora do
  // useEffect (era uma função anônima só chamada no mount) pra poder ser rechamada depois de uma
  // importação bem-sucedida — sem isso, a lista recém-criada não apareceria na aba "Por Lista"
  // nem teria contagem, mesmo já estando selecionada em form.listas_selecionadas.
  const fetchTargets = async () => {
    const { data: tagsData } = await api.from("tags").select("*");
    const { data: estagiosData } = await api.from("funil_estagios").select("*");
    const { data: listasData } = await api.from("listas").select("*").order("nome", { ascending: true });
    setTags(tagsData || []);
    setEstagios(estagiosData || []);
    setListas(listasData || []);

    // Total geral de contatos (usado pela opção "Todos os Leads")
    const { count: totalCount } = await api.from("contatos").select("id", { count: "exact", head: true });
    setTotalContatos(totalCount || 0);

    // Buscar contagem de contatos por lista (em paralelo)
    if (listasData && listasData.length) {
      const counts: Record<string, number> = {};
      await Promise.all(
        listasData.map(async (l: any) => {
          const { count } = await api.from("contatos").select("id", { count: "exact", head: true }).eq("lista_id", l.id);
          counts[l.id] = count || 0;
        })
      );
      setListasCounts(counts);
    }
  };

  useEffect(() => { fetchTargets(); }, []);

  // [AUDITORIA] BUG (Sprint Disparos/Importação, 2026-07-25, ver
  // diagnosticos/SPRINT_DISPAROS_IMPORTACAO_CSV_XLSX.md): `handleCsvUpload` só sabia ler XLSX
  // (readAsBinaryString + XLSX.read(type:'binary'), sem try/catch — arquivo .xlsx real
  // frequentemente falhava silenciosamente nesse modo, explicando o relato "Excel não subiu"), e
  // mesmo quando o parse funcionava (CSV), o resultado (`csvPreview`) só alimentava uma tabela de
  // preview — nunca virava contato de verdade nem entrava em `targetContacts`. O botão "Selecionar
  // Arquivo" era decorativo.
  // [AUDITORIA] FIX APLICADO: dois arquivos, duas etapas — (1) `handleImportFile` só lê e mostra
  // preview (csv via file.text() + parseCsvRowsTolerante; xlsx/xls via file.arrayBuffer() +
  // XLSX.read(type:'array'), padrão robusto igual Leads.tsx, dentro de try/catch com toast de
  // erro real); (2) botão novo "Confirmar Importação" (`confirmarImportacao`, abaixo) de fato cria
  // os contatos e uma lista de destino, e marca essa lista como selecionada — só então o
  // useEffect de targetContacts (linha ~57 do componente pai) passa a enxergar esses contatos.
  const [pendingImportRows, setPendingImportRows] = useState<string[][] | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importLoading, setImportLoading] = useState(false);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    try {
      let rows: string[][];
      if (ext === "csv") {
        const buf = await file.arrayBuffer();
        const texto = decodeTextoTolerante(buf);
        rows = parseCsvRowsTolerante(texto);
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        rows = raw.map(r => (r || []).map(c => (c === null || c === undefined ? "" : String(c).trim())));
      } else {
        toast.error("Formato não suportado", { description: "Use um arquivo .csv, .xlsx ou .xls." });
        e.target.value = "";
        return;
      }

      rows = rows.filter(r => r.some(c => c.length > 0));
      if (rows.length < 2) {
        toast.error("Arquivo vazio ou sem linhas de dados", { description: "É preciso ao menos uma linha de cabeçalho e uma linha de dados." });
        e.target.value = "";
        return;
      }

      setCsvPreview(rows.slice(0, 5));
      setPendingImportRows(rows);
      setImportFileName(file.name);
      toast.success(`${file.name} carregado`, {
        description: `${rows.length - 1} linha(s) de dados encontradas. Confira o preview e clique em "Confirmar Importação" para criar os contatos.`,
      });
    } catch (err: any) {
      toast.error("Não foi possível ler o arquivo", { description: err?.message || "Verifique o formato e tente novamente." });
    } finally {
      e.target.value = "";
    }
  };

  const cancelarImportacao = () => {
    setPendingImportRows(null);
    setCsvPreview([]);
    setImportFileName("");
  };

  // [AUDITORIA] FIX APLICADO (Sprint Disparos/Importação, revisão 2026-07-25): usuário reportou
  // achar que a importação estava "trazendo contatos com telefone vazio" — na prática, ele estava
  // vendo a PREVIEW (5 primeiras linhas cruas do arquivo, sem filtro nenhum) e interpretando isso
  // como o resultado final. Resumo de pré-validação abaixo roda a mesma análise que
  // `confirmarImportacao` vai aplicar de fato, mostrado assim que o arquivo é lido — não precisa
  // mais confirmar pra descobrir quantos vão ser aproveitados.
  const preAnalise = useMemo(
    () => (pendingImportRows ? analisarLinhasImportacao(pendingImportRows) : null),
    [pendingImportRows]
  );

  const confirmarImportacao = async () => {
    if (!pendingImportRows || !user) return;
    setImportLoading(true);
    try {
      const { novos: analisados, totalLinhas, corrigidos, descartados } = analisarLinhasImportacao(pendingImportRows);
      const novos = analisados.map(n => ({
        ...n,
        origem: "Importado (Disparos)",
        status: "novo",
        tags: [] as string[],
        user_id: user.id,
      }));

      if (!novos.length) {
        toast.error("Nenhum contato válido encontrado", {
          description: `${totalLinhas} linha(s) lida(s), todas com telefone inválido ou em branco (menos de 10 dígitos).`,
        });
        return;
      }

      const nomeLista = `Importação ${importFileName} ${new Date().toLocaleDateString("pt-BR")}`;
      const { data: listaCriada, error: listaError } = await api
        .from("listas")
        .insert({ user_id: user.id, nome: nomeLista })
        .select()
        .single();

      if (listaError || !listaCriada) {
        toast.error("Erro ao criar lista de importação", { description: listaError?.message });
        return;
      }

      const { error: insertError } = await api
        .from("contatos")
        .insert(novos.map(n => ({ ...n, lista_id: listaCriada.id })));

      if (insertError) {
        toast.error("Erro ao importar contatos", { description: insertError.message });
        return;
      }

      // [AUDITORIA] FIX APLICADO: marca a lista recém-criada como selecionada — é isso que faz o
      // useEffect de targetContacts (componente pai) de fato puxar esses contatos pra campanha,
      // fechando a ponte que faltava entre "arquivo importado" e "quem recebe o disparo".
      setForm({
        ...form,
        listas_selecionadas: Array.from(new Set([
          ...form.listas_selecionadas.filter((id: string) => id !== "__all__"),
          listaCriada.id,
        ])),
      });

      toast.success("Importação concluída", {
        description: `${totalLinhas} linha(s) lidas · ${novos.length} importado(s) · ${corrigidos} telefone(s) corrigido(s) automaticamente · ${descartados} descartado(s) por telefone inválido.`,
      });

      await fetchTargets();
      cancelarImportacao();
    } catch (err: any) {
      toast.error("Erro inesperado na importação", { description: err?.message });
    } finally {
      setImportLoading(false);
    }
  };

  const filteredTags = tags.filter(t => t.nome?.toLowerCase().includes(tagSearch.toLowerCase()));
  const allTagsSelected = filteredTags.length > 0 && filteredTags.every(t => form.tags_selecionadas.includes(t.nome));
  const allEstagiosSelected = estagios.length > 0 && estagios.every(s => form.estagios_selecionados.includes(s.id));

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div className="flex flex-col gap-1">
          <Label>Nome da Campanha</Label>
          <Input placeholder="Ex: Campanha Black Friday" value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} />
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase text-muted-foreground font-bold">Selecionados</p>
          <p className="text-2xl font-bold text-primary">
            {loadingCount ? "..." : liveCount}
            <span className="text-sm text-muted-foreground font-normal ml-1">contatos</span>
          </p>
        </div>
      </div>

      <Tabs defaultValue="lista" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="lista">Por Lista {form.listas_selecionadas.length > 0 && <Badge variant="secondary" className="ml-2 h-5">{form.listas_selecionadas.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="tags">Por Tag {form.tags_selecionadas.length > 0 && <Badge variant="secondary" className="ml-2 h-5">{form.tags_selecionadas.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="estagio">Por Estágio {form.estagios_selecionados.length > 0 && <Badge variant="secondary" className="ml-2 h-5">{form.estagios_selecionados.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="csv">Importar Arquivo</TabsTrigger>
        </TabsList>

        <TabsContent value="lista" className="p-4 border rounded-lg bg-card space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Selecione uma ou mais listas de leads:</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const allIds = listas.map(l => l.id);
                const allSelected = listas.length > 0 && listas.every(l => form.listas_selecionadas.includes(l.id));
                setForm({ ...form, listas_selecionadas: allSelected ? [] : allIds });
              }}
            >
              {listas.length > 0 && listas.every(l => form.listas_selecionadas.includes(l.id)) ? "Limpar" : "Selecionar todas"}
            </Button>
          </div>

          {/* Opção especial: Todos os Leads (ignora lista_id) */}
          {(() => {
            const checked = form.listas_selecionadas.includes("__all__");
            return (
              <label
                htmlFor="lista-__all__"
                className={`flex items-center justify-between gap-2 p-3 border-2 rounded cursor-pointer transition-colors ${checked ? "bg-primary/10 border-primary" : "border-dashed border-primary/40 hover:bg-muted/50"}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    id="lista-__all__"
                    checked={checked}
                    className="h-4 w-4"
                    onChange={(e) => {
                      setForm({
                        ...form,
                        listas_selecionadas: e.target.checked ? ["__all__"] : [],
                      });
                    }}
                  />
                  <Users className="h-4 w-4 text-primary" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">Todos os Leads</span>
                    <span className="text-[10px] text-muted-foreground">Puxa todos os contatos do módulo Leads, sem filtro de lista</span>
                  </div>
                </div>
                <Badge variant="default" className="text-[10px] flex-shrink-0">
                  {totalContatos}
                </Badge>
              </label>
            );
          })()}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
            {listas.map(l => {
              const checked = form.listas_selecionadas.includes(l.id);
              const disabled = form.listas_selecionadas.includes("__all__");
              return (
                <label
                  key={l.id}
                  htmlFor={`lista-${l.id}`}
                  className={`flex items-center justify-between gap-2 p-2 border rounded cursor-pointer transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${checked ? "bg-primary/10 border-primary/40" : "hover:bg-muted/50"}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      id={`lista-${l.id}`}
                      checked={checked}
                      disabled={disabled}
                      className="h-4 w-4"
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...form.listas_selecionadas.filter((id: string) => id !== "__all__"), l.id]
                          : form.listas_selecionadas.filter((id: string) => id !== l.id);
                        setForm({ ...form, listas_selecionadas: next });
                      }}
                    />
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: l.cor || "hsl(217 91% 45%)" }} />
                    <span className="text-sm truncate">{l.nome}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] flex-shrink-0">
                    {listasCounts[l.id] ?? "..."}
                  </Badge>
                </label>
              );
            })}
            {listas.length === 0 && (
              <p className="text-xs text-muted-foreground col-span-full text-center py-2">
                Você ainda não criou listas. Use "Todos os Leads" acima ou crie listas no módulo Leads.
              </p>
            )}
          </div>
        </TabsContent>



        <TabsContent value="tags" className="p-4 border rounded-lg bg-card space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Input
              placeholder="Buscar tag..."
              value={tagSearch}
              onChange={e => setTagSearch(e.target.value)}
              className="h-8 max-w-xs"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const names = filteredTags.map(t => t.nome);
                  setForm({
                    ...form,
                    tags_selecionadas: allTagsSelected
                      ? form.tags_selecionadas.filter((n: string) => !names.includes(n))
                      : Array.from(new Set([...form.tags_selecionadas, ...names])),
                  });
                }}
              >
                {allTagsSelected ? "Limpar" : "Selecionar todas"}
              </Button>
              <div className="flex items-center gap-2">
                <Switch checked />
                <span className="text-xs">Excluir Opt-outs</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
            {filteredTags.map(t => {
              const checked = form.tags_selecionadas.includes(t.nome);
              return (
                <label
                  key={t.id}
                  htmlFor={t.id}
                  className={`flex items-center space-x-2 p-2 border rounded cursor-pointer transition-colors ${checked ? "bg-primary/10 border-primary/40" : "hover:bg-muted/50"}`}
                >
                  <input
                    type="checkbox"
                    id={t.id}
                    checked={checked}
                    className="h-4 w-4"
                    onChange={(e) => {
                      const newTags = e.target.checked
                        ? [...form.tags_selecionadas, t.nome]
                        : form.tags_selecionadas.filter((st: string) => st !== t.nome);
                      setForm({...form, tags_selecionadas: newTags});
                    }}
                  />
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.cor }} />
                  <span className="text-sm">{t.nome}</span>
                </label>
              );
            })}
            {filteredTags.length === 0 && (
              <p className="text-xs text-muted-foreground col-span-full text-center py-4">Nenhuma tag encontrada</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="estagio" className="p-4 border rounded-lg bg-card space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Selecione os estágios do funil:</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setForm({
                  ...form,
                  estagios_selecionados: allEstagiosSelected ? [] : estagios.map(s => s.id),
                });
              }}
            >
              {allEstagiosSelected ? "Limpar" : "Selecionar todos"}
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {estagios.map(s => {
              const checked = form.estagios_selecionados.includes(s.id);
              return (
                <label
                  key={s.id}
                  htmlFor={s.id}
                  className={`flex items-center space-x-2 p-2 border rounded cursor-pointer transition-colors ${checked ? "bg-primary/10 border-primary/40" : "hover:bg-muted/50"}`}
                >
                  <input
                    type="checkbox"
                    id={s.id}
                    checked={checked}
                    className="h-4 w-4"
                    onChange={(e) => {
                      const newEstagios = e.target.checked
                        ? [...form.estagios_selecionados, s.id]
                        : form.estagios_selecionados.filter((se: string) => se !== s.id);
                      setForm({...form, estagios_selecionados: newEstagios});
                    }}
                  />
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.cor }} />
                  <span className="text-sm">{s.nome}</span>
                </label>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="csv" className="p-4 border rounded-lg bg-card space-y-4 text-center">
          <div className="py-8 border-2 border-dashed rounded-lg">
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Clique para fazer upload ou arraste o arquivo (CSV, XLSX ou XLS)</p>
            <input type="file" className="hidden" id="csv-upload" accept=".csv,.xlsx,.xls" onChange={handleImportFile} />
            <Button variant="outline" size="sm" className="mt-4" onClick={() => document.getElementById('csv-upload')?.click()}>
              Selecionar Arquivo
            </Button>
          </div>
          {csvPreview.length > 0 && (
            <div className="space-y-3 text-left">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Preview (Primeiras 5 linhas) — {importFileName}</p>
              <div className="border rounded overflow-hidden overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody className="divide-y">
                    {csvPreview.map((row, i) => (
                      <tr key={i} className={`divide-x ${i === 0 ? "font-bold bg-muted/50" : ""}`}>
                        {row.map((cell, j) => <td key={j} className="p-1 whitespace-nowrap">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* [AUDITORIA] FIX APLICADO: preview acima mostra o arquivo cru (por isso telefone
                  aparece em branco quando o arquivo tem essas linhas) — este resumo roda a MESMA
                  validação que "Confirmar Importação" vai aplicar, então dá pra saber quantos
                  contatos de verdade vêm ANTES de confirmar, sem precisar adivinhar pela preview. */}
              {preAnalise && (
                <div className={`p-3 rounded-lg border text-xs space-y-1 ${preAnalise.novos.length === 0 ? "bg-destructive/10 border-destructive/30" : "bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-500/30"}`}>
                  <p className="font-bold uppercase tracking-wider text-muted-foreground">Pré-validação (o que será importado de fato)</p>
                  <p>
                    <span className="font-bold text-emerald-600">{preAnalise.novos.length}</span> de {preAnalise.totalLinhas} linha(s) têm telefone válido e serão importadas
                    {preAnalise.corrigidos > 0 && <> (<span className="font-bold">{preAnalise.corrigidos}</span> com DDI/9º dígito corrigido automaticamente)</>}.
                  </p>
                  {preAnalise.descartados > 0 && (
                    <p className="text-muted-foreground">
                      <span className="font-bold text-destructive">{preAnalise.descartados}</span> linha(s) serão descartadas por telefone vazio ou inválido (menos de 10 dígitos) — a preview acima mostra o arquivo cru, essas linhas não geram contato.
                    </p>
                  )}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={cancelarImportacao} disabled={importLoading}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={confirmarImportacao} disabled={importLoading || (preAnalise?.novos.length ?? 0) === 0}>
                  {importLoading ? "Importando..." : "Confirmar Importação"}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Preview em tempo real dos contatos filtrados */}
      {targetContacts.length > 0 && (
        <div className="p-4 border rounded-lg bg-card space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium">Contatos selecionados</p>
              <p className="text-xs text-muted-foreground">
                {filteredPreview.length} de {targetContacts.length} {previewSearch ? "(filtrados)" : "totais"}
              </p>
            </div>
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={previewSearch}
              onChange={e => setPreviewSearch(e.target.value)}
              className="h-8 max-w-xs"
            />
          </div>
          <div className="max-h-72 overflow-y-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium text-xs">Nome</th>
                  <th className="px-3 py-2 font-medium text-xs">Telefone</th>
                </tr>
              </thead>
              <tbody>
                {filteredPreview.slice(0, 500).map((c: any, i: number) => (
                  <tr key={c.id || c.telefone || i} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-1.5 truncate max-w-[200px]">{c.nome || "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{c.telefone || "—"}</td>
                  </tr>
                ))}
                {filteredPreview.length === 0 && (
                  <tr><td colSpan={2} className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhum contato corresponde à busca.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredPreview.length > 500 && (
            <p className="text-[10px] text-muted-foreground text-center">Mostrando primeiros 500 de {filteredPreview.length}.</p>
          )}
        </div>
      )}
    </div>
  );
}


function StepMessage({ form, setForm }: any) {
  const mediaTypes = [
    { id: "texto", label: "Texto", icon: MessageSquare },
    { id: "imagem", label: "Imagem", icon: ImageIcon },
    { id: "audio", label: "Áudio", icon: Headphones },
    { id: "documento", label: "Documento", icon: FileText },
  ];

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
          {mediaTypes.map(t => (
            <Button 
              key={t.id} 
              variant={form.tipo_midia === t.id ? "default" : "ghost"} 
              size="sm" 
              className="h-8 gap-2"
              onClick={() => setForm({...form, tipo_midia: t.id})}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </Button>
          ))}
        </div>

        {form.tipo_midia !== 'texto' && (
          <div className="space-y-2">
            <Label>Arquivo de Mídia</Label>
            <div className="flex gap-2">
              <Input placeholder="URL do arquivo (ou faça upload)" value={form.url_midia} onChange={e => setForm({...form, url_midia: e.target.value})} />
              <Button variant="outline"><Upload className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <Label>{form.tipo_midia === 'texto' ? 'Mensagem' : 'Legenda (opcional)'}</Label>
            <span className={`text-[10px] ${form.mensagem.length > 4096 ? "text-destructive font-bold" : "text-muted-foreground"}`}>{form.mensagem.length}/4096</span>
          </div>
          <Textarea 
            className="min-h-[150px] font-mono text-sm" 
            value={form.mensagem} 
            onChange={e => setForm({...form, mensagem: e.target.value})} 
            placeholder={form.tipo_midia === 'texto' ? "Olá {{primeiro_nome}}, tudo bem?" : "Legenda do arquivo..."} 
          />
          <div className="flex gap-2 flex-wrap">
            {["{{nome}}", "{{primeiro_nome}}", "{{telefone}}", "{{data}}", "{{empresa}}"].map(v => (
              <Button key={v} size="sm" variant="secondary" className="text-[10px] h-7" onClick={() => {
                setForm({...form, mensagem: form.mensagem + v});
              }}>+{v}</Button>
            ))}
          </div>
        </div>

        {/* Preview Card */}
        <div className="p-4 border rounded-lg bg-emerald-50/30 dark:bg-emerald-950/10">
          <p className="text-[10px] font-bold uppercase text-emerald-600 mb-2">Preview do 1º Contato</p>
          <div className="p-3 bg-white dark:bg-zinc-900 rounded shadow-sm max-w-[80%] border-l-4 border-emerald-500">
            {form.tipo_midia !== 'texto' && (
              <div className="aspect-video bg-muted rounded mb-2 flex items-center justify-center">
                <ImageIcon className="h-8 w-8 opacity-20" />
              </div>
            )}
            <p className="text-sm whitespace-pre-wrap">
              {form.mensagem.replace('{{nome}}', 'João Silva').replace('{{primeiro_nome}}', 'João')}
            </p>
            <span className="text-[10px] text-muted-foreground float-right">10:45</span>
          </div>
        </div>
      </div>
    </Card>
  );
}


function StepAntiBan({ form, setForm }: any) {
  const [instancias, setInstancias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // [AUDITORIA] BUG (Sprint Disparos/Multi-instância, 2026-07-25): <Switch /> sem
  // checked/onCheckedChange — não filtrava nada, e o limiar (>70) nem batia com o hardcoded
  // (>=40) do botão "Selecionar todas" logo ao lado. [AUDITORIA] FIX APLICADO: estado local
  // ligado ao toggle, usado tanto para filtrar a lista abaixo quanto para decidir o limiar do
  // "Selecionar todas" (uniformizado: >70 quando o toggle está ativo, >=40 caso contrário).
  const [apenasSaudaveis, setApenasSaudaveis] = useState(false);
  const LIMIAR_SAUDAVEL = 70;
  const LIMIAR_PADRAO = 40;

  useEffect(() => {
    const fetchInstancias = async () => {
      // [AUDITORIA] BUG (achado 2026-07-27): `.not("evolution_instancia", "is", null)` é um
      // no-op no QueryBuilder (src/integrations/database/client.ts) — `not()` empilha o filtro
      // em `_filters`, mas `_buildParams()` não tem nenhum branch para o operador `not_is` (só
      // trata eq/in/gte/lte/gt/lt/ilike), e o backend (`crud.ts`) também não tem um parâmetro de
      // query equivalente a "_not_null"/"_ne". Resultado real: esta busca sempre trouxe TODOS os
      // `agentes` do usuário, inclusive linhas sem `evolution_instancia` (nunca conectaram a
      // Evolution) — apareciam como opção selecionável aqui, no seletor de instâncias do
      // anti-ban. Se o usuário selecionasse só essas linhas "fantasma", o backend
      // (`resolverInstanciasCampanha` em disparoProcessor.ts, que SIM filtra
      // `evolution_instancia IS NOT NULL` corretamente) devolveria uma lista vazia de instâncias
      // elegíveis, e o round-robin cairia silenciosamente no fallback de uma única instância
      // padrão — anulando a distribuição multi-instância que o usuário pensava ter configurado,
      // sem erro nenhum visível. [AUDITORIA] FIX APLICADO: filtro aplicado no cliente, no único
      // ponto do frontend que usa `.not()` — mudança isolada aqui em vez de implementar suporte
      // genérico a "not is null" no QueryBuilder/crud.ts (usados por muitas outras telas, maior
      // risco pra um fix não pedido). `.neq()`/`.not()` continuam sendo no-ops no cliente
      // compartilhado; comentado lá também para não pegar o próximo desenvolvedor de surpresa.
      const { data } = await api.from("agentes").select("*");
      setInstancias((data || []).filter((i: any) => !!i.evolution_instancia));
      setLoading(false);
    };
    fetchInstancias();
  }, []);

  const instanciasVisiveis = apenasSaudaveis
    ? instancias.filter(i => (i.whatsapp_score || 0) > LIMIAR_SAUDAVEL)
    : instancias;

  const profiles = [
    { id: "safe", label: "SEGURO", icon: ShieldCheck, color: "text-emerald-500", delay: "30-60s", limit: "50", desc: "Recomendado para novos números" },
    { id: "moderate", label: "MODERADO", icon: Shield, color: "text-yellow-500", delay: "15-30s", limit: "100", desc: "Equilíbrio entre velocidade e segurança" },
    { id: "fast", label: "RÁPIDO", icon: ShieldAlert, color: "text-red-500", delay: "5-15s", limit: "200", desc: "Risco aumentado de banimento", alert: true },
  ];

  return (
    <div className="space-y-6">
      {/* Instances Selection */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <Label className="font-bold">Instâncias para Disparar {form.instancias_ids.length > 0 && <Badge variant="secondary" className="ml-2">{form.instancias_ids.length}</Badge>}</Label>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const available = instancias
                  .filter(i => apenasSaudaveis ? (i.whatsapp_score || 0) > LIMIAR_SAUDAVEL : (i.whatsapp_score || 0) >= LIMIAR_PADRAO)
                  .map(i => i.id);
                const allSelected = available.length > 0 && available.every(id => form.instancias_ids.includes(id));
                setForm({ ...form, instancias_ids: allSelected ? [] : available });
              }}
            >
              Selecionar todas
            </Button>
            <div className="flex items-center gap-2">
              <Switch checked={apenasSaudaveis} onCheckedChange={setApenasSaudaveis} />
              <span className="text-xs">Apenas saudáveis (&gt;70)</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {instanciasVisiveis.map(inst => {
            const isBlocked = (inst.whatsapp_score || 0) < LIMIAR_PADRAO;
            return (
              <div key={inst.id} className={`flex items-center justify-between p-3 border rounded-lg ${isBlocked ? 'bg-red-50/50 dark:bg-red-950/10 border-red-200' : ''}`}>
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    disabled={isBlocked} 
                    checked={form.instancias_ids.includes(inst.id)}
                    onChange={(e) => {
                      const ids = e.target.checked 
                        ? [...form.instancias_ids, inst.id]
                        : form.instancias_ids.filter((id: string) => id !== inst.id);
                      setForm({...form, instancias_ids: ids});
                    }}
                    className="h-4 w-4" 
                  />
                  <div>
                    <p className="text-sm font-bold">{inst.nome}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{inst.evolution_instancia}</p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={isBlocked ? "destructive" : "outline"} className="text-[10px]">
                    Score: {inst.whatsapp_score || 0}
                  </Badge>
                  {isBlocked && <p className="text-[9px] text-red-500 font-bold mt-1 uppercase">Bloqueada</p>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Velocity Profiles */}
      <div className="grid grid-cols-3 gap-4">
        {profiles.map(p => (
          <Card 
            key={p.id} 
            className={`p-4 cursor-pointer transition-all border-2 ${form.perfil_velocidade === p.id ? 'border-primary shadow-md' : 'border-transparent'}`}
            onClick={() => setForm({...form, perfil_velocidade: p.id})}
          >
            <p.icon className={`h-8 w-8 mb-2 ${p.color}`} />
            <h3 className="font-bold text-sm">{p.label}</h3>
            <div className="mt-2 space-y-1">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Delay: {p.delay}</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Limite: {p.limit}/dia</p>
            </div>
            {p.alert && <p className="text-[9px] text-red-500 font-bold mt-2 uppercase flex items-center gap-1"><AlertOctagon className="h-3 w-3" /> Risco de Ban</p>}
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Sending Window */}
        <Card className="p-4 space-y-4">
          <Label className="font-bold flex items-center gap-2"><Calendar className="h-4 w-4" /> Janela de Envio</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Início</span>
              <Input type="time" value={form.janela_inicio} onChange={e => setForm({...form, janela_inicio: e.target.value})} />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Término</span>
              <Input type="time" value={form.janela_fim} onChange={e => setForm({...form, janela_fim: e.target.value})} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Pausar nos fins de semana</span>
            <Switch checked={form.pausa_fins_semana} onCheckedChange={v => setForm({...form, pausa_fins_semana: v})} />
          </div>
        </Card>

        {/* Auto Pause */}
        <Card className="p-4 space-y-4">
          <Label className="font-bold flex items-center gap-2"><Settings2 className="h-4 w-4" /> Pausa Automática</Label>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs">Pausar em erros consecutivos</span>
              <Switch checked={form.pausa_erros_consecutivos} onCheckedChange={v => setForm({...form, pausa_erros_consecutivos: v})} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Pausar se bloqueios detectados</span>
              <Switch checked={form.pausa_bloqueios_detectados} onCheckedChange={v => setForm({...form, pausa_bloqueios_detectados: v})} />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Falhas seguidas para pausar</span>
              <Input type="number" value={form.limite_erros_consecutivos} onChange={e => setForm({...form, limite_erros_consecutivos: parseInt(e.target.value)})} className="h-8" />
            </div>
          </div>
        </Card>

        {/* Humanização IA */}
        <Card className="p-4 space-y-3 border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-bold">Humanizar com IA</Label>
              <p className="text-[11px] text-muted-foreground">
                Reescreve cada mensagem com leve variação para reduzir risco de bloqueio pela Meta.
              </p>
            </div>
            <Switch
              checked={form.humanizar_ia}
              onCheckedChange={v => setForm({...form, humanizar_ia: v})}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}


function StepReview({ form, targetContacts, loadingContacts, onStart }: any) {
  const estimate = useMemo(() => {
    const total = targetContacts.length || 0;
    const msgsPerHour = form.perfil_velocidade === 'safe' ? 60 : form.perfil_velocidade === 'moderate' ? 120 : 240;
    const totalMinutes = Math.ceil((total / msgsPerHour) * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const endDate = new Date(Date.now() + totalMinutes * 60_000);
    const endStr = endDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return { label: total === 0 ? "—" : `${h}h ${m}m`, end: total === 0 ? "—" : endStr };
  }, [targetContacts.length, form.perfil_velocidade]);

  const [agendarAt, setAgendarAt] = useState("");

  const handleStart = async (now = true) => {
    try {
      if (targetContacts.length === 0) {
        toast.error("Nenhum contato encontrado com os filtros selecionados.");
        return;
      }

      const { data: { user } } = await api.auth.getUser();


      const payload: any = {
        user_id: user?.id,
        nome: form.nome || "Disparo em Massa " + new Date().toLocaleDateString(),
        status: now ? 'em_andamento' : 'rascunho',
        perfil_velocidade: form.perfil_velocidade,
        horario_inicio: form.janela_inicio,
        horario_fim: form.janela_fim,
        instancias_ids: form.instancias_ids,
        total_leads: targetContacts.length,
        mensagem_template: form.mensagem,
        tipo_midia: form.tipo_midia,
        url_midia: form.url_midia,
        legenda_midia: form.legenda_midia,
        agendado_para: now ? null : agendarAt,
        pausa_fins_semana: form.pausa_fins_semana,
        pausa_erros_consecutivos: form.pausa_erros_consecutivos,
        limite_erros_consecutivos: form.limite_erros_consecutivos,
        pausa_bloqueios_detectados: form.pausa_bloqueios_detectados,
        humanizar_ia: form.humanizar_ia,
      };


      const { data: campaignData, error: campaignError } = await api
        .from("disparos")
        .insert(payload)
        .select()
        .single();

      if (campaignError) throw campaignError;

      // 2. Criar logs individuais (mensagens pendentes)
      const logs = targetContacts.map(c => ({
        disparo_id: campaignData.id,
        user_id: user?.id,
        contato_id: c.id,
        telefone: c.telefone,
        nome: c.nome,
        mensagem_enviada: form.mensagem.replace('{{nome}}', c.nome || 'cliente').replace('{{primeiro_nome}}', (c.nome || 'cliente').split(' ')[0]),
        status: 'pending'
      }));


      const { error: logsError } = await api.from("disparo_logs").insert(logs);
      if (logsError) throw logsError;
      
      toast.success(now ? "Campanha iniciada!" : "Campanha agendada!");
      if (now) onStart(campaignData);
    } catch (err: any) {
      toast.error("Erro ao iniciar campanha: " + err.message);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-6">
      <Card className="col-span-2 p-6 space-y-6">
        <h3 className="text-lg font-bold">Revisão da Configuração</h3>
        
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Destinatários</p>
              <div className="flex items-center gap-2 mt-1">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-xl font-bold">{loadingContacts ? "..." : targetContacts.length} contatos</span>

              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Duplicados removidos automaticamente</p>
            </div>
            
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Proteção Ativa</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                  <ShieldCheck className="h-3 w-3 mr-1" /> Perfil {form.perfil_velocidade}
                </Badge>
                {form.pausa_fins_semana && <Badge variant="outline">Pausa FDS</Badge>}
                <Badge variant="outline">Janela: {form.janela_inicio} - {form.janela_fim}</Badge>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Tempo Estimado</p>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-xl font-bold">{estimate.label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Término previsto: {estimate.end}</p>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Instâncias</p>
              <div className="flex gap-2 mt-2">
                {form.instancias_ids.length} selecionadas
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-muted/50 rounded-lg border">
          <p className="text-xs font-bold mb-2">Resumo da Mensagem:</p>
          <p className="text-xs italic text-muted-foreground line-clamp-3">"{form.mensagem}"</p>
        </div>
      </Card>

      <Card className="p-6 flex flex-col justify-between">
        <div className="space-y-4">
          <h3 className="font-bold">Ações</h3>
          <Button className="w-full gap-2 h-12 text-lg font-bold" onClick={() => handleStart(true)}>
            <Play className="h-5 w-5 fill-current" /> Disparar Agora
          </Button>
          
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-background px-2 text-muted-foreground">OU</span></div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Agendar para:</Label>
            <Input type="datetime-local" value={agendarAt} onChange={e => setAgendarAt(e.target.value)} />
            <Button variant="outline" className="w-full gap-2" disabled={!agendarAt} onClick={() => handleStart(false)}>
              <Calendar className="h-4 w-4" /> Agendar Disparo
            </Button>
          </div>
        </div>

        <p className="text-[10px] text-center text-muted-foreground mt-6 italic">
          Ao iniciar, o sistema respeitará as regras de delay e janela de envio configuradas.
        </p>
      </Card>
    </div>
  );
}

function MonitoringDashboard({ campaign, onCancel }: { campaign: any, onCancel: () => void }) {
  const [currentCampaign, setCurrentCampaign] = useState(campaign);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchProgress = async () => {
      // 1. Atualizar dados da campanha
      const { data: campaignData } = await api
        .from("disparos")
        .select("*")
        .eq("id", campaign.id)
        .single();
      
      if (campaignData) {
        setCurrentCampaign(campaignData);
      }

      // 2. Buscar logs recentes
      const { data: logsData } = await api
        .from("disparo_logs")
        .select("*")
        .eq("disparo_id", campaign.id)
        .order("created_at", { ascending: false })
        .limit(20);
      
      if (logsData) {
        setLogs(logsData);
      }
    };

    fetchProgress();
    const timer = setInterval(fetchProgress, 3000);
    return () => clearInterval(timer);
  }, [campaign.id]);

  const stats = [
    { label: "Enviados", val: currentCampaign.enviados || 0, total: currentCampaign.total_leads || 0, icon: Send, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Entregues", val: currentCampaign.entregues || 0, total: null, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Respondidos", val: currentCampaign.respondidos || 0, total: null, icon: MessageSquare, color: "text-purple-500", bg: "bg-purple-500/10" },
    { label: "Falhas", val: currentCampaign.falhas || 0, total: null, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
  ];

  const failureRate = currentCampaign.enviados > 0 ? (currentCampaign.falhas / (currentCampaign.enviados + currentCampaign.falhas)) * 100 : 0;

  const handleStatusChange = async (newStatus: string) => {
    const { error } = await api
      .from("disparos")
      .update({ status: newStatus })
      .eq("id", campaign.id);
    
    if (error) {
      toast.error("Erro ao alterar status: " + error.message);
    } else {
      toast.success(`Campanha ${newStatus === 'pausado' ? 'pausada' : 'cancelada'}!`);
      if (newStatus === 'cancelado') onCancel();
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in zoom-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary animate-pulse" />
            Monitoramento: {currentCampaign.nome}
          </h2>
          <Badge className={`mt-1 ${currentCampaign.status === 'em_andamento' ? 'bg-emerald-500/20 text-emerald-600' : 'bg-yellow-500/20 text-yellow-600'}`}>
            {currentCampaign.status.toUpperCase()}
          </Badge>
        </div>
        <div className="flex gap-2">
          {currentCampaign.status === 'em_andamento' ? (
            <Button variant="outline" onClick={() => handleStatusChange('pausado')}><Pause className="w-4 h-4 mr-2" /> Pausar</Button>
          ) : (
            <Button variant="outline" onClick={() => handleStatusChange('em_andamento')}><Play className="w-4 h-4 mr-2" /> Retomar</Button>
          )}
          <Button variant="destructive" onClick={() => handleStatusChange('cancelado')}><Square className="w-4 h-4 mr-2" /> Cancelar</Button>
        </div>
      </div>

      {failureRate > 10 && (
        <Alert variant={failureRate > 25 ? "destructive" : "default"} className={`animate-bounce ${failureRate <= 25 ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20' : ''}`}>
          <AlertCircle className={`h-4 w-4 ${failureRate <= 25 ? 'text-yellow-500' : ''}`} />
          <AlertTitle className={failureRate <= 25 ? 'text-yellow-600' : ''}>{failureRate > 25 ? "Pausa Automática Ativada" : "Taxa de Falha Elevada"}</AlertTitle>
          <AlertDescription className={failureRate <= 25 ? 'text-yellow-600/80' : ''}>
            {failureRate > 25 
              ? "A campanha foi pausada automaticamente devido a uma taxa de erro superior a 25%." 
              : "Detectamos que mais de 10% dos disparos estão falhando. Recomendamos revisar suas instâncias."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="p-5 border-none shadow-sm overflow-hidden relative group">
            <div className={`absolute top-0 right-0 p-4 transition-transform group-hover:scale-110`}>
              <s.icon className={`h-12 w-12 opacity-10 ${s.color}`} />
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{s.label}</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-3xl font-black ${s.color}`}>{s.val}</span>
              {s.total !== null && <span className="text-sm text-muted-foreground font-bold">/ {s.total}</span>}
            </div>
            {s.total !== null && <Progress value={(s.val/s.total)*100} className={`h-1.5 mt-3 ${s.bg}`} />}
            {s.label === "Respondidos" && s.val > 0 && (
              <p className="text-[10px] text-purple-600 font-bold mt-2">
                Conversão: {((s.val / currentCampaign.enviados) * 100).toFixed(1)}%
              </p>
            )}
          </Card>
        ))}
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <div className="bg-muted/30 p-4 border-b flex justify-between items-center">
          <h3 className="font-bold text-sm flex items-center gap-2"><TableIcon className="h-4 w-4" /> Log de Envios (Tempo Real)</h3>
          <Badge variant="outline" className="text-[10px]">Atualizando a cada 3s</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/10">
                <th className="p-3 text-left font-bold">Nome</th>
                <th className="p-3 text-left font-bold">Número</th>
                <th className="p-3 text-left font-bold">Status</th>
                <th className="p-3 text-left font-bold">Erro</th>
                <th className="p-3 text-left font-bold">Horário</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log, i) => (
                <tr key={log.id} className="hover:bg-muted/5 transition-colors">
                  <td className="p-3 font-medium">{log.nome || "Contato"}</td>
                  <td className="p-3 text-xs font-mono">{log.telefone}</td>
                  <td className="p-3">
                    <Badge variant={
                      log.status === 'sent' ? 'secondary' : 
                      log.status === 'failed' ? 'destructive' :
                      log.status === 'sending' ? 'default' : 'outline'
                    } className="text-[10px] px-2 py-0">
                      {log.status === 'sent' ? 'Enviado' : 
                       log.status === 'failed' ? 'Falha' :
                       log.status === 'sending' ? 'Enviando...' : 'Pendente'}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-red-500 max-w-[200px] truncate" title={log.erro}>
                    {log.erro || "-"}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(log.enviado_at || log.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground italic">
                    Nenhum envio registrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}


