O problema de sincronização de conversas do WhatsApp ocorre principalmente devido a uma divergência entre os nomes das colunas no banco de dados e os nomes usados no código do backend, além da falta de criação automática de contatos quando uma nova mensagem é recebida.

### Alterações propostas:

#### 1. Banco de Dados (Migração)
- Adicionar um índice ÚNICO na tabela `contatos` para o par `(user_id, telefone)`. Isso permitirá realizar um "UPSERT" seguro (inserir se não existir, atualizar se já existir).
- Verificar e garantir a integridade da tabela `whatsapp_messages`.

#### 2. Backend - Webhook (`backend/src/routes/webhook.ts`)
- **Correção de Nomes de Colunas**: Ajustar a query de inserção em `whatsapp_messages` para usar os nomes corretos: `instancia`, `id`, `tipo`, `conteudo`, `midia_mime` e `timestamp_unix`.
- **Criação de Contatos (UPSERT)**: Substituir o `UPDATE` simples por um `INSERT ... ON CONFLICT` para garantir que novos leads que chamam no WhatsApp sejam criados automaticamente no CRM.
- **Sincronização de Respostas Manuais**: Alterar a lógica para que mensagens enviadas manualmente (pelo próprio WhatsApp ou WhatsApp Web) também sejam salvas na tabela `whatsapp_messages`, permitindo que apareçam no histórico do CRM.
- **Deduplicação**: Garantir que o `session_id` (número do telefone) seja preenchido corretamente.

#### 3. Backend - Motor de IA (`backend/src/services/agentEngine.ts`)
- **Correção de Nomes de Colunas**: Ajustar a query de inserção em `whatsapp_messages` para corresponder ao esquema do banco de dados, garantindo que as respostas da IA sejam registradas corretamente no chat.

### Detalhes Técnicos:
- Tabela `whatsapp_messages` esquema: `id` (PK), `user_id`, `instancia`, `session_id`, `remote_jid`, `from_me`, `push_name`, `tipo`, `conteudo`, `midia_url`, `midia_mime`, `midia_nome`, `status`, `timestamp_unix`.
- A query atual no código usa nomes como `instance_name`, `message_id`, `message_type`, `content`, o que causa falha silenciosa na persistência.
