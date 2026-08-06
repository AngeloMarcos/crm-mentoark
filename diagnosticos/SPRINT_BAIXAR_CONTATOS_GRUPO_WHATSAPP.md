# Sprint — Baixar contatos (participantes) de um grupo de WhatsApp pro CRM

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Escopo isolado — não misturar com as 2 investigações de nome de contato ainda em aberto (`SPRINT_GRUPOS_INFO_E_CONTATOS_NOME_ERRADO.md` Parte A — contato herdando nome do dono da conta — e `SPRINT_DIAGNOSTICO_IMPORTACAO_NOME_ERRADO.md` — telefone aparecendo no lugar do nome em importação CSV). Esta sprint é só a funcionalidade de baixar participantes de grupo; se qualquer uma das outras duas investigações ainda não tiver rodado, não é bloqueante pra esta aqui — são caminhos de dado diferentes (esta sprint não usa CSV nem `pushName` de mensagem individual, usa a lista de participantes que a Evolution devolve pro grupo).

---

## Contexto

Hoje `buscarInfoGrupo()` (`backend/src/utils/whatsappMediaStorage.ts`) chama `GET /group/findGroupInfos/{instancia}?groupJid=...` na Evolution mas só aproveita `subject` e `pictureUrl` do retorno — descarta o resto. Confirmar primeiro (chamando o endpoint real contra um grupo de teste) se a resposta já inclui a lista de participantes (`participants`, formato típico Evolution API: array de `{ id: "5511999998888@s.whatsapp.net", admin: "superadmin"|"admin"|null }`) — se sim, não precisa de endpoint novo na Evolution, só aproveitar o dado que já vem e hoje é jogado fora.

## O que fazer

1. Nova função `buscarParticipantesGrupo()` (ou expandir `buscarInfoGrupo()` pra retornar também `participants`) — extrair a lista de JIDs de participantes (e o papel/admin, se relevante mostrar depois).
2. Novo endpoint backend, ex: `POST /api/whatsapp/grupos/:groupJid/importar-contatos` — busca os participantes reais (chamada direta na Evolution, dado sempre fresco, não cacheado) e faz upsert em `contatos` pra cada telefone: `origem = 'Grupo WhatsApp'` (ou similar, pra diferenciar de contato orgânico), `nome = telefone` se não houver nome melhor disponível (a Evolution normalmente não devolve nome de perfil de cada participante nesse endpoint, só o JID — confirmar isso durante o teste; se não vier nome, fica com telefone mesmo, sem inventar). **Nunca sobrescrever nome/dados de um contato que já existe e já tem informação real** — só criar os que não existem, e só atualizar campos vazios dos que já existem.
3. UI: no painel de informações do grupo (onde quer que hoje mostre nome/foto do grupo — `WhatsAppInterface.tsx`, painel de detalhes), adicionar um botão "Baixar contatos do grupo" que chama o endpoint novo e mostra um resumo ao final (ex: "12 contatos novos, 3 já existiam").
4. Nesse mesmo painel, aproveitar pra exibir mais informação do grupo que a Evolution já entrega e hoje é descartada (ex: descrição do grupo `desc`, quantidade de participantes, data de criação, se disponíveis na resposta) — só exibir o que vier de fato, não inventar campo que a Evolution não retorna.
5. **Consistência com o restante do sistema**: os contatos importados por esta via devem aparecer corretamente na tela de seleção de Disparos (`StepContacts`) como qualquer outro contato — usar os mesmos campos/convenções já existentes (`nome`, `telefone`, `origem`, `tags` se aplicável), sem criar um formato paralelo.

### Cautela a registrar no código (comentário `[AUDITORIA]`)

Importar todos os participantes de um grupo pro CRM de uma vez é uma ação que merece confirmação explícita do usuário na tela (não pode ser automático/silencioso) — trata-se de dado de terceiros (números de telefone de pessoas que não necessariamente têm relação comercial direta com a conta) sendo importado em massa pra uma base que pode depois ser usada em campanhas de Disparo. Deixar claro na UI que isso é uma ação deliberada (ex: um modal de confirmação antes de importar, mostrando quantos participantes serão trazidos), e marcar esses contatos com uma tag/flag que os diferencie de contatos que iniciaram conversa organicamente — útil pra decisões futuras de quem pode ou não receber campanha (ex: um participante de grupo nunca falou diretamente com a empresa, pode fazer sentido excluí-lo de campanhas frias por padrão, ficando de fora a menos que o operador inclua explicitamente).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend e backend). Testar em homolog: usar um dos grupos já conhecidos/mapeados nas sprints anteriores de grupo (ver levantamento em `AUDITORIA_LOG.md`) pra importar de verdade — conferir que contatos novos aparecem em `contatos` com os telefones certos, que um contato que já existia não teve o nome real sobrescrito, e que os novos aparecem corretamente na tela de seleção de Disparos com a tag/marcação de origem de grupo.

## AO FINALIZAR, REPORTAR

- Confirmação de que `participants` (ou equivalente) realmente vem no retorno da Evolution, com exemplo real (mascarado) do formato.
- Resultado do teste de importação num grupo real: quantos novos, quantos já existiam, nenhum dado real sobrescrito.
- Confirmação de que os contatos importados aparecem corretamente em Disparos/StepContacts, com a tag de origem de grupo.
- O que mais a Evolution retorna de informação de grupo que passou a ser exibido na tela.
- Build do frontend e do backend passaram.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
