/**
 * kanbanInboxService.ts — Cliente frontend para as rotas da Inbox Unificada do backend
 * (/api/conversas). Usado por InboxPanel para listar conversas por status e gerenciar
 * atribuição de atendente / status do ticket.
 */
import { api } from "@/integrations/database/client";

export interface Conversation {
  id: string;
  instance_name: string;
  remote_jid: string;
  status: "open" | "pending" | "closed";
  last_message_at: string;
  unread_count: number;
  contato_nome: string;
  contato_telefone: string;
  contato_foto?: string | null;
  agent_name?: string | null;
  ultima_mensagem?: string | null;
}

interface ServiceResult<T> {
  data?: T;
  error?: { message: string; status?: number };
}

export async function getInboxConversations(
  status: "open" | "pending" | "closed",
  limit = 50,
  offset = 0
): Promise<Conversation[]> {
  try {
    const { data } = await api.get(
      `/api/conversas?status=${encodeURIComponent(status)}&limit=${limit}&offset=${offset}`
    );
    return (data as Conversation[]) || [];
  } catch (err: any) {
    console.error("[kanbanInboxService] getInboxConversations falhou:", err?.message);
    return [];
  }
}

export async function assignConversationAgent(
  conversationId: string,
  agentId: string | null
): Promise<ServiceResult<Conversation>> {
  try {
    const { data } = await api.patch(`/api/conversas/${conversationId}/assign`, {
      assigned_agent_id: agentId,
    });
    return { data };
  } catch (err: any) {
    return { error: { message: err?.message || "Falha ao atribuir atendente", status: err?.status } };
  }
}

export async function updateConversationStatus(
  conversationId: string,
  status: "open" | "pending" | "closed"
): Promise<ServiceResult<Conversation>> {
  try {
    const { data } = await api.patch(`/api/conversas/${conversationId}/status`, { status });
    return { data };
  } catch (err: any) {
    return { error: { message: err?.message || "Falha ao atualizar status", status: err?.status } };
  }
}

export async function markConversationAsRead(conversationId: string): Promise<ServiceResult<{ ok: boolean }>> {
  try {
    const { data } = await api.patch(`/api/conversas/${conversationId}/read`, {});
    return { data };
  } catch (err: any) {
    return { error: { message: err?.message || "Falha ao marcar como lida", status: err?.status } };
  }
}
