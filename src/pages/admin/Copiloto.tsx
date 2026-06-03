import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Bot, Send, Sparkles, Loader2, User } from "lucide-react";
import { adminFetch } from "@/lib/adminApi";
import ReactMarkdown from "react-markdown";

interface ToolCall {
  nome: string;
  args: any;
  resultado: any;
  ok: boolean;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: ToolCall[];
  iteracoes?: number;
  pending?: boolean;
}

const SUGGESTIONS = [
  "Verificar status do sistema",
  "Corrigir URL do Evolution",
  "Quantos contatos com IA pausada?",
  "Diagnóstico completo",
];

export default function CopilotoPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: msg },
      { role: "assistant", content: "", pending: true },
    ]);
    setLoading(true);
    setLoadingProgress(0);
    const interval = setInterval(() => {
      setLoadingProgress(prev => {
        if (prev >= 95) return prev;
        return prev + (100 / 40); // 10s base
      });
    }, 250);

    try {
      const res = await adminFetch<{
        resposta: string;
        ferramentas_executadas: ToolCall[];
        iteracoes: number;
      }>("/api/suporte/diagnostico", { method: "POST", body: { mensagem: msg } });

      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: res.resposta,
          tools: res.ferramentas_executadas,
          iteracoes: res.iteracoes,
        };
        return copy;
      });
    } catch {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: "_Não foi possível obter resposta. Verifique os logs do servidor._",
        };
        return copy;
      });
    } finally {
      setLoading(false);
      setLoadingProgress(100);
      clearInterval(interval);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <CRMLayout>
      <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b">
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">Copiloto de Infraestrutura</h1>
          </div>
          <Badge variant="secondary">GPT-4o-mini</Badge>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <Bot className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Pergunte qualquer coisa sobre a infraestrutura do CRM.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
        </div>

        {/* Suggestions */}
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 pb-3">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-3 py-1.5 rounded-full border bg-muted/40 hover:bg-muted transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <div className="border-t pt-3 flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Digite sua pergunta… (Enter para enviar, Shift+Enter quebra linha)"
            rows={2}
            className="resize-none"
            disabled={loading}
          />
          <Button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            size="icon"
            className="h-[60px] w-[60px] shrink-0"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </CRMLayout>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5">
          <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
        </div>
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="h-4 w-4 text-primary" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
        <Bot className="h-4 w-4" />
      </div>
      <div className="max-w-[80%] space-y-2">
        <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5">
          {msg.pending ? (
            <div className="flex flex-col gap-2 py-2 min-w-[200px]">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs font-medium">Analisando infraestrutura...</span>
              </div>
              <div className="w-full bg-primary/10 h-1 rounded-full overflow-hidden">
                <div 
                  className="bg-primary h-full transition-all duration-300" 
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          )}
        </div>
        {msg.tools && msg.tools.length > 0 && (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="tools" className="border rounded-md">
              <AccordionTrigger className="px-3 py-2 text-xs">
                Ferramentas executadas ({msg.tools.length}) · {msg.iteracoes} iteraç{msg.iteracoes === 1 ? "ão" : "ões"}
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 space-y-2">
                {msg.tools.map((t, i) => (
                  <div key={i} className="border rounded p-2 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={t.ok ? "secondary" : "destructive"} className="text-[10px]">
                        {t.ok ? "OK" : "ERRO"}
                      </Badge>
                      <span className="font-mono font-semibold">{t.nome}</span>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted-foreground">args</summary>
                      <pre className="overflow-x-auto bg-background/50 p-2 rounded mt-1">
{JSON.stringify(t.args, null, 2)}
                      </pre>
                    </details>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted-foreground">resultado</summary>
                      <pre className="overflow-x-auto bg-background/50 p-2 rounded mt-1">
{JSON.stringify(t.resultado, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    </div>
  );
}
