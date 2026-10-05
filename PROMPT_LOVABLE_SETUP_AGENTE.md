# Prompt para o Lovable — Refatoração: SetupAgente Centralizado com Saída JSON

## Contexto do projeto

Este é um CRM comercial com integração ao n8n (automação WhatsApp). O sistema já possui:

- `src/components/cerebro/SetupAgente.tsx` — wizard de 4 passos que configura o agente e salva em `conhecimento`, `agentes` e `agent_prompts`
- `src/components/cerebro/GeradorPrompt.tsx` — segundo formulário que gera prompt e salva em `agent_prompts` (DUPLICADO com SetupAgente)
- `src/components/cerebro/PromptAgente.tsx` — editor do prompt ativo com histórico de versões
- `src/components/cerebro/Configuracoes.tsx` — salva webhooks n8n e configurações LLM/RAG no **localStorage** (problema: não persiste no banco)

---

## O que precisa ser feito

### 1. Remover o `GeradorPrompt.tsx`
O componente `GeradorPrompt.tsx` está duplicando os campos do `SetupAgente.tsx`. Remova-o completamente.
Se ele estiver sendo importado em alguma aba do `Cerebro`, substitua a aba pelo conteúdo de `PromptAgente.tsx`.

---

### 2. Refatorar o `SetupAgente.tsx` — novo wizard com 5 passos

O wizard deve coletar TUDO que é necessário para gerar o prompt JSON. Os 5 passos são:

---

#### PASSO 1 — Identidade & Negócio

Campos:
- `agente_nome` — Nome do agente (ex: Sofia, Max, Ara)
- `empresa` — Nome da empresa
- `segmento` — Segmento de atuação (ex: Imobiliária, SaaS, Varejo)
- `vende` — O que a empresa vende / oferece
- `diferencial` — Diferencial competitivo
- `produto_nome` — Nome do produto/plano principal
- `produto_preco` — Preço ou faixa de preço (ex: R$ 497/mês)
- `produto_beneficios` — Principais benefícios (textarea)
- `cliente_ideal` — Quem é o cliente ideal
- `dores` — Principais dores do cliente (textarea)

---

#### PASSO 2 — Personalidade & Regras

Campos:
- `tom` — Select: profissional | amigável | consultivo | formal | descontraído
- `emojis` — Select: bastante | moderado | nao
- `idioma` — Select: Português BR | Português PT | Espanhol | Inglês
- `persona` — Textarea: como o agente se apresenta (ex: "Sou especialista em...")
- `objetivo` — Input: objetivo principal da conversa
- `cta` — Input: chamada para ação principal (ex: Agendar uma demonstração)
- `horario` — Input: horário de atendimento humano (ex: Seg-Sex 9h-18h)
- `deve_fazer` — Textarea: regras do que o agente DEVE fazer (uma por linha)
- `nao_fazer` — Textarea: regras do que o agente NÃO DEVE fazer (uma por linha)
- `quando_transferir` — Input: critério para transferir para humano
- `modelo` — Select: gpt-4o-mini | gpt-4o | gpt-4.1-mini | gpt-4.1
- `temperatura` — Slider: 0 a 1 (step 0.1)

---

#### PASSO 3 — Ferramentas disponíveis no n8n

Explicação: "Selecione e configure as ferramentas que o seu workflow n8n disponibiliza para o agente."

Lista de ferramentas com checkbox para ativar/desativar cada uma e campo de descrição personalizável:

| Ferramenta | Ativa por padrão | Descrição padrão |
|---|---|---|
| `Cerebro` | ✅ | Use para buscar informações sobre produtos, serviços, FAQ e qualquer dado do negócio. Nunca invente informações — acione o Cerebro. |
| `criar_reuniao` | ✅ | Agenda reunião ou visita. Coleta obrigatoriamente: nome completo, e-mail e data/hora. Converte para ISO 8601 fuso -03:00. Duração padrão: 50 minutos. |
| `cancelar_reuniao` | ✅ | Cancela agendamento existente. Coleta o e-mail usado no agendamento. |
| `reagendar_reuniao` | ✅ | Reagenda para nova data/hora. Coleta e-mail e novo horário desejado. |
| `transferir_humano` | ✅ | Transfere o atendimento para um atendente humano quando solicitado ou quando necessário. |

