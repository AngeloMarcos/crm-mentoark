import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AuthProvider } from "@/hooks/useAuth";
import LoginPage from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import LeadsPage from "./pages/Leads";
import ContatosPage from "./pages/Contatos";
import ContatoDetalhePage from "./pages/ContatoDetalhe";
import DiscagemPage from "./pages/Discagem";
import FunilPage from "./pages/Funil";
import WhatsAppPage from "./pages/WhatsApp";
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
import NotFound from "./pages/NotFound";

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

              <Route path="/dashboard"    element={<ProtectedRoute requireModulo="dashboard">  <DashboardPage /></ProtectedRoute>} />
              <Route path="/leads"        element={<ProtectedRoute requireModulo="leads">       <LeadsPage /></ProtectedRoute>} />
              <Route path="/contatos"     element={<ProtectedRoute requireModulo="contatos">    <ContatosPage /></ProtectedRoute>} />
              <Route path="/contatos/:id" element={<ProtectedRoute requireModulo="contatos">    <ContatoDetalhePage /></ProtectedRoute>} />
              <Route path="/discagem"     element={<ProtectedRoute requireModulo="discagem">    <DiscagemPage /></ProtectedRoute>} />
              <Route path="/funil"        element={<ProtectedRoute requireModulo="funil">       <FunilPage /></ProtectedRoute>} />
              <Route path="/whatsapp"     element={<ProtectedRoute requireModulo="whatsapp">    <WhatsAppPage /></ProtectedRoute>} />
              <Route path="/disparos"     element={<ProtectedRoute requireModulo="disparos">    <DisparosPage /></ProtectedRoute>} />
              <Route path="/campanhas"    element={<ProtectedRoute requireModulo="campanhas">   <CampanhasPage /></ProtectedRoute>} />
              <Route path="/integracoes"  element={<ProtectedRoute requireModulo="integracoes"> <IntegracoesPage /></ProtectedRoute>} />
              <Route path="/cerebro"      element={<ProtectedRoute requireModulo="cerebro">     <CerebroPage /></ProtectedRoute>} />
              <Route path="/agentes"      element={<ProtectedRoute requireModulo="agentes">     <AgentesPage /></ProtectedRoute>} />
              <Route path="/catalogo"     element={<ProtectedRoute requireModulo="catalogo">    <CatalogoPage /></ProtectedRoute>} />
              <Route path="/catalogo/:id" element={<ProtectedRoute requireModulo="catalogo">    <CatalogoDetalhePage /></ProtectedRoute>} />
              <Route path="/catalogo/envios" element={<ProtectedRoute requireModulo="catalogo"> <CatalogoEnviosPage /></ProtectedRoute>} />
              <Route path="/galeria"      element={<ProtectedRoute requireModulo="galeria">     <GaleriaPage /></ProtectedRoute>} />
              <Route path="/workflows"    element={<ProtectedRoute requireModulo="workflows">   <WorkflowsPage /></ProtectedRoute>} />
              <Route path="/docs"         element={<ProtectedRoute requireModulo="docs">        <DocsPage /></ProtectedRoute>} />
              <Route path="/usuarios"     element={<ProtectedRoute requireAdmin>               <UsuariosPage /></ProtectedRoute>} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
