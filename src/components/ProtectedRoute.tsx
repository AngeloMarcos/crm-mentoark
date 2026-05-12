import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireModulo?: string;
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireModulo,
}: ProtectedRouteProps) {
  const { user, isAdmin, loading, hasModulo, modulosLoading } = useAuth();

  if (loading || modulosLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (requireAdmin && !isAdmin) return <Navigate to="/dashboard" replace />;
  if (requireModulo && !hasModulo(requireModulo)) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
