import { Badge } from "@/components/ui/badge";
import { Server, Zap } from 'lucide-react';


interface StatusCardProps {
  title: string;
  status: 'online' | 'offline' | 'loading';
  info?: string;
  indicatorText?: string;
}

export const StatusCard = ({ title, status, info, indicatorText }: StatusCardProps) => {
  return (
    <div className="p-4 bg-card border rounded-xl flex flex-col justify-between h-32 hover:border-primary/30 transition-colors">
      <div className="flex justify-between items-start">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <Badge 
          className={
            status === 'online' ? 'bg-green-500/20 text-green-500 border-green-500/30' : 
            status === 'offline' ? 'bg-red-500/20 text-red-500 border-red-500/30' : 
            'bg-yellow-500/20 text-yellow-500 border-yellow-500/30'
          }
          variant="outline"
        >
          {indicatorText || (status === 'online' ? 'Ativo' : status === 'offline' ? 'Offline' : 'Verificando...')}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${status === 'online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : status === 'offline' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`} />
        <span className="text-lg font-mono font-bold text-foreground truncate">{info || '---'}</span>
      </div>
    </div>
  );
};
