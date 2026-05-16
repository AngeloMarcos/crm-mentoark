import { Link } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import ParticlesBackground from "@/components/ParticlesBackground";

export default function PrivacyPage() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#1a1c2c] via-[#4a1942] to-[#0f172a] text-white overflow-hidden">
      <ParticlesBackground />
      
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
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Shield className="h-5 w-5 text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold">Política de Privacidade</h1>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">1. Introdução</h2>
            <p className="text-blue-100/70 leading-relaxed">
              A MentoArk está comprometida com a proteção de suas informações pessoais. 
              Esta Política de Privacidade descreve como coletamos, usamos, armazenamos e protegemos 
              seus dados quando você utiliza nossa plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">2. Dados Coletados</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Podemos coletar as seguintes categorias de dados:
            </p>
            <ul className="mt-2 ml-6 list-disc text-blue-100/70 space-y-1">
              <li><strong>Informações de cadastro:</strong> nome, e-mail, telefone, nome da empresa</li>
              <li><strong>Dados de uso:</strong> interações com a plataforma, funcionalidades acessadas</li>
              <li><strong>Dados de contatos:</strong> informações de clientes e leads inseridas por você</li>
              <li><strong>Dados técnicos:</strong> endereço IP, tipo de navegador, logs de acesso</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">3. Uso das Informações</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Utilizamos seus dados para:
            </p>
            <ul className="mt-2 ml-6 list-disc text-blue-100/70 space-y-1">
              <li>Fornecer, operar e melhorar nossos serviços</li>
              <li>Processar transações e gerenciar sua conta</li>
              <li>Enviar comunicações sobre atualizações, alertas técnicos e novidades</li>
              <li>Personalizar sua experiência e oferecer suporte técnico</li>
              <li>Cumprir obrigações legais e regulatórias</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">4. Compartilhamento de Dados</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Não vendemos ou alugamos suas informações pessoais a terceiros. 
              Podemos compartilhar dados apenas com:
            </p>
            <ul className="mt-2 ml-6 list-disc text-blue-100/70 space-y-1">
              <li>Prestadores de serviços essenciais à operação da plataforma (cloud, processamento de pagamentos)</li>
              <li>Autoridades legais quando exigido por lei ou ordem judicial</li>
              <li>Parceiros de integração, mediante sua autorização explícita</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">5. Segurança</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Adotamos medidas técnicas e organizacionais robustas para proteger seus dados, 
              incluindo criptografia em trânsito e em repouso, controle de acesso baseado em funções, 
              monitoramento contínuo e auditorias regulares de segurança.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">6. Seus Direitos</h2>
            <p className="text-blue-100/70 leading-relaxed">
              De acordo com a Lei Geral de Proteção de Dados (LGPD), você tem o direito de:
            </p>
            <ul className="mt-2 ml-6 list-disc text-blue-100/70 space-y-1">
              <li>Acessar, corrigir ou excluir seus dados pessoais</li>
              <li>Revogar consentimentos previamente fornecidos</li>
              <li>Solicitar portabilidade dos dados</li>
              <li>Obter informações sobre o tratamento de seus dados</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">7. Retenção de Dados</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Mantemos seus dados pelo tempo necessário para cumprir as finalidades descritas nesta política 
              ou conforme exigido por lei. Após o encerramento da conta, seus dados serão excluídos ou anonimizados 
              dentro de um prazo razoável, salvo obrigações legais de retenção.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">8. Contato</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Para exercer seus direitos ou esclarecer dúvidas sobre esta Política de Privacidade, 
              entre em contato conosco pelo e-mail: 
              <a href="mailto:privacidade@mentoark.com.br" className="text-purple-300 hover:text-white underline ml-1">
                privacidade@mentoark.com.br
              </a>
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
