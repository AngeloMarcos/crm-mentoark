/**
 * Seções da aba "Configurações" do agente (Sprint IA-1, 2026-10-29), no modelo do Cubo: conversa,
 * histórico, formato da resposta e persona. Todo campo vazio/"padrão" grava NULL e o motor
 * (backend/src/services/agenteConversa.ts) mantém o comportamento de antes.
 */
import type { ReactNode } from "react";
import { History, MessageSquareText, Scissors, UserCog } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface ConversaAgente {
  tempo_espera_mensagem: number | null;
  historico_mensagens: number | null;
  historico_max_tokens: number | null;
  divisao_ativa: boolean | null;
  divisao_modo: "paragrafos" | "caracteres" | null;
  divisao_tamanho: number | null;
  divisao_intervalo_ms: number | null;
  emoji_politica: "off" | "low" | "normal" | "high" | null;
  assinatura_ativa: boolean | null;
  assinatura_texto: string | null;
  idioma_forcado: string | null;
  mensagem_erro: string | null;
}

export const CONVERSA_PADRAO: ConversaAgente = {
  tempo_espera_mensagem: null, historico_mensagens: null, historico_max_tokens: null,
  divisao_ativa: null, divisao_modo: null, divisao_tamanho: null, divisao_intervalo_ms: null,
  emoji_politica: null, assinatura_ativa: null, assinatura_texto: null, idioma_forcado: null,
  mensagem_erro: null,
};

/** Lê da linha do agente (colunas ausentes ou NULL = padrão). */
export function conversaDoAgente(a: Partial<Record<keyof ConversaAgente, unknown>>): ConversaAgente {
  const saida = { ...CONVERSA_PADRAO } as Record<string, unknown>;
  for (const k of Object.keys(CONVERSA_PADRAO)) {
    const v = a[k as keyof ConversaAgente];
    if (v !== undefined && v !== null && v !== "") saida[k] = v;
  }
  return saida as unknown as ConversaAgente;
}

/** Para o payload de gravação: texto vazio vira NULL. */
export function conversaParaSalvar(c: ConversaAgente): ConversaAgente {
  const t = (v: string | null) => (v && v.trim() ? v.trim() : null);
  return { ...c, assinatura_texto: t(c.assinatura_texto), idioma_forcado: t(c.idioma_forcado), mensagem_erro: t(c.mensagem_erro) };
}

const numOuNulo = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v)));
const PADRAO = "__padrao";

function Secao({ icone, titulo, descricao, children }: { icone: ReactNode; titulo: string; descricao: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-4 bg-muted/20 space-y-4">
      <div>
        <div className="flex items-center gap-2 text-primary">
          {icone}
          <h3 className="font-semibold">{titulo}</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{descricao}</p>
      </div>
      {children}
    </div>
  );
}

function Campo({ label, ajuda, children }: { label: string; ajuda: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      <p className="text-xs text-muted-foreground">{ajuda}</p>
    </div>
  );
}