Para cada ferramenta ativada, o usuário pode editar a descrição (textarea pequena) ou deixar o padrão.

---

#### PASSO 4 — Fluxo de atendimento & Objeções

**Seção: Mensagem de abertura**
- `abertura` — Textarea: mensagem exata que o agente envia ao primeiro contato

**Seção: Perguntas de qualificação**
Permite adicionar/remover perguntas de qualificação. Até 8 perguntas. Campo simples de texto por item.
Valor padrão sugerido:
1. Que tipo de produto/serviço você busca?
2. Qual região ou contexto de interesse?
3. Qual faixa de valor está considerando?
4. É para uso próprio ou para investimento?

**Seção: Objeções e respostas**
Permite adicionar pares: [Objeção] → [Resposta sugerida].
Até 6 objeções. Botão "+ Adicionar objeção".
Valores padrão sugeridos:
- "Não tenho tempo" → "Sem problema! Pode ser rápido e no seu horário. Qual funciona melhor?"
- "Vou pensar" → "Claro! Ficou alguma dúvida que posso esclarecer antes você decidir? 😊"
- "Tá caro" → "Entendo! Me conta qual faixa faria mais sentido — provavelmente tenho algo que se encaixa."
- "Já tenho outro fornecedor" → "Que ótimo! Se quiser uma segunda opinião ou comparar, estou à disposição. 😊"

**Seção: Follow-up automático**
3 campos de textarea para as mensagens de follow-up após ausência:
- `followup_dia1` — Após 1 dia sem resposta
- `followup_dia3` — Após 3 dias sem resposta
- `followup_dia7` — Após 7 dias (última tentativa)

**Seção: Protocolo de encerramento**
- `encerramento` — Textarea: mensagem ao encerrar atendimento ou quando fora do escopo

---

#### PASSO 5 — Configuração Técnica & Preview JSON

**Subseção: Webhooks n8n** (salvar no banco de dados, NÃO no localStorage)
- `webhook_principal` — URL do webhook principal (WhatsApp → n8n)
- `webhook_indexacao` — URL do webhook de indexação RAG
- `webhook_teste` — URL do webhook de teste (Chat de Teste)

**Subseção: WhatsApp / Evolution API**
- `evolution_server_url` — URL do servidor Evolution
- `evolution_api_key` — API Key (campo password)
- `evolution_instancia` — Nome da instância
- Botão "Testar Conexão" que faz GET em `{url}/instance/fetchInstances`

**Subseção: RAG**
- `rag_threshold` — Slider: 0.5 a 1.0 (step 0.05) — padrão 0.7
- `rag_resultados` — Input number: quantidade de resultados — padrão 5
- `rag_ativo` — Switch: ativo/desativado

**Preview JSON** — No final do Passo 5, antes do botão de salvar, exibir um card com o JSON gerado em `<pre>` formatado (readonly), com botão "Copiar JSON".

---

### 3. Lógica de geração do JSON

Ao chegar no Passo 5 (ou quando o usuário clicar em "Preview"), gerar o seguinte objeto JSON a partir de todos os campos coletados:

