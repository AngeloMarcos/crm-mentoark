/**
 * Helper único para ler o JWT armazenado no localStorage.
 *
 * O ApiClient (src/integrations/api/client.ts) salva o token em
 * `crm_access_token`. Durante a transição mantemos fallback pra
 * `access_token` (chave legada que estava espalhada pelo código).
 */
export function getAuthToken(): string {
  return (
    localStorage.getItem("access_token") ||
    localStorage.getItem("crm_access_token") ||
    ""
  );
}

/** Header pronto pra usar em `fetch(url, { headers: authHeader() })`. */
export function authHeader(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
