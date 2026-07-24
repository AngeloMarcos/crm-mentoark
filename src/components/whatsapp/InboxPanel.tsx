import React, { useState, useEffect } from "react";
import {
  getInboxConversations,
  assignConversationAgent,
  updateConversationStatus,
  markConversationAsRead,
  Conversation
} from "@/services/kanbanInboxService";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MessageSquare,
  UserPlus,
  CheckCircle,
  Clock,
  User,
  Inbox,
  CornerDownLeft,
  CornerUpRight
} from "lucide-react";

export const InboxPanel: React.FC = () => {
  const [statusTab, setStatusTab] = useState<'open' | 'pending' | 'closed'>('open');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const loadConversations = async (status: 'open' | 'pending' | 'closed') => {
    setLoading(true);
    const data = await getInboxConversations(status);
    setConversations(data);
    setLoading(false);
  };

  useEffect(() => {
    loadConversations(statusTab);
    // Polling leve de atualização de contagem e mensagens a cada 5 segundos
    const interval = setInterval(async () => {
      const data = await getInboxConversations(statusTab);
      setConversations(data);
    }, 5000);

    return () => clearInterval(interval);
  }, [statusTab]);

  const handleSelectConversation = async (conv: Conversation) => {
    setActiveConv(conv);
    if (conv.unread_count > 0) {
      // Zera o contador de não-lidas localmente para atualizar a UI rápido
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread_count: 0 } : c));
      await markConversationAsRead(conv.id);
    }
  };

  const handleAssignAgent = async (convId: string, agentId: string | null) => {
    const originalConversations = [...conversations];

    // Atualização otimista
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, agent_name: agentId ? "Você" : undefined } : c));

    const result = await assignConversationAgent(convId, agentId);
    if (result.error) {
      setConversations(originalConversations);
      toast({
        variant: "destructive",
        title: "Erro na Atribuição",
        description: "Não foi possível transferir o atendimento. Tente novamente.",
      });
    } else {
      toast({
        title: "Conversa Atribuída",
        description: agentId ? "Você assumiu este atendimento." : "Atendimento liberado para fila global.",
      });
      loadConversations(statusTab);
    }
  };

  const handleStatusChange = async (convId: string, targetStatus: 'open' | 'pending' | 'closed') => {
    const originalConversations = [...conversations];

    // Remove otimistamente da listagem atual
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (activeConv?.id === convId) setActiveConv(null);

    const result = await updateConversationStatus(convId, targetStatus);
    if (result.error) {
      setConversations(originalConversations);
      toast({
        variant: "destructive",
        title: "Falha na Atualização",
        description: "Não foi possível alterar o status da conversa.",
      });
    } else {
      toast({
        title: "Status Atualizado",
        description: `Conversa movida para a aba de ${targetStatus === 'closed' ? 'resolvidos' : targetStatus === 'pending' ? 'pendentes' : 'em atendimento'}.`,
      });
    }
  };

  return (
    <div className="flex h-[600px] border border-gray-150 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-950 shadow-md">

      {/* Coluna Esquerda: Listagem de Chats */}
      <div className="w-1/3 border-r border-gray-150 dark:border-gray-800 flex flex-col h-full bg-gray-50 dark:bg-gray-900/50">

        {/* Abas de Status */}
        <div className="p-3 border-b border-gray-150 dark:border-gray-800 bg-white dark:bg-gray-950">
          <Tabs value={statusTab} onValueChange={(val: any) => setStatusTab(val)} className="w-full">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="open" className="text-xs">Abertas</TabsTrigger>
              <TabsTrigger value="pending" className="text-xs">Aguardando</TabsTrigger>
              <TabsTrigger value="closed" className="text-xs">Fechadas</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Lista de Conversas */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
          {conversations.map((conv) => {
            const isSelected = activeConv?.id === conv.id;
            return (
              <div
                key={conv.id}
                onClick={() => handleSelectConversation(conv)}
                className={`p-3 flex items-start gap-3 cursor-pointer transition-colors ${
                  isSelected ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-l-4 border-emerald-500" : "hover:bg-gray-100 dark:hover:bg-gray-850"
                }`}
              >
                <Avatar className="w-10 h-10 mt-0.5">
                  <AvatarImage src={conv.contato_foto || ""} />
                  <AvatarFallback className="bg-emerald-500 text-white font-semibold text-xs">
                    {conv.contato_nome.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">{conv.contato_nome}</h4>
                    <span className="text-[10px] text-gray-400">
                      {new Date(conv.last_message_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>

                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate pr-2">
                    {conv.ultima_mensagem || <span className="italic text-gray-450">Nenhuma mensagem</span>}
                  </p>

                  <div className="flex items-center justify-between pt-1">
                    {conv.agent_name ? (
                      <span className="text-[9px] text-gray-400 flex items-center gap-1">
                        <User className="w-3 h-3 text-emerald-500" />
                        Atribuído a {conv.agent_name}
                      </span>
                    ) : (
                      <span className="text-[9px] text-amber-500 font-medium flex items-center gap-1">
                        <Inbox className="w-3 h-3 animate-pulse" />
                        Fila Global
                      </span>
                    )}

                    {conv.unread_count > 0 && (
                      <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white text-[9px] font-bold h-4 px-1.5 flex items-center justify-center rounded-full animate-bounce">
                        {conv.unread_count}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {conversations.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-400 text-xs flex flex-col items-center gap-2">
              <MessageSquare className="w-8 h-8 opacity-40" />
              Nenhum atendimento nesta aba.
            </div>
          )}
        </div>
      </div>

      {/* Coluna Direita: Controle de Atendimento */}
      <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-950">
        {activeConv ? (
          <div className="p-6 flex flex-col h-full justify-between">
            <div className="space-y-6">
              {/* Header de Detalhes do Cliente */}
              <div className="flex items-center gap-4 border-b border-gray-100 dark:border-gray-800 pb-4">
                <Avatar className="w-16 h-16">
                  <AvatarImage src={activeConv.contato_foto || ""} />
                  <AvatarFallback className="bg-emerald-500 text-white text-lg font-bold">
                    {activeConv.contato_nome.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{activeConv.contato_nome}</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{activeConv.contato_telefone}</p>
                  <p className="text-[10px] text-gray-400 mt-1">Conector: {activeConv.instance_name}</p>
                </div>
              </div>

              {/* Seção de Atribuição de Operadores */}
              <div className="space-y-3 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-100 dark:border-gray-850">
                <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 text-emerald-500" />
                  Atribuição de Operador
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Gerencie quem está respondendo a este cliente para evitar conflito de atendimento.
                </p>
                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    onClick={() => handleAssignAgent(activeConv.id, user?.id ?? null)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                    disabled={!user?.id || activeConv.agent_name === "Você"}
                  >
                    Assumir Atendimento
                  </Button>
                  {activeConv.agent_name && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAssignAgent(activeConv.id, null)}
                      className="text-xs border-gray-200 dark:border-gray-800"
                    >
                      Liberar na Fila
                    </Button>
                  )}
                </div>
              </div>

              {/* Seção de Transição de Status do Ticket */}
              <div className="space-y-3 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-100 dark:border-gray-850">
                <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  Status do Atendimento
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Mova o status desta conversa conforme o andamento do ticket.
                </p>
                <div className="flex gap-2 pt-2">
                  {activeConv.status !== 'open' && (
                    <Button
                      size="sm"
                      onClick={() => handleStatusChange(activeConv.id, 'open')}
                      className="bg-gray-800 hover:bg-gray-900 dark:bg-gray-800 dark:hover:bg-gray-700 text-xs"
                    >
                      <CornerDownLeft className="w-3.5 h-3.5 mr-1" />
                      Reabrir Chat
                    </Button>
                  )}
                  {activeConv.status !== 'pending' && (
                    <Button
                      size="sm"
                      onClick={() => handleStatusChange(activeConv.id, 'pending')}
                      className="bg-amber-600 hover:bg-amber-700 text-white text-xs"
                    >
                      <Clock className="w-3.5 h-3.5 mr-1" />
                      Marcar Pendente
                    </Button>
                  )}
                  {activeConv.status !== 'closed' && (
                    <Button
                      size="sm"
                      onClick={() => handleStatusChange(activeConv.id, 'closed')}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                    >
                      <CheckCircle className="w-3.5 h-3.5 mr-1" />
                      Resolver/Fechar
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="text-center text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-4">
              Atividade atualizada via WebSocket em tempo real.
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
            <MessageSquare className="w-12 h-12 opacity-30" />
            Selecione uma conversa para gerenciar o atendimento.
          </div>
        )}
      </div>
    </div>
  );
};
