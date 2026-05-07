
-- dados_cliente
CREATE TABLE public.dados_cliente (
  id BIGSERIAL PRIMARY KEY,
  telefone TEXT,
  nomewpp TEXT,
  atendimento_ia BOOLEAN DEFAULT true,
  "Setor" TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.dados_cliente ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read dados_cliente" ON public.dados_cliente FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert dados_cliente" ON public.dados_cliente FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update dados_cliente" ON public.dados_cliente FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete dados_cliente" ON public.dados_cliente FOR DELETE TO authenticated USING (true);

-- chat_messages
CREATE TABLE public.chat_messages (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT,
  nomewpp TEXT,
  bot_message TEXT,
  user_message TEXT,
  message_type TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read chat_messages" ON public.chat_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert chat_messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update chat_messages" ON public.chat_messages FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete chat_messages" ON public.chat_messages FOR DELETE TO authenticated USING (true);

-- chats
CREATE TABLE public.chats (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read chats" ON public.chats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert chats" ON public.chats FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update chats" ON public.chats FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete chats" ON public.chats FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON public.chats
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
