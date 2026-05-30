ALTER TABLE public.users ADD COLUMN owner_id UUID REFERENCES public.users(id);

-- Create an index for performance
CREATE INDEX idx_users_owner_id ON public.users(owner_id);