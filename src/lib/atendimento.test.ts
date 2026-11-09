import { describe, it, expect } from "vitest";
import { textoEventoAtendimento, tempoRestantePausa, type EventoAtendimento } from "./atendimento";

const ev = (over: Partial<EventoAtendimento>): EventoAtendimento => ({
  id: 1, atendimento_id: "a1", tipo: "aberto", origem: "sistema", texto: null, ate: null,
  created_at: "2026-11-09T12:00:00Z", autor_id: null, autor_nome: null, de_nome: null, para_nome: null, motivo_nome: null, ...over,
});

describe("texto do evento na linha do tempo", () => {
  it("atribuição", () => {
    expect(textoEventoAtendimento(ev({ tipo: "atribuido", para_nome: "Ana" }))).toBe("Atribuído a Ana");
  });

  it("transferência mostra de, para e motivo", () => {
    expect(textoEventoAtendimento(ev({ tipo: "transferido", de_nome: "Ana", para_nome: "Bia", motivo_nome: "Fora do horário" })))
      .toBe("Transferido de Ana para Bia — Fora do horário");
  });

  it("transferência de conversa sem atendente", () => {
    expect(textoEventoAtendimento(ev({ tipo: "transferido", para_nome: "Bia" }))).toBe("Transferido para Bia");
  });

  it("cliente pediu humano", () => {
    expect(textoEventoAtendimento(ev({ tipo: "aguardando", origem: "ia" }))).toBe("Cliente pediu atendente: aguardando humano");
  });

  it("resolução com motivo", () => {
    expect(textoEventoAtendimento(ev({ tipo: "resolvido", autor_nome: "Ana", motivo_nome: "Venda feita" }))).toBe("Resolvido por Ana — Venda feita");
  });

  it("reabertura", () => {
    expect(textoEventoAtendimento(ev({ tipo: "reaberto", autor_nome: "Ana" }))).toBe("Reaberto por Ana");
  });

  it("pausa sem prazo", () => {
    expect(textoEventoAtendimento(ev({ tipo: "ia_pausada", autor_nome: "Ana" }))).toBe("IA pausada por Ana até devolver");
  });

  it("pausa com prazo mostra o horário", () => {
    expect(textoEventoAtendimento(ev({ tipo: "ia_pausada", autor_nome: "Ana", ate: "2026-11-09T15:30:00Z" }), "America/Sao_Paulo"))
      .toBe("IA pausada por Ana até 12:30");
  });

  it("fim automático da pausa", () => {
    expect(textoEventoAtendimento(ev({ tipo: "ia_retomada", origem: "sistema" }))).toBe("IA voltou: fim da pausa");
  });

  it("devolução por pessoa", () => {
    expect(textoEventoAtendimento(ev({ tipo: "ia_retomada", origem: "humano", autor_nome: "Ana" }))).toBe("IA devolvida por Ana");
  });

  it("sem nome de quem fez não deixa buraco no texto", () => {
    expect(textoEventoAtendimento(ev({ tipo: "resolvido" }))).toBe("Resolvido");
  });
});

describe("tempo restante da pausa", () => {
  const agora = new Date("2026-11-09T12:00:00Z");
  const mais = (min: number) => new Date(agora.getTime() + min * 60_000).toISOString();

  it("minutos", () => {
    expect(tempoRestantePausa(mais(23), agora)).toBe("23 min");
  });

  it("horas e minutos", () => {
    expect(tempoRestantePausa(mais(135), agora)).toBe("2 h 15 min");
  });

  it("hora cheia", () => {
    expect(tempoRestantePausa(mais(60), agora)).toBe("1 h");
  });

  it("menos de um minuto", () => {
    expect(tempoRestantePausa(mais(0.5), agora)).toBe("menos de 1 min");
  });

  it("sem prazo devolve null", () => {
    expect(tempoRestantePausa(null, agora)).toBeNull();
  });

  it("prazo vencido devolve null", () => {
    expect(tempoRestantePausa(mais(-1), agora)).toBeNull();
  });
});
