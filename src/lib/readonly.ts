import { toast } from "sonner";

/**
 * Estado global de "somente leitura" (assinatura expirada). Módulo simples, sem React —
 * o `AssinaturaProvider` empurra o valor pra cá quando o status muda, e o client HTTP
 * (`integrations/database/client.ts`) consulta antes de qualquer insert/update/delete.
 *
 * A trava DURA é o 403 do backend (assinaturaGuard). Isto aqui é só a camada amigável:
 * evita a requisição que ia falhar e mostra um aviso claro.
 */
let _readOnly = false;
let _ultimoAviso = 0;

export function setReadOnly(v: boolean) {
  _readOnly = !!v;
}

export function isReadOnly() {
  return _readOnly;
}

export function avisarBloqueado() {
  const agora = Date.now();
  if (agora - _ultimoAviso < 3500) return;
  _ultimoAviso = agora;
  toast.error(
    "Assinatura inativa — o sistema está em modo somente leitura. Reative para voltar a editar.",
  );
}
