import { describe, it, expect } from "vitest";
import { analisarMensagem, validarFormato } from "./linterMensagem";
import { ufPorDdd, substituirPlaceholders } from "./motorTexto";

// Sprint 8 (Sprint 4 / H6, 2026-10-06): linter da mensagem e {{estado}} automático pelo DDD.

describe("validarFormato", () => {
  it("aceita as variáveis do sistema e spintax", () => {
    expect(validarFormato("Oi {{primeiro_nome}}, {tudo bem|como vai}? Vi a {{empresa}} em {{cidade}}.")).toEqual([]);
  });
  it("barra variável desconhecida e formatos antigos", () => {
    expect(validarFormato("Oi {{nomee}}")[0]).toMatch(/desconhecida/);
    expect(validarFormato("Oi {nome}")[0]).toMatch(/chaves duplas/);
    expect(validarFormato("Oi [nome]")[0]).toMatch(/não é variável/);
    expect(validarFormato("Oi %empresa%")[0]).toMatch(/não é variável/);
    expect(validarFormato("Oi {tudo|bem")[0]).toMatch(/desbalanceadas/);
  });
});

describe("analisarMensagem", () => {
  const boa = "{Oi|Olá} {{primeiro_nome}}, {tudo bem?|como vai?} Vi que a {{empresa}} {trabalha com|atua em} reformas. " +
    "{Posso te mandar uma ideia rápida?|Topa conversar 2 minutos?} Se não quiser receber, responda SAIR.";
  it("mensagem personalizada, curta, com variação e saída tira nota alta", () => {
    const r = analisarMensagem(boa);
    expect(r.nota).toBeGreaterThanOrEqual(80);
    expect(r.previas).toHaveLength(5);
    expect(r.erros).toEqual([]);
  });
  it("mensagem genérica com link, termos de spam e sem saída tira nota baixa", () => {
    const r = analisarMensagem("PROMOÇÃO IMPERDÍVEL!!! Ganhe dinheiro, é grátis 🤑🤑🤑🤑🔥🔥 clique aqui https://x.com");
    expect(r.nota).toBeLessThan(50);
    expect(r.itens.find(i => i.item === "Link")?.ok).toBe(false);
    expect(r.itens.find(i => i.item === "Termos sensíveis")?.ok).toBe(false);
  });
  it('avisa quando o texto promete "API Oficial" numa campanha por QR Code', () => {
    expect(analisarMensagem("Atendimento pela API Oficial do WhatsApp").avisos[0]).toMatch(/QR Code/);
    expect(analisarMensagem("Atendimento pela API Oficial", { canalBaileys: false }).avisos).toEqual([]);
  });
});

describe("{{estado}} pelo DDD", () => {
  it("deduz a UF do DDD", () => {
    expect(ufPorDdd("5521987654321")).toBe("RJ");
    expect(ufPorDdd("11987654321")).toBe("SP");
    expect(ufPorDdd("447911123456")).toBe(""); // Reino Unido (DDI 44), não é BR
  });
  it("usa o estado do cadastro quando existe e o do DDD quando falta", () => {
    expect(substituirPlaceholders("Aqui de {{estado}}", { telefone: "5531999990000", estado: "BA" })).toBe("Aqui de BA");
    expect(substituirPlaceholders("Aqui de {{estado}}", { telefone: "5531999990000" })).toBe("Aqui de MG");
  });
});
