# Sprint — Buscar nome real dos participantes de grupo na importação + melhorar visualização de contatos sem nome

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Testar em homolog antes de produção.

---

## Contexto (confirmado no código atual + pesquisa)

`POST /grupos/:groupJid/importar-contatos` (`routes/whatsapp.ts`) grava `nome = p.telefone` pra todo participante importado (~linha 540: `INSERT INTO contatos (..., nome, telefone, ...) VALUES ($1, $2, $3, ...)` com `$2 = p.telefone`) — a Evolution, no endpoint hoje usado (`GET /group/findGroupInfos`), só devolve `{ id, phoneNumber, admin }` por participante, sem nome nenhum (`ParticipanteGrupo` em `whatsappMediaStorage.ts` só tem `telefone`/`admin`). Usuário reportou (print real, tela de Disparos, "Contatos selecionados") 229 contatos de grupo aparecendo com o telefone repetido no lugar do nome.

**Pesquisa feita nesta sessão** (documentação oficial + issues do repositório `EvolutionAPI/evolution-api`):
- Existe um endpoint separado, `GET /group/participants/{instance}` ("Find Group Members"), não usado hoje neste projeto (o código usa `findGroupInfos`, que devolve os participantes como parte de um payload maior). Vale testar se esse endpoint devolve mais dado por participante.
- Uma issue histórica do próprio projeto Evolution API (#561) pedia justamente "inserir pushName na lista de membros de grupo" — sinal de que, por padrão, esse dado **não vem** nessa listagem. O changelog do projeto menciona um campo novo `ParticipantsData` adicionado depois — não dá pra saber, sem testar a versão real da instância desta conta, se isso já inclui nome.
- `POST /chat/fetchProfile/{instance}` (perfil por número) existe e às vezes devolve `name`, mas há relatos de bug conhecido onde o campo vem vazio mesmo pra contato com nome real no WhatsApp — não confiável sozinho.
- **Fonte que já existe dentro do próprio sistema, sem chamada nova à Evolution**: `whatsapp_messages.push_name` já é gravado com o nome real de quem manda mensagem, inclusive em grupo (`webhook.ts` ~linha 1190-1192, com sufixo `" (grupo)"` pra diferenciar) — cobre qualquer participante que já tenha mandado pelo menos uma mensagem em qualquer conversa que o sistema tenha capturado (grupo ou individual). Não cobre membro nunca-falante, mas é gratuito (já está no banco) e não depende de nenhuma chamada externa nova.

## O que fazer

### 1. Testar as fontes possíveis contra a Evolution real (homolog) antes de decidir

Não assumir qual funciona — testar contra um grupo real de teste:
- `GET /group/participants/{instance}?groupJid=X` — comparar a resposta com o que `findGroupInfos` já devolve. Se vier mais campo (nome/pushName), documentar o formato exato.
- `POST /chat/fetchProfile/{instance}` pra 3-5 números reais do grupo de teste — medir taxa real de sucesso (quantos vieram com nome preenchido de verdade).
- Cruzar contra `whatsapp_messages.push_name` pros mesmos números de teste (se algum já tiver conversa registrada).

### 2. Implementar cadeia de fallback na importação (ordem por confiabilidade/custo)

Em `POST /grupos/:groupJid/importar-contatos`, pra cada participante, antes de cair no fallback `nome = telefone`:
1. Nome vindo da fonte nova confirmada no item 1 (se existir e for confiável).
2. `SELECT push_name FROM whatsapp_messages WHERE ... telefone = participante ... ORDER BY timestamp_wa DESC LIMIT 1` (remover o sufixo `" (grupo)"` se vier daí) — não faz chamada externa, é uma query local.
3. Só then, `nome = telefone` (comportamento atual, mantido como último recurso).

Documentar a taxa real de cobertura no teste (quantos dos 229 contatos do exemplo do usuário teriam nome resolvido por cada camada, se puder reproduzir um cenário parecido em homolog).

### 3. Reforçar proteção existente pra quem não resolver nome nenhum

Confirmar (teste real, não só leitura) que `substituirPlaceholders()` (`Disparos.tsx`) continua tratando `nome === telefone` como "sem nome real" pra esses contatos de grupo também — a proteção já existe e é genérica, só confirmar que não regride com a mudança acima.

### 4. Melhorar a tabela "Contatos selecionados" (StepReview, `Disparos.tsx` ~linha 1462-1520) pra quem ainda ficar sem nome

- Badge pequeno "sem nome" ao lado do telefone quando `c.nome === c.telefone` (~linha 1505), pra o operador identificar de relance quem precisa de atenção — não só uma tabela igual pra todo mundo.
- Contador no cabeçalho da prévia (perto de "X de Y totais", ~linha 1466-1469): "Z sem nome identificado".
- Filtro rápido (toggle ou opção na busca já existente, ~linha 1471-1476) "Mostrar só sem nome" — ajuda revisar/corrigir antes de disparar.
- Edição inline do nome direto na tabela (ícone de lápis na célula Nome, ~linha 1505) — `PATCH /api/contatos/:id` já existe (rota genérica `makeCrud`), só precisa da UI chamando. Corrige na hora sem sair do fluxo de criação da campanha.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend e backend). Testar em homolog com grupo real: reimportar um grupo de teste, medir quantos participantes ganharam nome real pela cadeia de fallback vs. quantos ainda caíram no telefone. Testar edição inline do nome na prévia de Disparos. Confirmar que `substituirPlaceholders` continua protegendo a saudação pra quem ainda não tem nome.

## AO FINALIZAR, REPORTAR

- Qual(is) fonte(s) de nome real funcionaram de verdade contra a Evolution desta conta (com taxa de sucesso medida, não estimada).
- Cobertura real da cadeia de fallback num teste com grupo real (quantos % dos participantes ganharam nome).
- Confirmação de que a proteção de saudação continua funcionando pra quem sobra sem nome.
- Confirmação de que a edição inline funciona e persiste.
- Build limpo nos dois lados.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