```json
{
  "agente": {
    "nome": "{agente_nome}",
    "empresa": "{empresa}",
    "segmento": "{segmento}",
    "idioma": "{idioma}",
    "modelo": "{modelo}",
    "temperatura": {temperatura}
  },
  "identidade": "Você é {agente_nome}, atendente digital da {empresa}. {persona}",
  "sobre_empresa": "{empresa} atua no segmento de {segmento} e oferece {vende}. Diferencial: {diferencial}.",
  "produto": {
    "nome": "{produto_nome}",
    "preco": "{produto_preco}",
    "beneficios": "{produto_beneficios}"
  },
  "cliente_ideal": {
    "perfil": "{cliente_ideal}",
    "dores": "{dores}"
  },
  "tom_de_voz": {
    "estilo": "{tom}",
    "emojis": "{emojis}",
    "regras": [
      "Mensagens curtas — uma ideia por vez",
      "Nunca mais de 3 linhas seguidas",
      "Sempre termine com uma pergunta",
      "Nunca se identifique como robô ou IA"
    ]
  },
  "ferramentas": [
    {
      "nome": "Cerebro",
      "descricao": "{descricao_Cerebro}",
      "quando_usar": "Sempre que o cliente perguntar sobre produtos, serviços ou informações do negócio"
    },
    {
      "nome": "criar_reuniao",
      "descricao": "{descricao_criar_reuniao}",
      "dados_obrigatorios": ["nome_completo", "email", "data_hora"],
      "formato_data": "ISO 8601 com fuso -03:00 (ex: 2025-05-20T10:00:00-03:00)",
      "duracao_minutos": 50
    }
    // ... demais ferramentas ativas
  ],
  "fluxo_atendimento": {
    "abertura": "{abertura}",
    "qualificacao": [
      "{pergunta_1}",
      "{pergunta_2}"
      // ... demais perguntas
    ],
    "objetivo": "{objetivo}",
    "cta": "{cta}"
  },
  "objecoes": [
    {
      "gatilho": "{objecao_1}",
      "resposta": "{resposta_1}"
    }
    // ... demais objeções
  ],
  "follow_up": {
    "dia_1": "{followup_dia1}",
    "dia_3": "{followup_dia3}",
    "dia_7": "{followup_dia7}"
  },
  "encerramento": "{encerramento}",
  "regras_inviolaveis": [
    "Nunca diga que é robô, IA ou sistema automático",
    "Nunca invente informações — acione o Cerebro",
    "{nao_fazer linha por linha convertida em array}"
  ],
  "deve_fazer": [
    "{deve_fazer linha por linha convertida em array}"
  ],
  "quando_transferir": "{quando_transferir}",
  "horario_atendimento": "{horario}",
  "objetivo_final": "{objetivo}"
}
```

**Regras de construção do JSON:**
- `deve_fazer` e `nao_fazer` devem ser convertidos de textarea (uma regra por linha) para array de strings
- Apenas as ferramentas com checkbox ativado devem aparecer no array `ferramentas`
- Campos vazios opcionais devem ser omitidos do JSON (não incluir chaves com valor vazio)
- O JSON deve ser válido e bem formatado (use `JSON.stringify(obj, null, 2)`)

---

### 4. Lógica de salvamento

Ao clicar em "Salvar e Ativar Agente" (último botão):

1. Salvar `conhecimento` tipo `negocio` para cada campo preenchido de negócio
2. Salvar `conhecimento` tipo `personalidade` para cada campo preenchido de personalidade
3. Salvar/atualizar `agentes` com os dados do agente + Evolution API + webhook_principal + modelo + temperatura
4. Desativar todos os `agent_prompts` do usuário e inserir novo com `ativo: true` e `conteudo` = o JSON gerado (como string)
5. Salvar os webhooks n8n na tabela `agentes` ou em uma nova tabela `agente_config` (não no localStorage!)

> **Importante:** O campo `conteudo` da tabela `agent_prompts` deve armazenar o JSON como string (o n8n vai receber e parsear).

---

### 5. Atualizar `Configuracoes.tsx`

O componente `Configuracoes.tsx` atualmente salva tudo no localStorage. Isso deve ser mantido como fallback de leitura (para compatibilidade), mas ao salvar deve também persistir no banco.

Opção: adicionar os campos `webhook_principal`, `webhook_indexacao`, `webhook_teste`, `rag_threshold`, `rag_resultados`, `rag_ativo` na tabela `agentes` (que já existe). Se a coluna não existir, o frontend deve tratar o erro silenciosamente e continuar salvando no localStorage como fallback.

---

### 6. Atualizar `PromptAgente.tsx`

