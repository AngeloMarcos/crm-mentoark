import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AuthProvider } from "@/hooks/useAuth";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import TermsPage from "./pages/Terms";
import PrivacyPage from "./pages/Privacy";
import DashboardPage from "./pages/Dashboard";
import LeadsPage from "./pages/Leads";
import TagsPage from "./pages/Tags";
import ContatosPage from "./pages/Contatos";
import ContatoDetalhePage from "./pages/ContatoDetalhe";
import DiscagemPage from "./pages/Discagem";
import FunilPage from "./pages/Funil";
import WhatsAppPage from "./pages/WhatsApp";
import SLAPage from "./pages/SLA";
import RespostasRapidasPage from "./pages/RespostasRapidas";
import DisparosPage from "./pages/Disparos";
import CampanhasPage from "./pages/Campanhas";
import IntegracoesPage from "./pages/Integracoes";
import CerebroPage from "./pages/Cerebro";
import AgentesPage from "./pages/Agentes";
import UsuariosPage from "./pages/Usuarios";
import CatalogoPage from "./pages/Catalogo";
import CatalogoDetalhePage from "./pages/CatalogoDetalhe";
import CatalogoEnviosPage from "./pages/CatalogoEnvios";
import GaleriaPage from "./pages/Galeria";
import WorkflowsPage from "./pages/Workflows";
import DocsPage from "./pages/Docs";
import CentralBIPage from "./pages/CentralBI";
import MarketingDigitalPage from "./pages/MarketingDigital";
import SegurancaPage from "./pages/Seguranca";
import ChatEquipePage from "./pages/ChatEquipe";
import SmartLinksPage from "./pages/SmartLinks";
import NotFound from "./pages/NotFound";
import TestesPausa from "./pages/TestesPausa";
import SimuladorWebhook from "./pages/SimuladorWebhook";
import TesteConversas from "./pages/TesteConversas";
import MonitorWhatsApp from "./pages/MonitorWhatsApp";
import PerfilPage from "./pages/Perfil";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/termos" element={<TermsPage />} />
              <Route path="/privacidade" element={<PrivacyPage />} />

              <Route path="/dashboard"    element={<ProtectedRoute requireModulo="dashboard">  <DashboardPage /></ProtectedRoute>} />
              <Route path="/bi"           element={<ProtectedRoute requireModulo="dashboard">  <CentralBIPage /></ProtectedRoute>} />
              <Route path="/leads"        element={<ProtectedRoute requireModulo="leads">       <LeadsPage /></ProtectedRoute>} />
              <Route path="/tags-funil"   element={<ProtectedRoute requireModulo="leads">       <TagsPage /></ProtectedRoute>} />
              <Route path="/contatos"     element={<ProtectedRoute requireModulo="contatos">    <ContatosPage /></ProtectedRoute>} />
              <Route path="/contatos/:id" element={<ProtectedRoute requireModulo="contatos">    <ContatoDetalhePage /></ProtectedRoute>} />
              <Route path="/discagem"     element={<ProtectedRoute requireModulo="discagem">    <DiscagemPage /></ProtectedRoute>} />
              <Route path="/funil"        element={<ProtectedRoute requireModulo="funil">       <FunilPage /></ProtectedRoute>} />
              <Route path="/whatsapp"     element={<ProtectedRoute requireModulo="whatsapp">    <WhatsAppPage /></ProtectedRoute>} />
              <Route path="/sla"          element={<ProtectedRoute requireModulo="whatsapp">    <SLAPage /></ProtectedRoute>} />
              <Route path="/monitor-whatsapp" element={<ProtectedRoute requireModulo="whatsapp"> <MonitorWhatsApp /></ProtectedRoute>} />
              <Route path="/respostas-rapidas" element={<ProtectedRoute requireModulo="whatsapp"> <RespostasRapidasPage /></ProtectedRoute>} />
              <Route path="/disparos"     element={<ProtectedRoute requireModulo="disparos">    <DisparosPage /></ProtectedRoute>} />
              <Route path="/campanhas"    element={<ProtectedRoute requireModulo="campanhas">   <CampanhasPage /></ProtectedRoute>} />
              <Route path="/marketing-digital" element={<ProtectedRoute requireModulo="campanhas"> <MarketingDigitalPage /></ProtectedRoute>} />
              <Route path="/integracoes"  element={<ProtectedRoute requireAdmin> <IntegracoesPage /></ProtectedRoute>} />
              <Route path="/cerebro"      element={<ProtectedRoute requireAdmin>     <CerebroPage /></ProtectedRoute>} />
              <Route path="/agentes"      element={<ProtectedRoute requireAdmin>     <AgentesPage /></ProtectedRoute>} />
              <Route path="/catalogo"     element={<ProtectedRoute requireModulo="catalogo">    <CatalogoPage /></ProtectedRoute>} />
              <Route path="/catalogo/:id" element={<ProtectedRoute requireModulo="catalogo">    <CatalogoDetalhePage /></ProtectedRoute>} />
              <Route path="/catalogo/envios" element={<ProtectedRoute requireModulo="catalogo"> <CatalogoEnviosPage /></ProtectedRoute>} />
              <Route path="/galeria"      element={<ProtectedRoute requireModulo="galeria">     <GaleriaPage /></ProtectedRoute>} />
              <Route path="/workflows"    element={<ProtectedRoute requireAdmin>   <WorkflowsPage /></ProtectedRoute>} />
              <Route path="/docs"         element={<ProtectedRoute requireModulo="docs">        <DocsPage /></ProtectedRoute>} />
              <Route path="/usuarios"     element={<ProtectedRoute requireAdmin>               <UsuariosPage /></ProtectedRoute>} />
              <Route path="/seguranca"    element={<ProtectedRoute requireAdmin>               <SegurancaPage /></ProtectedRoute>} />
              <Route path="/chat-equipe"  element={<ProtectedRoute requireModulo="whatsapp">   <ChatEquipePage /></ProtectedRoute>} />
              <Route path="/smart-links"  element={<ProtectedRoute requireModulo="whatsapp">   <SmartLinksPage /></ProtectedRoute>} />

              {import.meta.env.DEV && (
                <>
                  <Route path="/dev/testes-pausa" element={<TestesPausa />} />
                  <Route path="/dev/simulador-webhook" element={<SimuladorWebhook />} />
                  <Route path="/dev/teste-conversas" element={<TesteConversas />} />
                </>
              )}

              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
