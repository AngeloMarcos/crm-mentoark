import { Pool } from 'pg';
import {
  validateUserIdIsolation,
  validateNoDestructiveSql,
  BuscarContatoArgsSchema,
  CriarOuAtualizarContatoArgsSchema,
  BuscarHistoricoArgsSchema,
  RegistrarPausaArgsSchema,
  BuscarProdutosArgsSchema,
  CriarAgendamentoArgsSchema,
  ConsultarFaqArgsSchema,
} from '../functionCallingSecurity';
import { log } from '../logger';

export interface MCPTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const MCP_TOOLS: MCPTool[] = [
  {
    name: 'buscar_contato',
    description: 'Busca informações de um contato pelo telefone ou nome no CRM',
    input_schema: {
      type: 'object',
      properties: {
        telefone: { type: 'string', description: 'Telefone no formato 5511999999999' },
        nome: { type: 'string', description: 'Nome parcial para busca' },
      },
    },
  },
  {
    name: 'criar_ou_atualizar_contato',
    description: 'Cria um novo contato ou atualiza dados de um existente',
    input_schema: {
      type: 'object',
      properties: {
        telefone: { type: 'string', description: 'Telefone obrigatório' },
        nome: { type: 'string', description: 'Nome completo' },
        email: { type: 'string', description: 'Email' },
        observacao: { type: 'string', description: 'Observação ou nota sobre o contato' },
        estagio: { type: 'string', description: 'Estágio do funil: novo, contatado, qualificado, agendado, fechado, perdido' },
      },
      required: ['telefone'],
    },
  },
  {
    name: 'buscar_historico',
    description: 'Busca o histórico de conversas anteriores com um contato',
    input_schema: {
      type: 'object',
      properties: {
        telefone: { type: 'string', description: 'Telefone do contato' },
        limite: { type: 'number', description: 'Número de mensagens (padrão 10, máx 30)' },
      },
      required: ['telefone'],
    },
  },
  {
    name: 'registrar_pausa',
    description: 'Pausa o atendimento automático para que um humano assuma. Use quando: lead qualificado, pedido de falar com humano, negociação complexa.',
    input_schema: {
      type: 'object',
      properties: {
        telefone: { type: 'string', description: 'Telefone do contato' },
        motivo: { type: 'string', description: 'Motivo da pausa: qualificado, pedido_humano, negociacao, encerramento' },
        resumo: { type: 'string', description: 'Resumo da conversa para o atendente humano' },
      },
      required: ['telefone', 'motivo'],
    },
  },
  {
    name: 'buscar_produtos',
    description: 'Busca produtos ou imóveis disponíveis no catálogo',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Termo de busca (nome, descrição)' },
        preco_max: { type: 'number', description: 'Preço máximo em reais' },
        preco_min: { type: 'number', description: 'Preço mínimo em reais' },
      },
    },
  },
  {
    name: 'criar_agendamento',
    description: 'Agenda uma visita, reunião ou ligação com o contato',
    input_schema: {
      type: 'object',
      properties: {
        telefone: { type: 'string', description: 'Telefone do contato' },
        tipo: { type: 'string', description: 'Tipo: visita, reuniao, ligacao' },
        data_hora: { type: 'string', description: 'Data e hora no formato ISO 8601' },
        observacao: { type: 'string', description: 'Detalhes do agendamento' },
      },
      required: ['telefone', 'tipo', 'data_hora'],
    },
  },
  {
    name: 'consultar_faq',
    description: 'Consulta respostas da base de conhecimento para perguntas frequentes',
    input_schema: {
      type: 'object',
      properties: {
        pergunta: { type: 'string', description: 'A pergunta do cliente' },
      },
      required: ['pergunta'],
    },
  },
];

