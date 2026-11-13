/**
 * apiPublicaDocs.ts — OpenAPI 3.0 da API pública `/v1` (servido em GET /v1/openapi.json, sem chave).
 * Manter junto com routes/apiPublica.ts: cada rota nova lá ganha uma entrada aqui.
 */
import { RECURSOS } from '../services/apiKeys';

const ref = (nome: string) => ({ $ref: `#/components/schemas/${nome}` });
const json = (schema: any) => ({ 'application/json': { schema } });
const lista = (item: string) => json({ type: 'object', properties: { data: { type: 'array', items: ref(item) }, metadata: ref('Metadata') } });
const um = (item: string) => json({ type: 'object', properties: { data: ref(item) } });
const erros = {
  401: { description: 'Sem chave ou chave inválida', content: json(ref('Erro')) },
  403: { description: 'Chave sem a permissão necessária (code `missing_scope`)', content: json(ref('Erro')) },
  422: { description: 'Dados inválidos', content: json(ref('Erro')) },
  429: { description: 'Limite por minuto atingido (code `rate_limited`)', content: json(ref('Erro')) },
};
const pagina = [
  { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
  { name: 'perPage', in: 'query', schema: { type: 'integer', default: 10, maximum: 100 } },
];
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const q = (name: string, description: string) => ({ name, in: 'query', schema: { type: 'string' }, description });

export function montarOpenApi() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'MentoArk CRM API',
      version: '1.0.0',
      description:
        'API pública do CRM MentoArk. Toda requisição precisa do header `X-API-Key` (gere em Configurações → API Keys). ' +
        'A chave age como o usuário que a criou. Listagens: `{ data, metadata }` com `page`/`perPage`. ' +
        'Erros: `{ errors: [{ message, code }] }`. Limite: 120 requisições/min por chave (30 envios/min em /messages/send).',
    },
    servers: [{ url: 'https://api.mentoark.com.br/v1' }],
    security: [{ apiKey: [] }],
    tags: [{ name: 'Conta' }, ...Object.values(RECURSOS).map(r => ({ name: r.nome }))],
    paths: {
      '/whoami': {
        get: { tags: ['Conta'], summary: 'Identificar a chave de API', description: 'Primeira chamada de qualquer integração: usuário, permissões da chave e contagens.',
          responses: { 200: { description: 'Dados da chave', content: json({ type: 'object' }) }, 401: erros[401] } },
      },
      '/peoples': {
        get: { tags: ['Contatos'], summary: 'Listar contatos',
          parameters: [...pagina,
            q('name', 'Busca parcial no nome'), q('phone', 'Telefone; casa com/sem 55 e com/sem o 9º dígito'),
            q('email', 'E-mail exato'), q('status', 'Um ou mais status, separados por vírgula'),
            q('tags', 'Etiquetas separadas por vírgula'), q('tags_op', '`any` (padrão) ou `all`'),
            q('ids', 'IDs separados por vírgula'), q('optOut', '`true` ou `false`'),
            q('created_at', '`dd/MM/yyyy` ou `dd/MM/yyyy,dd/MM/yyyy`'), q('updated_at', 'Mesmo formato de created_at'),
            q('orderColumn', '`createdAt` (padrão), `updatedAt`, `name`, `lastMessageAt`'), q('orderDirection', '`asc` ou `desc`'),
            q('cf_{key}', 'Campo personalizado pela chave (ex.: `cf_cidade=Santos`). Texto: contém; demais tipos: igual'),
            q('organizationId', 'Contatos de uma organização')],
          responses: { 200: { description: 'Lista paginada', content: lista('Pessoa') }, ...erros } },
        post: { tags: ['Contatos'], summary: 'Criar contato',
          description: 'Exige `phone` ou `email`. Telefone já cadastrado → 409 `duplicate` com `peopleId`; com `upsert: true` atualiza o existente.',
          requestBody: { content: json({ allOf: [ref('PessoaEntrada'), { type: 'object', properties: { upsert: { type: 'boolean' } } }] }) },
          responses: { 201: { description: 'Criado', content: um('Pessoa') }, 409: { description: 'Telefone já cadastrado', content: json(ref('Erro')) }, ...erros } },
      },
      '/peoples/{id}': {
        get: { tags: ['Contatos'], summary: 'Detalhar contato', parameters: [id], responses: { 200: { description: 'Contato', content: um('Pessoa') }, 404: { description: 'Não encontrado' } } },
        put: { tags: ['Contatos'], summary: 'Atualizar contato', parameters: [id], requestBody: { content: json(ref('PessoaEntrada')) },
          responses: { 200: { description: 'Atualizado', content: um('Pessoa') }, ...erros } },
        delete: { tags: ['Contatos'], summary: 'Excluir contato', parameters: [id], responses: { 204: { description: 'Excluído' } } },
      },
      '/organizations': {
        get: { tags: ['Organizações'], summary: 'Listar organizações',
          description: 'A empresa do contato como registro próprio, compartilhado pela conta. `peoples` = quantos contatos estão nela.',
          parameters: [...pagina, q('name', 'Busca parcial no nome')],
          responses: { 200: { description: 'Lista paginada', content: lista('Organizacao') }, ...erros } },
        post: { tags: ['Organizações'], summary: 'Criar organização', description: 'Exige `name`. Nome repetido na conta → 409 `duplicate`.',
          requestBody: { content: json(ref('OrganizacaoEntrada')) },
          responses: { 201: { description: 'Criada', content: um('Organizacao') }, 409: { description: 'Nome já usado', content: json(ref('Erro')) }, ...erros } },
      },
      '/organizations/{id}': {
        get: { tags: ['Organizações'], summary: 'Detalhar organização', parameters: [id],
          responses: { 200: { description: 'Organização', content: um('Organizacao') }, 404: { description: 'Não encontrada' } } },
        put: { tags: ['Organizações'], summary: 'Atualizar organização', parameters: [id], requestBody: { content: json(ref('OrganizacaoEntrada')) },
          responses: { 200: { description: 'Atualizada', content: um('Organizacao') }, ...erros } },
        delete: { tags: ['Organizações'], summary: 'Excluir organização', parameters: [id],
          description: 'Os contatos continuam existindo, só deixam de ter organização.',
          responses: { 204: { description: 'Excluída' }, 404: { description: 'Não encontrada' } } },
      },
      '/custom-fields': {
        get: { tags: ['Contatos'], summary: 'Listar campos personalizados',
          description: 'Campos ativos da conta. `key` é o nome usado em `customFields` e no filtro `cf_{key}`; não muda quando o campo é renomeado. ' +
            '`type`: texto, numero, moeda, data (aaaa-mm-dd), selecao, multipla (lista), sim_nao (booleano).',
          responses: { 200: { description: 'Lista', content: json({ type: 'object', properties: { data: { type: 'array', items: ref('CampoPersonalizado') } } }) } } },
      },
      '/tags': {
        get: { tags: ['Etiquetas'], summary: 'Listar etiquetas (com quantos contatos usam cada uma)', responses: { 200: { description: 'Lista' } } },
        post: { tags: ['Etiquetas'], summary: 'Criar etiqueta', requestBody: { content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, color: { type: 'string' } } }) },
          responses: { 201: { description: 'Criada' } } },
      },
      '/tags/attach': {
        post: { tags: ['Etiquetas'], summary: 'Vincular etiquetas a contatos', requestBody: { content: json(ref('MudarTags')) }, responses: { 200: { description: '`{ data: { updated } }`' } } },
      },
      '/tags/detach': {
        post: { tags: ['Etiquetas'], summary: 'Desvincular etiquetas de contatos', requestBody: { content: json(ref('MudarTags')) }, responses: { 200: { description: '`{ data: { updated } }`' } } },
      },
      '/stages': {
        get: { tags: ['Funil'], summary: 'Listar etapas do funil', description: 'Um funil por conta. `kind`: open, won ou lost. `peoples` = quantos contatos estão na etapa.',
          responses: { 200: { description: 'Lista' } } },
      },
      '/peoples/{id}/stage': {
        put: { tags: ['Funil'], summary: 'Mover contato de etapa',
          description: 'Cada contato tem um card só. `stageId: null` tira do funil. As automações da etapa de destino rodam (resultado em `automations`); o movimento fica no histórico do card como origem "API".',
          parameters: [id],
          requestBody: { content: json({ type: 'object', required: ['stageId'], properties: { stageId: { type: 'string', nullable: true }, reason: { type: 'string' } } }) },
          responses: { 200: { description: '`{ data: Pessoa, moved, automations }` — `moved: false` quando já estava na etapa' }, 404: { description: 'Contato não encontrado' }, ...erros } },
      },
      '/channels': {
        get: { tags: ['Canais'], summary: 'Listar canais (números de WhatsApp QR Code e oficiais)', responses: { 200: { description: 'Lista', content: json({ type: 'object', properties: { data: { type: 'array', items: ref('Canal') } } }) } } },
      },
      '/agents': {
        get: { tags: ['Agentes de IA'], summary: 'Listar agentes de IA', responses: { 200: { description: 'Lista' } } },
      },
      '/conversations': {
        get: { tags: ['Conversas'], summary: 'Listar conversas',
          parameters: [...pagina, q('phone', 'Telefone do contato'), q('channelId', 'ID do canal'), q('groups', '`true` inclui grupos')],
          responses: { 200: { description: 'Lista paginada' } } },
      },
      '/conversations/{id}/messages': {
        get: { tags: ['Conversas'], summary: 'Listar mensagens da conversa (mais recentes primeiro, 50 por página)', parameters: [id, ...pagina],
          responses: { 200: { description: 'Lista paginada' }, 404: { description: 'Não encontrada' } } },
      },
      '/conversations/{id}/assign': {
        post: { tags: ['Conversas'], summary: 'Atribuir o atendimento em andamento (escopo conversations:update)', parameters: [id],
          description: 'Sem `userId`, atribui ao dono da chave.',
          requestBody: { content: json({ type: 'object', properties: { userId: { type: 'string' } } }) },
          responses: { 200: { description: '`{ data: { id, attendanceId, state, assignedTo, resolvedAt } }`' }, 404: { description: 'Sem atendimento em andamento (code `no_open_attendance`)' }, ...erros } },
      },
      '/conversations/{id}/resolve': {
        post: { tags: ['Conversas'], summary: 'Resolver o atendimento em andamento (escopo conversations:update)', parameters: [id],
          description: 'Devolve a conversa à IA, salvo `keepAiPaused: true`. `reasonId` é obrigatório se a conta exigir motivo.',
          requestBody: { content: json({ type: 'object', properties: { reasonId: { type: 'string' }, keepAiPaused: { type: 'boolean' } } }) },
          responses: { 200: { description: '`{ data: { id, attendanceId, state, assignedTo, resolvedAt } }`' }, 404: { description: 'Sem atendimento em andamento (code `no_open_attendance`)' }, ...erros } },
      },
      '/messages/send': {
        post: { tags: ['Envio de mensagens'], summary: 'Enviar mensagem de texto por um canal',
          description:
            'Destinatário: `peopleId` ou `phone`. Contato com opt-out → 422 `opted_out`. ' +
            'Canal oficial fora da janela de 24h → 422 `window_closed` (templates pela API ainda não disponíveis). ' +
            '`sentBy: bot` (padrão) não pausa a IA; `sentBy: human` atribui a conversa ao dono da chave e pausa a IA por 1 hora.',
          requestBody: { content: json({ type: 'object', required: ['channelId', 'text'], properties: {
            channelId: { type: 'string' }, peopleId: { type: 'string' }, phone: { type: 'string' },
            text: { type: 'string', maxLength: 4096 }, sentBy: { type: 'string', enum: ['bot', 'human'] } } }) },
          responses: { 201: { description: '`{ data: { messageId, status } }`' }, 502: { description: 'WhatsApp/Meta recusou (code `send_failed`)' }, ...erros } },
      },
    },
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
      schemas: {
        Erro: { type: 'object', properties: { errors: { type: 'array', items: { type: 'object', properties: { message: { type: 'string' }, code: { type: 'string' } } } }, code: { type: 'string' } } },
        Metadata: { type: 'object', properties: { total: { type: 'integer' }, perPage: { type: 'integer' }, currentPage: { type: 'integer' }, lastPage: { type: 'integer' }, firstPage: { type: 'integer' } } },
        Pessoa: { type: 'object', properties: {
          id: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' },
          jobTitle: { type: 'string' }, origin: { type: 'string' }, status: { type: 'string' }, temperature: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' }, potentialValue: { type: 'number' },
          city: { type: 'string' }, state: { type: 'string' }, optOut: { type: 'boolean' },
          stageId: { type: 'string', nullable: true }, stageEnteredAt: { type: 'string', format: 'date-time', nullable: true },
          customFields: { type: 'object', additionalProperties: true, description: '`{ chave: valor }` dos campos personalizados' },
          organizationId: { type: 'string', nullable: true },
          lastMessageAt: { type: 'string', format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
        PessoaEntrada: { type: 'object', properties: {
          name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' }, jobTitle: { type: 'string' },
          origin: { type: 'string' }, status: { type: 'string' }, temperature: { type: 'string' }, notes: { type: 'string' },
          potentialValue: { type: 'number' }, city: { type: 'string' }, state: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
          customFields: { type: 'object', additionalProperties: true,
            description: 'Mescla com os valores atuais; `null` ou vazio apaga o campo. Chave desconhecida → 422 `unknown_custom_field`; valor fora do tipo → 422 `invalid_value` (nada é gravado).' } } },
        Organizacao: { type: 'object', properties: {
          id: { type: 'string' }, name: { type: 'string' }, website: { type: 'string', nullable: true }, phone: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true }, state: { type: 'string', nullable: true }, notes: { type: 'string', nullable: true },
          peoples: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
        OrganizacaoEntrada: { type: 'object', required: ['name'], properties: {
          name: { type: 'string' }, website: { type: 'string' }, phone: { type: 'string' },
          city: { type: 'string' }, state: { type: 'string' }, notes: { type: 'string' } } },
        CampoPersonalizado: { type: 'object', properties: {
          id: { type: 'string' }, name: { type: 'string' }, key: { type: 'string' },
          type: { type: 'string', enum: ['texto', 'numero', 'moeda', 'data', 'selecao', 'multipla', 'sim_nao'] },
          options: { type: 'array', items: { type: 'string' } }, description: { type: 'string', nullable: true } } },
        MudarTags: { type: 'object', required: ['tags'], properties: { peopleId: { type: 'string' }, peopleIds: { type: 'array', items: { type: 'string' }, maxItems: 500 }, tags: { type: 'array', items: { type: 'string' } } } },
        Canal: { type: 'object', properties: {
          id: { type: 'string' }, type: { type: 'string', enum: ['whatsapp_qrcode', 'whatsapp_official'] }, name: { type: 'string' }, phone: { type: 'string' },
          connected: { type: 'boolean' }, personal: { type: 'boolean' }, aiActive: { type: 'boolean' }, agentId: { type: 'string' } } },
      },
    },
  };
}
