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
  BuscarDocumentosArgsSchema,
  CriarCorridaArgsSchema,
} from '../functionCallingSecurity';
import { gerarEmbedding } from '../../utils/embeddings';
import { enviarCorridaParaSistemaCliente } from '../corridasService';
import { log } from '../../logger';

// Dados do contato da conversa atual — usados por ferramentas que precisam do telefone/id
// real de quem está falando (nunca extraído pela LLM, ver comentário em
// CriarCorridaArgsSchema). Opcional: ferramentas que não precisam disso seguem funcionando
// sem essa informação (chamadas fora do fluxo de agentEngine.ts, ex: testes/suporte).
export interface ContextoConversa {
  telefone?: string;
  contatoId?: string | null;
  nomeContato?: string | null;
}

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
  {
    name: 'buscar_documentos',
    description: 'Busca trechos de documentos de conhecimento e FAQs armazenados na base de conhecimento (RAG/pgvector) para responder a dúvidas institucionais ou de regras do negócio do cliente.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A pergunta ou termo de busca do usuário de forma clara para pesquisa semântica.' },
        limite: { type: 'number', description: 'Quantidade máxima de trechos a retornar (padrão: 3).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'criar_corrida',
    description: 'Registra um pedido de corrida identificado na conversa de WhatsApp, para envio ao sistema de gestão de corridas do cliente. Use quando o contato pedir uma corrida/carro/transporte. Extraia origem, destino e horário do texto da conversa. Marque confianca="alta" SOMENTE se origem, destino E horário estiverem claros e sem ambiguidade — nesse caso a corrida é enviada automaticamente. Em qualquer outro caso (dado faltando, texto vago, ambiguidade) use confianca="baixa": a corrida cai numa fila de confirmação humana antes de ser enviada, o que é preferível a mandar dado errado pro sistema do cliente.',
    input_schema: {
      type: 'object',
      properties: {
        origem: { type: 'string', description: 'Endereço ou local de partida, se mencionado.' },
        destino: { type: 'string', description: 'Endereço ou local de destino, se mencionado.' },
        horario_solicitado: { type: 'string', description: "Quando a pessoa quer a corrida, em texto livre (ex: 'agora', 'amanhã 8h')." },
        nome_passageiro: { type: 'string', description: 'Nome do passageiro, se diferente do nome já conhecido do contato.' },
        observacoes: { type: 'string', description: 'Detalhe extra relevante (bagagem, pet, ponto de referência, etc.).' },
        confianca: { type: 'string', description: "'alta' somente se origem, destino e horário estiverem claros e sem ambiguidade; 'baixa' em qualquer outro caso." },
      },
      required: ['confianca'],
    },
  },
];

