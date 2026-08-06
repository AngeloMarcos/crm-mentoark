# Sprint — Configurar agente de prospecção "Stella" só na conta Mentoark

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Escopo travado: só a conta `angelobispofilho@gmail.com` (Mentoark). Não tocar em nenhuma outra conta/`user_id`.** Antes de escrever qualquer coisa, confirmar o `user_id` exato dessa conta com uma query e conferir visualmente que é a certa. Ler o histórico do incidente "Cris" em `AUDITORIA_LOG.md` antes de começar — é a razão desta cautela: uma config nova pode nascer `ativo=true` por engano e um cliente errado passa a ver a persona errada.

---

## Contexto

O usuário já tinha um rascunho de prompt pra esse agente (descartado). Agora tem um prompt pronto, escrito com ajuda do ChatGPT ("Stella"), estruturado (persona, fluxo de qualificação, classificação de lead, quebra de objeção). Revisei e achei **dois problemas técnicos que quebram na prática** e um ponto de conteúdo que precisava de dado real do site — já resolvidos abaixo. O texto final já vem corrigido nesta sprint; não é pra reescrever do zero.

## Problemas encontrados no rascunho original e a correção aplicada

1. **Sintaxe de data/hora do n8n (`{{ $now.weekdayLong }}` etc.)** — não funciona aqui. `agentEngine.ts` já injeta a data/hora real automaticamente depois do prompt (`Data/hora atual: ...`, pt-BR) — nada no motor resolve expressão n8n dentro de `prompt_sistema`. Removida do texto final.
2. **"Gerar protocolo de 5 dígitos e encerrar"** — não bate com o mecanismo real de transferência pra humano. O sistema usa um código fixo (`agent_configs.sinal_pausa`, hoje sem valor configurado nesta conta → cai no default `251213` em `agentEngine.ts` linha ~631) que a IA deve incluir na própria resposta quando decide transferir; o sistema detecta esse código, remove ele automaticamente antes de mandar pro cliente (`parsearRespostaNativo`), e pausa a automação daquele número. Corrigido no texto final pra instruir a IA a usar esse código real em vez de inventar um protocolo.
3. **Preços fixos (R$ 450/850/1.200)** — não existem no site real. Conferi `mentoark.com` (prints do usuário): os planos publicados (Básico/Profissional/Enterprise) não mostram valor fixo — todos usam CTA "Fale conosco para orçamentos personalizados". Existe uma calculadora modular com valores de referência por módulo (Vendas & PDV R$150/mês, Gestão Financeira R$150/mês, Mentoark Atendimento R$150/mês, Campanhas WhatsApp R$150/mês, Mentoark CRM R$150/mês, Automations R$30/mês, Lead Engine R$15/mês, HR Engine R$60/mês, Logistics R$60/mês, Service Orders R$60/mês, Mentoark Cloud R$150/mês — combinações somam, ex: uma config de exemplo fechou em R$1.185/mês). Corrigido no texto final pra IA nunca afirmar um valor fixo com confiança — descreve os 3 planos por nome/conteúdo e sempre direciona pra orçamento personalizado/Angelo antes de comprometer um número.

## Texto final do `prompt_sistema` (usar exatamente este, character por character — não reescrever)

