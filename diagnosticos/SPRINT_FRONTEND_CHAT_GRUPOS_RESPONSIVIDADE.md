# Sprint — Bugs de Frontend no Chat WhatsApp (grupos, painel de detalhes, responsividade)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Usuário reportou por print (`src/components/WhatsAppInterface.tsx`, tela de Conversas): o identificador do grupo aparece errado/ilegível no cabeçalho da conversa, o painel de detalhes do contato abre sozinho toda vez que uma conversa é aberta, e problemas gerais de responsividade/UI.

---

## ACHADO 1 — Painel de detalhes abre sozinho em toda conversa (confirmado, causa raiz encontrada)

`showContactPanel` (linha ~271) é inicializado com `useState(true)` — por isso o painel lateral direito (detalhes do contato) já nasce aberto e permanece aberto ao trocar de conversa, mesmo quando o usuário não pediu.

**Fix:** mudar o default pra `false`. Confirmar que o botão que já existe pra abrir/fechar o painel (ícone `Info`, linha ~2258-2265) continua funcionando normalmente pra abrir sob demanda. Se fizer sentido pro produto lembrar a preferência do usuário entre sessões, usar `localStorage` (não usar em artifacts, mas aqui é app real, então pode) — mas isso é opcional, o fix mínimo é só trocar o default. Aplicar o mínimo primeiro, mudança isolada e segura.

## ACHADO 2 — Identificador do grupo no cabeçalho da conversa (confirmado, causa raiz encontrada)

Linha ~2198: `<span>✓ {activeChat.source ?? "CRM"}</span> · {activeChat.phone}` — pra uma conversa de grupo, `activeChat.phone` carrega o JID numérico bruto do grupo (ex: `120363401725364845`), um número longo sem formatação nenhuma, que no layout atual quebra/estoura visualmente (ver print do usuário — aparece cortado/ilegível ao lado do nome da instância).

Note que a lista lateral de conversas (linha ~1794-1795) já mostra um badge "Grupo" formatado de forma legível — o cabeçalho da conversa aberta não usa esse mesmo tratamento.

**Fix:** no cabeçalho (linha ~2197-2199), tratar o caso `activeChat.is_group` separadamente do caso de contato individual:
- Para grupo: não mostrar o JID numérico bruto. Mostrar algo útil — o nome do grupo (já é `activeChat.name`, mostrado acima) e, se fizer sentido, um identificador curto do grupo (ex: os últimos dígitos, como já é extraído em algum lugar do código pra gerar o nome "Grupo XXXX" na lista lateral — localizar essa lógica e reaproveitar) ao invés do JID completo.
- Para contato individual: manter o comportamento atual (número de telefone).
- Garantir que o texto não estoura/quebra o layout do cabeçalho em nenhum dos dois casos (`truncate`/`text-overflow` se necessário).

## ACHADO 3 — Responsividade geral do chat (investigar e reportar antes de sair corrigindo tudo)

Ler `WhatsAppInterface.tsx` por completo com atenção a breakpoints (`sm:`/`md:`/`lg:` do Tailwind) e larguras fixas. Testar mentalmente/via build em pelo menos 3 larguras: mobile (~375px), tablet (~768px), desktop (~1280px+). Listar os problemas reais encontrados (não assumir) — provável, mas confirmar: colunas fixas (lista de conversas + chat + painel de detalhes) não colapsando em telas estreitas, dropdowns/menus cortados, textos estourando containers.

Para cada problema real encontrado:
- Se for CSS isolado (classe Tailwind errada, falta de `truncate`/`min-w-0`/`overflow-hidden`) e não muda comportamento/lógica: corrigir direto.
- Se exigir redesenho de layout (ex: esconder painel de detalhes automaticamente em mobile, virar bottom-sheet, etc.): documentar como `FIX PENDENTE` com a proposta, não implementar sem confirmação — é decisão de produto/design, não só bug.

## ACHADO 4 — Varredura geral de bugs de frontend similares (mesmo arquivo)

O usuário mencionou "vários bugs de frontend como esse" — não só os 2 itens acima. Ler o arquivo inteiro (é grande, já tem histórico de comentários `[AUDITORIA]` de sessões anteriores — não duplicar o que já foi revisado, ver `diagnosticos/AUDITORIA_LOG.md` seção WhatsApp) e procurar especificamente por:
- Estados que deveriam resetar ao trocar de conversa e não resetam (mesma classe do Achado 1).
- `useEffect`/`useState` com dependência errada causando comportamento "pega" ou "sempre aberto/fechado".
- Textos/dados não formatados sendo jogados direto na tela sem tratamento (mesma classe do Achado 2).

Comentar cada achado com `[AUDITORIA] BUG` + `FIX APLICADO`/`FIX PENDENTE` conforme o critério de sempre (`AUDITORIA_PROTOCOLO.md`). Não é pra reescrever a tela inteira — é pra catalogar e corrigir o que for seguro, isolado e de baixo risco.

---

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend, vite) depois de cada mudança. Testar em homolog se possível antes de considerar pronto. Commit por achado/grupo pequeno de achados relacionados. Atualizar `AUDITORIA_LOG.md`.

## AO FINALIZAR, REPORTAR

- Confirmação dos fixes 1 e 2 (com print ou descrição do comportamento novo, se possível testar).
- Lista de problemas de responsividade encontrados no Achado 3 — quais foram corrigidos direto e quais ficaram como `FIX PENDENTE` (com a proposta de cada um).
- Lista de outros bugs de frontend encontrados no Achado 4, mesmo critério.
- Build do frontend passou.
- Atualizar `STATUS.md`.
