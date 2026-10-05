import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatWaPhone, resolveDisplayName, normalizeMessageType, stripWhatsAppMarkup,
  renderWhatsAppText, snippetAround, cleanPushName,
} from "./whatsappFormat";

const html = (t: string, hl?: string) => renderToStaticMarkup(<>{renderWhatsAppText(t, hl)}</>);

describe("formatWaPhone", () => {
  it("formata celular e fixo BR", () => {
    expect(formatWaPhone("5511995705436")).toBe("+55 (11) 99570-5436");
    expect(formatWaPhone("551133334444")).toBe("+55 (11) 3333-4444");
  });
  it("não aplica máscara BR em ID @lid (14+ dígitos)", () => {
    expect(formatWaPhone("96645555474650")).toBeNull();
    expect(formatWaPhone("220825844211736")).toBeNull();
    expect(formatWaPhone("123@lid")).toBeNull();
  });
  it("estrangeiro vira +DDI", () => {
    expect(formatWaPhone("14155552671")).toBe("+14155552671");
  });
});

describe("resolveDisplayName", () => {
  it("troca a máscara errada do backend por fallback", () => {
    const r = resolveDisplayName({ name: "966(45) 55547-4650", sessionId: "96645555474650" });
    expect(r).toEqual({ name: "Contato sem nome", isFallback: true });
  });
  it("usa pushName quando o nome é '.'", () => {
    expect(resolveDisplayName({ name: ".", pushName: "~Charles Frederik", sessionId: "5511995705436" }))
      .toEqual({ name: "Charles Frederik", isFallback: false });
  });
  it("cai no telefone formatado", () => {
    expect(resolveDisplayName({ name: "(11) 99570-5436", sessionId: "5511995705436" }).name).toBe("+55 (11) 99570-5436");
  });
  it("mantém nome válido", () => {
    expect(resolveDisplayName({ name: "Lavanderia", sessionId: "5511995705436" }).name).toBe("Lavanderia");
  });
});

describe("normalizeMessageType", () => {
  it("converge tipos crus da Evolution", () => {
    expect(normalizeMessageType("imageMessage")).toBe("image");
    expect(normalizeMessageType("extendedTextMessage")).toBe("text");
    expect(normalizeMessageType("protocolMessage")).toBe("hidden");
    expect(normalizeMessageType("reactionMessage")).toBe("reaction");
    expect(normalizeMessageType("algoNovoMessage")).toBe("unknown");
  });
});

describe("marcação do WhatsApp", () => {
  it("negrito, itálico, tachado", () => {
    expect(html("*JA COLOCA NO CARRINHO!*")).toContain("<strong");
    const s = html("_~R$ 285,57~_");
    expect(s).toContain("<em>");
    expect(s).toContain("<s>");
  });
  it("não formata dentro de palavra nem de URL", () => {
    expect(html("snake_case_name")).not.toContain("<em>");
    expect(html("2*3*4")).not.toContain("<strong");
    const s = html("veja https://site.com/a_b_c agora");
    expect(s).not.toContain("<em>");
    expect(s).toContain('href="https://site.com/a_b_c"');
  });
  it("linkifica e tira pontuação final", () => {
    const s = html("Oferta: https://s.shopee.com.br/abc123.");
    expect(s).toContain('href="https://s.shopee.com.br/abc123"');
    expect(s).toContain('target="_blank"');
    expect(s).toContain('rel="noopener noreferrer"');
    expect(html("www.exemplo.com")).toContain('href="https://www.exemplo.com"');
  });
  it("escapa HTML", () => {
    expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
  });
  it("destaca termo buscado", () => {
    expect(html("promo shopee hoje", "shopee")).toContain("<mark");
  });
  it("preview remove marcadores", () => {
    expect(stripWhatsAppMarkup("*Angelo*: _oi_ ~x~")).toBe("Angelo: oi x");
  });
  it("snippet centrado no termo", () => {
    const long = "a".repeat(300) + " shopee " + "b".repeat(300);
    const sn = snippetAround(long, "shopee", 20);
    expect(sn).toContain("shopee");
    expect(sn.startsWith("…")).toBe(true);
  });
  it("cleanPushName", () => {
    expect(cleanPushName("Fulano (grupo)")).toBe("Fulano");
    expect(cleanPushName("~Charles")).toBe("Charles");
  });
});
