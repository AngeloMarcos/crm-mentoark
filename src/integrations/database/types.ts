export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalDatabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_prompts: {
        Row: {
          ativo: boolean
          conteudo: string
          created_at: string
          created_by: string | null
          id: number
          nome: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          conteudo: string
          created_at?: string
          created_by?: string | null
          id?: number
          nome: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          conteudo?: string
          created_at?: string
          created_by?: string | null
          id?: number
          nome?: string
          user_id?: string
        }
        Relationships: []
      }
      agentes: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          evolution_api_key: string | null
          evolution_instancia: string | null
          evolution_server_url: string | null
          id: string
          max_tokens: number
          mensagem_boas_vindas: string | null
          modelo: string
          nome: string
          objetivo: string | null
          persona: string | null
          rag_ativo: boolean | null
          rag_resultados: number | null
          rag_threshold: number | null
          regras: string | null
          temperatura: number
          tom: string
          updated_at: string
          user_id: string
          webhook_indexacao: string | null
          webhook_principal: string | null
          webhook_teste: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          evolution_api_key?: string | null
          evolution_instancia?: string | null
          evolution_server_url?: string | null
          id?: string
          max_tokens?: number
          mensagem_boas_vindas?: string | null
          modelo?: string
          nome: string
          objetivo?: string | null
          persona?: string | null
          rag_ativo?: boolean | null
          rag_resultados?: number | null
          rag_threshold?: number | null
          regras?: string | null
          temperatura?: number
          tom?: string
          updated_at?: string
          user_id: string
          webhook_indexacao?: string | null
          webhook_principal?: string | null
          webhook_teste?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          evolution_api_key?: string | null
          evolution_instancia?: string | null
          evolution_server_url?: string | null
          id?: string
          max_tokens?: number
          mensagem_boas_vindas?: string | null
          modelo?: string
          nome?: string
          objetivo?: string | null
          persona?: string | null
          rag_ativo?: boolean | null
          rag_resultados?: number | null
          rag_threshold?: number | null
          regras?: string | null
          temperatura?: number
          tom?: string
          updated_at?: string
          user_id?: string
          webhook_indexacao?: string | null
          webhook_principal?: string | null
          webhook_teste?: string | null
        }
        Relationships: []
      }
      campanhas: {
        Row: {
          cliques: number
          conversoes: number
          cpl: number
          created_at: string
          ctr: number
          id: string
          impressoes: number
          investimento: number
          leads_gerados: number
          nome: string
          periodo: string | null
          plataforma: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cliques?: number
          conversoes?: number
          cpl?: number
          created_at?: string
          ctr?: number
          id?: string
          impressoes?: number
          investimento?: number
          leads_gerados?: number
          nome: string
          periodo?: string | null
          plataforma?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cliques?: number
          conversoes?: number
          cpl?: number
          created_at?: string
          ctr?: number
          id?: string
          impressoes?: number
          investimento?: number
          leads_gerados?: number
          nome?: string
          periodo?: string | null
          plataforma?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chamadas: {
        Row: {
          contato_id: string
          created_at: string
          duracao_segundos: number | null
          id: string
          notas: string | null
          resultado: string
          user_id: string
        }
        Insert: {
          contato_id: string
          created_at?: string
          duracao_segundos?: number | null
          id?: string
          notas?: string | null
          resultado: string
          user_id: string
        }
        Update: {
          contato_id?: string
          created_at?: string
          duracao_segundos?: number | null
          id?: string
          notas?: string | null
          resultado?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chamadas_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          active: boolean | null
          bot_message: string | null
          created_at: string
          id: number
          message_type: string | null
          nomewpp: string | null
          phone: string | null
          user_message: string | null
        }
        Insert: {
          active?: boolean | null
          bot_message?: string | null
          created_at?: string
          id?: number
          message_type?: string | null
          nomewpp?: string | null
          phone?: string | null
          user_message?: string | null
        }
        Update: {
          active?: boolean | null
          bot_message?: string | null
          created_at?: string
          id?: number
          message_type?: string | null
          nomewpp?: string | null
          phone?: string | null
          user_message?: string | null
        }
        Relationships: []
      }
      chats: {
        Row: {
          created_at: string
          id: number
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conhecimento: {
        Row: {
          campo: string | null
          categoria: string | null
          conteudo: string
          contexto: string | null
          created_at: string
          id: string
          indexado: boolean
          tipo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          campo?: string | null
          categoria?: string | null
          conteudo: string
          contexto?: string | null
          created_at?: string
          id?: string
          indexado?: boolean
          tipo: string
          updated_at?: string
          user_id: string
        }
        Update: {
          campo?: string | null
          categoria?: string | null
          conteudo?: string
          contexto?: string | null
          created_at?: string
          id?: string
          indexado?: boolean
          tipo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contatos: {
        Row: {
          cargo: string | null
          created_at: string
          email: string | null
          empresa: string | null
          id: string
          lista_id: string | null
          nome: string
          notas: string | null
          origem: string | null
          responsavel: string
          status: string
          tags: string[] | null
          telefone: string | null
          temperatura: string
          updated_at: string
          user_id: string
          valor_potencial: number
        }
        Insert: {
          cargo?: string | null
          created_at?: string
          email?: string | null
          empresa?: string | null
          id?: string
          lista_id?: string | null
          nome: string
          notas?: string | null
          origem?: string | null
          responsavel?: string
          status?: string
          tags?: string[] | null
          telefone?: string | null
          temperatura?: string
          updated_at?: string
          user_id: string
          valor_potencial?: number
        }
        Update: {
          cargo?: string | null
          created_at?: string
          email?: string | null
          empresa?: string | null
          id?: string
          lista_id?: string | null
          nome?: string
          notas?: string | null
          origem?: string | null
          responsavel?: string
          status?: string
          tags?: string[] | null
          telefone?: string | null
          temperatura?: string
          updated_at?: string
          user_id?: string
          valor_potencial?: number
        }
        Relationships: [
          {
            foreignKeyName: "contatos_lista_id_fkey"
            columns: ["lista_id"]
            isOneToOne: false
            referencedRelation: "listas"
            referencedColumns: ["id"]
          },
        ]
      }
      dados_cliente: {
        Row: {
          atendimento_ia: boolean | null
          created_at: string
          id: number
          nomewpp: string | null
          Setor: string | null
          telefone: string | null
        }
        Insert: {
          atendimento_ia?: boolean | null
          created_at?: string
          id?: number
          nomewpp?: string | null
          Setor?: string | null
          telefone?: string | null
        }
        Update: {
          atendimento_ia?: boolean | null
          created_at?: string
          id?: number
          nomewpp?: string | null
          Setor?: string | null
          telefone?: string | null
        }
        Relationships: []
      }
      disparo_logs: {
        Row: {
          contato_id: string | null
          created_at: string
          disparo_id: string
          enviado_at: string | null
          erro: string | null
          id: string
          mensagem_enviada: string | null
          nome: string | null
          status: string
          telefone: string
          tentativas: number
          user_id: string
        }
        Insert: {
          contato_id?: string | null
          created_at?: string
          disparo_id: string
          enviado_at?: string | null
          erro?: string | null
          id?: string
          mensagem_enviada?: string | null
          nome?: string | null
          status?: string
          telefone: string
          tentativas?: number
          user_id: string
        }
        Update: {
          contato_id?: string | null
          created_at?: string
          disparo_id?: string
          enviado_at?: string | null
          erro?: string | null
          id?: string
          mensagem_enviada?: string | null
          nome?: string | null
          status?: string
          telefone?: string
          tentativas?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disparo_logs_disparo_id_fkey"
            columns: ["disparo_id"]
            isOneToOne: false
            referencedRelation: "disparos"
            referencedColumns: ["id"]
          },
        ]
      }
      disparos: {
        Row: {
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          enviados: number
          falhas: number
          horario_fim: string
          horario_inicio: string
          id: string
          intervalo_max: number
          intervalo_min: number
          lista_id: string | null
          mensagem_template: string | null
          nome: string
          pausa_a_cada: number
          pausa_duracao: number
          status: string
          total_leads: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          enviados?: number
          falhas?: number
          horario_fim?: string
          horario_inicio?: string
          id?: string
          intervalo_max?: number
          intervalo_min?: number
          lista_id?: string | null
          mensagem_template?: string | null
          nome: string
          pausa_a_cada?: number
          pausa_duracao?: number
          status?: string
          total_leads?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          enviados?: number
          falhas?: number
          horario_fim?: string
          horario_inicio?: string
          id?: string
          intervalo_max?: number
          intervalo_min?: number
          lista_id?: string | null
          mensagem_template?: string | null
          nome?: string
          pausa_a_cada?: number
          pausa_duracao?: number
          status?: string
          total_leads?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: number
          metadata: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: number
          metadata?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: number
          metadata?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      integracoes_config: {
        Row: {
          api_key: string | null
          config: Json
          created_at: string
          id: string
          instancia: string | null
          nome: string
          status: string
          tipo: string
          ultima_sync: string | null
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          api_key?: string | null
          config?: Json
          created_at?: string
          id?: string
          instancia?: string | null
          nome: string
          status?: string
          tipo: string
          ultima_sync?: string | null
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          api_key?: string | null
          config?: Json
          created_at?: string
          id?: string
          instancia?: string | null
          nome?: string
          status?: string
          tipo?: string
          ultima_sync?: string | null
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      listas: {
        Row: {
          cor: string | null
          created_at: string
          descricao: string | null
          id: string
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cor?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cor?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      n8n_chat_histories: {
        Row: {
          created_at: string
          id: number
          message: Json
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          message: Json
          session_id: string
        }
        Update: {
          created_at?: string
          id?: number
          message?: Json
          session_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tarefas: {
        Row: {
          concluida_at: string | null
          contato_id: string | null
          created_at: string
          descricao: string | null
          id: string
          prazo: string | null
          prioridade: string
          status: string
          titulo: string
          user_id: string
        }
        Insert: {
          concluida_at?: string | null
          contato_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          prazo?: string | null
          prioridade?: string
          status?: string
          titulo: string
          user_id: string
        }
        Update: {
          concluida_at?: string | null
          contato_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          prazo?: string | null
          prioridade?: string
          status?: string
          titulo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_eventos: {
        Row: {
          contato_id: string
          created_at: string
          data_evento: string
          descricao: string | null
          id: string
          tipo: string
          titulo: string
          user_id: string
        }
        Insert: {
          contato_id: string
          created_at?: string
          data_evento?: string
          descricao?: string | null
          id?: string
          tipo: string
          titulo: string
          user_id: string
        }
        Update: {
          contato_id?: string
          created_at?: string
          data_evento?: string
          descricao?: string | null
          id?: string
          tipo?: string
          titulo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_eventos_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      dashboard_resumo: {
        Row: {
          convertidos: number | null
          em_atendimento: number | null
          novos_hoje: number | null
          total_leads: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalDatabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
