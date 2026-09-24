// Normalização de telefone brasileiro (e classificação) — fonte única no backend.
// Funções puras, sem I/O, cobertas por tests/telefone.test.ts.

export type TipoTelefone = 'celular' | 'fixo' | 'internacional' | 'invalido';

export interface TelefoneNormalizado {
  original: string;
  /** Só dígitos com DDI (55 + DDD + número p/ BR). null quando `tipo` é 'invalido'. */
  normalizado: string | null;
  tipo: TipoTelefone;
  ddd?: string;
  /** Motivo quando inválido, ou observação (ex.: 9º dígito inserido). */
  motivo?: string;
}

// DDDs oficiais da Anatel.
export const DDDS_VALIDOS: ReadonlySet<string> = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

function invalido(original: string, motivo: string): TelefoneNormalizado {
  return { original, normalizado: null, tipo: 'invalido', motivo };
}

// Classifica a parte nacional (DDD + assinante, 10 ou 11 dígitos).
function classificarNacional(original: string, nacional: string): TelefoneNormalizado {
  const ddd = nacional.slice(0, 2);
  if (!DDDS_VALIDOS.has(ddd)) return invalido(original, `DDD inválido (${ddd})`);

  let assinante = nacional.slice(2);
  let motivo: string | undefined;

  // Celular antigo (8 dígitos começando em 6-9): insere o 9. A confirmação real vem da
  // validação no WhatsApp — o JID devolvido pela Evolution prevalece sobre esta inferência.
  if (assinante.length === 8 && /^[6-9]/.test(assinante)) {
    assinante = '9' + assinante;
    motivo = '9º dígito inserido';
  }

  if (assinante.length === 8 && /^[2-5]/.test(assinante)) {
    return { original, normalizado: `55${ddd}${assinante}`, tipo: 'fixo', ddd };
  }
  if (assinante.length === 9 && assinante.startsWith('9')) {
    return { original, normalizado: `55${ddd}${assinante}`, tipo: 'celular', ddd, motivo };
  }
  return invalido(original, 'formato de número inválido');
}

export function normalizarTelefone(raw: string | null | undefined): TelefoneNormalizado {
  const original = raw == null ? '' : String(raw);
  let d = original.replace(/\D/g, '');
  if (!d) return invalido(original, 'vazio');

  // Prefixos de discagem: 00 (internacional) e 0 (tronco). Mais de 16 dígitos não é telefone
  // (IDs de grupo/LID da Evolution têm 15+ dígitos após o "@").
  d = d.replace(/^0+/, '');
  if (!d) return invalido(original, 'vazio');
  if (d.length > 15) return invalido(original, 'comprimento fora do padrão (ID de grupo/LID?)');

  // Brasil com DDI.
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    return classificarNacional(original, d.slice(2));
  }

  // Brasil sem DDI (DDD + número).
  if ((d.length === 10 || d.length === 11) && DDDS_VALIDOS.has(d.slice(0, 2))) {
    return classificarNacional(original, d);
  }

  // 10-11 dígitos que não fecharam como BR acima têm DDD inexistente.
  if (d.length === 10 || d.length === 11) return invalido(original, `DDD inválido (${d.slice(0, 2)})`);

  // Outro país: E.164 (12 a 15 dígitos) que não começa com 55.
  if (d.length >= 12 && !d.startsWith('55')) {
    return { original, normalizado: d, tipo: 'internacional' };
  }

  return invalido(original, 'formato incompleto');
}