export async function executarFerramenta(
  pool: Pool,
  userId: string,
  nome: string,
  args: Record<string, any>,
  contexto?: ContextoConversa,
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
        // [AUDITORIA] FIX APLICADO: esta chamada é aguardada (await) dentro do loop agêntico,
        // sob o lock atendimentosAtivos do contato — sem timeout, uma lentidão nesse endpoint
        // interno travaria o processamento daquela conversa inteira. Mesmo padrão de
        // AbortController já usado em transcreverAudio() (agentEngine.ts).
        const kanbanController = new AbortController();
        const kanbanTimer = setTimeout(() => kanbanController.abort(), 5_000);
        try {
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
            signal: kanbanController.signal,
          });
        } catch {
          // não-crítico: falha/timeout ao notificar o Kanban não deve impedir a pausa do atendimento
        } finally {
          clearTimeout(kanbanTimer);
        }

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

      case 'buscar_documentos': {
        // Valida argumentos com zod schema
        const validatedArgs = BuscarDocumentosArgsSchema.parse(args);

        // [AUDITORIA] LÓGICA: usa a OPENAI_API_KEY global do ambiente (não a chave por-tenant
        // de ai_providers) para gerar o embedding — decisão explícita: o RAG do CRM roda sobre
        // um único modelo de embeddings fixo, independente de qual provider/modelo o tenant
        // tenha configurado para a conversa (Claude, GPT, etc.).
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return 'Busca de documentos indisponível: OPENAI_API_KEY não configurada no servidor.';
        }

        const embedding = await gerarEmbedding(validatedArgs.query, apiKey);
        if (!embedding) {
          return 'Não foi possível processar a busca de documentos no momento.';
        }

        // Distância cosseno via pgvector (<=>), isolamento estrito por user_id — mesmo padrão
        // de todas as outras ferramentas deste arquivo.
        const vectorStr = `[${embedding.join(',')}]`;
        const r = await pool.query(
          `SELECT content FROM documents
           WHERE user_id = $1
           ORDER BY embedding <=> $2::vector
           LIMIT $3`,
          [userId, vectorStr, validatedArgs.limite]
        );

        if (!r.rows.length) return 'Nenhum documento correspondente encontrado na base de conhecimento.';
        return r.rows
          .map((row: any, idx: number) => `[Trecho ${idx + 1}]: ${row.content}`)
          .join('\n\n');
      }

      case 'criar_corrida': {
        // Valida argumentos com zod schema
        const validatedArgs = CriarCorridaArgsSchema.parse(args);

        const telefoneContato = contexto?.telefone;
        if (!telefoneContato) {
          // Não deveria acontecer no fluxo real (agentEngine.ts sempre passa o contexto),
          // mas nunca registra corrida sem saber de qual contato ela veio.
          return 'Não foi possível registrar a corrida: telefone do contato não identificado.';
        }

        const insertRes = await pool.query(
          `INSERT INTO corridas
             (user_id, contato_id, telefone, nome_passageiro, origem, destino, horario_solicitado, observacoes, status, origem_extracao, confianca_ia)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendente_confirmacao','ia',$9)
           RETURNING id, created_at`,
          [
            userId,
            contexto?.contatoId || null,
            telefoneContato,
            validatedArgs.nome_passageiro || contexto?.nomeContato || null,
            validatedArgs.origem || null,
            validatedArgs.destino || null,
            validatedArgs.horario_solicitado || null,
            validatedArgs.observacoes || null,
            validatedArgs.confianca,
          ]
        );
        const corridaId = insertRes.rows[0].id;
        const createdAt = insertRes.rows[0].created_at;

        // Defesa extra: mesmo que a LLM tenha marcado confianca='alta', só dispara o envio
        // automático se os 3 campos essenciais realmente vieram preenchidos — uma
        // contradição aqui (alta confiança, campo faltando) cai pra fila humana em vez de
        // arriscar mandar corrida incompleta pro sistema do cliente.
        const dadosCompletos = !!(validatedArgs.origem && validatedArgs.destino && validatedArgs.horario_solicitado);

        if (validatedArgs.confianca === 'alta' && dadosCompletos) {
          const resultado = await enviarCorridaParaSistemaCliente(pool, userId, {
            id: corridaId,
            telefone: telefoneContato,
            nome_passageiro: validatedArgs.nome_passageiro || contexto?.nomeContato || null,
            origem: validatedArgs.origem || null,
            destino: validatedArgs.destino || null,
            horario_solicitado: validatedArgs.horario_solicitado || null,
            observacoes: validatedArgs.observacoes || null,
            created_at: createdAt,
          });
          if (resultado.enviado) {
            return `CORRIDA_REGISTRADA: enviada automaticamente ao sistema do cliente (origem: ${validatedArgs.origem}, destino: ${validatedArgs.destino}, horário: ${validatedArgs.horario_solicitado}).`;
          }
          return `CORRIDA_REGISTRADA: dados completos, mas não foi possível enviar automaticamente agora (${resultado.motivo}). A corrida ficou registrada na fila para reenvio/confirmação manual.`;
        }

        return 'CORRIDA_REGISTRADA: dados incompletos ou incertos — encaminhada para confirmação de um atendente antes de ser enviada ao sistema do cliente.';
      }

      default:
        throw new Error(`Ferramenta "${nome}" não reconhecida`);
    }
  } catch (err: any) {
    log.error('MCP SEC', 'Erro na ferramenta', { nome, userId, err: err?.message, stack: err?.stack });
    return `Erro ao executar ${nome}: ${err.message}`;
  }
}
