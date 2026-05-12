# Prompt Lovable — voice_id ElevenLabs em Agentes.tsx

## Contexto
O backend agora expõe `GET /api/elevenlabs/voices` que retorna a lista de vozes disponíveis na conta ElevenLabs do usuário. A tabela `agentes` ganhou os campos `voice_id`, `elevenlabs_model`, `voice_stability` e `voice_similarity` via migração SQL.

Queremos que, na página de criação/edição de um agente, o usuário possa escolher qual voz ElevenLabs o agente usará para gerar respostas em áudio.

---

## Alterações em `src/pages/Agentes.tsx` (ou componente de formulário de agente)

### 1) Tipo/interface do agente — adicionar campos
Nas interfaces/types existentes de agente, adicionar:
```ts
voice_id?: string | null;
elevenlabs_model?: string;
voice_stability?: number;
voice_similarity?: number;
```

### 2) Estado local do formulário — adicionar campos
No state do form de criação/edição:
```ts
voice_id: agente?.voice_id ?? "",
elevenlabs_model: agente?.elevenlabs_model ?? "eleven_multilingual_v2",
voice_stability: agente?.voice_stability ?? 0.5,
voice_similarity: agente?.voice_similarity ?? 0.75,
```

### 3) Buscar lista de vozes ao abrir o modal/formulário
Adicionar hook/effect que busca as vozes quando o modal abre:
```ts
const [vozes, setVozes] = useState<{ voice_id: string; name: string; preview_url: string | null }[]>([]);
const [loadingVozes, setLoadingVozes] = useState(false);

useEffect(() => {
  if (!modalAberto) return;
  const fetchVozes = async () => {
    setLoadingVozes(true);
    try {
      const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
      const token = localStorage.getItem("crm_access_token") || localStorage.getItem("access_token") || "";
      const r = await fetch(`${BASE}/api/elevenlabs/voices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        setVozes(data.voices ?? []);
      }
      // Se não há integração configurada, vozes fica vazio — sem erro visível
    } finally {
      setLoadingVozes(false);
    }
  };
  fetchVozes();
}, [modalAberto]);
```

### 4) Campo de seleção de voz no formulário
Dentro do formulário de criação/edição do agente, após os campos existentes (ex: após "Prompt" ou "Instância"), adicionar uma seção:

```tsx
{/* ── Voz ElevenLabs ── */}
<div className="space-y-2 border-t pt-4 mt-2">
  <Label className="text-sm font-medium flex items-center gap-2">
    <Volume2 className="w-4 h-4" />
    Voz ElevenLabs (opcional)
  </Label>
  <p className="text-xs text-muted-foreground">
    Selecione a voz que este agente usará para respostas em áudio.
    Configure sua API Key em{" "}
    <a href="/integracoes" className="underline text-primary">Integrações → ElevenLabs</a>.
  </p>

  {loadingVozes ? (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /> Carregando vozes...
    </div>
  ) : vozes.length === 0 ? (
    <p className="text-xs text-amber-600">
      Nenhuma voz encontrada. Verifique a integração ElevenLabs.
    </p>
  ) : (
    <Select
      value={form.voice_id ?? ""}
      onValueChange={(v) => setForm(f => ({ ...f, voice_id: v || null }))}
    >
      <SelectTrigger>
        <SelectValue placeholder="Sem voz (texto apenas)" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">Sem voz (texto apenas)</SelectItem>
        {vozes.map((v) => (
          <SelectItem key={v.voice_id} value={v.voice_id}>
            {v.name}
            {v.preview_url && (
              <span className="ml-2 text-xs text-muted-foreground">[preview disponível]</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )}

  {/* Preview da voz selecionada */}
  {form.voice_id && vozes.find(v => v.voice_id === form.voice_id)?.preview_url && (
    <div className="flex items-center gap-2 mt-1">
      <span className="text-xs text-muted-foreground">Preview:</span>
      <audio
        controls
        src={vozes.find(v => v.voice_id === form.voice_id)!.preview_url!}
        className="h-8 w-48"
      />
    </div>
  )}
</div>
```

**Importar `Volume2` e `Loader2` do lucide-react** se ainda não importados.

### 5) Incluir voice_id no payload de salvar
No objeto enviado ao `api.from("agentes").insert(...)` ou `.update(...)`, incluir:
```ts
voice_id: form.voice_id || null,
elevenlabs_model: form.elevenlabs_model || "eleven_multilingual_v2",
```

---

## Não alterar
- Lógica de criação/edição/exclusão de agentes
- Outros campos do agente
- Outros arquivos fora de `Agentes.tsx` (ou do componente de form do agente)
