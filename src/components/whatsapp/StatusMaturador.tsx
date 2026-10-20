/**
 * StatusMaturador.tsx — Sprint 10 do maturador v5 (2026-10-20, modelo ChipFlow): fila de status de
 * um chip (até 20 imagens + 20 textos), publicados 1 por dia entre 14h e 20h, e quem vê.
 * Sem nada cadastrado, o sistema escreve uma frase (e às vezes usa uma foto) sozinho.
 * Backend: GET /api/maturador/status/:agenteId, POST /status/:agenteId/itens, DELETE /status/itens/:id,
 * PUT /controles/:agenteId { status_visibilidade }.
 */
import { useEffect, useRef, useState } from "react";
import { authHeader } from "@/lib/api-token";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ImagePlus, Trash2, Type, Loader2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

async function chamar(path: string, opts: { method?: string; body?: any } = {}) {
  const r = await fetch(`${API_URL}/api/maturador${path}`, {
    method: opts.method || "GET",
    headers: { ...authHeader(), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || `Erro ${r.status}`);
  return d;
}

const lerArquivo = (f: File) => new Promise<string>((ok, erro) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result));
  fr.onerror = () => erro(new Error("Não consegui ler o arquivo"));
  fr.readAsDataURL(f);
});

export function StatusMaturador({ chip, aberto, onFechar }: { chip: { agente_id: string; nome: string } | null; aberto: boolean; onFechar: (mudou: boolean) => void }) {
  const [d, setD] = useState<any>(null);
  const [texto, setTexto] = useState("");
  const [legenda, setLegenda] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const mudou = useRef(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const carregar = () => chip && chamar(`/status/${chip.agente_id}`).then(setD).catch((e) => toast.error(e.message));
  useEffect(() => { if (aberto) { mudou.current = false; setD(null); carregar(); } }, [aberto, chip?.agente_id]);

  const executar = async (fn: () => Promise<any>) => {
    setOcupado(true);
    try { await fn(); mudou.current = true; await carregar(); }
    catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  };

  const textos = d?.itens?.filter((i: any) => i.tipo === "texto") ?? [];
  const imagens = d?.itens?.filter((i: any) => i.tipo === "imagem") ?? [];
  const lim = d?.limites ?? { por_tipo: 20, caracteres_texto: 500, caracteres_legenda: 200 };
  const dataPub = (s: string | null) => s ? new Date(s).toLocaleDateString("pt-BR") : "ainda não saiu";

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar(mudou.current)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Status — {chip?.nome}</DialogTitle>
          <DialogDescription>
            1 status por dia, entre 14h e 20h, na ordem da fila. Quando todos já saíram, a fila recomeça.
            Sem nada cadastrado, o sistema escreve uma frase sozinho (às vezes com foto).
          </DialogDescription>
        </DialogHeader>

        {!d ? <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">Quem vê</p>
              <RadioGroup value={d.visibilidade} disabled={ocupado}
                onValueChange={(v) => executar(() => chamar(`/controles/${chip!.agente_id}`, { method: "PUT", body: { status_visibilidade: v } }))}>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="parceiros" id="vis-p" className="mt-0.5" />
                  <Label htmlFor="vis-p" className="font-normal leading-snug">
                    Só os números do aquecimento <span className="text-muted-foreground">(recomendado — seus clientes não veem)</span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="todos" id="vis-t" className="mt-0.5" />
                  <Label htmlFor="vis-t" className="font-normal leading-snug">
                    Todos os contatos do número <span className="text-muted-foreground">(clientes também veem)</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1 text-sm font-medium"><ImagePlus className="h-4 w-4" /> Imagens</p>
                <Badge variant="outline">{imagens.length}/{lim.por_tipo}</Badge>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input placeholder="Legenda (opcional)" value={legenda} maxLength={lim.caracteres_legenda} onChange={(e) => setLegenda(e.target.value)} />
                <input ref={arquivo} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    if (f.size > 10 * 1024 * 1024) return toast.error("Imagem grande demais (máx. 10 MB)");
                    await executar(async () => {
                      await chamar(`/status/${chip!.agente_id}/itens`, { method: "POST", body: { tipo: "imagem", imagem: await lerArquivo(f), legenda } });
                      setLegenda("");
                    });
                  }} />
                <Button type="button" variant="secondary" disabled={ocupado || imagens.length >= lim.por_tipo} onClick={() => arquivo.current?.click()}>
                  Escolher imagem
                </Button>
              </div>
              {imagens.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {imagens.map((i: any) => (
                    <div key={i.id} className="group relative overflow-hidden rounded-md border">
                      <img src={i.url} alt={i.legenda || "status"} className="aspect-square w-full object-cover" loading="lazy" />
                      <div className="space-y-0.5 p-1 text-[10px] leading-tight">
                        {i.legenda && <p className="truncate">{i.legenda}</p>}
                        <p className="text-muted-foreground">{d.proximo_id === i.id ? "próximo" : dataPub(i.publicado_em)}</p>
                      </div>
                      <button type="button" aria-label="Remover imagem" disabled={ocupado}
                        onClick={() => executar(() => chamar(`/status/itens/${i.id}`, { method: "DELETE" }))}
                        className="absolute right-1 top-1 rounded bg-background/80 p-1 opacity-80 hover:opacity-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1 text-sm font-medium"><Type className="h-4 w-4" /> Textos</p>
                <Badge variant="outline">{textos.length}/{lim.por_tipo}</Badge>
              </div>
              <Textarea placeholder="Texto do status" value={texto} maxLength={lim.caracteres_texto} rows={3} onChange={(e) => setTexto(e.target.value)} />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{texto.length}/{lim.caracteres_texto}</span>
                <Button type="button" size="sm" disabled={ocupado || !texto.trim() || textos.length >= lim.por_tipo}
                  onClick={() => executar(async () => { await chamar(`/status/${chip!.agente_id}/itens`, { method: "POST", body: { tipo: "texto", texto } }); setTexto(""); })}>
                  Adicionar texto
                </Button>
              </div>
              {textos.length > 0 && (
                <ul className="divide-y rounded-md border">
                  {textos.map((i: any) => (
                    <li key={i.id} className="flex items-start justify-between gap-2 p-2">
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap break-words text-sm">{i.conteudo}</p>
                        <p className="text-[11px] text-muted-foreground">{d.proximo_id === i.id ? "próximo" : dataPub(i.publicado_em)}</p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" aria-label="Remover texto" disabled={ocupado}
                        onClick={() => executar(() => chamar(`/status/itens/${i.id}`, { method: "DELETE" }))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
