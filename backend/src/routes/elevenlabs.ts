import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

export default function elevenLabsRouter(pool: Pool): Router {
  const router = Router();

  /** Busca a api_key ElevenLabs do usuário autenticado */
  async function getUserApiKey(userId: string): Promise<string | null> {
    const r = await pool.query(
      `SELECT api_key FROM integracoes_config
       WHERE user_id = $1 AND tipo = 'elevenlabs' AND status = 'conectado'
       LIMIT 1`,
      [userId]
    );
    return r.rows[0]?.api_key ?? null;
  }

  // ────────────────────────────────────────────────────────────
  // GET /api/elevenlabs/voices
  // Lista todas as vozes disponíveis na conta ElevenLabs do usuário
  // ────────────────────────────────────────────────────────────
  router.get('/voices', async (req: AuthRequest, res: Response) => {
    try {
      const apiKey = await getUserApiKey(req.userId!);
      if (!apiKey) {
        return res.status(400).json({
          message: 'Integração ElevenLabs não configurada. Acesse Integrações e adicione sua API Key.',
        });
      }

      const response = await fetch(`${ELEVENLABS_API}/voices`, {
        headers: { 'xi-api-key': apiKey },
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ message: `Erro ElevenLabs: ${err}` });
      }

      const data = await response.json() as any;

      // Retorna lista simplificada: id, nome, preview_url, categoria
      const voices = (data.voices ?? []).map((v: any) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category,
        preview_url: v.preview_url ?? null,
        labels: v.labels ?? {},
      }));

      return res.json({ voices });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ────────────────────────────────────────────────────────────
  // GET /api/elevenlabs/models
  // Lista modelos de TTS disponíveis
  // ────────────────────────────────────────────────────────────
  router.get('/models', async (req: AuthRequest, res: Response) => {
    try {
      const apiKey = await getUserApiKey(req.userId!);
      if (!apiKey) {
        return res.status(400).json({ message: 'Integração ElevenLabs não configurada.' });
      }

      const response = await fetch(`${ELEVENLABS_API}/models`, {
        headers: { 'xi-api-key': apiKey },
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ message: `Erro ElevenLabs: ${err}` });
      }

      const models = await response.json() as any[];
      // Filtra apenas modelos TTS
      const ttsModels = models
        .filter((m: any) => m.can_do_text_to_speech)
        .map((m: any) => ({ model_id: m.model_id, name: m.name }));

      return res.json({ models: ttsModels });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ────────────────────────────────────────────────────────────
  // POST /api/elevenlabs/tts
  // Gera áudio TTS, salva em /uploads e retorna a URL pública
  //
  // Body: { text: string, voice_id: string, model_id?: string,
  //         stability?: number, similarity_boost?: number }
  // ────────────────────────────────────────────────────────────
  router.post('/tts', async (req: AuthRequest, res: Response) => {
    try {
      const {
        text,
        voice_id,
        model_id = 'eleven_multilingual_v2',
        stability = 0.5,
        similarity_boost = 0.75,
      } = req.body;

      if (!text || !voice_id) {
        return res.status(400).json({ message: 'text e voice_id são obrigatórios.' });
      }
      if (text.length > 5000) {
        return res.status(400).json({ message: 'Texto excede 5000 caracteres.' });
      }

      const apiKey = await getUserApiKey(req.userId!);
      if (!apiKey) {
        return res.status(400).json({
          message: 'Integração ElevenLabs não configurada. Acesse Integrações e adicione sua API Key.',
        });
      }

      const response = await fetch(
        `${ELEVENLABS_API}/text-to-speech/${voice_id}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id,
            voice_settings: { stability, similarity_boost },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ message: `Erro ElevenLabs: ${err}` });
      }

      // Salva o áudio em /uploads
      if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

      const filename = `tts_${uuidv4()}.mp3`;
      const filepath = path.join(UPLOADS_DIR, filename);

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filepath, buffer);

      const BASE_URL = process.env.API_BASE_URL || 'https://api.mentoark.com.br';
      const audioUrl = `${BASE_URL}/uploads/${filename}`;

      return res.json({
        url: audioUrl,
        filename,
        voice_id,
        model_id,
        chars: text.length,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ────────────────────────────────────────────────────────────
  // POST /api/elevenlabs/tts/stream
  // Retorna o áudio diretamente como stream (sem salvar em disco)
  // Ideal para preview rápido de voz no frontend
  //
  // Body: { text: string, voice_id: string, model_id?: string }
  // ────────────────────────────────────────────────────────────
  router.post('/tts/stream', async (req: AuthRequest, res: Response) => {
    try {
      const { text, voice_id, model_id = 'eleven_multilingual_v2' } = req.body;

      if (!text || !voice_id) {
        return res.status(400).json({ message: 'text e voice_id são obrigatórios.' });
      }
      if (text.length > 1000) {
        return res.status(400).json({ message: 'Preview limitado a 1000 caracteres.' });
      }

      const apiKey = await getUserApiKey(req.userId!);
      if (!apiKey) {
        return res.status(400).json({ message: 'Integração ElevenLabs não configurada.' });
      }

      const response = await fetch(
        `${ELEVENLABS_API}/text-to-speech/${voice_id}/stream`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ message: `Erro ElevenLabs: ${err}` });
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Stream diretamente para o cliente
      const reader = response.body!.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(Buffer.from(value));
        await pump();
      };
      await pump();
    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(500).json({ message: err.message });
      }
    }
  });

  // ────────────────────────────────────────────────────────────
  // GET /api/elevenlabs/usage
  // Retorna cotas e uso do mês atual
  // ────────────────────────────────────────────────────────────
  router.get('/usage', async (req: AuthRequest, res: Response) => {
    try {
      const apiKey = await getUserApiKey(req.userId!);
      if (!apiKey) {
        return res.status(400).json({ message: 'Integração ElevenLabs não configurada.' });
      }

      const response = await fetch(`${ELEVENLABS_API}/user/subscription`, {
        headers: { 'xi-api-key': apiKey },
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ message: `Erro ElevenLabs: ${err}` });
      }

      const data = await response.json() as any;
      return res.json({
        tier: data.tier,
        character_count: data.character_count,
        character_limit: data.character_limit,
        percent_used: data.character_limit
          ? Math.round((data.character_count / data.character_limit) * 100)
          : 0,
        next_reset: data.next_character_count_reset_unix
          ? new Date(data.next_character_count_reset_unix * 1000).toISOString()
          : null,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
