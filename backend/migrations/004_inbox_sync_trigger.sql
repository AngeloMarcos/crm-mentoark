-- Migration 004: Sprint C — gatilho atômico de sincronização Inbox
-- BEFORE INSERT em whatsapp_messages: resolve/cria contato, upsert em conversations,
-- injeta conversation_id na própria linha sendo inserida.

CREATE OR REPLACE FUNCTION public.fn_sync_whatsapp_message_to_conversation()
RETURNS TRIGGER AS $$
DECLARE
  v_conv_id UUID;
  v_contato_id UUID;
BEGIN
  -- 1. Encontra o contato_id correspondente ao telefone (remote_jid sem @)
  SELECT id INTO v_contato_id
  FROM public.contatos
  WHERE user_id = NEW.user_id
    AND telefone = split_part(NEW.remote_jid, '@', 1)
  LIMIT 1;

  -- Se não achar o contato, cria um básico para não quebrar a integridade referencial
  IF v_contato_id IS NULL AND NOT NEW.remote_jid LIKE '%@g.us' THEN
    INSERT INTO public.contatos (user_id, nome, telefone, origem, status)
    VALUES (NEW.user_id, split_part(NEW.remote_jid, '@', 1), split_part(NEW.remote_jid, '@', 1), 'WhatsApp', 'novo')
    RETURNING id INTO v_contato_id;
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

-- Associa o gatilho ANTES da inserção (BEFORE INSERT) para podermos injetar o conversation_id sem nova query de escrita
DROP TRIGGER IF EXISTS trg_sync_whatsapp_message_to_conversation ON public.whatsapp_messages;
CREATE TRIGGER trg_sync_whatsapp_message_to_conversation
BEFORE INSERT ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_whatsapp_message_to_conversation();
