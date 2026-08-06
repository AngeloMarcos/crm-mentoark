# Sprint — Colunas de status de envio na seleção de contatos + tag de "Enviado/Não enviado" visível no chat e no contato

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Depende da coluna `contatos.ultimo_disparo_em`** já especificada em `diagnosticos/SPRINT_DISPAROS_BLOQUEIO_REENVIO_DUPLICADO.md` — se aquela sprint ainda não rodou, criar a coluna aqui também (usar `ADD COLUMN IF NOT EXISTS`, idempotente, sem conflito se as duas rodarem em qualquer ordem). Usuário revisou o Passo 1 do wizard de Disparos ("Lista de Contatos") e quer mais contexto na tabela de prévia antes de decidir quem entra na campanha, além de espalhar essa mesma informação pro chat e pra tela de detalhe do contato.

---

## O que fazer

### 1. Colunas novas na tabela "Contatos selecionados" (`StepContacts`, `Disparos.tsx`)

Hoje a tabela mostra só Nome e Telefone. Adicionar:
- **Situação no CRM** — estágio do funil do contato (`contatos.funil_estagio_id` → nome/cor de `funil_estagios`, mesma fonte já usada na aba "Por Estágio" desta mesma tela).
- **Status de envio** — como uma **tag colorida**, não texto simples: "Nunca enviado" (cor neutra/cinza) vs "Já enviado" (cor de alerta, ex: âmbar/laranja — é um aviso, não bloqueio) — baseado em `contatos.ultimo_disparo_em` não ser nulo. Reaproveitar o componente `Badge` já usado no resto do arquivo, com paleta de cor própria pra esse status (separado das cores de `tags`/`funil_estagios`, que são livres/definidas pelo usuário).
- **Data do último envio** — `contatos.ultimo_disparo_em` formatada (ou "—" se nunca).
- **Nome da última campanha** — nome da campanha (`disparos.nome`) do disparo mais recente desse contato. Buscar via `disparo_logs` (mais recente por `enviado_at` desc, join em `disparos`) — se ficar pesado buscar isso pra centenas/milhares de contatos de uma vez na prévia, considerar buscar só pra página visível/primeiros N ou implementar via uma view/query agregada em vez de N+1 queries. Avaliar performance antes de finalizar, documentar a abordagem escolhida.

### 2. Mesma tag de status, em mais 2 lugares

- **`WhatsAppInterface.tsx`** — no painel de detalhes do contato (o painel lateral que já existe, `showContactPanel`) ou próximo ao cabeçalho da conversa (decisão de UI, escolher o que fizer mais sentido visualmente sem quebrar o layout já existente) — mostrar a mesma tag "Já enviado (nome da campanha, data)" / "Nunca enviado" quando aplicável.
- **`ContatoDetalhe.tsx`** — mesma tag, na área de informações do contato.

Extrair a lógica de "buscar status de disparo de um contato" (ou pelo menos o componente visual da tag) pra um lugar compartilhado (hook ou componente pequeno reaproveitável) em vez de duplicar a query/lógica de cor em 3 arquivos diferentes.

### 3. Não confundir com o bloqueio da outra sprint

Esta sprint é só **visibilidade** (mostrar a informação) — o bloqueio de fato (impedir reenvio) é escopo da sprint `SPRINT_DISPAROS_BLOQUEIO_REENVIO_DUPLICADO.md`. As duas se apoiam na mesma coluna, mas não são a mesma tarefa — se só uma das duas rodar primeiro, o sistema deve continuar funcionando (a tag não bloqueia nada sozinha; o bloqueio não depende da tag existir na tela).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend e backend) depois da mudança. Testar em homolog: usar um contato de teste que já recebeu disparo antes (dado real, não mockado) e confirmar que a tag "Já enviado" aparece com a campanha/data certa nos 3 lugares (tela de seleção de Disparos, chat do WhatsApp, ContatoDetalhe) — e que um contato que nunca recebeu nada mostra "Nunca enviado" nos 3 lugares também, de forma consistente.

## AO FINALIZAR, REPORTAR

- Confirmação das 4 colunas novas na tabela de seleção de contatos, com print ou descrição do resultado.
- Confirmação da tag aparecendo em `WhatsAppInterface.tsx` e `ContatoDetalhe.tsx`, com teste real usando um contato que já recebeu disparo.
- Abordagem escolhida pra buscar "nome da última campanha" sem virar N+1 query pesada em listas grandes.
- Build do frontend e do backend passaram.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
