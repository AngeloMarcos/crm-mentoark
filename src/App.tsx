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
import DiscagemPage from "./pages/Discagem";
import FunilPage from "./pages/Funil";
import WhatsAppPage from "./pages/WhatsApp";
import DisparosPage from "./pages/Disparos";
import CampanhasPage from "./pages/Campanhas";
import IntegracoesPage from "./pages/Integracoes";
import CerebroPage from "./pages/Cerebro";
import AgentesPage from "./pages/Agentes";
import UsuariosPage from "./pages/Usuarios";
import WorkflowsPage from "./pages/Workflows";
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
              <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
              <Route path="/leads" element={<ProtectedRoute><LeadsPage /></ProtectedRoute>} />
              <Route path="/discagem" element={<ProtectedRoute><DiscagemPage /></ProtectedRoute>} />
              <Route path="/funil" element={<ProtectedRoute><FunilPage /></ProtectedRoute>} />
              <Route path="/whatsapp" element={<ProtectedRoute><WhatsAppPage /></ProtectedRoute>} />
              <Route path="/disparos" element={<ProtectedRoute><DisparosPage /></ProtectedRoute>} />
              <Route path="/campanhas" element={<ProtectedRoute><CampanhasPage /></ProtectedRoute>} />
              <Route path="/integracoes" element={<ProtectedRoute><IntegracoesPage /></ProtectedRoute>} />
              <Route path="/cerebro" element={<ProtectedRoute><CerebroPage /></ProtectedRoute>} />
              <Route path="/agentes" element={<ProtectedRoute><AgentesPage /></ProtectedRoute>} />
              <Route path="/workflows" element={<ProtectedRoute><WorkflowsPage /></ProtectedRoute>} />
              <Route path="/usuarios" element={<ProtectedRoute requireAdmin><UsuariosPage /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