export async function executarFerramenta(
  pool: Pool,
  userId: string,
  nome: string,
  args: Record<string, any>
): Promise<string> {
  try {
    // Validação de segurança: userId deve ser UUID (isolamento multi-tenant)
    validateUserIdIsolation(userId);

    // Validação de segurança: argumentos não podem conter SQL destrutivo
    validateNoDestructiveSql(args);

    switch (nome) {
      case 'buscar_contato': {
        // Valida argumentos com zod schema
        const validatedArgs = BuscarContatoArgsSchema.parse(args);
        const where = validatedArgs.telefone ? `telefone ILIKE $2` : `nome ILIKE $2`;
        const val = validatedArgs.telefone
          ? `%${validatedArgs.telefone.slice(-11)}`
          : `%${validatedArgs.nome}%`;
        const r = await pool.query(
          `SELECT nome, telefone, email, status, observacoes, created_at
           FROM contatos WHERE user_id = $1 AND ${where} LIMIT 3`,
          [userId, val]
        );
        if (!r.rows.length) return 'Contato não encontrado no CRM.';
        return JSON.stringify(r.rows);
      }

      case 'criar_ou_atualizar_contato': {
        // Valida argumentos com zod schema
        const validatedArgs = CriarOuAtualizarContatoArgsSchema.parse(args);
        const { telefone, nome, email, observacao, estagio } = validatedArgs;
        await pool.query(
          `INSERT INTO contatos (user_id, telefone, nome, email, observacoes, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, telefone) DO UPDATE
           SET nome       = COALESCE(EXCLUDED.nome, contatos.nome),
               email      = COALESCE(EXCLUDED.email, contatos.email),
               observacoes = COALESCE(EXCLUDED.observacoes, contatos.observacoes),
               status     = COALESCE(EXCLUDED.status, contatos.status),
               updated_at = NOW()`,
          [userId, telefone, nome || telefone, email || null, observacao || null, estagio || 'novo']
        );
        return `Contato ${nome || telefone} salvo com sucesso.`;
      }

      case 'buscar_historico': {
        // Valida argumentos com zod schema
        const validatedArgs = BuscarHistoricoArgsSchema.parse(args);
        const limite = validatedArgs.limite || 10;
        const sessionPhone = validatedArgs.telefone.replace(/\D/g, '');
        const r = await pool.query(
          `SELECT message->>'role' as role, message->>'content' as content, created_at
           FROM n8n_chat_histories
           WHERE session_id = $1 AND user_id = $2
           ORDER BY created_at DESC LIMIT $3`,
          [sessionPhone, userId, limite]
        );
        if (!r.rows.length) return 'Sem histórico anterior com este contato.';
        return r.rows.reverse()
          .map((m: any) => `[${m.role}]: ${String(m.content).slice(0, 200)}`)
          .join('\n');
      }

      case 'registrar_pausa': {
        // Valida argumentos com zod schema
        const validatedArgs = RegistrarPausaArgsSchema.parse(args);
        await pool.query(
          `UPDATE dados_cliente SET atendimento_ia = 'pause',
             pausa_timestamp = NOW(), pausa_duracao_min = 60
           WHERE user_id = $1 AND telefone ILIKE $2`,
          [userId, `%${validatedArgs.telefone.slice(-11)}`]
        ).catch(() => {});

        const backendUrl = process.env.BACKEND_URL || 'https://api.mentoark.com.br';
        const secret = process.env.N8N_WEBHOOK_SECRET || 'mentoark-kanban-secret-2025';
        await fetch(`${backendUrl}/api/kanban/webhook/n8n`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
          body: JSON.stringify({
            user_id: userId,
            titulo: `Lead ${validatedArgs.motivo}: ${validatedArgs.telefone}`,
            resumo: validatedArgs.resumo || `Pausa: ${validatedArgs.motivo}`,
            contato_telefone: validatedArgs.telefone,
            remote_jid: `${validatedArgs.telefone}@s.whatsapp.net`,
            prioridade: validatedArgs.motivo === 'qualificado' ? 'alta' : 'media',
          }),
        }).catch(() => {});

        return `PAUSA_ATIVADA:${validatedArgs.motivo}`;
      }

      case 'buscar_produtos': {
        // Valida argumentos com zod schema
        const validatedArgs = BuscarProdutosArgsSchema.parse(args);
        const termos = validatedArgs.busca ? `%${validatedArgs.busca}%` : '%';
        const r = await pool.query(
          `SELECT p.nome, p.descricao, p.preco, c.nome as catalogo
           FROM produtos p
           JOIN catalogos c ON c.id = p.catalogo_id
           WHERE p.user_id = $1 AND p.ativo = true
             AND (p.nome ILIKE $2 OR p.descricao ILIKE $2)
             AND ($3::numeric IS NULL OR p.preco <= $3)
             AND ($4::numeric IS NULL OR p.preco >= $4)
           ORDER BY p.preco ASC LIMIT 5`,
          [userId, termos, validatedArgs.preco_max || null, validatedArgs.preco_min || null]
        );
        if (!r.rows.length) return 'Nenhum produto encontrado com esses critérios.';
        return r.rows
          .map((p: any) => `${p.nome} — R$ ${p.preco} (${p.catalogo}): ${String(p.descricao || '').slice(0, 100)}`)
          .join('\n');
      }

      case 'criar_agendamento': {
        // Valida argumentos com zod schema
        const validatedArgs = CriarAgendamentoArgsSchema.parse(args);
        await pool.query(
          `INSERT INTO follow_ups (user_id, contato_id, data_retorno, motivo, observacao, status)
           SELECT $1, c.id, $2, $3, $4, 'pendente'
           FROM contatos c
           WHERE c.user_id = $1 AND c.telefone ILIKE $5
           LIMIT 1`,
          [userId, validatedArgs.data_hora, validatedArgs.tipo, validatedArgs.observacao || null, `%${validatedArgs.telefone.slice(-11)}`]
        );
        return `Agendamento de ${validatedArgs.tipo} criado para ${validatedArgs.data_hora}.`;
      }

      case 'consultar_faq': {
        // Valida argumentos com zod schema
        const validatedArgs = ConsultarFaqArgsSchema.parse(args);
        const r = await pool.query(
          `SELECT conteudo FROM conhecimento
           WHERE user_id = $1
             AND (conteudo ILIKE $2 OR campo ILIKE $2)
           ORDER BY created_at DESC LIMIT 3`,
          [userId, `%${validatedArgs.pergunta.split(' ').slice(0, 3).join('%')}%`]
        );
        if (!r.rows.length) return 'Não encontrei essa informação na base de conhecimento.';
        return r.rows.map((k: any) => k.conteudo).join('\n---\n');
      }

      default:
        throw new Error(`Ferramenta "${nome}" não reconhecida`);
    }
  } catch (err: any) {
    log.error('MCP SEC', 'Erro na ferramenta', { nome, userId, err: err?.message, stack: err?.stack });
    return `Erro ao executar ${nome}: ${err.message}`;
  }
}
