import { Link } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import ParticlesBackground from "@/components/ParticlesBackground";

export default function TermsPage() {
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
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <FileText className="h-5 w-5 text-purple-400" />
          </div>
          <h1 className="text-3xl font-bold">Termos de Uso</h1>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">1. Aceitação dos Termos</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Ao acessar e utilizar a plataforma MentoArk, você concorda em cumprir e estar vinculado a estes Termos de Uso. 
              Se você não concordar com qualquer parte destes termos, não deverá utilizar nossos serviços.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">2. Descrição do Serviço</h2>
            <p className="text-blue-100/70 leading-relaxed">
              A MentoArk é uma plataforma de CRM inteligente para automação comercial via WhatsApp. 
              Nossos serviços incluem gestão de contatos, campanhas de marketing, funis de vendas, 
              integração com APIs de mensagens e ferramentas de inteligência artificial para otimização de atendimento.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">3. Cadastro e Conta</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Para utilizar certos recursos da plataforma, você deve criar uma conta fornecendo informações precisas e completas. 
              Você é responsável por manter a confidencialidade de suas credenciais de acesso e por todas as atividades 
              realizadas em sua conta. Notifique-nos imediatamente sobre qualquer uso não autorizado.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">4. Uso Adequado</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Você concorda em utilizar a plataforma apenas para fins legais e de acordo com estes termos. 
              É estritamente proibido o uso da MentoArk para:
            </p>
            <ul className="mt-2 ml-6 list-disc text-blue-100/70 space-y-1">
              <li>Enviar spam, mensagens não solicitadas ou conteúdo ofensivo</li>
              <li>Violar leis de proteção de dados ou privacidade</li>
              <li>Realizar atividades fraudulentas ou enganosas</li>
              <li>Tentar acessar dados de outros usuários sem autorização</li>
              <li>Distribuir malware ou qualquer código malicioso</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">5. Propriedade Intelectual</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Todo o conteúdo, software, tecnologia e materiais disponibilizados pela MentoArk são protegidos por 
              direitos autorais, marcas registradas e outras leis de propriedade intelectual. 
              Você recebe uma licença limitada, não exclusiva e revogável para usar a plataforma conforme previsto nestes termos.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">6. Limitação de Responsabilidade</h2>
            <p className="text-blue-100/70 leading-relaxed">
              A MentoArk não será responsável por danos indiretos, incidentais, especiais ou consequenciais 
              resultantes do uso ou incapacidade de uso da plataforma. Nosso serviço é fornecido "como está", 
              sem garantias de qualquer tipo, expressas ou implícitas.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">7. Modificações nos Termos</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Reservamo-nos o direito de modificar estes Termos de Uso a qualquer momento. 
              As alterações entrarão em vigor imediatamente após a publicação. 
              O uso continuado da plataforma após quaisquer mudanças constitui aceitação dos novos termos.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-purple-300 mb-3">8. Contato</h2>
            <p className="text-blue-100/70 leading-relaxed">
              Em caso de dúvidas sobre estes Termos de Uso, entre em contato conosco pelo e-mail: 
              <a href="mailto:suporte@mentoark.com.br" className="text-purple-300 hover:text-white underline ml-1">
                suporte@mentoark.com.br
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
