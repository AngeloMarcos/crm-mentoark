# Sprint 4 — Corrigir Achados da Revisão Externa (Google AI Studio) em webhook.ts

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Este sprint é resultado de uma segunda revisão (Google AI Studio, atuando como segundo par de olhos) sobre `backend/src/routes/webhook.ts` já comentado nas Sprints 1-3. A revisão confirmou os achados anteriores e trouxe 4 achados novos + 1 correção sobre um achado já existente. Antes de aplicar qualquer fix, ler o arquivo inteiro de novo e confirmar que as linhas abaixo ainda correspondem ao código atual (pode ter mudado desde a revisão).

---

## ACHADO A — Race condition no upsert de contato (linhas ~342 e ~481) — CORRIGIR

Existem dois caminhos concorrentes escrevendo em `contatos` para o mesmo contato: um upsert antecipado (fire-and-forget, sem `await`, usa `ON CONFLICT (user_id, telefone) DO UPDATE` — atômico) logo após a resolução do `userId`, e mais abaixo um segundo bloco que faz `UPDATE ... RETURNING profile_pic_url` e, se `rowCount` vier zero, dispara um `INSERT` **sem** `ON CONFLICT`. Se duas mensagens do mesmo contato novo chegarem próximas, as duas podem ver `rowCount=0` no `UPDATE` e colidir no `INSERT` (um dos dois falha silenciosamente pelo `.catch(() => {})`).

**Fix:** trocar o `INSERT` sem `ON CONFLICT` desse segundo bloco (dentro do `void (async () => {...})()`) por `INSERT ... ON CONFLICT (user_id, telefone) DO NOTHING`, espelhando o padrão já usado no upsert antecipado. Pequeno, isolado, reversível — aplicar direto. Comentar com `[AUDITORIA] FIX APLICADO` citando a condição de corrida encontrada pela revisão externa.

## ACHADO B — `fetch` sem timeout na busca de foto de perfil (linhas ~476-508) — CORRIGIR

As duas chamadas `fetch` para a Evolution API (`/chat/fetchProfilePictureUrl/` e `/fetchProfilePicture/`) dentro do bloco `void (async () => {...})()` não têm timeout. `fetch` nativo do Node não tem timeout padrão — se a Evolution travar/ficar lenta, essas conexões ficam penduradas indefinidamente, e sob volume alto isso esgota o pool de conexões de saída.

**Fix:** adicionar `AbortController` com timeout de 5s em ambas as chamadas (`signal: controller.signal`, `clearTimeout` no `finally`). Pequeno, isolado, reversível — aplicar direto. `[AUDITORIA] FIX APLICADO`.

## ACHADO C — `ILIKE '%...'` impede uso de índice (linhas ~344, ~486, ~513, ~530 e outras ocorrências no arquivo) — NÃO CORRIGIR AGORA, SÓ DOCUMENTAR

Toda busca por telefone usa `telefone ILIKE $2` com parâmetro `%${telefone.slice(-11)}` — curinga no início impede o Postgres de usar índice B-Tree em `telefone`, forçando full table scan em toda mensagem recebida. Isso piora conforme a base de contatos cresce.

**Não corrigir neste sprint** — a correção correta exige normalizar a coluna `telefone` para formato E.164 (decisão de dado/migração, não só código) e trocar `ILIKE '%...'` por `=` exato, o que é mudança maior e toca schema/dado existente. Deixar `[AUDITORIA] FIX PENDENTE (motivo: exige migração de dados — normalizar telefone para E.164 antes de trocar ILIKE por igualdade exata; decisão do usuário sobre quando rodar essa migração em produção)` no topo do arquivo, próximo ao cabeçalho, citando todas as linhas afetadas.

## ACHADO D — `fs.appendFileSync` bloqueia o event loop (linha ~25, função `wlog`) — CORRIGIR

`wlog()` já loga via `log.info()` (módulo de log estruturado) **e também** escreve síncrono em `/opt/crm/backend/log_geral.txt` via `fs.appendFileSync`. Isso bloqueia o event loop a cada chamada (webhook recebido, update de status, descarte) — sob tráfego alto degrada a latência de toda a API, não só desta rota.

**Fix:** trocar `fs.appendFileSync` por `fs.appendFile` (assíncrono, fire-and-forget, com `.catch(() => {})` já que é só log auxiliar). Se ficar claro que essa escrita em arquivo plano é redundante com `log.info()` (mesmo conteúdo, dois destinos), deixar um `[AUDITORIA] LÓGICA` observando a redundância mas **não remover** o arquivo de log sem perguntar ao usuário — pode haver algum script/monitoramento externo lendo esse arquivo especificamente. Aplicar só a troca sync→async direto (pequeno, isolado, reversível); a remoção do arquivo em si fica como `FIX PENDENTE (motivo: confirmar se algo externo lê log_geral.txt antes de remover)`.

## ACHADO E — Correção sobre o `FIX PENDENTE` já existente de `isValidJid` — ATUALIZAR COMENTÁRIO, NÃO ATIVAR

O comentário `[AUDITORIA] FIX PENDENTE` já existente sobre `isValidJid()` (função não usada) estava certo em não ativá-la, mas a regex citada como candidata (`/^\d+@(s\.whatsapp\.net|g\.us|lid)$/`) é ela mesma falha: IDs de grupo (`@g.us`) frequentemente têm hífen e não são só dígitos (ex: `120363190000000000-1620000000@g.us`), então essa regex descartaria grupos legítimos se algum dia fosse ativada. **Não ativar a função de qualquer forma** (mantém-se `FIX PENDENTE`) — só atualizar o texto do comentário existente acrescentando essa ressalva sobre o formato de grupo, para que uma sessão futura não proponha essa regex específica como pronta pra uso.

---

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`: ler o arquivo inteiro antes de editar, aplicar os fixes A/B/D em edições pequenas e isoladas, comentar C e E como `FIX PENDENTE`/atualização de comentário, rodar `npm run build` do backend depois de todas as edições, `git commit` (pode ser um único commit para os 5 achados deste arquivo, já que é o mesmo arquivo e mesma sprint — mensagem `audit(whatsapp): webhook.ts — fixes de revisão externa (race condition, timeout fetch, log async) + pendências documentadas`), atualizar `AUDITORIA_LOG.md`.

## SAÍDA PARA REVISÃO EXTERNA (Google AI Studio) — OBRIGATÓRIO, NÃO PULAR

Esta etapa é obrigatória e não pode ser omitida, resumida ou deixada "implícita". Ao final da sprint, depois de todo o resto:

1. Listar explicitamente, em uma linha, todos os arquivos tocados nesta sprint.
2. Para CADA um desses arquivos, sem exceção, imprimir um bloco no formato:

### ARQUIVO: <caminho completo>
```<linguagem>
<conteúdo completo e atual do arquivo — do início ao fim, sem cortar, sem resumir>
```

3. Não terminar a resposta da sprint sem esses blocos presentes — se a resposta for ficar muito longa, ainda assim incluir todos, um por um; não substituir por "arquivo grande, ver localmente" ou qualquer atalho.
4. Isso é usado por outra IA (Google AI Studio) que só aceita código colado, sem acesso a arquivos ou git — se o bloco não vier completo aqui, a revisão externa não é possível.

## AO FINALIZAR, REPORTAR

- Confirmação dos 3 fixes aplicados (A, B, D) e diff resumido de cada um.
- Confirmação de que C e E ficaram como `FIX PENDENTE`/comentário atualizado, sem ativar nada em produção.
- Build do backend passou.
- Atualizar `STATUS.md`.
