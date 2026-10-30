/**
 * integracoesHub.ts — Integrações num lugar só (2026-10-29, modelo Cubo; ver
 * diagnosticos/engenharia_reversa_suite/RELATORIO_INTEGRACOES_E_DESCARTE.md).
 *
 * Junta numa lista única o que hoje mora em 5 tabelas, sem migrar dado nenhum ainda:
 *   - IA (OpenAI/Claude/Gemini/OpenRouter) ......... ai_providers          (gerenciada nesta página)
 *   - WhatsApp não oficial (Evolution) ............. agentes.evolution_instancia
 *   - WhatsApp oficial (Meta Cloud API) ............ whatsapp_oficial_config
 *   - Meta Ads / Lead Ads .......................... facebook_contas
 *   - ElevenLabs, n8n e outras ..................... integracoes_config
 * Cada item diz o status e onde é gerenciado. Só leitura — nenhuma credencial sai daqui.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { TIPOS_IA } from '../services/integracoesIA';

export type StatusIntegracao = 'ok' | 'atencao' | 'erro' | 'desligada';

export interface ItemIntegracao {
  chave: string;
  categoria: 'ia' | 'whatsapp' | 'marketing' | 'voz' | 'automacao';
  tipo: string;
  nome: string;
  status: StatusIntegracao;
  detalhe: string | null;
  gerenciar: string;            // rota do frontend
  id?: string;                  // id na tabela de origem (IA: usado pelas ações da página)
}

export interface TipoCatalogo {
  tipo: string;
  categoria: ItemIntegracao['categoria'];
  rotulo: string;
  descricao: string;
  criar: string | null;         // rota onde se cria (null = cria nesta página)
}

export const CATALOGO: TipoCatalogo[] = [
  ...TIPOS_IA.map(t => ({ tipo: t.tipo, categoria: 'ia' as const, rotulo: t.rotulo, descricao: t.descricao, criar: null })),
  { tipo: 'whatsapp_oficial', categoria: 'whatsapp', rotulo: 'WhatsApp Business (oficial)', descricao: 'Número conectado direto na Meta (sem QR Code). Disparo só com template aprovado.', criar: '/whatsapp?tab=instancias' },
  { tipo: 'evolution', categoria: 'whatsapp', rotulo: 'WhatsApp não oficial (QR Code)', descricao: 'Número conectado pelo WhatsApp Web via Evolution. Há risco de banimento; use o aquecimento.', criar: '/whatsapp?tab=instancias' },
  { tipo: 'meta_ads', categoria: 'marketing', rotulo: 'Meta Ads e Lead Ads', descricao: 'Resultados das campanhas e leads dos formulários do Facebook/Instagram.', criar: '/marketing-digital' },
  { tipo: 'elevenlabs', categoria: 'voz', rotulo: 'ElevenLabs (voz)', descricao: 'Respostas da IA em áudio com voz natural.', criar: '/integracoes/conectores' },
  { tipo: 'n8n', categoria: 'automacao', rotulo: 'n8n / Webhook', descricao: 'Fluxos externos que recebem ou enviam dados do CRM.', criar: '/integracoes/conectores' },
];

const rotuloTipo = (tipo: string) => CATALOGO.find(c => c.tipo === tipo)?.rotulo ?? tipo;

/** Status de uma integração de IA a partir do último teste da chave. */
export function statusIA(row: { ativo: boolean; ultimo_status: string | null; ultimo_erro: string | null; ultimo_teste_em: string | Date | null }): { status: StatusIntegracao; detalhe: string | null } {
  if (!row.ativo) return { status: 'desligada', detalhe: 'Desligada' };
  if (row.ultimo_status === 'erro') return { status: 'erro', detalhe: row.ultimo_erro || 'Chave recusada' };
  if (row.ultimo_status === 'ok') return { status: 'ok', detalhe: 'Chave válida' };
  return { status: 'atencao', detalhe: 'Chave ainda não testada' };
}

