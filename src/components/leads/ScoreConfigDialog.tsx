import { useEffect, useState } from "react";
import { api } from "@/integrations/database/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ConfigApi {
  pesos: Record<string, number>;
  ddds_interesse: string[];
  nichos_alvo: string[];
  dicionario: Record<string, { tipo: "b2b" | "b2c"; palavras: string[] }>;
  grupo_b2c_palavras: string[];
}

// Estado de edição: listas viram texto separado por vírgula.
interface ConfigForm {
  pesos: Record<string, number>;
  ddds: string;
  alvos: Set<string>;
  nichos: { nome: string; tipo: "b2b" | "b2c"; palavras: string }[];
  b2c: string;
}

const ROTULOS_PESO: Record<string, string> = {
  valido: "WhatsApp válido",
  business: "WhatsApp Business",
  nome_real: "Nome real",
  nicho_alvo: "Nicho-alvo",
  nicho_detectado: "Nicho detectado (fora dos alvos)",
  ddd_interesse: "DDD de interesse",
  multiplas_listas: "Em 2+ listas de negócios",
  fixo: "Telefone fixo",
  sem_whatsapp: "Sem WhatsApp",
  sem_foto: "Sem foto de perfil",
  grupo_b2c: "Só em grupos de consumidor final",
  admin_grupo: "Administrador de grupo",
};

const csv = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

function paraForm(c: ConfigApi): ConfigForm {
  return {
    pesos: { ...c.pesos },
    ddds: c.ddds_interesse.join(", "),
    alvos: new Set(c.nichos_alvo),
    nichos: Object.entries(c.dicionario).map(([nome, d]) => ({ nome, tipo: d.tipo, palavras: d.palavras.join(", ") })),
    b2c: c.grupo_b2c_palavras.join(", "),
  };
}

export function ScoreConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<ConfigForm | null>(null);
  const [padrao, setPadrao] = useState<ConfigApi | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [novoNicho, setNovoNicho] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(null);
    (async () => {
      try {
        const { data } = await api.get("/api/higienizacao/score-config");
        setForm(paraForm(data.config));
        setPadrao(data.padrao);
      } catch (err: any) {
        toast.error("Não foi possível carregar a configuração", { description: err?.message });
        onClose();
      }
    })();
  }, [open]);

  const salvar = async () => {
    if (!form) return;
    setSalvando(true);
    try {
      const dicionario: ConfigApi["dicionario"] = {};
      for (const n of form.nichos) dicionario[n.nome] = { tipo: n.tipo, palavras: csv(n.palavras) };
      await api.put("/api/higienizacao/score-config", {
        pesos: form.pesos,
        ddds_interesse: csv(form.ddds),
        nichos_alvo: Array.from(form.alvos),
        dicionario,
        grupo_b2c_palavras: csv(form.b2c),
      });
      toast.success("Configuração salva", { description: "Rode a higienização com \"Classificar\" para aplicar aos contatos existentes." });
      onClose();
    } catch (err: any) {
      toast.error("Não foi possível salvar", { description: err?.message });
    } finally {
      setSalvando(false);
    }
  };

  const adicionarNicho = () => {
    const nome = novoNicho.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!form || nome.length < 2) { toast.error("Use um nome com ao menos 2 letras (a-z, 0-9 e _)"); return; }
    if (form.nichos.some(n => n.nome === nome)) { toast.error("Esse nicho já existe"); return; }
    setForm({ ...form, nichos: [...form.nichos, { nome, tipo: "b2b", palavras: "" }] });
    setNovoNicho("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Score e nichos</DialogTitle>
          <DialogDescription>
            O score de 0 a 100 é calculado só por regras e pesos (sem IA). Cada ponto tem um motivo que aparece no contato.
          </DialogDescription>
        </DialogHeader>

        {!form ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Pesos (pontos somados ou subtraídos)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {Object.keys(ROTULOS_PESO).map((k) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <span className="text-sm">{ROTULOS_PESO[k]}</span>
                    <Input
                      type="number" min={-100} max={100} className="w-20 h-8"
                      value={form.pesos[k] ?? 0}
                      onChange={(e) => setForm({ ...form, pesos: { ...form.pesos, [k]: Number(e.target.value) } })}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">DDDs de interesse (separados por vírgula)</Label>
              <Input value={form.ddds} onChange={(e) => setForm({ ...form, ddds: e.target.value })} placeholder="11, 12, 13" />
            </section>

            <section className="space-y-3">
              <Label className="text-xs uppercase text-muted-foreground">Nichos — marque os que são alvo</Label>
              {form.nichos.map((n, i) => (
                <div key={n.nome} className="rounded border p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={form.alvos.has(n.nome)}
                      onCheckedChange={(v) => {
                        const alvos = new Set(form.alvos);
                        v === true ? alvos.add(n.nome) : alvos.delete(n.nome);
                        setForm({ ...form, alvos });
                      }}
                    />
                    <span className="font-medium text-sm flex-1">{n.nome}</span>
                    <select
                      className="h-8 rounded border bg-background px-2 text-sm"
                      value={n.tipo}
                      onChange={(e) => setForm({ ...form, nichos: form.nichos.map((x, j) => j === i ? { ...x, tipo: e.target.value as "b2b" | "b2c" } : x) })}
                    >
                      <option value="b2b">B2B</option>
                      <option value="b2c">B2C</option>
                    </select>
                    <Button
                      type="button" size="icon" variant="ghost" className="h-8 w-8"
                      onClick={() => {
                        const alvos = new Set(form.alvos); alvos.delete(n.nome);
                        setForm({ ...form, alvos, nichos: form.nichos.filter((_, j) => j !== i) });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Textarea
                    rows={2} className="text-xs" value={n.palavras} placeholder="palavras-chave separadas por vírgula"
                    onChange={(e) => setForm({ ...form, nichos: form.nichos.map((x, j) => j === i ? { ...x, palavras: e.target.value } : x) })}
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <Input value={novoNicho} onChange={(e) => setNovoNicho(e.target.value)} placeholder="novo nicho (ex.: pet)" className="h-8" />
                <Button type="button" size="sm" variant="outline" onClick={adicionarNicho}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
              </div>
            </section>

            <section className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Palavras de grupos de consumidor final (B2C)</Label>
              <Textarea rows={2} className="text-xs" value={form.b2c} onChange={(e) => setForm({ ...form, b2c: e.target.value })} />
              <p className="text-xs text-muted-foreground">Se o nome do grupo de origem tem uma dessas palavras, o contato perde pontos e pode ser marcado como B2C.</p>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={!padrao || !form} onClick={() => padrao && setForm(paraForm(padrao))}>Restaurar padrão</Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={!form || salvando}>
            {salvando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
