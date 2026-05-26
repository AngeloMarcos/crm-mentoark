## Contexto
O campo `n8n_webhook_url` já está declarado na interface `Agente`, no `formInicial`, na função `abrirEditar()` e no payload do `salvar()`. Faltam apenas dois ajustes visuais.

## Alterações

### 1. Mover campo n8n_webhook_url para aba WhatsApp
Atualmente o campo está na aba "Integração" (linha 663). O usuário pede para movê-lo para a aba "WhatsApp", logo após o campo "Nome da Instância" (~linha 647).

**Remover de:** `TabsContent value="integracao"` (linhas 663–677)
**Adicionar em:** `TabsContent value="whatsapp"`, após o campo `evolution_instancia` (após linha 647)

Código a inserir:
```tsx
<div className="space-y-2">
  <Label>URL do Webhook n8n</Label>
  <Input
    placeholder="https://seu-n8n.com/webhook/..."
    value={form.n8n_webhook_url}
    onChange={e => setForm(f => ({ ...f, n8n_webhook_url: e.target.value }))}
  />
  <p className="text-xs text-muted-foreground">
    Quando preenchido, mensagens são processadas pelo n8n em vez da IA interna.
  </p>
</div>
```

### 2. Atualizar badges de listagem (~linha 338)
Substituir o badge atual de status n8n/IA Interna pelos estilos solicitados:

```tsx
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
```

## Arquivo
- `src/pages/Agentes.tsx`