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
import FunilPage from "./pages/Funil";
import WhatsAppPage from "./pages/WhatsApp";
import CampanhasPage from "./pages/Campanhas";
import IntegracoesPage from "./pages/Integracoes";
import CerebroPage from "./pages/Cerebro";
import UsuariosPage from "./pages/Usuarios";
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
              <Route path="/funil" element={<ProtectedRoute><FunilPage /></ProtectedRoute>} />
              <Route path="/whatsapp" element={<ProtectedRoute><WhatsAppPage /></ProtectedRoute>} />
              <Route path="/campanhas" element={<ProtectedRoute><CampanhasPage /></ProtectedRoute>} />
              <Route path="/integracoes" element={<ProtectedRoute><IntegracoesPage /></ProtectedRoute>} />
              <Route path="/cerebro" element={<ProtectedRoute><CerebroPage /></ProtectedRoute>} />
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
