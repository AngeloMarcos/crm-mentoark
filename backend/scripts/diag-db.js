// diag-db.js — habilidade de diagnóstico rápido de integridade de esquema.
// Le backend/.env, conecta no Postgres apontado por DATABASE_URL e confere
// tabelas estruturais, a coluna vector de `documents` e funções SQL
// customizadas esperadas. Somente leitura (information_schema/pg_catalog) —
// nenhuma DDL/DML é executada.
//
// Uso: node backend/scripts/diag-db.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const TABELAS_ESPERADAS = ['contatos', 'whatsapp_messages', 'dados_cliente', 'integracoes_config', 'documents'];
const FUNCOES_ESPERADAS = ['match_documents', 'get_next_disparo_batch'];

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log('# Diagnóstico de Banco de Dados\n\n**FALHA:** `DATABASE_URL` ausente no `.env`.');
    process.exit(1);
  }

  const url = new URL(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const linhas = [];
  linhas.push('# Diagnóstico de Banco de Dados');
  linhas.push('');
  linhas.push(`- Conexão: \`${url.hostname}:${url.port || 5432}${url.pathname}\` (usuário \`${url.username}\`)`);
  linhas.push('');

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    linhas.push(`**FALHA:** não foi possível conectar (${err.message}).`);
    console.log(linhas.join('\n'));
    process.exit(1);
  }

  try {
    // ── Tabelas estruturais ────────────────────────────────────────────────
    const { rows: tabelasRows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABELAS_ESPERADAS]
    );
    const tabelasPresentes = new Set(tabelasRows.map(r => r.table_name));

    linhas.push('## Tabelas estruturais');
    linhas.push('');
    linhas.push('| Tabela | Status |');
    linhas.push('|---|---|');
    for (const tabela of TABELAS_ESPERADAS) {
      linhas.push(`| ${tabela} | ${tabelasPresentes.has(tabela) ? '🟢 existe' : '🔴 ausente'} |`);
    }
    linhas.push('');

    // ── Coluna embedding de documents ───────────────────────────────────────
    linhas.push('## Coluna `documents.embedding`');
    linhas.push('');
    if (!tabelasPresentes.has('documents')) {
      linhas.push('🔴 Tabela `documents` ausente — não é possível checar a coluna.');
    } else {
      const { rows: colRows } = await client.query(
        `SELECT format_type(a.atttypid, a.atttypmod) AS tipo_formatado
         FROM pg_attribute a
         WHERE a.attrelid = 'public.documents'::regclass
           AND a.attname = 'embedding'
           AND a.attnum > 0
           AND NOT a.attisdropped`
      );
      if (!colRows.length) {
        linhas.push('🔴 Coluna `embedding` não existe em `documents`.');
      } else {
        const tipo = colRows[0].tipo_formatado; // ex: "vector(1536)"
        const match = /vector\((\d+)\)/.exec(tipo);
        if (!match) {
          linhas.push(`🔴 Coluna \`embedding\` existe mas não é do tipo \`vector\` (tipo real: \`${tipo}\`).`);
        } else {
          const dim = Number(match[1]);
          const dimOk = dim === 1536 || dim === 3072;
          linhas.push(`${dimOk ? '🟢' : '🟡'} Tipo \`${tipo}\` — dimensão ${dim}${dimOk ? '' : ' (esperado 1536 ou 3072)'}.`);
        }
      }
    }
    linhas.push('');

    // ── Funções SQL customizadas ────────────────────────────────────────────
    const { rows: funcRows } = await client.query(
      `SELECT DISTINCT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = ANY($1)`,
      [FUNCOES_ESPERADAS]
    );
    const funcoesPresentes = new Set(funcRows.map(r => r.proname));

    linhas.push('## Funções SQL customizadas');
    linhas.push('');
    linhas.push('| Função | Status |');
    linhas.push('|---|---|');
    for (const fn of FUNCOES_ESPERADAS) {
      linhas.push(`| ${fn}() | ${funcoesPresentes.has(fn) ? '🟢 existe' : '🔴 ausente'} |`);
    }
    linhas.push('');

    const totalOk = tabelasPresentes.size === TABELAS_ESPERADAS.length;
    linhas.push(`**Resumo:** ${tabelasPresentes.size}/${TABELAS_ESPERADAS.length} tabelas OK, ${funcoesPresentes.size}/${FUNCOES_ESPERADAS.length} funções OK.${totalOk ? '' : ' Há tabela(s) estrutural(is) faltando.'}`);

    console.log(linhas.join('\n'));
  } finally {
    client.release();
    await pool.end();
  }
})();
