import { Router } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

async function getKey(pool: Pool, userId: string, tipo: string, envKey: string): Promise<string | null> {
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  const res = await pool.query(
    `SELECT api_key FROM integracoes_config WHERE user_id=$1 AND tipo=$2 AND api_key IS NOT NULL AND api_key <> '' LIMIT 1`,
    [userId, tipo]
  );
  return res.rows[0]?.api_key ?? null;
}

export default function leadsBuscarRouter(pool: Pool): Router {
  const router = Router();

  router.post('/buscar', async (req: AuthRequest, res) => {
    const {
      segmento,
      cidade,
      estado,
      limite = 20,
      com_telefone = false,
    } = req.body as {
      segmento?: string;
      cnae?: string;
      cidade?: string;
      estado?: string;
      limite?: number;
      com_email?: boolean;
      com_telefone?: boolean;
    };

    if (!segmento) {
      return res.status(400).json({ error: 'segmento é obrigatório' });
    }

    const userId = req.userId!;
    const googleKey = await getKey(pool, userId, 'google_places', 'GOOGLE_PLACES_KEY');

    if (!googleKey) {
      return res.status(503).json({
        error: 'Google Places API Key não configurada. Vá em Integrações → Google Places API e adicione sua chave.',
      });
    }

    try {
      const textQuery = [segmento, cidade ? `em ${cidade}` : '', estado || '']
        .filter(Boolean)
        .join(' ');
      const maxResults = Math.min(Number(limite) || 20, 20);

      const placesRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleKey,
          'X-Goog-FieldMask': [
            'places.displayName',
            'places.formattedAddress',
            'places.nationalPhoneNumber',
            'places.websiteUri',
            'places.rating',
            'places.userRatingCount',
          ].join(','),
        },
        body: JSON.stringify({
          textQuery,
          languageCode: 'pt-BR',
          regionCode: 'BR',
          maxResultCount: maxResults,
        }),
      });

      if (!placesRes.ok) {
        const errText = await placesRes.text();
        throw new Error(`Google Places API: ${placesRes.status} — ${errText.slice(0, 300)}`);
      }

      const placesData = (await placesRes.json()) as any;
      const places: any[] = placesData.places || [];

      if (places.length === 0) {
        return res.json({ sucesso: true, total: 0, leads: [] });
      }

      const leads = places
        .map((p) => {
          const nome: string = p.displayName?.text || 'Sem nome';
          const endereco: string = p.formattedAddress || '';

          let cidadeResult = cidade || null;
          let estadoResult = estado || null;
          if (!cidadeResult || !estadoResult) {
            for (const part of endereco.split(',')) {
              const match = part.trim().match(/^(.+?)\s*[-–]\s*([A-Z]{2})$/);
              if (match) {
                if (!cidadeResult) cidadeResult = match[1].trim();
                if (!estadoResult) estadoResult = match[2].trim();
                break;
              }
            }
          }

          const rawPhone: string | null = p.nationalPhoneNumber || null;
          const telefone = rawPhone ? rawPhone.replace(/\D/g, '') : null;

          return {
            tipo: 'B2B',
            nome,
            cnpj: null as string | null,
            telefone,
            email: null as string | null,
            cidade: cidadeResult,
            estado: estadoResult,
            segmento,
            origem: 'google_places',
            rating: p.rating || null,
            total_avaliacoes: p.userRatingCount || null,
            website: p.websiteUri || null,
            endereco,
          };
        })
        .filter((l) => !com_telefone || !!l.telefone);

      // OpenAI scoring — optional
      const openaiKey = await getKey(pool, userId, 'openai', 'OPENAI_API_KEY');
      type Temperatura = 'frio' | 'morno' | 'quente';
      let leadsComScore = leads.map((l) => ({
        ...l,
        score_ia: 50,
        temperatura: 'morno' as Temperatura,
        resumo_ia: '',
        tags: [] as string[],
        motivo_score: '',
      }));

      if (openaiKey && leads.length > 0) {
        try {
          const payload = leads.slice(0, 20).map((l) => ({
            nome: l.nome,
            segmento: l.segmento,
            cidade: l.cidade,
            estado: l.estado,
            tem_telefone: !!l.telefone,
            rating: l.rating,
            total_avaliacoes: l.total_avaliacoes,
            tem_website: !!l.website,
          }));

          const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              temperature: 0.2,
              messages: [
                {
                  role: 'system',
                  content:
                    'Você é um especialista em qualificação de leads B2B para o mercado brasileiro.\n' +
                    'Analise os dados de cada empresa e retorne um array JSON.\n\n' +
                    'Critérios de score (0-100):\n' +
                    '- Tem telefone de contato: +30\n' +
                    '- Rating Google acima de 4.0: +20\n' +
                    '- Mais de 50 avaliações no Google: +20\n' +
                    '- Tem website: +15\n' +
                    '- Segmento com alto potencial comercial: +15\n\n' +
                    'Temperatura: 70-100=quente, 40-69=morno, 0-39=frio\n\n' +
                    'Retorne SOMENTE array JSON válido, sem markdown:\n' +
                    '[{"score":0,"temperatura":"frio|morno|quente","resumo":"max 2 linhas","tags":[],"motivo_score":"1 frase"}]',
                },
                {
                  role: 'user',
                  content: 'Avalie os leads na mesma ordem e retorne o array JSON:\n\n' + JSON.stringify(payload, null, 2),
                },
              ],
            }),
          });

          if (aiRes.ok) {
            const aiData = (await aiRes.json()) as any;
            const raw: string = aiData.choices[0].message.content;
            const scores: any[] = JSON.parse(raw.replace(/```json\n?|```\n?/g, '').trim());
            leadsComScore = leads.map((lead, i) => {
              const s = scores[i] ?? { score: 50, temperatura: 'morno', resumo: '', tags: [], motivo_score: '' };
              return {
                ...lead,
                score_ia: s.score,
                temperatura: s.temperatura as Temperatura,
                resumo_ia: s.resumo,
                tags: s.tags || [],
                motivo_score: s.motivo_score,
              };
            });
          }
        } catch {
          // scoring falhou — mantém defaults
        }
      }

      return res.json({ sucesso: true, total: leadsComScore.length, leads: leadsComScore });
    } catch (err: any) {
      console.error('[leads/buscar]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
