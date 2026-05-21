-- Índices para performance do motor de disparos
CREATE INDEX IF NOT EXISTS idx_disparo_logs_status_disparo ON public.disparo_logs (status, disparo_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_disparos_status_active ON public.disparos (status) WHERE status = 'em_andamento';

-- Função para buscar próximo lote de envios de forma segura (atomicidade)
CREATE OR REPLACE FUNCTION public.get_next_disparo_batch(p_limit INT)
RETURNS TABLE (
    log_id UUID,
    disparo_id UUID,
    user_id UUID,
    telefone TEXT,
    mensagem TEXT,
    tipo_midia TEXT,
    url_midia TEXT,
    legenda_midia TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH selected_logs AS (
        SELECT dl.id, dl.disparo_id, dl.user_id, dl.telefone, dl.mensagem_enviada,
               d.tipo_midia, d.url_midia, d.legenda_midia
        FROM public.disparo_logs dl
        JOIN public.disparos d ON d.id = dl.disparo_id
        WHERE dl.status = 'pending'
          AND d.status = 'em_andamento'
          -- Garante que a janela de envio seja respeitada no nível do SQL para eficiência
          AND (
            CURRENT_TIME AT TIME ZONE 'America/Sao_Paulo' 
            BETWEEN d.horario_inicio::time AND d.horario_fim::time
          )
        ORDER BY dl.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.disparo_logs
    SET status = 'sending', updated_at = NOW()
    FROM selected_logs
    WHERE public.disparo_logs.id = selected_logs.id
    RETURNING 
        selected_logs.id, 
        selected_logs.disparo_id, 
        selected_logs.user_id, 
        selected_logs.telefone, 
        selected_logs.mensagem_enviada,
        selected_logs.tipo_midia,
        selected_logs.url_midia,
        selected_logs.legenda_midia;
END;
$$ LANGUAGE plpgsql;