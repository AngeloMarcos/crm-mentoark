export type LeadStatus = "novo" | "contatado" | "em_atendimento" | "qualificado" | "proposta" | "negociacao" | "fechado" | "perdido";
export type LeadTemperatura = "frio" | "morno" | "quente";

export interface Lead {
  id: string;
  nome: string;
  telefone: string;
  email: string;
  origem: string;
  campanha: string;
  status: LeadStatus;
  etapa_funil: string;
  responsavel: string;
  temperatura: LeadTemperatura;
  data_entrada: string;
  ultima_interacao: string;
  cidade: string;
  observacoes: string;
  tags: string[];
  valor_potencial?: number;
}

export interface Campanha {
  id: string;
  nome: string;
  status: "ativa" | "pausada" | "finalizada";
  investimento: number;
  impressoes: number;
  cliques: number;
  ctr: number;
  leads_gerados: number;
  cpl: number;
  conversoes: number;
  custo_total: number;
  periodo: string;
}

export interface ConversaWhatsApp {
  id: string;
  lead_id: string;
  nome: string;
  telefone: string;
  status_atendimento: "pendente" | "em_andamento" | "finalizado";
  ultima_mensagem: string;
  horario: string;
  tipo: "automacao" | "humano";
  ativo: boolean;
}

export interface Integracao {
  id: string;
  nome: string;
  descricao: string;
  status: "conectado" | "sincronizando" | "atencao" | "erro" | "inativo";
  ultima_sincronizacao: string;
  icone: string;
}

export const etapaLabel: Record<LeadStatus, string> = {
  novo: "Novo Lead",
  contatado: "Contato Iniciado",
  em_atendimento: "Em Atendimento",
  qualificado: "Qualificado",
  proposta: "Proposta Enviada",
  negociacao: "Negociação",
  fechado: "Fechado",
  perdido: "Perdido",
};

// Dados reais serão carregados do backend.
// Arrays vazios para o sistema iniciar limpo, sem dados fantasma.
export const mockLeads: Lead[] = [];
export const mockCampanhas: Campanha[] = [];
export const mockConversas: ConversaWhatsApp[] = [];
export const mockIntegracoes: Integracao[] = [];

// Dashboard zerado — será preenchido quando dados reais entrarem.
export const dashboardData = {
  totalLeads: 0,
  novosHoje: 0,
  emAtendimento: 0,
  convertidos: 0,
  taxaConversao: 0,
  custoMedioLead: 0,
  campanhasAtivas: 0,
  mensagensWhatsApp: 0,
  atendimentosAndamento: 0,
  leadsPorOrigem: [] as { origem: string; quantidade: number }[],
  evolucaoSemanal: [] as { semana: string; leads: number; conversoes: number }[],
  conversaoPorEtapa: [] as { etapa: string; total: number }[],
};
