# Sprint — Relatório completo: o que foi implantado e o que ainda falta desenvolver

Cole este prompt inteiro no Claude Code (CLI). Não é uma sprint de implementação — é levantamento e verificação. Ler `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md` primeiro, mas **não reportar nada de lá como fato sem confirmar contra o estado real** (git, VPS, banco) — mesmo cuidado que já causou retrabalho nesta sessão (o relatório da sprint do spintax dizia "testado em homolog" e na verdade tinha rodado em produção; só foi pego porque o usuário notou por acaso numa tela).

---

## O que fazer

### 1. Levantamento do que foi implantado recentemente

Para cada item abaixo (lista não exaustiva — completar com qualquer outra sprint recente do `diagnosticos/` que não esteja nesta lista), confirmar **por evidência direta**, não por lembrança do relatório anterior:
- Está commitado? (`git log`/`git status`)
- Está deployado em homolog? Em produção? (comparar hash/conteúdo do arquivo local contra `/opt/crm-homolog/...` e `/opt/crm/...` na VPS — mesmo método já usado nesta sessão pra achar a divergência do `disparoProcessor.ts`)
- Foi testado com dado real, e esse teste realmente rodou no ambiente que o relatório diz? (confirmar banco — `crm` vs `crm_hml` — não assumir pela URL/JWT usados, seguir a regra nova do item "Testes que mandam mensagem real via WhatsApp" em `AUDITORIA_PROTOCOLO.md`)

Itens a verificar (não exaustivo):
- Importação com upsert (`checar-telefones`/`importar-lote`)
- Fix nome/telefone na saudação (importação CNPJ)
- Fix duplicação Whisper/Vision (`agentEngine.ts`)
- Motor de variação sem IA (spintax) + `humanizar_ia` default `false`
- Divergência de `disparoProcessor.ts` entre homolog/produção — foi corrigida? (sprint escrita, confirmar se já rodou)
- Gerenciar listas no passo "Por Lista" de Disparos (excluir/renomear/limpar vazias) — sprint escrita, confirmar se já rodou
- Aba "Grupos" (listar grupos, prévia de membros, importar com Lista própria) — sprint escrita, confirmar se já rodou
- Revalidação do spintax em homolog (processo corrigido) — sprint escrita, confirmar se já rodou
- Qualquer outra mudança de código não commitada no working tree hoje (`git status --short`) que não esteja documentada em nenhuma sprint — sinalizar como achado, não ignorar.

### 2. Levantamento do que ainda falta

Varrer `diagnosticos/SPRINT_*.md` restantes (os que não foram apagados pelo protocolo de absorção) e classificar cada um:
- **Nunca executada** — nem começou.
- **Desenhada mas decisão pendente do usuário** — precisa de uma escolha antes de rodar (ex: qual opção de economia de IA priorizar).
- **Parcialmente feita** — só uma parte do escopo original foi implementada.
- **Stale/já resolvida por outra via** — não descartar sem confirmar contra o código atual primeiro (mesma regra do protocolo de absorção).

Itens conhecidos a incluir (não exaustivo — completar com o que houver de fato em `diagnosticos/`):
- `SPRINT_DISPAROS_VARIACAO_IMAGEM.md` (perturbação de imagem via `sharp`, anti-fingerprint)
- `SPRINT_UNIFICAR_CONFIGURACAO_AGENTE_IA.md`
- `SPRINT_CONFIGURAR_AGENTE_IA_STELLA_MENTOARK.md` (ativação da Stella)
- `SPRINT_ROLETA_TAREFAS_GRUPO_IMPLEMENTACAO.md`
- `contatos.is_group` (recomendação de `SPRINT_GRUPOS_DIAGNOSTICO_COMPLETO.md`, nunca implementada)
- Execução da economia de IA (`SPRINT_DIAGNOSTICO_APROFUNDADO_CUSTO_IA.md` — trocar modelo, cortar histórico, filtrar MCP tools) — diagnóstico feito, nada aplicado, aguardando priorização
- `PLANO_MIGRACAO_N8N_PARA_CRM_NATIVO.md` — confirmar status real (não investigado nesta sessão)
- `SPRINT_FRONTEND_CHAT_GRUPOS_RESPONSIVIDADE.md` — confirmar status real (não investigado nesta sessão)

### 3. Achados soltos que não têm sprint própria ainda

Verificar se algum desses (mencionados em sessões anteriores mas sem sprint dedicada) segue pendente: 2 grupos sem acesso da instância (sem solução conhecida), contas sem `ai_providers` próprio (100% no fallback compartilhado), POST em `agent-config.ts` que falha 500 se `nome_agente` ausente.

## PROCESSO

Investigação e verificação — não corrigir nada encontrado nesta sprint, só relatar. Se achar algo urgente/grave no caminho (mesmo critério já usado antes — ex: divergência de produção, dado real em risco), sinalizar com destaque no relatório, mas não corrigir sem confirmação.

## AO FINALIZAR, REPORTAR

Formato de tabela ou lista clara, organizada em 3 blocos:

1. **Implantado e confirmado em produção** — cada item com a evidência que confirma (hash, teste real, data).
2. **Implantado só em homolog / aguardando decisão pra produção** — o que falta pra cada um seguir.
3. **Ainda não desenvolvido** — cada sprint pendente, com uma frase sobre o que ela resolveria e se depende de decisão do usuário antes de começar.

Fechar com uma recomendação objetiva de prioridade (2-3 itens), mas sem decidir sozinho — só apontar.
