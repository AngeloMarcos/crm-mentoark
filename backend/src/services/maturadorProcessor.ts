/**
 * maturadorProcessor.ts — motor do Maturador de Números (Sprint Score Real + Maturador,
 * 2026-08-09, item 2). Chamado a cada 1min pelo cron (`cron.ts`) — mesmo espírito de
 * `disparoProcessor.ts` (ciclo com delay variável, nunca rajada), mas trocando mensagem
 * PRÉ-ESCRITA (banco de diálogo em `maturadorDialogos.ts`, zero IA/token) entre 2 instâncias da
 * MESMA conta, pra simular tráfego orgânico em número novo/recém-conectado.
 *
 * Só age sobre pares com `ativo=true` — nasce sempre `false` (ver migrations.ts), então este
 * motor não faz nada até o usuário ativar pelo menos 1 par manualmente pela UI. Ativar um par já
 * exige (validado em `routes/maturador.ts`, na criação/ativação) que NENHUMA das duas instâncias
 * tenha `agentes.ativo=true` — guard-rail contra a IA real do CRM responder a uma mensagem do
 * maturador (custaria token de verdade e quebraria a promessa de "zero IA" desta feature).
 */
import { Pool } from 'pg';
import { evolutionFetch, sanitizeEvolutionUrl } from '../utils/resilientFetch';
import { log } from '../logger';
import { DIALOGO, aplicarVariacao } from './maturadorDialogos';

// Ritmo de aquecimento — mesma progressão já documentada na cópia estática de
// `ScoreInstancia.tsx` ("Semana 1: max 20 msg/dia, Semana 2: max 50 msg/dia, Semana 3: max 100
// msg/dia"), citada também no print de referência do usuário. Semana 3+ estabiliza em 100/dia
// (não continua subindo indefinidamente).
function limiteDiarioPorIdade(diasAtivo: number): number {
  if (diasAtivo < 7) return 20;
  if (diasAtivo < 14) return 50;
  return 100;
}

// Intervalo mínimo entre mensagens do MESMO par — bem mais espaçado que o antiban do Disparo
// (que lida com fila real de contatos esperando); aqui não tem pressa nenhuma, o objetivo é
// parecer 2 pessoas trocando mensagem ao longo do dia, não uma rajada. Recalculado a cada tick
// (jitter inofensivo — só define a partir de quando a próxima troca fica "liberada").
function proximoIntervaloMinutos(): number {
  return 5 + Math.random() * 10; // 5–15 min
}

interface InstanciaInfo {
  url: string;
  api_key: string;
  instancia: string;
  numero: string | null;
}

// [AUDITORIA] LÓGICA: cópia mínima e adaptada de `buscarPhoneNumberInstancia()`
// (`routes/whatsapp.ts`, função local não exportada) — resolve o número de telefone real de uma
// instância via Evolution `fetchInstances` (ownerJid). Duplicado aqui pelo mesmo motivo já
// documentado em `maturadorDialogos.ts` (função local, não exportada, extrair criaria acoplamento
// maior do que vale a pena pra esta sprint). Cache em memória por instância (módulo-level,
// mesmo padrão de `instanciasCampanhaCache` em `disparoProcessor.ts`) — número de telefone de uma
// instância não muda, não precisa re-consultar a cada tick.
const numeroCache = new Map<string, string | null>();
async function resolverNumeroInstancia(url: string, apiKey: string, instancia: string): Promise<string | null> {
  if (numeroCache.has(instancia)) return numeroCache.get(instancia)!;
  try {
    const baseUrl = sanitizeEvolutionUrl(url);
    const r = await evolutionFetch(`${baseUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`, {
      headers: { apikey: apiKey },
    });
    if (!r.ok) { numeroCache.set(instancia, null); return null; }
    const data: any = await r.json().catch(() => null);
    const info = Array.isArray(data) ? data[0] : null;
    const numero = info?.ownerJid ? String(info.ownerJid).split('@')[0] : null;
    numeroCache.set(instancia, numero);
    return numero;
  } catch {
    numeroCache.set(instancia, null);
    return null;
  }
}

/**
 * Processa UM tick do motor — checa todos os pares ativos, envia no máximo 1 mensagem por par
 * que esteja "devido" (respeitando limite diário + intervalo mínimo). Erros por par são isolados
 * (uma falha de envio/instância desconectada não derruba os outros pares).
 */
