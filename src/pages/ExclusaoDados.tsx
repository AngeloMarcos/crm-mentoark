import { Link } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ParticlesBackground from "@/components/ParticlesBackground";

// [AUDITORIA] LÓGICA (Sprint API Oficial WhatsApp, 2026-09-07): página nova, pedida pela
// checklist de App Review da Meta (Meta for Developers → Configurações Básicas do App exige uma
// "URL de instruções de exclusão de dados" — separada da Política de Privacidade geral, com
// passo a passo específico de como o usuário solicita a exclusão). Rota pública (`/exclusao-de-dados`,
// registrada em App.tsx fora do <ProtectedRoute>, mesmo padrão de /termos e /privacidade) — o
// reviewer da Meta acessa sem login. Conteúdo só descreve o processo real já coberto pela seção
// "Direitos" da Política de Privacidade (Privacy.tsx) — não cria nenhum endpoint/callback novo,
// só documenta por e-mail (opção suportada pela Meta como alternativa ao callback de API).
export default function ExclusaoDadosPage() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#1a1c2c] via-[#4a1942] to-[#0f172a] text-white overflow-hidden">
      <ParticlesBackground showContrastToggle />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[40rem] h-[40rem] rounded-full bg-purple-600/10 blur-[120px]" />
        <div className="absolute -bottom-40 -right-32 w-[40rem] h-[40rem] rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <Button asChild variant="ghost" className="text-purple-300 hover:text-white gap-2 -ml-4">
            <Link to="/login">
              <ArrowLeft className="h-4 w-4" />
              Voltar para o Login
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <Trash2 className="h-5 w-5 text-red-400" />
          </div>
          <h1 className="text-3xl font-bold">Instruções de Exclusão de Dados</h1>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl space-y-8">
          <section>
            <p className="text-blue-100/70 leading-relaxed">
              Esta página explica como solicitar a exclusão dos seus dados pessoais e de qualquer
              informação associada à sua conta na plataforma MentoArk, incluindo dados sincronizados
              através de integrações conectadas (como WhatsApp Business Platform / Meta).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">Como solicitar</h2>
            <ol className="mt-2 ml-6 list-decimal text-blue-100/70 space-y-2">
              <li>
                Envie um e-mail para{" "}
                <a
                  href="mailto:privacidade@mentoark.com.br?subject=Solicita%C3%A7%C3%A3o%20de%20exclus%C3%A3o%20de%20dados"
                  className="text-purple-300 hover:text-white underline"
                >
                  privacidade@mentoark.com.br
                </a>{" "}
                a partir do endereço de e-mail cadastrado na sua conta, com o assunto
                "Solicitação de exclusão de dados".
              </li>
              <li>
                Informe o nome completo ou nome da empresa vinculado à conta, para localizarmos o
                cadastro correto.
              </li>
              <li>
                Confirmaremos o recebimento em até 2 dias úteis e concluiremos a exclusão em até
                15 dias úteis, conforme previsto na LGPD (Lei nº 13.709/2018).
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">O que é excluído</h2>
            <ul className="mt-2 ml-6 list-disc text-blue-100/70 space-y-1">
              <li>Dados de cadastro (nome, e-mail, telefone, empresa)</li>
              <li>Contatos, conversas e histórico de mensagens de WhatsApp associados à conta</li>
              <li>
                Credenciais e configurações de integrações conectadas (Evolution API, WhatsApp API
                Oficial/Meta, provedores de IA) — os tokens/segredos são removidos do banco de dados
                e não são reutilizáveis após a exclusão
              </li>
              <li>Templates, campanhas e demais dados operacionais gerados na conta</li>
            </ul>
            <p className="text-blue-100/70 leading-relaxed mt-3">
              Dados que a lei exige manter por período determinado (ex: registros fiscais) são
              retidos apenas pelo prazo legal e depois eliminados, conforme a seção "Retenção de
              Dados" da nossa{" "}
              <Link to="/privacidade" className="text-purple-300 hover:text-white underline">
                Política de Privacidade
              </Link>
              .
            </p>
          </section>

          <div className="pt-6 border-t border-white/10 text-center text-sm text-white/40">
            Última atualização: {new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>
    </div>
  );
}
