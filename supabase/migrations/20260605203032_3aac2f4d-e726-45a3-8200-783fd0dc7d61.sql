
-- 1) Restrict users.password_hash: revoke column SELECT from authenticated/anon
REVOKE SELECT ON public.users FROM authenticated, anon;
GRANT SELECT (id, email, display_name, avatar_url, role, active, email_verified, last_login_at, created_at, updated_at, owner_id, cargo_id) ON public.users TO authenticated;

-- 2) Restrict agentes.evolution_api_key
REVOKE SELECT ON public.agentes FROM authenticated, anon;
GRANT SELECT (id, user_id, nome, descricao, persona, tom, objetivo, mensagem_boas_vindas, regras, modelo, temperatura, max_tokens, evolution_instancia, evolution_server_url, webhook_principal, webhook_indexacao, webhook_teste, ativo, created_at, updated_at, score_updated_at, voice_stability, elevenlabs_model, voice_id, rag_ativo, rag_resultados, rag_threshold, voice_similarity, whatsapp_score, score_fatores, n8n_webhook_url) ON public.agentes TO authenticated;

-- 3) Restrict agent_configs.evolution_api_key
REVOKE SELECT ON public.agent_configs FROM authenticated, anon;
GRANT SELECT (id, user_id, sinal_pausa, tempo_espera_mensagem, tempo_espera_resposta, modelo_llm, modelo_parser, grupo_notificacao, ativo, evolution_instancia, evolution_server_url, updated_at, created_at, nome_agente, prompt_sistema, saudacao_inicial, bloco_qualificacao, mensagem_encaminhamento, mensagem_encerramento, palavra_reativar) ON public.agent_configs TO authenticated;

-- 4) Restrict facebook_contas.access_token
REVOKE SELECT ON public.facebook_contas FROM authenticated, anon;
GRANT SELECT (id, user_id, ad_account_id, nome_conta, token_expira_em, criado_em, atualizado_em) ON public.facebook_contas TO authenticated;

-- 5) Restrict integracoes_config.api_key
REVOKE SELECT ON public.integracoes_config FROM authenticated, anon;
GRANT SELECT (id, user_id, nome, tipo, url, instancia, status, config, ultima_sync, created_at, updated_at) ON public.integracoes_config TO authenticated;

-- 6) Fix whatsapp_message_status policy: restrict role + ownership
DROP POLICY IF EXISTS "Users can view statuses of their messages" ON public.whatsapp_message_status;
CREATE POLICY "Users can view statuses of their messages"
  ON public.whatsapp_message_status
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.whatsapp_messages m
    WHERE m.message_id = whatsapp_message_status.message_id
      AND m.user_id = auth.uid()
  ));

-- 7) Fix whatsapp_chat_prefs policy: restrict role to authenticated
DROP POLICY IF EXISTS "Users can manage their own chat preferences" ON public.whatsapp_chat_prefs;
CREATE POLICY "Users can manage their own chat preferences"
  ON public.whatsapp_chat_prefs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 8) Fix function search_path for update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Ensure service_role retains full access
GRANT ALL ON public.users, public.agentes, public.agent_configs, public.facebook_contas, public.integracoes_config TO service_role;
