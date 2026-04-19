import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Copy, Save, Loader2, Eye, RotateCcw, Trash2, FileCode, Code2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface AgentPrompt {
  id: number;
  nome: string;
  conteudo: string;
  ativo: boolean;
  created_at: string;
  created_by: string | null;
}

const KEYWORDS = ["PROIBIDO", "PROIBIDA", "SEMPRE", "NUNCA", "OBRIGATÓRIO", "OBRIGATORIO"];

function highlightKeywords(text: string) {
  if (!text) return null;
  const regex = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "g");
  const parts = text.split(regex);
  return parts.map((p, i) =>
    KEYWORDS.includes(p.toUpperCase())
      ? <mark key={i} className="bg-destructive/20 text-destructive font-semibold rounded px-0.5">{p}</mark>
      : <span key={i}>{p}</span>
  );
}

function detectVariables(text: string) {
  const set = new Set<string>();
  const regex = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m;
  while ((m = regex.exec(text)) !== null) set.add(m[1].trim());
  return Array.from(set);
}

function describeVar(v: string): string {
  if (v.includes("$now")) return "Data/hora atual da execução do n8n";
  if (v.includes("$json")) return "Campo do JSON de entrada do node anterior";
  if (v.includes("$node")) return "Output de um node específico do workflow";
  if (v.includes("$workflow")) return "Metadados do workflow";
  return "Expressão dinâmica do n8n";
}

