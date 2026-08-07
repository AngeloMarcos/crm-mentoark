# Sprint URGENTE — Contato sem telefone derruba a criação inteira da campanha (`disparo_logs.telefone` NOT NULL)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Achado real (print do usuário, erro em produção): `"Erro ao iniciar campanha: null value in column \"telefone\" of relation \"disparo_logs\" violates not-null constraint"` ao clicar "Disparar Agora" numa campanha de 247 contatos.

---

## Contexto (a confirmar, mas causa já bem indicada)

`StepReview.handleStart()` (`Disparos.tsx`) monta `logs = targetContacts.map(c => ({ ..., telefone: c.telefone, ... }))` e insere tudo de uma vez em `disparo_logs` (`api.from("disparo_logs").insert(logs)`, um único `INSERT` multi-linha via `makeCrud` genérico, sem `ON CONFLICT`/tratamento por linha). A coluna `disparo_logs.telefone` é `NOT NULL`. Nenhuma das buscas que alimentam `targetContacts` filtra telefone vazio/nulo — `fetchAllContatos()` com `select("id, nome, telefone, ...")` (~linha 582, 589, 611, 615) não tem `WHERE telefone IS NOT NULL` em nenhum caso, nem a opção "Todos os Leads". Se **um único** contato dos 247 tiver `telefone` nulo, o `INSERT` inteiro falha e a campanha inteira não é criada — mesma classe de bug já corrigida na importação (`SPRINT_IMPORTACAO_INTELIGENTE_UPSERT.md`, um registro ruim quebrando o lote inteiro), agora encontrada num ponto diferente do sistema.

**Efeito colateral já em produção**: como `handleStart()` primeiro cria a linha em `disparos` (INSERT separado, já confirmado com sucesso) e SÓ DEPOIS tenta `disparo_logs`, o erro relatado deixou uma campanha **órfã** — existe em `disparos` sem nenhuma linha correspondente em `disparo_logs`. Verificar e limpar.

## O que fazer

1. **Confirmar a causa raiz com dado real**: `SELECT id, nome, telefone FROM contatos WHERE user_id = $1 AND (telefone IS NULL OR telefone = '')` — achar o(s) contato(s) culpado(s) da campanha que falhou (cruzar com a seleção usada, lista/tag/estágio) e entender **como** um contato desses chegou a existir (importação já descarta telefone vazio; investigar se veio de criação manual via `Leads.tsx` sem validação obrigatória de telefone, de outro caminho de escrita, ou de dado legado).
2. **Fix defensivo, na origem** (`Disparos.tsx`): filtrar contatos sem telefone válido em todas as fontes de `targetContacts` (as 3 buscas por lista/tag/estágio + "Todos os Leads", ~linha 582-620) — `WHERE telefone IS NOT NULL AND telefone <> ''` na query, ou filtro client-side logo após o fetch. Mostrar toast/aviso não-bloqueante quando isso descartar algum contato (ex: "3 contatos sem telefone válido foram excluídos da seleção"), mesmo padrão já usado noutros avisos do módulo.
3. **Segunda camada de proteção, direto em `handleStart()`**: mesmo com o fix acima, filtrar de novo (`targetContacts.filter(c => c.telefone)`) logo antes de montar `logs` — nunca deixar um `INSERT` de `disparo_logs` correr com risco de `telefone` nulo, independente de por onde os dados chegaram até ali (defesa em profundidade, mesmo espírito do `ON CONFLICT`/validação dupla já usado no resto do sistema).
4. **Limpar a campanha órfã já criada em produção pelo erro do print**: achar a linha em `disparos` sem `disparo_logs` correspondentes (criada no horário do erro) e decidir com o usuário se apaga ou deixa (não deletar sem confirmar).
5. **Considerar (avaliar se vale)**: fazer `handleStart()` desfazer a criação da campanha (`DELETE` na linha de `disparos` recém-criada) se o `INSERT` de `disparo_logs` falhar — evita gerar mais campanhas órfãs no futuro se outro erro parecido acontecer por qualquer outro motivo.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend). Testar em homolog: criar um contato de teste com telefone vazio (se o caminho de criação manual permitir — parte da investigação do item 1), incluir na seleção de uma campanha de teste, confirmar que agora ele é excluído automaticamente (com aviso) e a campanha é criada normalmente com os demais.

## AO FINALIZAR, REPORTAR

- Como o(s) contato(s) com telefone nulo foram parar no banco (causa raiz real, não suposição).
- Se esse caminho de criação também foi corrigido (ex: exigir telefone no formulário manual), ou se ficou só o filtro defensivo.
- Confirmação do teste real em homolog.
- O que foi feito com a campanha órfã em produção.
- Build limpo.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
