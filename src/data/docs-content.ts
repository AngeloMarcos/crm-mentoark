export interface DocSection {
  id: string;
  title: string;
  icon: string;
  description: string;
  articles: DocArticle[];
}

export interface DocArticle {
  id: string;
  title: string;
  badge?: { label: string; color: string };
  content: DocBlock[];
}

export type DocBlock =
  | { type: 'heading'; level: 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'callout'; variant: 'info' | 'success' | 'warn' | 'danger'; title: string; text: string }
  | { type: 'code'; lang: string; label?: string; code: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'cards'; items: { title: string; text: string; icon: string; color: string }[] }
  | { type: 'divider' };

export const DOCS: DocSection[] = [
  // ─────────────────────────────────────────────────────────────────────
  // 1. VISÃO GERAL
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'visao-geral',
    title: 'Visão Geral',
    icon: '🏠',
    description: 'Produto, arquitetura e roadmap do sistema',
    articles: [
      {
        id: 'o-que-e',
        title: 'O que é o Mentoark',
        content: [
          {
            type: 'paragraph',
            text: 'Mentoark é uma plataforma de CRM + Automação Comercial via WhatsApp focada no mercado B2B brasileiro. Combina gestão de leads, disparo de mensagens em massa, agente de IA conversacional e análise de performance em um único sistema.',
          },
          { type: 'heading', level: 3, text: 'Para quem é' },
          {
            type: 'cards',
            items: [
              { title: 'Vendedores', text: 'Gerenciam leads, funil e disparos sem sair do sistema', icon: '👔', color: 'blue' },
              { title: 'Gestores', text: 'Acompanham KPIs, conversas e performance do agente IA', icon: '📊', color: 'purple' },
              { title: 'Desenvolvedores', text: 'API REST com JWT, PostgreSQL, Docker — stack moderna', icon: '💻', color: 'green' },
              { title: 'Clientes WhatsApp', text: 'Interagem com o agente IA 24/7 sem saber que é IA', icon: '💬', color: 'orange' },
            ],
          },
          { type: 'heading', level: 3, text: 'Componentes principais' },
          {
            type: 'table',
            headers: ['Componente', 'Tecnologia', 'URL'],
            rows: [
              ['CRM Frontend', 'React + Vite + TypeScript', 'crm.mentoark.com.br'],
              ['Backend API', 'Express.js + TypeScript', 'api.mentoark.com.br'],
              ['Banco de Dados', 'PostgreSQL 16 + pgvector', '147.93.9.172:5432'],
              ['Automação', 'n8n (Cloudfy)', 'fierceparrot-n8n.cloudfy.live'],
              ['WhatsApp', 'Evolution API', 'disparo.mentoark.com.br'],
              ['Proxy HTTPS', 'Traefik v2', '147.93.9.172'],
            ],
          },
        ],
      },
      {
        id: 'arquitetura',
        title: 'Arquitetura do Sistema',
        content: [
          { type: 'heading', level: 3, text: 'Fluxo principal' },
          {
            type: 'paragraph',
            text: 'O frontend React nunca fala diretamente com o PostgreSQL. Todas as operações passam pelo backend Express que valida o JWT, aplica filtros de user_id e executa as queries.',
          },
          {
            type: 'code',
            lang: 'text',
            label: 'Fluxo de dados',
            code: `Browser (React)
    │  Authorization: Bearer <JWT>
    ▼
Backend Express (api.mentoark.com.br)
    │  authMiddleware → valida JWT → extrai userId
    │  makeCrud() → SELECT ... WHERE user_id = $1
    ▼
PostgreSQL 16 (147.93.9.172:5432)
    │  banco: crm | usuário: mentoark
    ▼
pgvector → busca semântica (RAG)`,
          },
          { type: 'heading', level: 3, text: 'Servidores' },
          {
            type: 'table',
            headers: ['Servidor', 'Provedor', 'Papel'],
            rows: [
              ['147.93.9.172', 'Hostinger VPS', 'CRM + API + PostgreSQL + Evolution + n8n (futuro)'],
              ['Cloudfy', 'Externo', 'n8n principal com workflows WhatsApp ativos'],
            ],
          },
          {
            type: 'callout',
            variant: 'info',
            title: 'Banco único',
            text: 'O PostgreSQL é compartilhado com projetos Lovable. As tabelas dados_cliente, chat_messages e chats não usam filtro user_id — são globais para a instância.',
          },
          { type: 'heading', level: 3, text: 'Autenticação' },
          {
            type: 'paragraph',
            text: 'JWT HS256 com dois tokens: access_token (1h) e refresh_token (30 dias). Armazenados no localStorage com as chaves crm_access_token e crm_refresh_token. O role (admin|user) vem embutido no JWT — sem roundtrip ao banco.',
          },
        ],
      },
      {
        id: 'roadmap',
        title: 'Roadmap — 3 Fases',
        badge: { label: 'Estratégico', color: 'purple' },
        content: [
          {
            type: 'cards',
            items: [
              { title: 'Fase 1 — Integração n8n', text: 'Gerenciar workflows do n8n Cloudfy direto do CRM. Proxy seguro via backend. Página Automações com listar, disparar e ver logs. 2–3 dias.', icon: '🔌', color: 'blue' },
              { title: 'Fase 2 — Motor Nativo', text: 'Engine de automação dentro do Express. Tabela automacoes no PostgreSQL com steps JSON. Triggers: webhook, schedule, evento CRM. 2–4 semanas.', icon: '⚙️', color: 'green' },
              { title: 'Fase 3 — IA + MCP', text: 'CRM expõe ferramentas via MCP Server. Claude como agente que busca contatos, atualiza funil, envia WhatsApp e registra timeline. Sem n8n. 1–3 meses.', icon: '🤖', color: 'purple' },
            ],
          },
          { type: 'heading', level: 3, text: 'Status atual' },
          {
            type: 'table',
            headers: ['Item', 'Status', 'Observação'],
            rows: [
              ['CRM + Backend + PostgreSQL', '✅ Pronto', 'Em produção'],
              ['Busca de Leads (Google Places)', '✅ Pronto', 'Configurar API Key em Integrações'],
              ['Scoring OpenAI', '✅ Pronto', 'Configurar API Key em Integrações'],
              ['Monitor WhatsApp', '✅ Pronto', 'Lê n8n_chat_histories'],
              ['Proxy n8n Cloudfy', '⏳ Fase 1', 'Aguardando API Key do n8n Cloudfy'],
              ['Motor de Automação Nativo', '📋 Fase 2', 'Planejado'],
              ['MCP Server + Agente IA', '📋 Fase 3', 'Planejado'],
              ['PDV (Ponto de Venda)', '📋 Planejado', 'Escopo a definir'],
            ],
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 2. GUIA DO USUÁRIO
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'guia-usuario',
    title: 'Guia do Usuário',
    icon: '👤',
    description: 'Como usar o CRM no dia a dia',
    articles: [
      {
        id: 'primeiro-acesso',
        title: 'Primeiro acesso',
        badge: { label: 'Iniciante', color: 'green' },
        content: [
          { type: 'heading', level: 3, text: 'Login' },
          { type: 'list', items: ['Acesse crm.mentoark.com.br', 'Informe e-mail e senha', 'O token JWT é salvo no navegador por 1h (renovado automaticamente por 30 dias)'] },
          { type: 'heading', level: 3, text: 'Roles (papéis)' },
          {
            type: 'table',
            headers: ['Role', 'O que pode fazer'],
            rows: [
              ['user', 'Acesso a todas as páginas exceto Usuários'],
              ['admin', 'Tudo + gerenciar usuários do sistema'],
            ],
          },
          {
            type: 'callout',
            variant: 'info',
            title: 'Primeiro admin',
            text: 'O primeiro usuário criado pode ser promovido a admin diretamente no banco: UPDATE auth.users SET role = \'admin\' WHERE email = \'seu@email.com\';',
          },
        ],
      },
      {
        id: 'leads-funil',
        title: 'Leads e Funil de Vendas',
        content: [
          { type: 'heading', level: 3, text: 'Gerenciar Leads' },
          { type: 'paragraph', text: 'A página Leads exibe todos os contatos com filtros por status, busca por nome/telefone/e-mail e paginação. Cada lead pode ser aberto para ver a linha do tempo de interações.' },
          { type: 'heading', level: 3, text: 'Buscar Leads (Google Places)' },
          { type: 'list', items: [
            'Clique no botão "Buscar Leads" no canto superior direito da página Leads',
            'Informe o segmento (ex: "academia de ginástica"), cidade e estado',
            'O sistema consulta o Google Places API e retorna até 20 empresas',
            'Se a OpenAI estiver configurada, cada lead recebe um score de 0–100 e temperatura (frio/morno/quente)',
            'Selecione os leads e importe para os Contatos',
          ]},
          {
            type: 'callout',
            variant: 'warn',
            title: 'Pré-requisito',
            text: 'Configure a Google Places API Key em Integrações → Google Places API. Sem a key, o botão retorna erro 503.',
          },
          { type: 'heading', level: 3, text: 'Funil de Vendas' },
          { type: 'paragraph', text: 'Kanban com colunas por status: Novo → Contatado → Qualificado → Agendado → Fechado → Perdido. Arraste o card do lead entre colunas. O status é atualizado em tempo real no banco.' },
        ],
      },
      {
        id: 'whatsapp-disparos',
        title: 'WhatsApp e Disparos',
        content: [
          { type: 'heading', level: 3, text: 'Monitor WhatsApp' },
          { type: 'paragraph', text: 'A página WhatsApp mostra todas as conversas do agente IA em tempo real. Atualiza a cada 60 segundos.' },
          { type: 'list', items: [
            'Clique em uma conversa para ver o histórico completo',
            'Botão "Copiar" copia o número do WhatsApp',
            'Botão "Exportar .txt" baixa toda a conversa',
            'Botão "WhatsApp" abre o contato no WhatsApp Web',
            'Se o número existir nos Contatos, aparece o card do lead com opção de mudar status',
          ]},
          { type: 'heading', level: 3, text: 'Disparos em Massa' },
          { type: 'list', items: [
            'Crie uma Lista de contatos em Leads → Listas',
            'Vá em Disparos → Novo Disparo',
            'Selecione a lista, o template de mensagem e o agendamento',
            'O envio usa a Evolution API configurada em Integrações',
          ]},
          {
            type: 'callout',
            variant: 'warn',
            title: 'Limite de disparo',
            text: 'Para evitar bloqueios do WhatsApp, não dispare mais de 100 mensagens por hora. Use intervalos aleatórios entre envios.',
          },
        ],
      },
      {
        id: 'agente-ia',
        title: 'Configurar o Agente IA',
        content: [
          { type: 'heading', level: 3, text: 'Prompts do Agente' },
          { type: 'paragraph', text: 'Em Agentes, configure o prompt que o agente IA usa ao responder leads no WhatsApp. O n8n busca o prompt ativo com: SELECT * FROM agent_prompts WHERE user_id=$1 AND ativo=true LIMIT 1.' },
          { type: 'heading', level: 3, text: 'Cérebro do Agente (RAG)' },
          { type: 'paragraph', text: 'Em Cérebro do Agente, adicione documentos de conhecimento que o agente consulta ao responder. Tipos disponíveis:' },
          {
            type: 'table',
            headers: ['Tipo', 'Uso'],
            rows: [
              ['personalidade', 'Tom de voz e estilo de comunicação do agente'],
              ['negocio', 'Informações sobre o produto/serviço oferecido'],
              ['faq', 'Perguntas frequentes e respostas padrão'],
              ['objecao', 'Como responder objeções de compra'],
              ['script', 'Roteiro de vendas estruturado'],
            ],
          },
          {
            type: 'callout',
            variant: 'success',
            title: 'Busca semântica',
            text: 'Os documentos são convertidos em embeddings (vector 1536) e armazenados com pgvector. A busca retorna os trechos mais relevantes para cada pergunta do lead.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 3. BACKEND API
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'backend-api',
    title: 'Backend API',
    icon: '⚡',
    description: 'Endpoints, autenticação e variáveis de ambiente',
    articles: [
      {
        id: 'autenticacao',
        title: 'Autenticação JWT',
        content: [
          { type: 'heading', level: 3, text: 'Fluxo de autenticação' },
          { type: 'code', lang: 'bash', label: 'Login', code: `curl -X POST https://api.mentoark.com.br/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"usuario@email.com","password":"senha"}'

# Resposta:
# { "access_token": "eyJ...", "refresh_token": "eyJ...", "user": {...} }` },
          { type: 'code', lang: 'bash', label: 'Usar token nas requisições', code: `curl https://api.mentoark.com.br/api/contatos \\
  -H "Authorization: Bearer eyJ..."` },
          { type: 'code', lang: 'bash', label: 'Renovar token', code: `curl -X POST https://api.mentoark.com.br/auth/refresh \\
  -H "Content-Type: application/json" \\
  -d '{"refresh_token":"eyJ..."}'` },
          { type: 'heading', level: 3, text: 'Payload do JWT' },
          { type: 'code', lang: 'json', label: 'Conteúdo decodificado', code: `{
  "sub": "uuid-do-usuario",
  "email": "usuario@email.com",
  "role": "admin",   // ou "user"
  "iat": 1234567890,
  "exp": 1234571490
}` },
        ],
      },
      {
        id: 'endpoints',
        title: 'Endpoints disponíveis',
        content: [
          { type: 'heading', level: 3, text: 'Rotas públicas (sem JWT)' },
          {
            type: 'table',
            headers: ['Método', 'Rota', 'Descrição'],
            rows: [
              ['POST', '/auth/login', 'Login com email e senha'],
              ['POST', '/auth/refresh', 'Renovar access_token com refresh_token'],
              ['POST', '/auth/register', 'Criar novo usuário'],
              ['GET', '/health', 'Health check da API e banco'],
            ],
          },
          { type: 'heading', level: 3, text: 'CRUD automático (requer JWT)' },
          { type: 'paragraph', text: 'As rotas abaixo são geradas automaticamente pela factory makeCrud() e suportam GET, POST, PATCH/:id e DELETE/:id com filtro por user_id.' },
          {
            type: 'table',
            headers: ['Prefixo', 'Tabela', 'Filtro user_id'],
            rows: [
              ['/api/listas', 'listas', 'Sim'],
              ['/api/chamadas', 'chamadas', 'Sim'],
              ['/api/timeline_eventos', 'timeline_eventos', 'Sim'],
              ['/api/tarefas', 'tarefas', 'Sim'],
              ['/api/campanhas', 'campanhas', 'Sim'],
              ['/api/disparo_logs', 'disparo_logs', 'Sim'],
              ['/api/agentes', 'agentes', 'Sim'],
              ['/api/conhecimento', 'conhecimento', 'Sim'],
              ['/api/integracoes_config', 'integracoes_config', 'Sim'],
              ['/api/dados_cliente', 'dados_cliente', 'Não'],
              ['/api/chat_messages', 'chat_messages', 'Não'],
              ['/api/chats', 'chats', 'Não'],
            ],
          },
          { type: 'heading', level: 3, text: 'Rotas especializadas' },
          {
            type: 'table',
            headers: ['Método', 'Rota', 'Descrição'],
            rows: [
              ['GET/POST/PATCH/DELETE', '/api/contatos', 'CRUD com busca full-text e filtros avançados'],
              ['*', '/api/disparos', 'Disparo em massa via Evolution API'],
              ['*', '/api/agent_prompts', 'Prompts do agente IA'],
              ['*', '/api/documents', 'Documentos RAG com embeddings'],
              ['*', '/api/n8n_chat_histories', 'Histórico de conversas WhatsApp'],
              ['GET', '/api/dashboard', 'KPIs e métricas'],
              ['POST', '/api/functions/validar-numeros-whatsapp', 'Valida números em lote via Evolution'],
              ['POST', '/api/leads/buscar', 'Busca leads via Google Places + scoring OpenAI'],
              ['GET', '/api/usuarios', 'Lista usuários do sistema (virtual)'],
            ],
          },
          { type: 'heading', level: 3, text: 'Filtros via query string' },
          { type: 'code', lang: 'bash', label: 'Exemplos de filtros', code: `# Filtrar por valor exato
GET /api/contatos?status=qualificado

# Filtrar por lista de valores
GET /api/contatos?status_in=novo,contatado

# Filtrar por intervalo de datas
GET /api/timeline_eventos?created_at_gte=2026-01-01&created_at_lte=2026-12-31

# Paginação
GET /api/contatos?page=2&limit=50` },
        ],
      },
      {
        id: 'env-vars',
        title: 'Variáveis de Ambiente',
        badge: { label: 'DevOps', color: 'orange' },
        content: [
          { type: 'code', lang: 'bash', label: '/opt/crm/backend/.env', code: `# Banco de dados
DATABASE_URL=postgresql://mentoark:Mentoark@2025@147.93.9.172:5432/crm

# JWT
JWT_SECRET=mentoark2025jwtsecretkey32chars!!
JWT_EXPIRES_IN=1h
REFRESH_TOKEN_EXPIRES_IN=30d

# Servidor
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://crm.mentoark.com.br

# APIs externas (podem ser configuradas via Integrações no CRM)
GOOGLE_PLACES_KEY=
OPENAI_API_KEY=` },
          { type: 'code', lang: 'bash', label: '/opt/crm/.env (frontend)', code: `VITE_API_URL=https://api.mentoark.com.br` },
          {
            type: 'callout',
            variant: 'success',
            title: 'GOOGLE_PLACES_KEY e OPENAI_API_KEY',
            text: 'Essas variáveis não precisam estar no .env. O backend busca automaticamente em integracoes_config no banco se a env var estiver vazia. Configure via Integrações no CRM.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 4. BANCO DE DADOS
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'banco-de-dados',
    title: 'Banco de Dados',
    icon: '🐘',
    description: 'PostgreSQL 16 + pgvector · schemas e tabelas',
    articles: [
      {
        id: 'conexao',
        title: 'Conexão e acesso',
        content: [
          {
            type: 'table',
            headers: ['Parâmetro', 'Valor'],
            rows: [
              ['Host', '147.93.9.172'],
              ['Porta', '5432'],
              ['Database', 'crm'],
              ['Usuário', 'mentoark'],
              ['Senha', 'Mentoark@2025'],
              ['Extensões', 'pgcrypto, vector (pgvector)'],
            ],
          },
          { type: 'code', lang: 'bash', label: 'Conectar via psql', code: `PGPASSWORD=Mentoark@2025 psql -U mentoark -h 147.93.9.172 -d crm` },
          { type: 'code', lang: 'bash', label: 'Conectar via Docker (da VPS)', code: `# PgAdmin disponível em pgadmin.mentoark.com.br
# Ou via psql dentro da VPS:
docker exec -it postgres psql -U mentoark -d crm` },
        ],
      },
      {
        id: 'tabelas',
        title: 'Tabelas e schemas',
        content: [
          { type: 'heading', level: 3, text: 'Tabelas com user_id (isoladas por usuário)' },
          {
            type: 'table',
            headers: ['Tabela', 'Campos principais', 'Uso'],
            rows: [
              ['contatos', 'id, user_id, nome, telefone, email, status, tags, lista_id', 'CRM principal — leads e clientes'],
              ['listas', 'id, user_id, nome, descricao', 'Agrupamento de contatos para disparos'],
              ['campanhas', 'id, user_id, nome, status, tipo', 'Campanhas de marketing'],
              ['disparos', 'id, user_id, campanha_id, contato_id, status, enviado_em', 'Registro de envios individuais'],
              ['disparo_logs', 'id, user_id, mensagem, status, created_at', 'Log de execuções de disparo'],
              ['agentes', 'id, user_id, nome, ativo, config', 'Configuração dos agentes IA'],
              ['agent_prompts', 'id, user_id, conteudo, ativo', 'Prompts do agente (n8n busca ativo=true)'],
              ['conhecimento', 'id, user_id, tipo, conteudo', 'Base de conhecimento RAG (sem embedding)'],
              ['documents', 'id, user_id, content, embedding vector(1536)', 'Chunks RAG com embedding pgvector'],
              ['integracoes_config', 'id, user_id, tipo, nome, url, api_key, instancia, status', 'Config de integrações (n8n, Evolution, etc.)'],
              ['chamadas', 'id, user_id, contato_id, duracao, resultado', 'Registro de chamadas telefônicas'],
              ['timeline_eventos', 'id, user_id, contato_id, tipo, descricao', 'Linha do tempo do lead'],
              ['tarefas', 'id, user_id, contato_id, titulo, prazo, concluida', 'Tarefas de follow-up'],
              ['n8n_chat_histories', 'id, session_id, message (jsonb), created_at', 'Histórico de conversas do agente IA'],
            ],
          },
          { type: 'heading', level: 3, text: 'Tabelas compartilhadas (sem user_id)' },
          {
            type: 'table',
            headers: ['Tabela', 'Campos principais', 'Uso'],
            rows: [
              ['dados_cliente', 'id, telefone, nomewpp, atendimento_ia, setor', 'Cadastro de clientes WhatsApp (Lovable)'],
              ['chat_messages', 'id, phone, nomewpp, bot_message, user_message, message_type, active', 'Mensagens WhatsApp (Lovable)'],
              ['chats', 'id, phone, created_at, updated_at', 'Sessões de chat (Lovable)'],
            ],
          },
          {
            type: 'callout',
            variant: 'info',
            title: 'pgvector',
            text: 'A extensão vector permite armazenar embeddings float[] de 1536 dimensões (padrão OpenAI). Busca semântica via: SELECT * FROM documents ORDER BY embedding <-> $1::vector LIMIT 5;',
          },
        ],
      },
      {
        id: 'queries-uteis',
        title: 'Queries úteis',
        content: [
          { type: 'code', lang: 'sql', label: 'Listar todas as tabelas', code: `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;` },
          { type: 'code', lang: 'sql', label: 'Total de registros por tabela', code: `SELECT
  relname AS tabela,
  n_live_tup AS registros
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;` },
          { type: 'code', lang: 'sql', label: 'Busca semântica com pgvector', code: `-- Buscar os 5 chunks mais relevantes para uma query
SELECT content, 1 - (embedding <=> $1::vector) AS similaridade
FROM documents
WHERE user_id = $2
ORDER BY embedding <=> $1::vector
LIMIT 5;` },
          { type: 'code', lang: 'sql', label: 'Prompt ativo do agente (como o n8n busca)', code: `SELECT conteudo FROM agent_prompts
WHERE user_id = $1 AND ativo = true
LIMIT 1;` },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 5. N8N & AUTOMAÇÕES
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'n8n-automacoes',
    title: 'n8n & Automações',
    icon: '🔄',
    description: 'Workflows, webhooks e plano de migração',
    articles: [
      {
        id: 'n8n-cloudfy',
        title: 'n8n Cloudfy (ativo)',
        badge: { label: 'Em produção', color: 'green' },
        content: [
          { type: 'paragraph', text: 'O n8n principal roda em servidores da Cloudfy. Todos os workflows de WhatsApp estão aqui.' },
          {
            type: 'table',
            headers: ['Parâmetro', 'Valor'],
            rows: [
              ['URL', 'fierceparrot-n8n.cloudfy.live'],
              ['API', 'fierceparrot-n8n.cloudfy.live/api/v1'],
              ['Tipo', 'Instância gerenciada Cloudfy'],
            ],
          },
          { type: 'heading', level: 3, text: 'Workflows ativos' },
          {
            type: 'table',
            headers: ['Workflow', 'Trigger', 'Função'],
            rows: [
              ['Agente Maria Vendas', 'Webhook WhatsApp', 'Responde leads via IA usando prompt + RAG'],
              ['Angelo Prospect', 'Manual / Webhook', 'Fluxo de prospecção B2B'],
              ['Busca Leads B2B', 'Webhook HTTP', 'Busca empresas (substituído pelo backend CRM)'],
            ],
          },
          { type: 'heading', level: 3, text: 'Como o agente IA funciona no n8n' },
          { type: 'code', lang: 'text', label: 'Fluxo simplificado', code: `Lead manda msg no WhatsApp
  ↓
Evolution API recebe e chama webhook do n8n
  ↓
n8n busca prompt: GET /api/agent_prompts?ativo=true
  ↓
n8n busca RAG: POST /api/documents/search com embedding da pergunta
  ↓
n8n chama OpenAI/Claude com contexto (prompt + RAG + histórico)
  ↓
n8n envia resposta via Evolution API
  ↓
n8n salva histórico: POST /api/n8n_chat_histories` },
          {
            type: 'callout',
            variant: 'warn',
            title: 'Para conectar o CRM ao n8n Cloudfy',
            text: 'Acesse o painel do n8n Cloudfy → Settings → API → Create API Key. Cole a URL e a key em Integrações → N8N Automation no CRM. O backend vai usar essas credenciais para o proxy /api/n8n/*.',
          },
        ],
      },
      {
        id: 'n8n-hostinger',
        title: 'n8n Hostinger (futuro)',
        badge: { label: 'Configurado', color: 'blue' },
        content: [
          { type: 'paragraph', text: 'O n8n da VPS Hostinger está instalado e rodando mas sem workflows. Será o n8n principal após a migração completa.' },
          {
            type: 'table',
            headers: ['Parâmetro', 'Valor'],
            rows: [
              ['URL', 'n8n.mentoark.com.br'],
              ['API URL', 'n8n.mentoark.com.br/api/v1'],
              ['Login', 'angelobispofilho@gmail.com'],
              ['Senha', 'Mentoark@2025'],
              ['Banco', 'SQLite (volume Docker n8n_data)'],
              ['API Key MCP', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...EjcY'],
            ],
          },
          {
            type: 'callout',
            variant: 'info',
            title: 'MySQL configurado mas não usado',
            text: 'O docker-compose aponta para MySQL mas o n8n está usando SQLite do volume. O banco MySQL n8n existe mas está vazio.',
          },
        ],
      },
      {
        id: 'plano-migracao',
        title: 'Plano de migração n8n → CRM',
        content: [
          { type: 'paragraph', text: 'A migração é gradual — cada workflow do n8n vira uma automação nativa, sem downtime.' },
          {
            type: 'table',
            headers: ['Etapa', 'O que fazer', 'Fase'],
            rows: [
              ['1', 'Conectar CRM ao n8n Cloudfy via API (proxy)', 'Fase 1'],
              ['2', 'Criar tabela automacoes + worker no backend', 'Fase 2'],
              ['3', 'Reimplementar "Agente Maria Vendas" como automação nativa', 'Fase 2'],
              ['4', 'Implementar MCP Server com ferramentas do CRM', 'Fase 3'],
              ['5', 'Substituir OpenAI no n8n por Claude via MCP', 'Fase 3'],
              ['6', 'Descomissionar n8n Cloudfy', 'Fase 3 final'],
            ],
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 6. WHATSAPP & EVOLUTION
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'whatsapp-evolution',
    title: 'WhatsApp & Evolution',
    icon: '📱',
    description: 'Configuração, webhooks e envio de mensagens',
    articles: [
      {
        id: 'evolution-config',
        title: 'Configurar Evolution API',
        content: [
          { type: 'paragraph', text: 'A Evolution API é o middleware entre o CRM e o WhatsApp. Gerencia instâncias (números) e roteia mensagens.' },
          {
            type: 'table',
            headers: ['Parâmetro', 'Valor'],
            rows: [
              ['URL', 'https://disparo.mentoark.com.br'],
              ['Configuração', '/opt/evolution/docker-compose.yml (VPS)'],
            ],
          },
          { type: 'heading', level: 3, text: 'Configurar no CRM' },
          { type: 'list', items: [
            'Acesse Integrações → Evolution API / WhatsApp',
            'URL: https://disparo.mentoark.com.br',
            'API Key: chave configurada na instância Evolution',
            'Instância: nome da instância WhatsApp (ex: "mentoark")',
            'Status: Ativo → Salvar',
          ]},
          { type: 'heading', level: 3, text: 'Webhook de recebimento' },
          { type: 'paragraph', text: 'Configure na Evolution API qual URL recebe as mensagens incoming. O n8n Cloudfy usa o webhook dele. Após a Fase 2, o CRM receberá diretamente em:' },
          { type: 'code', lang: 'text', label: 'URL do webhook futuro', code: `POST https://api.mentoark.com.br/api/whatsapp/webhook` },
        ],
      },
      {
        id: 'validacao-numeros',
        title: 'Validar números WhatsApp',
        content: [
          { type: 'paragraph', text: 'Antes de disparar, valide quais contatos têm WhatsApp ativo para evitar bloqueios.' },
          { type: 'code', lang: 'bash', label: 'Validar via API', code: `curl -X POST https://api.mentoark.com.br/api/functions/validar-numeros-whatsapp \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contato_ids": ["uuid1", "uuid2"],
    "lista_id": "uuid-da-lista"
  }'

# Resposta:
# { "ok": true, "total": 100, "validos": 87, "invalidos": 13 }` },
          { type: 'paragraph', text: 'Contatos inválidos recebem automaticamente a tag "whatsapp_invalido" para fácil filtragem.' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 7. DEPLOY & DEVOPS
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'deploy-devops',
    title: 'Deploy & DevOps',
    icon: '🚀',
    description: 'Servidores, Docker, Traefik e comandos de deploy',
    articles: [
      {
        id: 'servidores',
        title: 'Servidores e serviços',
        content: [
          {
            type: 'table',
            headers: ['Domínio', 'Container', 'Compose', 'Função'],
            rows: [
              ['crm.mentoark.com.br', 'crm', '/opt/crm/docker-compose.yml', 'Frontend React (nginx)'],
              ['api.mentoark.com.br', 'crm-api', '/opt/crm/backend/docker-compose.yml', 'Backend Express'],
              ['n8n.mentoark.com.br', 'n8n', '/opt/n8n/docker-compose.yml', 'n8n + Redis + MySQL'],
              ['disparo.mentoark.com.br', 'evolution', '/opt/evolution/docker-compose.yml', 'Evolution API WhatsApp'],
              ['pgadmin.mentoark.com.br', 'pgadmin', '/opt/postgres/docker-compose.yml', 'PgAdmin (admin BD)'],
            ],
          },
          {
            type: 'callout',
            variant: 'danger',
            title: 'Regra crítica do Traefik',
            text: 'Containers em múltiplas redes Docker DEVEM ter o label traefik.docker.network=proxy, caso contrário o Traefik usa IP errado e retorna Gateway Timeout.',
          },
        ],
      },
      {
        id: 'deploy-commands',
        title: 'Comandos de deploy',
        badge: { label: 'Frequente', color: 'blue' },
        content: [
          { type: 'code', lang: 'bash', label: 'Deploy backend (1 arquivo)', code: `# 1. Enviar arquivo
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \\
  /root/mentoark-vision/backend/src/routes/ARQUIVO.ts \\
  root@147.93.9.172:/opt/crm/backend/src/routes/ARQUIVO.ts

# 2. Rebuild
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \\
  'cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'` },
          { type: 'code', lang: 'bash', label: 'Deploy frontend (1 arquivo)', code: `sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \\
  /root/mentoark-vision/src/pages/ARQUIVO.tsx \\
  root@147.93.9.172:/opt/crm/src/pages/ARQUIVO.tsx

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \\
  'cd /opt/crm && docker compose build --no-cache crm && docker compose up -d crm'` },
          { type: 'code', lang: 'bash', label: 'Verificar status', code: `# Saúde da API
curl https://api.mentoark.com.br/health

# Status dos containers
sshpass -p 'Mentoark@2025' ssh root@147.93.9.172 \\
  'docker ps --format "table {{.Names}}\\t{{.Status}}"'

# Logs do backend
sshpass -p 'Mentoark@2025' ssh root@147.93.9.172 \\
  'docker logs crm-api --tail=50'` },
          { type: 'code', lang: 'bash', label: 'Adicionar novo container (template Traefik)', code: `# docker-compose.yml — labels obrigatórios
labels:
  - traefik.enable=true
  - traefik.docker.network=proxy
  - traefik.http.routers.NOME.rule=Host(\`sub.mentoark.com.br\`)
  - traefik.http.routers.NOME.entrypoints=websecure
  - traefik.http.routers.NOME.tls.certresolver=letsencrypt
  - traefik.http.services.NOME.loadbalancer.server.port=PORTA
networks:
  - proxy` },
        ],
      },
      {
        id: 'acesso-vps',
        title: 'Acesso à VPS',
        content: [
          { type: 'code', lang: 'bash', label: 'SSH', code: `sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172` },
          {
            type: 'callout',
            variant: 'warn',
            title: 'Segurança',
            text: 'A senha root está exposta aqui apenas para referência interna. Em produção escalada, migre para autenticação por chave SSH e desative o login por senha.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 8. GUIA DO DESENVOLVEDOR
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'guia-dev',
    title: 'Guia do Desenvolvedor',
    icon: '💻',
    description: 'Setup local, estrutura do projeto e convenções',
    articles: [
      {
        id: 'setup-local',
        title: 'Setup do ambiente local',
        badge: { label: 'Começar aqui', color: 'green' },
        content: [
          { type: 'heading', level: 3, text: 'Pré-requisitos' },
          { type: 'list', items: ['Node.js 20+', 'Git', 'Acesso ao PostgreSQL remoto (147.93.9.172:5432)'] },
          { type: 'code', lang: 'bash', label: 'Clonar e instalar', code: `# Frontend
cd mentoark-vision
npm install
echo "VITE_API_URL=http://localhost:3000" > .env.local
npm run dev   # http://localhost:5173

# Backend (outro terminal)
cd mentoark-vision/backend
npm install
# Criar .env com DATABASE_URL apontando para o banco remoto
npm run dev   # porta 3000` },
          {
            type: 'callout',
            variant: 'info',
            title: 'Banco remoto',
            text: 'O banco de dados roda na VPS. Certifique-se que a porta 5432 está acessível do seu IP ou use um túnel SSH: ssh -L 5432:localhost:5432 root@147.93.9.172',
          },
        ],
      },
      {
        id: 'estrutura-projeto',
        title: 'Estrutura do projeto',
        content: [
          { type: 'code', lang: 'text', label: 'Árvore principal', code: `mentoark-vision/
├── src/
│   ├── pages/          # Uma página por rota (Leads, Dashboard, etc.)
│   ├── components/     # Componentes reutilizáveis
│   │   ├── ui/         # shadcn/ui (Button, Card, Dialog, etc.)
│   │   ├── campanhas/  # Componentes específicos de Campanhas
│   │   └── leads/      # Componentes específicos de Leads
│   ├── hooks/          # useAuth, useTheme, etc.
│   ├── integrations/
│   │   └── api/
│   │       └── client.ts  # ⚠️ NÃO é Database real — é HTTP client para o backend
│   ├── data/
│   │   └── docs-content.ts  # Conteúdo desta documentação
│   └── App.tsx         # Rotas React Router
│
└── backend/
    └── src/
        ├── index.ts    # Entry point, CORS, rotas
        ├── auth.ts     # Login, registro, refresh
        ├── crud.ts     # Factory makeCrud()
        ├── db.ts       # Pool PostgreSQL
        ├── middleware.ts  # authMiddleware (JWT)
        └── routes/
            ├── contatos.ts
            ├── disparos.ts
            ├── agent_prompts.ts
            ├── documents.ts
            ├── n8n_chat_histories.ts
            ├── dashboard.ts
            ├── functions.ts
            ├── leads-buscar.ts
            └── usuarios.ts` },
          { type: 'heading', level: 3, text: 'O cliente "api"' },
          {
            type: 'callout',
            variant: 'warn',
            title: 'IMPORTANTE para novos desenvolvedores',
            text: 'O arquivo src/integrations/api/client.ts NÃO usa o Database real. É um cliente HTTP customizado que espelha a interface do @api/api-js mas encaminha todas as chamadas para api.mentoark.com.br. Use normalmente: api.from("tabela").select() vai para o backend Express.',
          },
        ],
      },
      {
        id: 'nova-rota',
        title: 'Adicionar uma nova rota',
        content: [
          { type: 'heading', level: 3, text: 'Backend — nova rota especializada' },
          { type: 'code', lang: 'typescript', label: 'backend/src/routes/minha-rota.ts', code: `import { Router } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function minhaRota(pool: Pool): Router {
  const router = Router();

  router.get('/', async (req: AuthRequest, res) => {
    const userId = req.userId;  // JWT já validado pelo middleware
    const rows = await pool.query(
      'SELECT * FROM minha_tabela WHERE user_id = $1',
      [userId]
    );
    return res.json(rows.rows);
  });

  return router;
}` },
          { type: 'code', lang: 'typescript', label: 'Registrar em backend/src/index.ts', code: `import minhaRota from './routes/minha-rota';
// ...
app.use('/api/minha-rota', minhaRota(pool));` },
          { type: 'heading', level: 3, text: 'Frontend — nova página' },
          { type: 'code', lang: 'typescript', label: 'src/pages/MinhaPagina.tsx', code: `import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";

export default function MinhaPagina() {
  // api.from("minha_tabela").select() → chama /api/minha_tabela
  return (
    <CRMLayout>
      <h1>Minha Página</h1>
    </CRMLayout>
  );
}` },
          { type: 'code', lang: 'typescript', label: 'Registrar em src/App.tsx', code: `import MinhaPagina from "./pages/MinhaPagina";
// ...
<Route path="/minha-pagina" element={<ProtectedRoute><MinhaPagina /></ProtectedRoute>} />` },
        ],
      },
      {
        id: 'convencoes',
        title: 'Convenções e padrões',
        content: [
          { type: 'heading', level: 3, text: 'Backend' },
          { type: 'list', items: [
            'Rotas simples: usar makeCrud(pool, "tabela") em index.ts',
            'Rotas complexas: arquivo próprio em src/routes/',
            'Sempre extrair userId de req.userId (injetado pelo authMiddleware)',
            'Parâmetros SQL sempre via $1, $2... — nunca interpolação de string',
            'Erros: return res.status(500).json({ error: err.message })',
          ]},
          { type: 'heading', level: 3, text: 'Frontend' },
          { type: 'list', items: [
            'Todas as páginas envolvem com <CRMLayout>',
            'Usar api.from() para todas as chamadas de dados',
            'Componentes UI da pasta components/ui/ (shadcn/ui)',
            'Toast de feedback: import { toast } from "sonner"',
            'Auth: import { useAuth } from "@/hooks/useAuth"',
          ]},
          { type: 'heading', level: 3, text: 'Deploy' },
          { type: 'list', items: [
            'SCP direto para VPS — sem git push (remote sem token)',
            'Rebuild sempre com --no-cache para garantir mudanças',
            'Verificar /health após rebuild do backend',
          ]},
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 9. ONBOARDING
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'onboarding',
    title: 'Onboarding',
    icon: '🎯',
    description: 'Checklists para novos usuários e desenvolvedores',
    articles: [
      {
        id: 'novo-usuario',
        title: 'Checklist — Novo usuário',
        badge: { label: 'Usuário', color: 'blue' },
        content: [
          { type: 'list', ordered: true, items: [
            'Receber credenciais de acesso (e-mail + senha inicial)',
            'Acessar crm.mentoark.com.br e fazer login',
            'Ir em Integrações e configurar a Evolution API (URL + API Key + Instância)',
            'Ir em Integrações e configurar Google Places API Key para busca de leads',
            'Ir em Integrações e configurar OpenAI API Key para scoring de leads',
            'Ir em Agentes e criar o prompt do agente IA',
            'Ir em Cérebro do Agente e adicionar os documentos de conhecimento (negócio, FAQ, objeções)',
            'Importar ou criar os primeiros contatos em Leads',
            'Criar uma lista de contatos para disparos',
            'Fazer um disparo de teste com 1 contato',
            'Monitorar respostas em WhatsApp',
          ]},
          {
            type: 'callout',
            variant: 'success',
            title: 'Pronto para vender',
            text: 'Com esses passos, o agente IA já está respondendo automaticamente no WhatsApp e você pode monitorar todas as conversas no CRM.',
          },
        ],
      },
      {
        id: 'novo-dev',
        title: 'Checklist — Novo desenvolvedor',
        badge: { label: 'Dev', color: 'purple' },
        content: [
          { type: 'list', ordered: true, items: [
            'Ler esta documentação completa (especialmente "O cliente api")',
            'Clonar o repositório: git clone https://github.com/AngeloMarcos/mentoark-vision.git',
            'Instalar dependências do frontend e backend',
            'Criar .env locais apontando para o banco e API remotos',
            'Rodar npm run dev (frontend porta 5173) e npm run dev (backend porta 3000)',
            'Fazer login no CRM local com as credenciais de desenvolvimento',
            'Entender a factory makeCrud() em backend/src/crud.ts',
            'Entender o cliente HTTP em src/integrations/api/client.ts',
            'Verificar o CLAUDE.md na raiz do projeto para convenções específicas',
            'Nunca commitar .env — usar .gitignore',
            'Deploy sempre via SCP + rebuild (sem git push para produção)',
          ]},
          { type: 'heading', level: 3, text: 'Acessos que você vai precisar' },
          {
            type: 'table',
            headers: ['Sistema', 'Como acessar', 'Pedir para'],
            rows: [
              ['CRM', 'crm.mentoark.com.br', 'Admin do sistema'],
              ['VPS SSH', 'root@147.93.9.172', 'Admin da infra'],
              ['PgAdmin', 'pgadmin.mentoark.com.br', 'Admin da infra'],
              ['n8n Hostinger', 'n8n.mentoark.com.br', 'Admin da infra'],
              ['n8n Cloudfy', 'fierceparrot-n8n.cloudfy.live', 'Angelo (dono da conta)'],
            ],
          },
        ],
      },
    ],
  },
];
