# Prompt Lovable — ElevenLabs em Integracoes.tsx

## Objetivo
Adicionar o card de integração ElevenLabs na página `src/pages/Integracoes.tsx` para que o usuário possa cadastrar sua API Key do ElevenLabs e marcar a integração como conectada.

---

## Alterações em `src/pages/Integracoes.tsx`

### 1) Adicionar import do ícone de áudio (já existente no lucide-react)
No bloco de imports do lucide-react, adicione `Volume2` à lista:
```tsx
import {
  Workflow, MessageCircle, BarChart3, Database, Webhook,
  RefreshCw, CheckCircle2, Loader2, AlertTriangle, XCircle,
  Power, Eye, EyeOff, Plug, MapPin, Brain,
  Volume2,            // <-- novo
} from "lucide-react";
```

### 2) Registrar Volume2 no iconMap
```tsx
const iconMap = {
  Workflow,
  MessageCircle,
  BarChart3,
  Database,
  Webhook,
  RefreshCw,
  MapPin,
  Brain,
  Volume2,           // <-- novo
} as const;
```

### 3) Adicionar template ElevenLabs no array TEMPLATES
Inserir logo após o objeto `openai`:
```tsx
{
  tipo: "elevenlabs",
  nome: "ElevenLabs",
  descricao: "Síntese de voz para respostas de áudio via IA",
  icone: "Volume2",
  campos: { api_key: true },
  urlLabel: "",
},
```

### 4) Mostrar info sobre uso de cotas no card ElevenLabs (opcional, nice-to-have)
Quando `row.tipo === 'elevenlabs'` e `row.status === 'conectado'`, exibir um botão "Ver uso" que chama:
```
GET /api/elevenlabs/usage
```
E mostra um toast ou badge com `character_count / character_limit (X%)`.

---

## Comportamento esperado
- O usuário verá um card "ElevenLabs" com ícone de áudio (Volume2) na lista de integrações.
- Ao clicar "Configurar" abre o modal existente, com campo **API Key** (oculto por padrão, com botão Eye/EyeOff).
- Ao salvar, a integração é persistida em `integracoes_config` com `tipo = 'elevenlabs'`.
- Ao clicar "Testar conexão", o sistema chama `GET /api/elevenlabs/voices` e, se retornar lista de vozes, marca como "conectado".

---

## Lógica de teste de conexão (testarConexao)
A função `testarConexao` já existe. Para o tipo `elevenlabs`, a chamada de teste deve ser:
```ts
const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
const resp = await fetch(`${BASE}/api/elevenlabs/voices`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (resp.ok) {
  const data = await resp.json();
  toast.success(`ElevenLabs conectado — ${data.voices.length} vozes disponíveis`);
} else {
  throw new Error("API Key inválida ou sem permissão");
}
```
Isso deve ser adicionado como um caso especial dentro do `switch(template?.tipo)` ou do bloco de teste de conexão existente. Se não houver switch, adicionar verificação `if (template?.tipo === 'elevenlabs')` antes da lógica genérica.

---

## Não alterar
- Lógica de salvar/atualizar integrações (já funciona com qualquer `tipo`)
- Componentes de layout, CSS, outros templates
- Outros arquivos fora de `Integracoes.tsx`
