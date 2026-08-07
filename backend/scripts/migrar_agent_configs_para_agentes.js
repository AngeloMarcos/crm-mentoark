// Script de migração de dados — Sprint 1 (unificar agent_configs -> agentes)
// Regra confirmada com o usuário: match por evolution_instancia (único match = alvo da
// migração; sem match = cria linha nova; múltiplos matches = lista e para, não adivinha).
// Contas com agent_configs.ativo=false ficam de fora desta migração (decisão confirmada).
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const configs = await pool.query(
    `SELECT user_id, nome_agente, prompt_sistema, saudacao_inicial, bloco_qualificacao,
            mensagem_encaminhamento, mensagem_encerramento, palavra_reativar, sinal_pausa,
            tempo_espera_mensagem, tempo_espera_resposta, modelo_llm, evolution_server_url,
            evolution_api_key, evolution_instancia, operation_mode, distribution_mode,
            grupo_notificacao, resposta_voz_habilitada, resposta_voz_id
     FROM agent_configs WHERE ativo = true`
  );
  console.log(`agent_configs ativo=true encontradas: ${configs.rows.length}`);

  for (const cfg of configs.rows) {
    const matches = await pool.query(
      `SELECT id, nome FROM agentes WHERE user_id = $1 AND evolution_instancia = $2`,
      [cfg.user_id, cfg.evolution_instancia]
    );
    if (matches.rows.length > 1) {
      console.log(`⚠️  AMBÍGUO — user_id=${cfg.user_id}, instancia=${cfg.evolution_instancia}: ${matches.rows.length} linhas em agentes batem. PULANDO (decisão manual).`);
      continue;
    }
    const params = [
      cfg.prompt_sistema || null, cfg.saudacao_inicial || null, cfg.bloco_qualificacao || null,
      cfg.mensagem_encaminhamento || null, cfg.mensagem_encerramento || null,
      cfg.palavra_reativar || 'atendimento finalizado', cfg.sinal_pausa || '251213',
      cfg.tempo_espera_mensagem || null, cfg.tempo_espera_resposta || null,
      cfg.grupo_notificacao || null, cfg.resposta_voz_habilitada === true,
      cfg.resposta_voz_id || null, cfg.evolution_server_url || null, cfg.evolution_api_key || null,
    ];

    if (matches.rows.length === 1) {
      const alvo = matches.rows[0];
      await pool.query(
        `UPDATE agentes SET
           prompt_sistema = COALESCE($1, prompt_sistema),
           saudacao_inicial = COALESCE($2, saudacao_inicial),
           bloco_qualificacao = COALESCE($3, bloco_qualificacao),
           mensagem_encaminhamento = COALESCE($4, mensagem_encaminhamento),
           mensagem_encerramento = COALESCE($5, mensagem_encerramento),
           palavra_reativar = $6,
           sinal_pausa = $7,
           tempo_espera_mensagem = COALESCE($8, tempo_espera_mensagem),
           tempo_espera_resposta = COALESCE($9, tempo_espera_resposta),
           grupo_notificacao = COALESCE($10, grupo_notificacao),
           resposta_voz_habilitada = $11,
           voice_id = COALESCE($12, voice_id),
           evolution_server_url = COALESCE($13, evolution_server_url),
           evolution_api_key = COALESCE($14, evolution_api_key),
           nome = CASE WHEN nome IN ('Conexão WhatsApp','Agente Teste','Agente Teste 2') THEN $15 ELSE nome END,
           updated_at = NOW()
         WHERE id = $16`,
        [...params, cfg.nome_agente || 'Assistente', alvo.id]
      );
      console.log(`✅ UPDATE agentes.id=${alvo.id} (nome antigo="${alvo.nome}") <- agent_configs user_id=${cfg.user_id}`);
    } else {
      const ins = await pool.query(
        `INSERT INTO agentes (
           user_id, nome, prompt_sistema, saudacao_inicial, bloco_qualificacao,
           mensagem_encaminhamento, mensagem_encerramento, palavra_reativar, sinal_pausa,
           tempo_espera_mensagem, tempo_espera_resposta, grupo_notificacao,
           resposta_voz_habilitada, voice_id, evolution_server_url, evolution_api_key,
           evolution_instancia, ativo
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true)
         RETURNING id`,
        [cfg.user_id, cfg.nome_agente || 'Assistente', ...params, cfg.evolution_instancia]
      );
      console.log(`🆕 INSERT agentes.id=${ins.rows[0].id} <- agent_configs user_id=${cfg.user_id} (nenhuma linha existente pra essa instancia)`);
    }
  }
  await pool.end();
})().catch(e => { console.error('ERRO', e); process.exit(1); });