export default function integracoesHubRouter(pool: Pool): Router {
  const router = Router();

  router.get('/catalogo', (_req: AuthRequest, res: Response) => res.json(CATALOGO));

  router.get('/', async (req: AuthRequest, res: Response) => {
    const userId = req.userId;
    const q = (sql: string) => pool.query(sql, [userId]).then(r => r.rows).catch(() => [] as any[]);
    const [ia, evolution, oficial, meta, outras] = await Promise.all([
      q(`SELECT id, nome, slug, modelo, ativo, ultimo_status, ultimo_erro, ultimo_teste_em FROM ai_providers WHERE user_id = $1 ORDER BY created_at`),
      q(`SELECT id, nome, nome_exibicao, evolution_instancia, numero_conectado, ativo, protecao_alerta
           FROM agentes WHERE user_id = $1 AND COALESCE(evolution_instancia, '') <> '' ORDER BY created_at`),
      q(`SELECT id, nome, numero_exibicao, verified_name, ativo, ultimo_erro, quality_rating, conta_status
           FROM whatsapp_oficial_config WHERE user_id = $1 ORDER BY created_at`),
      q(`SELECT id, nome_conta, ad_account_id, token_expira_em FROM facebook_contas WHERE user_id = $1`),
      q(`SELECT id, tipo, status, url FROM integracoes_config WHERE user_id = $1 AND tipo NOT IN ('evolution', 'openai')`),
    ]);

    const itens: ItemIntegracao[] = [
      ...ia.map((r: any): ItemIntegracao => ({
        chave: `ia:${r.id}`, id: r.id, categoria: 'ia', tipo: r.slug, nome: r.nome || rotuloTipo(r.slug),
        ...statusIA(r), gerenciar: '/integracoes',
      })),
      ...evolution.map((r: any): ItemIntegracao => ({
        chave: `evolution:${r.id}`, categoria: 'whatsapp', tipo: 'evolution',
        nome: r.nome_exibicao || r.nome || r.evolution_instancia,
        status: !r.ativo ? 'desligada' : r.protecao_alerta ? 'atencao' : r.numero_conectado ? 'ok' : 'atencao',
        detalhe: r.protecao_alerta || (r.numero_conectado ? `+${r.numero_conectado}` : 'Sem número conectado'),
        gerenciar: '/whatsapp?tab=instancias',
      })),
      ...oficial.map((r: any): ItemIntegracao => ({
        chave: `oficial:${r.id}`, categoria: 'whatsapp', tipo: 'whatsapp_oficial',
        nome: r.nome || r.verified_name || r.numero_exibicao || 'Número oficial',
        status: !r.ativo ? 'desligada' : r.ultimo_erro ? 'erro' : r.quality_rating && r.quality_rating !== 'GREEN' ? 'atencao' : 'ok',
        detalhe: r.ultimo_erro || [r.numero_exibicao, r.quality_rating && `qualidade ${r.quality_rating}`].filter(Boolean).join(' · ') || null,
        gerenciar: '/whatsapp?tab=instancias',
      })),
      ...meta.map((r: any): ItemIntegracao => {
        const expirado = r.token_expira_em && new Date(r.token_expira_em).getTime() < Date.now();
        return {
          chave: `meta_ads:${r.id}`, categoria: 'marketing', tipo: 'meta_ads', nome: r.nome_conta || 'Conta de anúncios',
          status: expirado ? 'erro' : r.ad_account_id ? 'ok' : 'atencao',
          detalhe: expirado ? 'Acesso expirado: reconecte a conta' : r.ad_account_id ? `Conta ${r.ad_account_id}` : 'Escolha a conta de anúncios',
          gerenciar: '/marketing-digital',
        };
      }),
      ...outras.map((r: any): ItemIntegracao => ({
        chave: `config:${r.id}`, categoria: r.tipo === 'elevenlabs' ? 'voz' : 'automacao', tipo: r.tipo, nome: rotuloTipo(r.tipo),
        status: ['ativo', 'conectado'].includes(String(r.status)) ? 'ok' : 'desligada',
        detalhe: r.url || null, gerenciar: '/integracoes/conectores',
      })),
    ];
    return res.json({ itens, catalogo: CATALOGO });
  });

  return router;
}
