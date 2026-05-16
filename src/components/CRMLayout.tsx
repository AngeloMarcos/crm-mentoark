import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full relative overflow-hidden bg-background">
        {/* Orbs de luz ambiente */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/30 blur-[100px] opacity-40 animate-pulse-slow" />
          <div className="absolute top-1/4 -right-32 w-[30rem] h-[30rem] rounded-full bg-accent/25 blur-[120px] opacity-30 animate-float" />
          <div className="absolute -bottom-40 left-1/4 w-[35rem] h-[35rem] rounded-full bg-primary/20 blur-[140px] opacity-25 animate-float-delayed" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] rounded-full bg-blue-500/10 blur-[150px] opacity-20 animate-pulse-slow" />
        </div>

        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0 relative z-10">
          <AppHeader />
          <main className="flex-1 overflow-auto p-4 md:p-6">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
