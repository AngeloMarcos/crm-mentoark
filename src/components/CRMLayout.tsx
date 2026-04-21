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
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/20 blur-3xl opacity-30" />
          <div className="absolute top-1/3 -right-32 w-[28rem] h-[28rem] rounded-full bg-accent/20 blur-3xl opacity-25" />
          <div className="absolute -bottom-40 left-1/3 w-[32rem] h-[32rem] rounded-full bg-primary/15 blur-3xl opacity-20" />
        </div>

        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0 relative z-10">
          <AppHeader />
          <main className="flex-1 overflow-auto p-6">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
