# Engenharia reversa — atendIA (painel.atendiatec.com.br): funil que se move sozinho

Data: 2026-11-02 · Método: REA `capture_browser_scenario` (Edge headless, perfil temporário, login
real da conta "AS"), leitura do HTML/RSC servido pelo próprio painel, do `GET /api/ia/agents` e dos
bundles JS de `/app/funil`, `/app/ia` e do pacote de traduções (`chunks/90039-*.js`).
Nada foi alterado na conta. Credenciais não estão neste arquivo.

## 1. O que é

Next.js (App Router, RSC) atrás de Cloudflare, sessão por cookie (`POST /api/session`), tempo real por
SSE (`/api/stream`, `/api/notifications/stream`). Módulos: Conversas, Grupos, Kanban, **Funil**,
Templates, Disparos, Contatos, Agenda, Relatórios, Atividade, Ligação, Equipe, **IA**, Configuração.

## 2. Modelo do funil (observado no payload de `/app/funil`)

- **Funil (pipeline)**: `name`, `description`, `kind: "revenue"`, `singleCardPerContact` (um card aberto
  por cliente), `requireLostReason`, `stallDays` (card parado há N dias fica laranja).
  A conta tem 3 funis ("Disparos rotina", "Re-marketing", "BASE MT").
- **Etapa (stage)**: `name`, `color`, `kind` (`active` | `won` | `lost`), `probability`, `automations[]`.
- **Card**: `cardId`, `conversationId` (o card é ligado à conversa do WhatsApp), `stageId`, `valueCents`,
  `tags`, `ownerUserId`, `stageEnteredAt`, `lastMessage`/`lastMessageAt`, `closedAt`, motivo de ganho/perda.
  "Disparos rotina": CONFIRMAÇÃO 133, EM CONVERSA 462, AGENDADO 12, SEM INTERESSE 2, REUNIÃO REALIZADA 1.
- Histórico do card registra eventos `moved`, `value`, `owner`, `automation` (com nota), `trashed`...
  Texto `origem_automation = "Foi uma regra do funil"`.

## 3. Duas camadas de automação

### 3a. Automações da etapa (o que acontece DEPOIS que o card entra)
Gatilho fixo: **"quando um card entrar em <etapa>"** — "arrastando no quadro, pelo painel do cliente ou
pela API". Ações (nesta ordem, uma vez, na entrada): `add_tag`, `set_owner`, `send_template`.
"Uma falha nunca desfaz o movimento: vira um aviso no histórico do card."

### 3b. Ações da IA (o que faz o card ANDAR sozinho)
O agente de atendimento (prompt + modelo, ex.: `gpt-5.6-luna`) tem **ações** configuráveis
(`set_tool` com `acao` + `config`). Catálogo observado:

| Ação | Rótulo |
|---|---|
| `mover_no_funil` | Mover no funil |
| `criar_card` | Criar card no funil |
| `atualizar_card` | Atualizar card do funil |
| `adicionar_etiqueta` / `remover_etiqueta` | Adicionar / remover etiqueta |
| `transferir_departamento` | Transferir de setor |
| `encerrar_conversa` | Encerrar a conversa |
| `atualizar_contato` / `anotar_contato` | Atualizar dados / anotar no contato |
| `agendar_retorno` | Retomar a conversa no horário que o cliente pediu |
| `dar_toque` | Dar um toque e desligar |

Config de cada ação: `pipeline_id`, **`etapas` permitidas**, `etiquetas` permitidas, `setores`, `segundos`.
A IA só escolhe destinos **da lista configurada**. Travas observadas nas mensagens:
- etapa de Ganho/Perdido não pode ser destino: "a IA não fecha venda sozinha";
- "A IA pediu uma opção que não está na lista configurada";
- "Este contato tem mais de um card no funil; a IA não escolheu qual mover";
- "Este contato não tem card no funil"; "Já estava assim — nada mudou";
- "A mensagem da IA não foi entregue, então a ação foi cancelada" (ação só vale se a resposta saiu);
- **autonomia**: "A autonomia da IA não permite esta ação sem aprovação" (ação pode exigir aprovação).

Cada tentativa aparece na conversa como evento: "Moveu o card para a etapa “X”" (feito) ou
"Mover o card para a etapa “X”" + motivo (não feito). Ação errada pode ser marcada pelo atendente
("Fez uma ação errada") — vira aprendizado.

**Lições** (`save_lesson`): regras curtas "sempre" (máx. 10) ou "situação" (`quando` → `regra`) que
corrigem o comportamento da IA sem reescrever o prompt. **Follow-up** (`set_followup`): passos
`{apos_minutos, instrucao}`.

### 3c. Regras do funil
Permissão separada "Criar, publicar e pausar as regras do funil" e eventos `pipeline_rule_failed` /
`pipeline_rule_paused`, notificação "Envio automático não feito: {card}". Não foi possível ver o
editor das regras nesta conta (sem regras criadas) — **não observado**.

## 4. Limites desta análise

- Nesta conta a IA está DESLIGADA (`tenant_ai_disabled`) e os 2 agentes têm `tools: null`: o
  comportamento "move sozinho" foi reconstituído pelo catálogo, pelos esquemas e pelos textos do
  produto, não observado numa conversa real.
- O servidor (prompt das ações, classificação) não é visível: como o modelo decide é inferência —
  pelos esquemas, é **chamada de ferramenta** do próprio agente durante a resposta, com destino
  restrito à lista configurada.
- Só leitura: nenhuma configuração foi alterada.