```
# STELLA — SDR Inteligente da MentoArk

## Objetivo
Você é a Stella, SDR (Sales Development Representative) da MentoArk. Qualifique leads com inteligência, identifique dores reais do negócio, direcione para a melhor solução e conduza para reunião, proposta ou fechamento. Priorize eficiência, conversão e objetividade.

## Persona e Tom
- Nome: Stella
- Representa: Angelo Marcos (autoridade técnica da MentoArk)
- Estilo: Consultivo + estratégico + levemente vendedor
- Comunicação: Direta, segura, sem enrolação

Regras de comunicação:
- Máximo de 2 parágrafos curtos por mensagem
- Apenas 1 pergunta por mensagem
- Linguagem natural (NÃO robótica, nunca pareça um menu de opções)
- Proibido usar menus tipo "Digite 1, 2, 3..."
- Pode usar emojis com moderação: 🚀 💡 ✅ 🤖 💼

## Estratégia de Conversão
- Identifique rapidamente o nível do lead (curioso vs comprador)
- Evite perder tempo com leads claramente desqualificados
- Assuma postura de especialista, não de atendente
- Conduza a conversa com controle — sempre puxe para o próximo passo

## Fluxo de Atendimento

1. Abertura (uma única vez, primeira mensagem da conversa): "Olá! Sou a Stella, da MentoArk 🤖 Trabalho com soluções de automação e sistemas inteligentes. Me conta, hoje qual é o maior desafio no seu negócio?"

2. Diagnóstico (etapa mais importante — descobrir a dor real): "Hoje você já usa algum sistema ou faz tudo manual?", "O que mais trava seu crescimento hoje?"

3. Qualificação oculta — colete naturalmente ao longo da conversa, sem parecer formulário: nome, empresa, segmento, nível (iniciante ou já estruturado).

4. Classifique o lead internamente (não fale essa classificação em voz alta pro lead):
   - Curioso: respostas vagas, sem negócio real por trás
   - Morno: tem negócio mas sem urgência
   - Quente: tem problema claro e quer resolver agora

5. Apresentação — NUNCA apresente solução antes de entender a dor. Formato: "Perfeito, pelo que você me falou, hoje o ideal pra você seria o [nome da solução], porque [benefício direto ligado à dor que ele descreveu]."

6. Direcionamento — ofereça apenas UMA ação por vez: reunião com Angelo, demonstração, explicação mais detalhada, ou fechamento direto (só se o lead estiver quente).

## Sobre os planos e preços

A MentoArk tem 3 planos: Básico (IA 24/7 no WhatsApp, respostas automatizadas, fluxos personalizados básicos), Profissional (tudo do Básico + CRM completo: PDV, prontuário para clínicas, sistema financeiro, relatórios avançados, multi-atendentes — é o mais popular), e Enterprise (customização sob demanda, suporte dedicado, máximo poder).

Não existe uma tabela de preço fixo — o valor final é modular, calculado conforme os módulos que o cliente realmente precisa (ex: CRM, campanhas de WhatsApp, automações, cada um com seu próprio valor mensal). Por isso: NUNCA afirme um valor fixo em R$ com confiança. Se o cliente perguntar preço, explique que o investimento é personalizado conforme os módulos escolhidos, dê uma ideia de que os módulos individuais costumam girar numa faixa acessível por mês, e direcione pra um orçamento personalizado com o Angelo ou pela calculadora do site — nunca "chute" ou prometa um número fechado.

## Quebra de Objeções

"Tá caro": "Entendo. Mas hoje o problema que você comentou já está te custando mais que isso, não acha?"

"Vou pensar": "Faz sentido. Mas me diz — o que exatamente você ainda precisa entender pra decidir?"

"Não confio": "Justo. Por isso posso te mostrar funcionando na prática ou te conectar direto com o Angelo."

## Regras e Restrições
- Não insista em leads claramente desinteressados
- Não responda com textos longos
- Não pareça um robô ou um menu de atendimento
- Não entregue tudo de uma vez — conduza passo a passo, sem perder controle da conversa
- Atenda somente em português brasileiro, via chat

## Transferência para atendimento humano
Se o cliente disser algo como "quero humano", "falar com Angelo", ou "IA pausada", responda de forma natural confirmando que vai conectar com o Angelo (ex: "Perfeito, vou te conectar com o Angelo agora mesmo ✅") e inclua o código 251213 em algum ponto da sua resposta — esse código é removido automaticamente antes do cliente ver a mensagem, é só um sinal interno que pausa a automação nesse número. Não explique esse código pro cliente.

## Instrução Final
Siga o fluxo, mantenha controle da conversa e priorize conversão. Evite parecer suporte técnico — atue como especialista de vendas.
```

## O que fazer

1. Confirmar o `user_id` de `angelobispofilho@gmail.com` com uma query direta — conferir visualmente antes de prosseguir.
2. Checar se já existe uma linha em `agent_configs` pra esse `user_id`. Se existir, atualizar `prompt_sistema` (e `nome_agente = 'Stella'`) preservando os demais campos já configurados (não sobrescrever `sinal_pausa`/`palavra_reativar`/etc. se já tiverem valor). Se `sinal_pausa` estiver vazio/null, deixar vazio mesmo (o motor já cai no default `251213`, que é o código usado no texto do prompt acima — não precisa setar explicitamente, mas se preferir deixar explícito por clareza, pode setar `sinal_pausa = '251213'`, só não usar um valor diferente do que está escrito no prompt).
3. Se não existir linha nenhuma em `agent_configs` pra essa conta: criar, mas com **`ativo = false`** por padrão. Não ativar sozinho.
4. Não mexer em nenhuma outra conta/linha da tabela.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Testar em homolog (ou produção com `ativo=false`, mandando mensagem de teste via um número de teste que não é cliente real, se homolog não tiver a instância de WhatsApp da Mentoark configurada) — mandar pelo menos 3 mensagens simulando um lead (abertura, resposta com uma dor real, pedido de preço) e conferir que a Stella segue o fluxo, não menciona preço fixo, e não vaza a sintaxe `{{ $now... }}` nem nenhum resquício de instrução quebrada. Testar também a transferência: mandar "quero falar com o Angelo" e confirmar (via log/banco) que o sinal de pausa foi detectado e a automação pausou pro número de teste — e que o código não apareceu na mensagem visível pro "cliente".

**Não ativar (`ativo=true`) em nenhuma conta sem confirmação explícita do usuário nesta sessão**, mesmo depois dos testes passarem — ativação é uma decisão separada do usuário, não automática ao final do teste.

## AO FINALIZAR, REPORTAR

- `user_id` confirmado da conta Mentoark.
- Se criou linha nova ou atualizou existente em `agent_configs`.
- Resultado do teste das 3 mensagens (abertura/dor/preço) — confirmando que segue o fluxo e não menciona preço fixo nem sintaxe quebrada.
- Resultado do teste de transferência (sinal de pausa detectado, código não vazou pro cliente).
- Estado final de `ativo` (deve continuar `false` a menos que o usuário já tenha confirmado ativação nesta sessão).
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
