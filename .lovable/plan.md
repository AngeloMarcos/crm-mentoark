## Contexto
O arquivo já tem um componente isolado `ControleIA` (linhas 34-203) com pausa-status, countdown e popover de duração, usado em `<ControleIA contatoId={contato.id} />` (linha 466). Os botões "Pausar/Reativar IA" no header (linhas 380-402) chamam `toggleIA` direto sem buscar status nem countdown.

A spec do usuário pede para mover toda a lógica de pausa-status, countdown e seletor de duração para o **componente da página**, substituindo os botões do header. Para evitar duplicação visual com `ControleIA`, o card antigo será removido.

## Alterações em `src/pages/ContatoDetalhe.tsx`

### 1. Estado no componente da página (após linha 247)
Adicionar:
- `duracaoSelecionada` (default 30)
- `pausaStatus` (`{ pausada, segundosRestantes, pausa_ia_ate }` ou null)
- `loadingPausaStatus`

### 2. Função `carregarPausaStatus`
Definida no escopo do componente, faz GET em `${API_BASE}/api/contatos/${contato.id}/pausa-status` com `authHeader()` e popula `pausaStatus`.

### 3. Chamar `carregarPausaStatus()`
- Dentro de `fetchData` após carregar o contato (linha ~263).
- No final de `toggleIA` quando der sucesso (após `setContato` linha 322).

### 4. useEffect de countdown
Decrementa `pausaStatus.segundosRestantes` a cada 1s; quando expirar, recarrega via `carregarPausaStatus()`. Dependência: `pausaStatus?.pausa_ia_ate`.

### 5. Função `formatarContagem(s)` → "MM:SS"

### 6. Atualizar `toggleIA`
Trocar `duracaoMinutos: 30` por `duracaoMinutos: duracaoSelecionada` (linha 318).

### 7. Substituir botões do header (linhas 380-402)
Pelo bloco "Controle da IA" com:
- Estado pausada → caixa laranja com countdown + botão Reativar
- Estado ativa → seletor de duração (15/30/60/120/9999 min) + botão Pausar

### 8. Remover componente duplicado
- Remover `<ControleIA contatoId={contato.id} />` (linha 466)
- Remover definição do componente `ControleIA` (linhas 34-203) e interface `PausaStatus` (linhas 28-32), já que o novo bloco substitui essa funcionalidade no header

### 9. Limpar imports não usados
Avaliar se `Popover`, `PopoverContent`, `PopoverTrigger` ainda são usados (não são — só pelo `ControleIA`). Remover esses imports.

## Observação
A spec do usuário cita `pausa_ia_ate` no payload do backend, mas o componente atual usa `atendimento_ia` no retorno. Vou armazenar ambos no estado conforme a spec; o countdown depende apenas de `segundosRestantes`, então funcionará mesmo se o backend só devolver um dos campos.