export async function processarMaturador(pool: Pool): Promise<{ processados: number; enviados: number }> {
  const { rows: pares } = await pool.query(
    `SELECT mp.*,
            a.evolution_server_url AS a_url, a.evolution_api_key AS a_key, a.evolution_instancia AS a_instancia,
            b.evolution_server_url AS b_url, b.evolution_api_key AS b_key, b.evolution_instancia AS b_instancia
     FROM maturador_pares mp
     JOIN agentes a ON a.id = mp.agente_a_id
     JOIN agentes b ON b.id = mp.agente_b_id
     WHERE mp.ativo = true AND mp.banido_em IS NULL`
  );

  let processados = 0;
  let enviados = 0;

  for (const par of pares) {
    processados++;
    try {
      // Reset do contador diário — mesmo padrão citado pelo usuário (reseta à meia-noite).
      // Checado no próprio tick (sem cron separado): se a data salva for de outro dia, zera.
      const hoje = new Date().toISOString().slice(0, 10);
      const resetadoEm = par.contador_resetado_em ? new Date(par.contador_resetado_em).toISOString().slice(0, 10) : null;
      let contadorDia = par.contador_dia;
      if (resetadoEm !== hoje) {
        contadorDia = 0;
        await pool.query(
          `UPDATE maturador_pares SET contador_dia = 0, contador_resetado_em = CURRENT_DATE WHERE id = $1`,
          [par.id]
        );
      }

      const diasAtivo = Math.max(0, Math.floor((Date.now() - new Date(par.data_inicio).getTime()) / (1000 * 60 * 60 * 24)));
      const limiteHoje = limiteDiarioPorIdade(diasAtivo);
      if (contadorDia >= limiteHoje) continue; // teto do dia já batido pra este par

      if (par.ultima_mensagem_em) {
        const minutosDesdeUltima = (Date.now() - new Date(par.ultima_mensagem_em).getTime()) / 60000;
        if (minutosDesdeUltima < proximoIntervaloMinutos()) continue; // ainda não é hora
      }

      // Alterna remetente — null (primeira mensagem do par) começa por 'a'.
      const remetente: 'a' | 'b' = par.ultimo_remetente === 'a' ? 'b' : 'a';
      const de = remetente === 'a'
        ? { url: par.a_url, api_key: par.a_key, instancia: par.a_instancia }
        : { url: par.b_url, api_key: par.b_key, instancia: par.b_instancia };
      const para = remetente === 'a'
        ? { url: par.b_url, api_key: par.b_key, instancia: par.b_instancia }
        : { url: par.a_url, api_key: par.a_key, instancia: par.a_instancia };

      if (!de.url || !de.instancia || !para.url || !para.instancia) {
        log.warn('MATURADOR', 'Par sem credenciais Evolution completas — pulando', { parId: par.id });
        continue;
      }

      const numeroDestino = await resolverNumeroInstancia(para.url, para.api_key, para.instancia);
      if (!numeroDestino) {
        log.warn('MATURADOR', 'Não foi possível resolver o número da instância destino — pulando', { parId: par.id, instancia: para.instancia });
        continue;
      }

      const linhaIdx = par.linha_atual % DIALOGO.length;
      const texto = aplicarVariacao(DIALOGO[linhaIdx]);
      const baseUrl = sanitizeEvolutionUrl(de.url);

      const resp = await evolutionFetch(`${baseUrl}/message/sendText/${de.instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: de.api_key },
        body: JSON.stringify({ number: numeroDestino, text: texto }),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`Evolution API ${resp.status}: ${errBody}`);
      }

      await pool.query(
        `UPDATE maturador_pares
         SET ultimo_remetente = $1, ultima_mensagem_em = NOW(), linha_atual = $2,
             contador_dia = $3, updated_at = NOW()
         WHERE id = $4`,
        [remetente, (linhaIdx + 1) % DIALOGO.length, contadorDia + 1, par.id]
      );
      enviados++;
      log.info('MATURADOR', 'Mensagem de maturação enviada', { parId: par.id, de: de.instancia, para: para.instancia, linha: linhaIdx });
    } catch (err: any) {
      log.warn('MATURADOR', 'Falha ao processar par', { parId: par.id, err: err?.message });
    }
  }

  return { processados, enviados };
}
