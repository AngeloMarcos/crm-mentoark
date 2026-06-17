UPDATE integracoes_config SET status = 'inativo' WHERE instancia = 'teste';
SELECT tipo, status, instancia FROM integracoes_config;
