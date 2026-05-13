import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, FileText, Loader2, FileUp, Trash2, Eye, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import * as pdfjs from "pdfjs-dist";
import mammoth from "mammoth";

// Worker do PDF.js — usa CDN para não precisar configurar build
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

const TIPOS = [
  { value: "faq", label: "FAQ" },
  { value: "script", label: "Script de Vendas" },
  { value: "objecao", label: "Objeção" },
  { value: "personalidade", label: "Personalidade" },
  { value: "negocio", label: "Negócio / Empresa" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: () => void;
}

interface ArquivoProcessado {
  nome: string;
  tamanho: number;
  conteudo: string;
  chunks: string[];
}

const CHUNK_SIZE = 1000; // caracteres por chunk
const CHUNK_OVERLAP = 100;

function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size));
    i += size - overlap;
  }
  return chunks.filter(c => c.trim().length > 50);
}

async function extrairTextoArquivo(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "txt" || ext === "md" || ext === "csv") {
    return await file.text();
  }

  if (ext === "pdf") {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    let texto = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      texto += content.items.map((it: any) => it.str).join(" ") + "\n\n";
    }
    return texto;
  }

  if (ext === "docx") {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  throw new Error(`Formato .${ext} não suportado. Use PDF, DOCX, TXT ou MD.`);
}

export function UploadDocumentos({ open, onOpenChange, onUploaded }: Props) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [arquivos, setArquivos] = useState<ArquivoProcessado[]>([]);
  const [tipo, setTipo] = useState("faq");
  const [categoria, setCategoria] = useState("");
  const [processando, setProcessando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setProcessando(true);
    const novos: ArquivoProcessado[] = [];
    
    for (const file of Array.from(fileList)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name}: arquivo maior que 10MB`);
        continue;
      }
      try {
        const conteudo = await extrairTextoArquivo(file);
        if (!conteudo.trim()) {
          toast.error(`${file.name}: nenhum texto extraído`);
          continue;
        }
        const chunks = chunkText(conteudo);
        novos.push({ nome: file.name, tamanho: file.size, conteudo, chunks });
      } catch (e: any) {
        toast.error(`${file.name}: ${e.message}`);
      }
    }
    
    setArquivos(prev => [...prev, ...novos]);
    setProcessando(false);
    if (novos.length > 0) toast.success(`${novos.length} arquivo(s) processado(s)`);
  };

  const removerArquivo = (idx: number) => {
    setArquivos(prev => prev.filter((_, i) => i !== idx));
  };

  const totalChunks = arquivos.reduce((sum, a) => sum + a.chunks.length, 0);

  const indexar = async () => {
    if (!user) return toast.error("Faça login");
    if (arquivos.length === 0) return toast.error("Selecione ao menos um arquivo");
    if (!categoria.trim()) return toast.error("Informe a categoria");

    setEnviando(true);
    let totalInseridos = 0;
    let erros = 0;

    try {
      for (const arq of arquivos) {
        for (let i = 0; i < arq.chunks.length; i++) {
          const content = `${tipo}: ${arq.nome} (parte ${i + 1}/${arq.chunks.length})\n${arq.chunks[i]}`;
          const metadata = {
            tipo,
            categoria: categoria.trim(),
            campo: arq.nome,
            chunk_index: i,
            total_chunks: arq.chunks.length,
            origem: "upload_documento",
            tamanho_arquivo: arq.tamanho,
          };
          const { error } = await (api as any).from("documents").insert({ user_id: user.id, content, metadata });
          if (error) erros++;
          else totalInseridos++;
        }
      }

      if (erros > 0) {
        toast.warning(`${totalInseridos} chunks indexados, ${erros} falharam`);
      } else {
        toast.success(`✅ ${totalInseridos} chunks indexados! Lembre-se de reindexar via n8n para gerar embeddings.`);
      }

      // Reset
      setArquivos([]);
      setCategoria("");
      onUploaded?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro ao indexar: " + e.message);
    } finally {
      setEnviando(false);
    }
  };

  const fmtSize = (b: number) => b < 1024 * 1024 ? `${(b/1024).toFixed(1)} KB` : `${(b/1024/1024).toFixed(1)} MB`;
  const fmtIcon = (nome: string) => {
    const ext = nome.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return "📄";
    if (ext === "docx") return "📝";
    if (ext === "csv" || ext === "xlsx") return "📊";
    return "📃";
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!enviando) onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5 text-primary" /> Upload e Indexação de Documentos
          </DialogTitle>
          <DialogDescription>
            Envie arquivos PDF, DOCX, TXT ou MD. O conteúdo será dividido em chunks e adicionado à base RAG.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {/* Categoria e Tipo */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo de Conhecimento</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Categoria <span className="text-destructive">*</span></Label>
              <Input 
                placeholder="Ex: Manual de Vendas, FAQ Produto X" 
                value={categoria} 
                onChange={(e) => setCategoria(e.target.value)}
              />
            </div>
          </div>

          {/* Drop zone */}
          <div 
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,.csv"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            {processando ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Processando arquivos...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm font-medium">Arraste arquivos aqui ou clique para selecionar</p>
                <p className="text-xs text-muted-foreground">PDF, DOCX, TXT, MD, CSV (máx. 10MB cada)</p>
              </div>
            )}
          </div>

          {/* Lista de arquivos */}
          {arquivos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {arquivos.length} arquivo(s) • {totalChunks} chunks
                </p>
                <Badge variant="outline">~{Math.round(totalChunks * 0.5)}s para indexar</Badge>
              </div>
              <ScrollArea className="max-h-64">
                <div className="space-y-2">
                  {arquivos.map((arq, idx) => (
                    <div key={idx} className="border rounded-lg p-3 flex items-center gap-3">
                      <span className="text-2xl">{fmtIcon(arq.nome)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{arq.nome}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-[10px] h-4 px-1">{fmtSize(arq.tamanho)}</Badge>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">{arq.chunks.length} chunks</Badge>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">{arq.conteudo.length.toLocaleString()} chars</Badge>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewIdx(idx)} title="Preview">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removerArquivo(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Preview */}
          {previewIdx !== null && arquivos[previewIdx] && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Preview: {arquivos[previewIdx].nome}
                </p>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setPreviewIdx(null)}>Fechar</Button>
              </div>
              <ScrollArea className="h-48">
                <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">
                  {arquivos[previewIdx].conteudo.slice(0, 3000)}
                  {arquivos[previewIdx].conteudo.length > 3000 && "\n\n... (truncado)"}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={indexar} disabled={enviando || arquivos.length === 0 || !categoria.trim()}>
            {enviando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Indexar {totalChunks > 0 ? `${totalChunks} chunks` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