export function PromptAgente() {
  const { user } = useAuth();
  const [prompts, setPrompts] = useState<AgentPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [openSalvar, setOpenSalvar] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [visualizando, setVisualizando] = useState<AgentPrompt | null>(null);

  const ativo = prompts.find((p) => p.ativo) ?? null;

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("agent_prompts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { toast.error(error.message); setLoading(false); return; }
    const list = (data ?? []) as AgentPrompt[];
    setPrompts(list);
    const at = list.find((p) => p.ativo);
    setEditor(at?.conteudo ?? "");
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const salvarNovaVersao = async () => {
    if (!user) return toast.error("Faça login");
    if (!novoNome.trim() || !editor.trim()) return toast.error("Preencha nome e conteúdo");
    setSalvando(true);
    // desativa atuais
    await (supabase as any).from("agent_prompts").update({ ativo: false }).eq("user_id", user.id).eq("ativo", true);
    const { error } = await (supabase as any).from("agent_prompts").insert({
      user_id: user.id,
      nome: novoNome.trim(),
      conteudo: editor,
      ativo: true,
      created_by: user.email ?? null,
    });
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success("Nova versão salva e ativada");
    setNovoNome("");
    setOpenSalvar(false);
    carregar();
  };

  const restaurar = async (p: AgentPrompt) => {
    if (!user) return;
    await (supabase as any).from("agent_prompts").update({ ativo: false }).eq("user_id", user.id).eq("ativo", true);
    const { error } = await (supabase as any).from("agent_prompts").update({ ativo: true }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(`Versão "${p.nome}" ativada`);
    carregar();
  };

  const deletar = async (p: AgentPrompt) => {
    const { error } = await (supabase as any).from("agent_prompts").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Versão removida");
    carregar();
  };

  const copiar = async () => {
    await navigator.clipboard.writeText(editor);
    toast.success("Prompt copiado");
  };

  const copiarParaN8n = async () => {
    const escaped = editor.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    await navigator.clipboard.writeText(escaped);
    toast.success("Versão escapada copiada para colar no n8n");
  };

  const variaveis = useMemo(() => detectVariables(editor), [editor]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Editor */}
        <div className="lg:col-span-2 space-y-3">
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <FileCode className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Prompt ativo</h3>
                  {ativo && <Badge className="bg-success/15 text-success border-0">{ativo.nome}</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copiar}><Copy className="h-4 w-4 mr-1" /> Copiar</Button>
                  <Button size="sm" variant="outline" onClick={copiarParaN8n}><Code2 className="h-4 w-4 mr-1" /> Copiar p/ n8n</Button>
                  <Dialog open={openSalvar} onOpenChange={setOpenSalvar}>
                    <DialogTrigger asChild>
                      <Button size="sm"><Save className="h-4 w-4 mr-1" /> Salvar como nova versão</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Salvar nova versão</DialogTitle>
                        <DialogDescription>Esta versão será ativada automaticamente.</DialogDescription>
                      </DialogHeader>
                      <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder='Ex: "Adicionei bloco RAG - 19/04/2026"' />
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setOpenSalvar(false)}>Cancelar</Button>
                        <Button onClick={salvarNovaVersao} disabled={salvando}>{salvando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar e ativar</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : (
                <>
                  <Textarea
                    value={editor}
                    onChange={(e) => setEditor(e.target.value)}
                    placeholder={prompts.length === 0 ? "Nenhum prompt salvo ainda. Cole seu prompt atual aqui e salve a primeira versão." : "Edite o prompt..."}
                    className="font-mono text-xs min-h-[600px] resize-y"
                    spellCheck={false}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{editor.length.toLocaleString("pt-BR")} caracteres • {editor.split(/\s+/).filter(Boolean).length} palavras</span>
                    <span>{KEYWORDS.filter((k) => editor.toUpperCase().includes(k)).length} palavras-chave detectadas</span>
                  </div>

                  {editor && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Pré-visualizar com destaques</summary>
                      <div className="mt-2 p-3 bg-muted/30 rounded font-mono text-xs whitespace-pre-wrap max-h-64 overflow-y-auto border">
                        {highlightKeywords(editor)}
                      </div>
                    </details>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Variáveis */}
          {variaveis.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Code2 className="h-4 w-4 text-primary" /> Variáveis dinâmicas detectadas</h4>
                <div className="space-y-1">
                  {variaveis.map((v) => (
                    <div key={v} className="flex items-start gap-2 text-xs">
                      <code className="bg-muted px-2 py-0.5 rounded font-mono shrink-0">{`{{ ${v} }}`}</code>
                      <span className="text-muted-foreground">{describeVar(v)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Instrução export */}
          <Card>
            <CardContent className="pt-4">
              <h4 className="font-semibold text-sm mb-1">Como usar no n8n</h4>
              <p className="text-xs text-muted-foreground">
                Use <strong>"Copiar p/ n8n"</strong> para obter o conteúdo já com escape de aspas e quebras de linha.
                Cole no campo <code className="bg-muted px-1 rounded">systemMessage</code> do node DIOGO PERNOCA.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Histórico */}
        <Card className="h-fit">
          <CardContent className="pt-4">
            <h3 className="font-semibold mb-3 text-sm">Histórico de versões ({prompts.length})</h3>
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : prompts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma versão salva ainda.</p>
            ) : (
              <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1">
                {prompts.map((p) => (
                  <div key={p.id} className={`border rounded-md p-2 ${p.ativo ? "border-success bg-success/5" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{p.nome}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(p.created_at).toLocaleString("pt-BR")}
                          {p.created_by && ` • ${p.created_by}`}
                        </p>
                      </div>
                      {p.ativo && <Badge className="bg-success/15 text-success border-0 text-[10px]">Ativo</Badge>}
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setVisualizando(p)}>
                        <Eye className="h-3 w-3 mr-1" /> Ver
                      </Button>
                      {!p.ativo && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => restaurar(p)}>
                            <RotateCcw className="h-3 w-3 mr-1" /> Restaurar
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive">
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remover esta versão?</AlertDialogTitle>
                                <AlertDialogDescription>"{p.nome}" será removida permanentemente.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deletar(p)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remover</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Visualização readonly */}
      <Dialog open={!!visualizando} onOpenChange={(o) => !o && setVisualizando(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{visualizando?.nome}</DialogTitle>
            <DialogDescription>
              {visualizando && new Date(visualizando.created_at).toLocaleString("pt-BR")}
              {visualizando?.created_by && ` • ${visualizando.created_by}`}
            </DialogDescription>
          </DialogHeader>
          <Textarea readOnly value={visualizando?.conteudo ?? ""} className="font-mono text-xs min-h-[500px]" />
          <DialogFooter>
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(visualizando?.conteudo ?? ""); toast.success("Copiado"); }}>
              <Copy className="h-4 w-4 mr-1" /> Copiar
            </Button>
            {visualizando && !visualizando.ativo && (
              <Button onClick={() => { restaurar(visualizando); setVisualizando(null); }}>
                <RotateCcw className="h-4 w-4 mr-1" /> Restaurar esta versão
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
