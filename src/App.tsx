import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import LoginPage from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import LeadsPage from "./pages/Leads";
import FunilPage from "./pages/Funil";
import WhatsAppPage from "./pages/WhatsApp";
import CampanhasPage from "./pages/Campanhas";
import IntegracoesPage from "./pages/Integracoes";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/funil" element={<FunilPage />} />
            <Route path="/whatsapp" element={<WhatsAppPage />} />
            <Route path="/campanhas" element={<CampanhasPage />} />
            <Route path="/integracoes" element={<IntegracoesPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