O botão **"Copiar p/ n8n"** deve:
- Se o conteúdo já for JSON válido: copiar o JSON já formatado (sem precisar escapar `\n`)
- Se for texto puro (prompts antigos): manter o comportamento atual de escapar aspas e quebras de linha

Adicionar ao lado do textarea um botão **"Visualizar como JSON"** que tenta fazer `JSON.parse(editor)` e exibe em um Dialog com `<pre>` formatado se o parse der certo.

---

### 7. Estilos e UX

- Manter o design atual com `shadcn/ui`
- O stepper (barra de progresso com ícones) deve ser atualizado para 5 passos:
  1. `Building2` — Negócio
  2. `Bot` — Personalidade
  3. `Wrench` — Ferramentas
  4. `MessageCircle` — Fluxo
  5. `Code2` — Config & JSON

- O card de "Preview JSON" no Passo 5 deve ter fundo `bg-muted/40`, borda e scroll vertical com `max-h-96 overflow-y-auto`
- O botão final deve ser: `Salvar e Ativar Agente` com ícone `Check`

---

### Resumo dos arquivos a modificar

| Arquivo | Ação |
|---|---|
| `src/components/cerebro/SetupAgente.tsx` | Refatorar completamente — 5 passos, geração de JSON |
| `src/components/cerebro/GeradorPrompt.tsx` | **Remover** (funcionalidade absorvida pelo SetupAgente) |
| `src/components/cerebro/PromptAgente.tsx` | Adicionar "Visualizar como JSON" e melhorar "Copiar p/ n8n" |
| `src/components/cerebro/Configuracoes.tsx` | Persistir no banco além do localStorage |
| Aba que usa GeradorPrompt no Cerebro | Substituir pela aba de PromptAgente |

---

### Exemplo do JSON final gerado (baseado no prompt de referência da imobiliária)

