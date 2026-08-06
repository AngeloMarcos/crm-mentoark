# Sprint — Baixar contatos de grupo do WhatsApp + corrigir contatos com nome errado (nome do dono)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro.

---

## Parte A — Bug do "nome errado" (contato desconhecido aparece com o nome do dono da conta)

**Achado ao investigar antes de escrever este prompt**: esse bug específico já foi encontrado e corrigido em código, `webhook.ts` ~linha 857-883, comentário `[AUDITORIA] BUG (achado 2026-07-28 — "algumas pessoas ainda estão com meu nome")`. Causa: em mensagens `fromMe:true` (enviadas pelo próprio usuário/CRM/IA), a Evolution devolve o nome de perfil do DONO da instância no campo `pushName` — se essa fosse a primeira mensagem associada a um contato novo (ex: atendente inicia conversa, ou uma campanha de Disparo pra número novo), o nome do contato era gravado como o nome do próprio dono da conta, permanentemente. **O fix já impede isso daqui pra frente, mas não é retroativo** — contatos já corrompidos antes de 28/07 continuam errados até hoje.

### O que fazer

1. Confirmar que o fix de 28/07 está mesmo em produção (não só em homolog) e realmente ativo — reconfirmar lendo o código atual, não confiar só no comentário.
2. Levantar contatos afetados com esta query (mesma lógica pra qualquer conta, mas rodar ao menos pra `mentoark@gmail.com`, `user_id = 435ee472-0fc3-4015-995a-ae6e1c80606d`, e reportar se outras contas também têm o mesmo padrão):
   ```sql
   SELECT nome, COUNT(DISTINCT telefone) AS qtd_telefones_diferentes
   FROM contatos
   WHERE user_id = '435ee472-0fc3-4015-995a-ae6e1c80606d'
   GROUP BY nome
   HAVING COUNT(DISTINCT telefone) > 3
   ORDER BY qtd_telefones_diferentes DESC;
   ```
   Um nome real de pessoa não deveria aparecer em mais de um telefone. Se algum nome aparecer em vários telefones diferentes, é sinal quase certo de ser o nome do dono da conta vazado (confirmar comparando com o nome de perfil real do WhatsApp da instância, se disponível).
3. Confirmado o nome contaminado: resetar `nome` e `push_name` desses contatos pro telefone (mesmo placeholder seguro já usado em outros pontos do sistema — `nome = telefone`, `push_name = NULL`) — **só pros contatos identificados como contaminados, não mexer em nenhum outro**. Não apagar histórico de conversa nem nenhum outro dado do contato, só os campos de nome.
4. Depois do reset, esses contatos vão voltar a ganhar o nome certo automaticamente na próxima vez que a pessoa mandar mensagem de verdade (o fix de 28/07 já cuida disso).

## Parte B — Baixar contatos (participantes) de um grupo pro CRM

Hoje `buscarInfoGrupo()` (`backend/src/utils/whatsappMediaStorage.ts`) chama `GET /group/findGroupInfos/{instancia}?groupJid=...` na Evolution mas só aproveita `subject` e `pictureUrl` do retorno — descarta o resto. Confirmar primeiro (chamando o endpoint real contra um grupo de teste) se a resposta já inclui a lista de participantes (`participants`, formato típico Evolution API: array de `{ id: "5511999998888@s.whatsapp.net", admin: "superadmin"|"admin"|null }`) — se sim, não precisa de endpoint novo na Evolution, só aproveitar o dado que já vem e hoje é jogado fora.

### O que fazer

1. Nova função `buscarParticipantesGrupo()` (ou expandir `buscarInfoGrupo()` pra retornar também `participants`) — extrair a lista de JIDs de participantes (e o papel/admin, se relevante mostrar depois).
2. Novo endpoint backend, ex: `POST /api/whatsapp/grupos/:groupJid/importar-contatos` — busca os participantes reais (chamada direta na Evolution, dado sempre fresco, não cacheado) e faz upsert em `contatos` pra cada telefone: `origem = 'Grupo WhatsApp'` (ou similar, pra diferenciar de contato orgânico), `nome = telefone` se não houver nome melhor disponível (a Evolution normalmente não devolve nome de perfil de cada participante nesse endpoint, só o JID — confirmar isso durante o teste; se não vier nome, fica com telefone mesmo, sem inventar). **Nunca sobrescrever nome/dados de um contato que já existe e já tem informação real** — só criar os que não existem, e só atualizar campos vazios dos que já existem.
3. UI: no painel de informações do grupo (onde quer que hoje mostre nome/foto do grupo — `WhatsAppInterface.tsx`, painel de detalhes), adicionar um botão "Baixar contatos do grupo" que chama o endpoint novo e mostra um resumo ao final (ex: "12 contatos novos, 3 já existiam").
4. Nesse mesmo painel, aproveitar pra exibir mais informação do grupo que a Evolution já entrega e hoje é descartada (ex: descrição do grupo `desc`, quantidade de participantes, data de criação, se disponíveis na resposta) — só exibir o que vier de fato, não inventar campo que a Evolution não retorna.

### Cautela a registrar no código (comentário `[AUDITORIA]`)

Importar todos os participantes de um grupo pro CRM de uma vez é uma ação que merece confirmação explícita do usuário na tela (não pode ser automático/silencioso) — trata-se de dado de terceiros (números de telefone de pessoas que não necessariamente têm relação comercial direta com a conta) sendo importado em massa pra uma base que pode depois ser usada em campanhas de Disparo. Deixar claro na UI que isso é uma ação deliberada, e considerar (comentário no código, não necessariamente implementar agora) se esses contatos importados em massa deveriam nascer com alguma tag/flag que os diferencie de contatos que iniciaram conversa organicamente, útil inclusive para decisões futuras de quem pode ou não receber campanha.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend e backend). Testar em homolog: Parte A com os contatos de teste específicos identificados (não mexer em conta real sem confirmar a lista primeiro); Parte B testando o botão de importar contra um dos grupos já conhecidos (ex: os mapeados nas sprints anteriores de grupo), conferindo que contatos novos aparecem em `contatos` com os telefones certos e que um contato que já existia não teve o nome real sobrescrito.

## AO FINALIZAR, REPORTAR

- Parte A: quantos contatos foram identificados como contaminados, lista (ou contagem) do que foi resetado, confirmação de que o fix de 28/07 está mesmo ativo em produção.
- Parte B: confirmação de que `participants` (ou equivalente) realmente vem no retorno da Evolution; resultado do teste de importação num grupo real (quantos novos, quantos já existiam, nenhum dado real sobrescrito); o que mais a Evolution retorna de informação de grupo que passou a ser exibido.
- Build do frontend e do backend passaram.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
