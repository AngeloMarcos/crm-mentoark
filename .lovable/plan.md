

## Plano: corrigir falhas em massa nos disparos

### O que está acontecendo
Os disparos não falham por bug do sistema. A Evolution API rejeita 100% das mensagens com `"exists": false` — ou seja, os telefones da sua lista (origem **Cnpj.biz**) **não possuem conta de WhatsApp**, são fixos comerciais ou celulares desativados.

### Correções propostas

**1. Normalizador de telefone BR (`src/lib/phone.ts`)**
Função `normalizarTelefoneBR(raw)` que:
- Remove tudo que não é dígito
- Adiciona DDI 55 se faltar
- Insere o 9 na frente de celulares com 10 dígitos (DDD + 8) quando o terceiro dígito for 6/7/8/9
- Rejeita fixos (números cujo primeiro dígito após DDD seja 2, 3, 4 ou 5) — fixos não têm WhatsApp
- Retorna `{ jid, valido, motivo }`

**2. Pré-validação ao criar o disparo (`src/pages/Disparos.tsx`)**
Antes de gravar `disparo_logs`, rodar `normalizarTelefoneBR` em cada contato:
- Se inválido → marcar log como `status='invalido'` com `erro='Telefone fixo / formato inválido'` (não conta como falha real)
- Mostrar resumo no toast: "120 enviados para fila · 47 ignorados (telefone inválido)"

**3. Filtro visual em Disparos**
- Badge "Inválidos" separado de "Falhas" na lista
- Botão "Reprocessar apenas falhas reais" (ignora `status='invalido'`)

**4. Validação opcional via Evolution `chatWhatsappNumbers` (edge function)**
Edge function `validar-numeros-whatsapp` que:
- Recebe lista de JIDs
- Chama o endpoint Evolution `/chat/whatsappNumbers/{instancia}` em lotes de 50
- Atualiza `contatos.tags` com `whatsapp_invalido` para os que retornarem `exists:false`
- Botão "Validar lista no WhatsApp" na página de Leads

**5. Aviso em Leads ao importar CSV**
Mostrar alerta quando ≥30% dos números forem fixos: "Esta lista contém muitos telefones fixos — disparos via WhatsApp irão falhar."

### Resultado esperado
- Disparos novos enviam só para números válidos
- Taxa de falha cai de ~100% para <5% (apenas falhas reais de rede/instância)
- Você consegue limpar a base atual com o botão "Validar lista"

### Arquivos
- **Criar**: `src/lib/phone.ts`, `supabase/functions/validar-numeros-whatsapp/index.ts`
- **Editar**: `src/pages/Disparos.tsx`, `src/pages/Leads.tsx`