export function SecoesConversaAgente({ valor, onChange }: { valor: ConversaAgente; onChange: (v: ConversaAgente) => void }) {
  const set = <K extends keyof ConversaAgente>(k: K, v: ConversaAgente[K]) => onChange({ ...valor, [k]: v });
  const divisao = valor.divisao_ativa === null ? PADRAO : valor.divisao_ativa ? "sim" : "nao";
  const assinatura = valor.assinatura_ativa === null ? PADRAO : valor.assinatura_ativa ? "fim" : "nenhuma";

  return (
    <>
      <Secao icone={<MessageSquareText className="h-5 w-5" />} titulo="Conversa" descricao="Como o agente recebe as mensagens do contato.">
        <Campo
          label="Espera para agrupar mensagens (segundos)"
          ajuda="Se o contato manda várias mensagens seguidas, todas dentro desse intervalo viram uma só pergunta para a IA. Padrão: 3 s. Máximo: 60 s."
        >
          <Input type="number" min={1} max={60} placeholder="3" className="sm:w-[200px]"
            value={valor.tempo_espera_mensagem ?? ""}
            onChange={(e) => set("tempo_espera_mensagem", numOuNulo(e.target.value))} />
        </Campo>
      </Secao>

      <Secao icone={<History className="h-5 w-5" />} titulo="Histórico da conversa" descricao="Quanto da conversa anterior a IA lê a cada nova mensagem. Mais histórico = mais memória e mais custo.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Mensagens do histórico" ajuda="Quantas mensagens anteriores a IA lembra. Padrão: 20. Máximo: 100.">
            <Input type="number" min={1} max={100} placeholder="20"
              value={valor.historico_mensagens ?? ""}
              onChange={(e) => set("historico_mensagens", numOuNulo(e.target.value))} />
          </Campo>
          <Campo label="Tokens máx. do histórico" ajuda="Teto de tamanho do histórico. Acima dele, as mensagens mais antigas saem primeiro. Vazio: sem teto. Sugestão: 8000.">
            <Input type="number" min={500} step={500} placeholder="sem teto"
              value={valor.historico_max_tokens ?? ""}
              onChange={(e) => set("historico_max_tokens", numOuNulo(e.target.value))} />
          </Campo>
        </div>
      </Secao>

      <Secao icone={<Scissors className="h-5 w-5" />} titulo="Formato da resposta" descricao="Como a resposta chega no WhatsApp. Várias mensagens curtas parecem mais naturais que um textão.">
        <Campo label="Dividir respostas longas" ajuda="Padrão: até 2 mensagens (o último parágrafo vai separado). O marcador [QUEBRA] no texto da IA sempre separa, exceto em “Não dividir”.">
          <Select value={divisao} onValueChange={(v) => set("divisao_ativa", v === PADRAO ? null : v === "sim")}>
            <SelectTrigger className="sm:w-[320px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={PADRAO}>Padrão (até 2 mensagens)</SelectItem>
              <SelectItem value="sim">Dividir em várias mensagens</SelectItem>
              <SelectItem value="nao">Não dividir (uma mensagem só)</SelectItem>
            </SelectContent>
          </Select>
        </Campo>
        {valor.divisao_ativa === true && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo label="Modo de divisão" ajuda="Cortar a cada parágrafo ou a cada X caracteres (sem partir palavras).">
              <Select value={valor.divisao_modo ?? "paragrafos"} onValueChange={(v) => set("divisao_modo", v as ConversaAgente["divisao_modo"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paragrafos">Por parágrafo</SelectItem>
                  <SelectItem value="caracteres">Por caracteres</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label={valor.divisao_modo === "caracteres" ? "Caracteres por mensagem" : "Parágrafos por mensagem"}
              ajuda={valor.divisao_modo === "caracteres" ? "Padrão: 300." : "Padrão: 1."}>
              <Input type="number" min={1} placeholder={valor.divisao_modo === "caracteres" ? "300" : "1"}
                value={valor.divisao_tamanho ?? ""}
                onChange={(e) => set("divisao_tamanho", numOuNulo(e.target.value))} />
            </Campo>
          </div>
        )}
        <Campo label="Intervalo entre as mensagens (ms)" ajuda="Pausa entre cada parte enviada. Padrão: 3000 ms. Cerca de 1500 ms parece alguém digitando.">
          <Input type="number" min={0} max={15000} step={100} placeholder="3000" className="sm:w-[200px]"
            value={valor.divisao_intervalo_ms ?? ""}
            onChange={(e) => set("divisao_intervalo_ms", numOuNulo(e.target.value))} />
        </Campo>
      </Secao>

      <Secao icone={<UserCog className="h-5 w-5" />} titulo="Comportamento e persona" descricao="Como o agente se apresenta e escreve. A IA sempre se identifica como assistente virtual na primeira mensagem (política da Meta).">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Uso de emojis" ajuda="Padrão: o que estiver no prompt.">
            <Select value={valor.emoji_politica ?? PADRAO} onValueChange={(v) => set("emoji_politica", v === PADRAO ? null : (v as ConversaAgente["emoji_politica"]))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PADRAO}>Seguir o prompt</SelectItem>
                <SelectItem value="off">Nenhum</SelectItem>
                <SelectItem value="low">Pouco (até 1 por mensagem)</SelectItem>
                <SelectItem value="normal">Normal (2 a 3 por mensagem)</SelectItem>
                <SelectItem value="high">Bastante</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Idioma forçado" ajuda="Automático: responde no idioma do contato.">
            <Select value={valor.idioma_forcado ?? PADRAO} onValueChange={(v) => set("idioma_forcado", v === PADRAO ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PADRAO}>Automático (do contato)</SelectItem>
                <SelectItem value="português do Brasil">Português do Brasil</SelectItem>
                <SelectItem value="inglês">Inglês</SelectItem>
                <SelectItem value="espanhol">Espanhol</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
        </div>
        <Campo label="Assinatura" ajuda="Padrão: o nome de exibição em negrito no topo de cada mensagem.">
          <Select value={assinatura} onValueChange={(v) => set("assinatura_ativa", v === PADRAO ? null : v === "fim")}>
            <SelectTrigger className="sm:w-[320px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={PADRAO}>Nome de exibição no topo (padrão)</SelectItem>
              <SelectItem value="fim">Texto próprio no fim de cada mensagem</SelectItem>
              <SelectItem value="nenhuma">Sem assinatura</SelectItem>
            </SelectContent>
          </Select>
        </Campo>
        {valor.assinatura_ativa === true && (
          <Campo label="Texto da assinatura" ajuda="Pode ter quebra de linha. Ex.: nome do agente e site da empresa.">
            <Textarea rows={2} placeholder="— Stella, MentoArk"
              value={valor.assinatura_texto ?? ""}
              onChange={(e) => set("assinatura_texto", e.target.value)} />
          </Campo>
        )}
        <Campo label="Mensagem de erro" ajuda="Enviada ao contato quando a IA falha por instabilidade (rede, tempo esgotado). Chave recusada ou falta de crédito não enviam nada: a conversa vai para um humano. Vazio: não envia nada.">
          <Textarea rows={2} placeholder="Desculpe, tive uma instabilidade aqui. Pode me mandar sua mensagem de novo?"
            value={valor.mensagem_erro ?? ""}
            onChange={(e) => set("mensagem_erro", e.target.value)} />
        </Campo>
      </Secao>
    </>
  );
}
