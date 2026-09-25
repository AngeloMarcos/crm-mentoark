import { NextFunction, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest, isMasterEmail } from '../middleware';
import { log } from '../logger';
import { resolverOwnerId } from './subscription';
import { donoPeloPrefixo } from './tenantInstancia';

/**
 * Barra o cadastro (POST/PUT/PATCH) de agente/integração que aponte para a instância de OUTRA conta.
 * O nome da instância traz o id do dono (`crm_<id>`); só esse dono (ou alguém da equipe dele) pode usá-lo.
 * Donos da plataforma (MASTER_EMAILS) ficam de fora para poder dar suporte. Falha do banco não bloqueia
 * (o webhook aplica o mesmo invariante na hora de gravar as mensagens).
 */
export function exigirInstanciaPropria(pool: Pool, campos: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !req.userId || isMasterEmail(req.userEmail)) return next();
    try {
      const corpos = Array.isArray(req.body) ? req.body : [req.body];
      let minhaRaiz: string | null = null;
      for (const c of corpos) {
        for (const campo of campos) {
          const nome = c?.[campo];
          if (typeof nome !== 'string' || !nome) continue;
          const dono = await donoPeloPrefixo(pool, nome);
          if (!dono) continue;
          minhaRaiz ??= await resolverOwnerId(pool, req.userId);
          if (minhaRaiz !== dono) {
            log.error('TENANT_MISMATCH', 'tentativa de apontar configuração para instância de outra conta (bloqueada)', {
              userId: req.userId, campo, instancia: nome, path: req.path,
            });
            return res.status(403).json({ message: 'Esta instância pertence a outra conta e não pode ser usada aqui.' });
          }
        }
      }
    } catch (err: any) {
      log.warn('TENANT_MISMATCH', 'falha ao validar dono da instância no cadastro (seguindo)', { err: err?.message });
    }
    next();
  };
}