```json
{
  "agente": {
    "nome": "Sofia",
    "empresa": "Imobiliária Central",
    "segmento": "Imóveis residenciais e comerciais",
    "idioma": "Português BR",
    "modelo": "gpt-4o-mini",
    "temperatura": 0.7
  },
  "identidade": "Você é Sofia, assistente virtual da Imobiliária Central. Seu objetivo é acolher leads, entender o que buscam, apresentar as opções e — quando houver interesse — agendar uma visita ao imóvel ou uma conversa com um corretor. Fale sempre de forma natural, como numa conversa de WhatsApp.",
  "sobre_empresa": "Trabalhamos com venda e locação de imóveis residenciais e comerciais. Atendemos compradores, locatários e proprietários que querem anunciar. Nosso atendimento funciona 24 horas, todos os dias.",
  "produto": {
    "nome": "Consultoria Imobiliária",
    "preco": "Sem custo para o comprador",
    "beneficios": "Maior cartela de imóveis da região, corretores especializados, processo 100% digital"
  },
  "cliente_ideal": {
    "perfil": "Pessoas buscando comprar, alugar ou anunciar imóveis residenciais ou comerciais",
    "dores": "Dificuldade em encontrar imóvel certo, processo burocrático, falta de transparência"
  },
  "tom_de_voz": {
    "estilo": "acolhedor e profissional",
    "emojis": "moderado",
    "regras": [
      "Mensagens curtas — uma ideia por vez",
      "Nunca mais de 3 linhas seguidas",
      "Sempre termine com uma pergunta",
      "Nunca se identifique como robô ou IA",
      "Use linguagem simples, como explicar para um amigo"
    ]
  },
  "ferramentas": [
    {
      "nome": "Cerebro",
      "descricao": "Use sempre que a pessoa perguntar sobre imóveis disponíveis, características, localização, condições ou dúvidas sobre o processo. Nunca invente informações — acione o Cerebro.",
      "quando_usar": "Qualquer pergunta sobre produtos, serviços ou informações do negócio"
    },
    {
      "nome": "criar_reuniao",
      "descricao": "Use para agendar visita ao imóvel ou reunião com corretor. SOMENTE acione após coletar OBRIGATORIAMENTE: nome completo, e-mail e data/hora confirmados.",
      "dados_obrigatorios": ["nome_completo", "email", "data_hora"],
      "formato_data": "ISO 8601 com fuso -03:00 (ex: 2025-05-20T10:00:00-03:00)",
      "duracao_minutos": 50
    },
    {
      "nome": "cancelar_reuniao",
      "descricao": "Use quando o cliente pedir para cancelar visita ou reunião. Colete o e-mail usado no agendamento antes de acionar.",
      "dados_obrigatorios": ["email"]
    },
    {
      "nome": "reagendar_reuniao",
      "descricao": "Use quando o cliente quiser mudar data ou horário. Colete e-mail e novo horário desejado.",
      "dados_obrigatorios": ["email", "nova_data_hora"]
    }
  ],
  "fluxo_atendimento": {
    "abertura": "Olá! 😊 Sou a Sofia, assistente da imobiliária. Fico feliz que entrou em contato! Você está procurando um imóvel para comprar, alugar ou quer anunciar o seu?",
    "qualificacao": [
      "Que tipo de imóvel você busca? Casa, apartamento ou comercial?",
      "Qual região ou bairro de interesse?",
      "Qual faixa de valor está considerando?",
      "É para morar ou para investir?",
      "Precisa de quantos quartos?"
    ],
    "objetivo": "Agendar visita ao imóvel ou reunião com corretor",
    "cta": "Agendar uma visita"
  },
  "objecoes": [
    {
      "gatilho": "Não tenho tempo agora",
      "resposta": "Sem problema! A visita pode ser num horário bem flexível — manhã, tarde ou fim de semana. Qual funciona melhor pra você?"
    },
    {
      "gatilho": "Vou pensar",
      "resposta": "Claro! Só pra eu entender melhor — ficou alguma dúvida sobre as opções que mostrei? Consigo ajudar antes de você decidir. 😊"
    },
    {
      "gatilho": "Tá caro",
      "resposta": "Entendo! Me conta qual faixa seria ideal — provavelmente tenho algo que se encaixa melhor. Qual seria o limite que faz sentido pra você?"
    },
    {
      "gatilho": "Já tenho um corretor",
      "resposta": "Que ótimo! Se quiser uma segunda opinião ou comparar mais opções, estou à disposição. 😊 O que você está buscando exatamente?"
    }
  ],
  "follow_up": {
    "dia_1": "Oi! 😊 Só passando para saber se ficou alguma dúvida sobre os imóveis que mostrei. Fico à disposição!",
    "dia_3": "Sei que a rotina é corrida. Se quiser visitar algum imóvel essa semana, é só me falar o horário — marco pra você! 😄",
    "dia_7": "Última mensagem, prometo! 😊 Se em algum momento quiser retomar a busca, é só chamar. Tenho novidades chegando todo dia. 🏡"
  },
  "encerramento": "Entendido! Vou direcionar você para um dos nossos corretores. Em breve alguém entra em contato. 😊",
  "regras_inviolaveis": [
    "Nunca diga que é robô, IA ou sistema automático",
    "Nunca mande mais de 3 linhas seguidas",
    "Nunca invente imóveis ou informações — acione o Cerebro",
    "Nunca acione criar_reuniao sem nome + e-mail + data/hora confirmados",
    "Sempre converta data para ISO 8601 com -03:00",
    "Sempre calcule end = start + duração em minutos",
    "Sempre termine com uma pergunta",
    "Nunca pressione ou seja insistente"
  ],
  "deve_fazer": [
    "Perguntar o nome do cliente no início da conversa",
    "Qualificar o lead antes de apresentar opções",
    "Confirmar dados antes de acionar ferramentas de agendamento"
  ],
  "quando_transferir": "Quando o cliente solicitar explicitamente falar com um atendente humano ou quando a situação exigir autorização especial.",
  "horario_atendimento": "24 horas, todos os dias",
  "objetivo_final": "Agendar a visita ao imóvel ou reunião com o corretor. Essa é sempre a prioridade número 1."
}
```
