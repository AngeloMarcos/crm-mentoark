// diag-evolution.js — habilidade de diagnóstico rápido da Evolution API.
// Le backend/.env, consulta as instâncias cadastradas no servidor Evolution
// configurado, o estado de conexão de cada uma e se o webhook aponta pra
// URL/segredo corretos. Somente leitura (fetchInstances/webhook/find) —
// nenhuma chamada aqui altera estado na Evolution.
//
// Uso: node backend/scripts/diag-evolution.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const TIMEOUT_MS = 8_000;

function sanitizeEvolutionUrl(url) {
  let u = (url || '').trim();
  if (!u) return u;
  if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
  else if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

async function fetchComTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildExpectedWebhookUrl() {
  const base = process.env.EVOLUTION_WEBHOOK_URL || 'https://api.mentoark.com.br/webhook/evolution';
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return base;
  return `${base}${base.includes('?') ? '&' : '?'}key=${secret}`;
}

(async () => {
  const baseUrl = sanitizeEvolutionUrl(process.env.EVOLUTION_API_URL);
  const apiKey = process.env.EVOLUTION_API_KEY;
  const expectedWebhookUrl = buildExpectedWebhookUrl();

  const linhas = [];
  linhas.push('# Diagnóstico Evolution API');
  linhas.push('');
  linhas.push(`- Servidor: \`${baseUrl || '(EVOLUTION_API_URL não configurada)'}\``);
  linhas.push(`- Webhook esperado: \`${expectedWebhookUrl}\``);
  linhas.push('');

  if (!baseUrl || !apiKey) {
    linhas.push('**FALHA:** `EVOLUTION_API_URL` e/ou `EVOLUTION_API_KEY` ausentes no `.env` — nada a consultar.');
    console.log(linhas.join('\n'));
    process.exit(1);
  }

  let instancias;
  try {
    const resp = await fetchComTimeout(`${baseUrl}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
    });
    if (!resp.ok) {
      linhas.push(`**FALHA:** \`GET /instance/fetchInstances\` retornou HTTP ${resp.status}.`);
      console.log(linhas.join('\n'));
      process.exit(1);
    }
    const data = await resp.json().catch(() => null);
    instancias = Array.isArray(data) ? data : [];
  } catch (err) {
    linhas.push(`**FALHA:** não foi possível contatar o servidor Evolution (${err.message}).`);
    console.log(linhas.join('\n'));
    process.exit(1);
  }

  if (!instancias.length) {
    linhas.push('Nenhuma instância cadastrada nesse servidor.');
    console.log(linhas.join('\n'));
    return;
  }

  linhas.push(`## Instâncias (${instancias.length})`);
  linhas.push('');
  linhas.push('| Instância | Status | Webhook OK? | Detalhe do webhook |');
  linhas.push('|---|---|---|---|');

  for (const inst of instancias) {
    const nome = inst?.name ?? '(sem nome)';
    const status = inst?.connectionStatus ?? 'desconhecido';
    const emoji = status === 'open' ? '🟢' : status === 'connecting' ? '🟡' : '🔴';

    let webhookOk = '⚠️ erro ao consultar';
    let detalhe = '';
    try {
      const whResp = await fetchComTimeout(`${baseUrl}/webhook/find/${nome}`, {
        headers: { apikey: apiKey },
      });
      if (whResp.ok) {
        const whBody = await whResp.json().catch(() => ({}));
        const urlConfigurada = whBody?.url ?? whBody?.webhook?.url ?? null;
        const enabled = whBody?.enabled ?? whBody?.webhook?.enabled ?? false;
        if (!urlConfigurada) {
          webhookOk = '🔴 não registrado';
          detalhe = '(sem webhook configurado)';
        } else if (urlConfigurada === expectedWebhookUrl && enabled) {
          webhookOk = '🟢 correto';
          detalhe = urlConfigurada;
        } else {
          webhookOk = '🔴 divergente';
          detalhe = `configurado=\`${urlConfigurada}\` enabled=${enabled}`;
        }
      } else if (whResp.status === 404) {
        webhookOk = '🔴 não registrado';
        detalhe = 'HTTP 404 em webhook/find';
      } else {
        webhookOk = `⚠️ HTTP ${whResp.status}`;
      }
    } catch (err) {
      detalhe = err.message;
    }

    linhas.push(`| ${nome} | ${emoji} ${status} | ${webhookOk} | ${detalhe} |`);
  }

  linhas.push('');
  const abertas = instancias.filter(i => i?.connectionStatus === 'open').length;
  linhas.push(`**Resumo:** ${abertas}/${instancias.length} instância(s) com conexão \`open\`.`);

  console.log(linhas.join('\n'));
})();
