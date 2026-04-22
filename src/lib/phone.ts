/**
 * Normalizador de telefone brasileiro para WhatsApp.
 *
 * Regras:
 * - Remove tudo que não é dígito.
 * - Remove zeros à esquerda.
 * - Adiciona DDI 55 quando faltar (números com 10 ou 11 dígitos locais).
 * - Insere o "9" extra em celulares antigos com 10 dígitos locais (DDD + 8)
 *   quando o terceiro dígito for 6, 7, 8 ou 9.
 * - Rejeita fixos: o primeiro dígito após o DDD começa com 2, 3, 4 ou 5
 *   (esses números não têm conta de WhatsApp).
 * - Rejeita comprimentos finais fora do esperado (12 ou 13 dígitos com 55).
 */
export interface TelefoneNormalizado {
  jid: string | null;     // número final pronto para WhatsApp (ex: 5511987654321)
  valido: boolean;
  motivo?: string;        // razão da invalidação
  original: string;       // entrada original
}

export function normalizarTelefoneBR(raw: string | null | undefined): TelefoneNormalizado {
  const original = (raw ?? "").toString();
  if (!original.trim()) {
    return { jid: null, valido: false, motivo: "vazio", original };
  }

  // 1) só dígitos, sem zeros à esquerda
  let d = original.replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return { jid: null, valido: false, motivo: "sem dígitos", original };

  // 2) garante DDI 55
  if (!d.startsWith("55")) {
    if (d.length === 10 || d.length === 11) d = "55" + d;
  }

  // 3) precisa começar com 55 + DDD válido (11..99)
  if (!d.startsWith("55") || d.length < 12) {
    return { jid: null, valido: false, motivo: "formato incompleto", original };
  }

  const ddd = d.slice(2, 4);
  const dddNum = Number(ddd);
  if (!Number.isInteger(dddNum) || dddNum < 11 || dddNum > 99) {
    return { jid: null, valido: false, motivo: `DDD inválido (${ddd})`, original };
  }

  let resto = d.slice(4); // parte após DDI+DDD

  // 4) celular antigo com 8 dígitos: insere 9 se primeiro dígito for 6/7/8/9
  if (resto.length === 8 && /^[6-9]/.test(resto)) {
    resto = "9" + resto;
  }

  // 5) rejeita fixos (primeiro dígito 2-5)
  if (/^[2-5]/.test(resto)) {
    return {
      jid: null,
      valido: false,
      motivo: "Telefone fixo (não tem WhatsApp)",
      original,
    };
  }

  // 6) celular válido precisa começar com 9 e ter 9 dígitos após DDD
  if (resto.length !== 9 || !resto.startsWith("9")) {
    return {
      jid: null,
      valido: false,
      motivo: "Formato de celular inválido",
      original,
    };
  }

  const jid = "55" + ddd + resto; // 13 dígitos
  if (jid.length !== 13) {
    return { jid: null, valido: false, motivo: "comprimento final inválido", original };
  }

  return { jid, valido: true, original };
}

/** True se o número, normalizado, é um fixo brasileiro (sem WhatsApp). */
export function isFixoBR(raw: string | null | undefined): boolean {
  const r = normalizarTelefoneBR(raw);
  return !r.valido && r.motivo?.startsWith("Telefone fixo") === true;
}
