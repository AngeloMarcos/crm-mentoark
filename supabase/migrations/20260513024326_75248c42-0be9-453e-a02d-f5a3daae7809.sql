-- Create evolution_instances table
CREATE TABLE IF NOT EXISTS public.evolution_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  instance_id TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  phone_number TEXT,
  profile_name TEXT,
  owner_jid TEXT,
  customer_id TEXT,
  project_id TEXT,
  integration TEXT DEFAULT 'WHATSAPP-WHATSMEOW',
  api_response JSONB DEFAULT '{}'::jsonb,
  connected_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, instance_name)
);

-- Enable RLS for evolution_instances
ALTER TABLE public.evolution_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own evolution instances"
ON public.evolution_instances
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create tenant_whatsapp table
CREATE TABLE IF NOT EXISTS public.tenant_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  phone_number TEXT,
  qr_code TEXT,
  qr_expires_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  connected_at TIMESTAMP WITH TIME ZONE,
  last_disconnect_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS for tenant_whatsapp
ALTER TABLE public.tenant_whatsapp ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own whatsapp connection state"
ON public.tenant_whatsapp
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_evolution_instances_updated_at
BEFORE UPDATE ON public.evolution_instances
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_tenant_whatsapp_updated_at
BEFORE UPDATE ON public.tenant_whatsapp
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();
