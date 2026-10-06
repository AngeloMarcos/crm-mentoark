-- Migration 006: Sprint 9 (2026-10-06) — fn_sync_whatsapp_message_to_conversation ignora as
-- mensagens do Aquecimento Global (whatsapp_messages.maturador_global = true). Sem isso, o gatilho
-- criava contato e conversa com o número de outro cliente MentoArk a cada mensagem do aquecimento
-- (achado na simulação em homologação). Só existe onde 004/005 foram aplicadas (crm_hml);
-- aplicar junto quando as Sprints de Kanban/Inbox forem para produção.
-- Requer a coluna whatsapp_messages.maturador_global (criada por backend/src/migrations.ts).

CREATE OR REPLACE FUNCTION public.fn_sync_whatsapp_message_to_conversation()
RETURNS TRIGGER AS $$
DECLARE
  v_conv_id UUID;
  v_contato_id UUID;
  v_tel_clean VARCHAR;
BEGIN
  v_tel_clean := split_part(NEW.remote_jid, '@', 1);

  -- 006: mensagem do Aquecimento Global (troca com número de OUTRA conta) não vira contato nem
  -- conversa da inbox — ver backend/src/services/maturadorGlobal.ts.
  IF COALESCE(NEW.maturador_global, false) THEN
    RETURN NEW;
  END IF;

  -- 1. Encontra o contato_id correspondente ao telefone
  SELECT id INTO v_contato_id
  FROM public.contatos
  WHERE user_id = NEW.user_id
    AND telefone = v_tel_clean
  LIMIT 1;

  -- Se não achar o contato, tenta criar blindado contra concorrência simultânea
  IF v_contato_id IS NULL AND NOT NEW.remote_jid LIKE '%@g.us' THEN
    INSERT INTO public.contatos (user_id, nome, telefone, origem, status)
    VALUES (NEW.user_id, v_tel_clean, v_tel_clean, 'WhatsApp', 'novo')
    ON CONFLICT (user_id, telefone) WHERE telefone IS NOT NULL DO NOTHING
    RETURNING id INTO v_contato_id;

    -- Se houve conflito concorrente e não retornou ID, faz nova busca de segurança
    IF v_contato_id IS NULL THEN
      SELECT id INTO v_contato_id
      FROM public.contatos
      WHERE user_id = NEW.user_id
        AND telefone = v_tel_clean
      LIMIT 1;
    END IF;
  END IF;

  -- Se for conversa de contato individual (não-grupo) e possuir contato válido
  IF v_contato_id IS NOT NULL THEN
    -- 2. Faz o upsert da conversa de forma atômica
    INSERT INTO public.conversations (user_id, contato_id, instance_name, remote_jid, last_message_at, unread_count)
    VALUES (
      NEW.user_id,
      v_contato_id,
      NEW.instance_name,
      NEW.remote_jid,
      NEW.created_at,
      CASE WHEN NEW.from_me = false THEN 1 ELSE 0 END
    )
    ON CONFLICT (user_id, instance_name, remote_jid) DO UPDATE
    SET last_message_at = NEW.created_at,
        unread_count = CASE WHEN NEW.from_me = false THEN conversations.unread_count + 1 ELSE conversations.unread_count END,
        updated_at = NOW()
    RETURNING id INTO v_conv_id;

    -- 3. Vincula a mensagem que está sendo inserida diretamente ao ID da conversa
    NEW.conversation_id := v_conv_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
