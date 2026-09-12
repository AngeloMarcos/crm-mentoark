import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HealthCheck } from "./HealthCheck";

export function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full relative overflow-hidden bg-background">
        {/* Luz ambiente — bem discreta, só um respiro de laranja nos cantos */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-primary/10 blur-[160px] opacity-40" />
          <div className="absolute -bottom-48 -right-40 w-[36rem] h-[36rem] rounded-full bg-primary/[0.06] blur-[180px] opacity-40" />
        </div>

        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0 relative z-10">
          <AppHeader />
          {/* [AUDITORIA] FIX APLICADO (achado 2026-07-28 — "sistema todo muito grande"): padding
              reduzido em telas menores — soma com o padding interno de cada página (ex: chat do
              WhatsApp), então cada rem a menos aqui libera espaço real de conteúdo em tablet/
              mobile sem afetar desktop (`lg:p-6` preserva o valor original a partir daí). */}
          <main className="flex-1 overflow-auto p-2 sm:p-3 md:p-4 lg:p-6">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
          <HealthCheck />
        </div>
      </div>
    </SidebarProvider>
  );
}
