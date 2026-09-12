# Contexto para retomar em novo chat — CRM Mentoark

Cole esta mensagem inteira como primeira mensagem no novo chat do Cowork.

---

Você (Claude, Cowork) está me ajudando a manter e evoluir o CRM da Mentoark (WhatsApp + CRM + IA de automação comercial, stack React/Vite/TS + Express/TS + Postgres/pgvector — ver `CLAUDE.md` na raiz do repo pra arquitetura completa). Você tem acesso de leitura/escrita direto aos arquivos do repositório mounted localmente. Eu rodo um **Claude Code CLI separado**, com acesso real a SSH/VPS/banco de produção/homologação/git, numa outra janela — nossa dinâmica de trabalho é:

1. Eu te conto o que preciso ou colo um print/relatório.
2. Você investiga o código diretamente (Read/Grep — você tem acesso ao repo local), sem assumir nada por comentário `[AUDITORIA]` antigo sem reconfirmar (o repo é editado em paralelo pelo Claude Code, seus reads podem ficar desatualizados — sempre reconfirme antes de montar um prompt novo).
3. Você monta um prompt de sprint detalhado (contexto, o que fazer, PROCESSO com teste real em homolog antes de produção, o que reportar ao final) e salva em `diagnosticos/SPRINT_*.md`.
4. Eu colo esse prompt no Claude Code, ele executa, eu colo o relatório de volta pra você.
5. Você verifica as alegações do relatório contra o código atual antes de aceitar — já aconteceu de relatórios descreverem coisa já corrigida ou stale.

**Regras de segurança que já causaram incidente real e não podem ser reabertas sem cuidado**: nunca ativar/configurar algo pra conta errada (incidente "Cris" — nome de um cliente vazou pra config de outro; incidente `users.owner_id` — fallback automático misturou dados de 10 contas reais). Sempre confirmar `user_id` exato antes de qualquer mudança de config de conta. Testar em homolog antes de produção, sempre. Deploy de produção só com `scripts/deploy.sh prod --confirm`, nunca comando manual.

## Estado atual — o que já foi feito nesta sessão anterior (não repetir)

**Em produção, deployado e validado:**
- Fix do bug de legenda de mídia em Disparos (`legenda_midia` sempre vazio).
- Freio anti-loop bot-a-bot (circuit breaker por `user_id+telefone`, pausa automática) + `maxRetries:1` no SDK OpenAI — motivado por incidente real (28/07, loop bot-a-bot queimou 154 mil tokens, IA ficou autopausada em produção por dias).
- Guard no `agent-config` (backend+frontend) que impede salvar `ativo=true` com `prompt_sistema` vazio — corrige a causa raiz de contas ficarem silenciosas sem o operador perceber.
- Chave da OpenAI separada entre homolog e produção (antes eram idênticas — todo teste em homolog gastava saldo real de produção).

**Diagnosticado, decisão/implementação pendente:**
- Tabela de opções de economia de IA (trocar `gpt-4.1`→`gpt-4o-mini` em 3 contas caras; reduzir histórico de 20 mensagens; filtrar as 10 ferramentas MCP por toggle real em vez de mandar sempre todas; corrigir duplicação Vision/Whisper já confirmada) — nenhuma aplicada ainda, esperando eu decidir prioridade.
- `fmakonee03`/`stefanocatedral`: prompt corrigido no fluxo (guard já em produção), mas essas contas ainda não têm prompt de verdade preenchido — é o dono de cada conta que precisa fazer isso pela tela agora que funciona.

**Sprints desenhadas e prontas, ainda não executadas** (arquivo em `diagnosticos/`, ler antes de re-explicar):
- `SPRINT_UNIFICAR_CONFIGURACAO_AGENTE_IA.md` — unificar as duas telas/tabelas de config de agente (`agentes` vs `agent_configs`), trazer `prompt_sistema` pra tela principal, religar ou remover campos hoje decorativos (persona/tom/objetivo, toggles de MCP tools e modalidade que não fazem nada hoje).
- `SPRINT_CONFIGURAR_AGENTE_IA_STELLA_MENTOARK.md` — prompt final da Stella (SDR) já revisado/corrigido, pronto pra gravar em `agent_configs` da conta Mentoark, `ativo=false` até eu confirmar ativação.
- `SPRINT_DISPAROS_VARIACAO_IMAGEM.md`, `SPRINT_DISPAROS_INTERVALO_MINUTOS.md` — únicas 2 sprints de Disparos do backlog antigo que nunca rodaram (as outras já foram absorvidas/deployadas).
- `SPRINT_ROLETA_TAREFAS_GRUPO_IMPLEMENTACAO.md` — roleta de tarefas em grupo de WhatsApp específico (estrutura pronta, não ativa nenhum grupo real ainda — falta eu confirmar o JID do grupo alvo, mandando uma mensagem de teste nele primeiro, e cadastrar gente em `team_members`, hoje vazio).
- `SPRINT_GRUPOS_DIAGNOSTICO_COMPLETO.md` — já executada (achados: 2 grupos perderam acesso da instância, sem solução; Disparos/Leads/CentralBI/ModalTarefa não filtram grupo da seleção de contatos — recomendação de coluna `is_group`, ainda não implementada).
- `SPRINT_BAIXAR_CONTATOS_GRUPO_WHATSAPP.md` — baixar participantes de um grupo como contatos do CRM (endpoint + botão na UI), pronta pra rodar.
- `SPRINT_FIX_NOME_TELEFONE_SAUDACAO.md` — corrigir saudação usando telefone cru quando não há nome (achado com prova real: campanha já saiu como "Oi 5511984849872, tudo tranquilo?"). Ainda não confirmei execução desta.

**Decisão em aberto, ainda não resolvida** (era o assunto imediatamente antes de eu pedir esse resumo):
Import de lista nova em Disparos com números repetidos hoje **quebra a importação inteira** — o insert em `contatos` não usa `ON CONFLICT`, então se 1 linha já existe, o Postgres rejeita e derruba o lote todo, sem aviso claro pro operador. Correção proposta: trocar pra upsert + mostrar no resumo de pré-importação quantos são novos vs. já existentes (o bloqueio de reenvio em si, por cooldown, já existe e já funciona — só falta isso na importação). Segunda parte, ainda em aberto: quero também um jeito mais "inteligente" de pegar campos errados da planilha além do caso nome-vira-telefone — duas opções, ainda não decidi:
1. Só regra determinística (sem custo de IA) — sinaliza linha suspeita antes de importar (telefone estranho, nome que parece outra coisa), sem travar a importação.
2. Revisão assistida por IA, opcional (botão, não automático) — pega inconsistência que regra fixa não pega bem, mas tem custo real por importação (relevante logo depois de termos resolvido um incidente de crédito de IA).

**Próximo passo real, se eu confirmar a opção 1 ou 2**: montar a sprint `SPRINT_IMPORTACAO_INTELIGENTE_UPSERT.md` (ainda não criada) com upsert + validação (+ opção de IA se eu escolher a 2).

## Pastas relevantes

- `diagnosticos/*.md` — todas as sprints já escritas, algumas executadas outras não. Ler o conteúdo, não confiar só no nome do arquivo.
- `diagnosticos/AUDITORIA_LOG.md` — log histórico de achados/decisões.
- `STATUS.md` — painel de status atual, ler primeiro em qualquer sessão nova.
- `AUDITORIA_PROTOCOLO.md` — convenção de comentários `[AUDITORIA]`, processo de homolog-antes-de-produção, critério de fix seguro.

Comece confirmando comigo qual das pendências acima eu quero atacar primeiro — não presuma.
