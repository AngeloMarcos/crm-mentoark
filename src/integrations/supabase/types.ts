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
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_configs: {
        Row: {
          ativo: boolean | null
          bloco_qualificacao: string | null
          created_at: string | null
          evolution_api_key: string | null
          evolution_instancia: string | null
          evolution_server_url: string | null
          grupo_notificacao: string | null
          id: string
          mensagem_encaminhamento: string | null
          mensagem_encerramento: string | null
          modelo_llm: string | null
          modelo_parser: string | null
          nome_agente: string
          palavra_reativar: string | null
          prompt_sistema: string
          saudacao_inicial: string | null
          sinal_pausa: string | null
          tempo_espera_mensagem: number | null
          tempo_espera_resposta: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ativo?: boolean | null
          bloco_qualificacao?: string | null
          created_at?: string | null
          evolution_api_key?: string | null
          evolution_instancia?: string | null
          evolution_server_url?: string | null
          grupo_notificacao?: string | null
          id?: string
          mensagem_encaminhamento?: string | null
          mensagem_encerramento?: string | null
          modelo_llm?: string | null
          modelo_parser?: string | null
          nome_agente?: string
          palavra_reativar?: string | null
          prompt_sistema: string
          saudacao_inicial?: string | null
          sinal_pausa?: string | null
          tempo_espera_mensagem?: number | null
          tempo_espera_resposta?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ativo?: boolean | null
          bloco_qualificacao?: string | null
          created_at?: string | null
          evolution_api_key?: string | null
          evolution_instancia?: string | null
          evolution_server_url?: string | null
          grupo_notificacao?: string | null
          id?: string
          mensagem_encaminhamento?: string | null
          mensagem_encerramento?: string | null
          modelo_llm?: string | null
          modelo_parser?: string | null
          nome_agente?: string
          palavra_reativar?: string | null
          prompt_sistema?: string
          saudacao_inicial?: string | null
          sinal_pausa?: string | null
          tempo_espera_mensagem?: number | null
          tempo_espera_resposta?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_prompts: {
        Row: {
          agent_config_id: string | null
          ativo: boolean
          conteudo: string
          created_at: string
          created_by: string | null
          id: number
          nome: string
          user_id: string
        }
        Insert: {
          agent_config_id?: string | null
          ativo?: boolean
          conteudo: string
          created_at?: string
          created_by?: string | null
          id?: number
          nome: string
          user_id: string
        }
        Update: {
          agent_config_id?: string | null
          ativo?: boolean
          conteudo?: string
          created_at?: string
          created_by?: string | null
          id?: number
          nome?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_prompts_agent_config_id_fkey"
            columns: ["agent_config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          elevenlabs_model: string | null
          evolution_api_key: string | null
          evolution_instancia: string | null
          evolution_server_url: string | null
          id: string
          max_tokens: number
          mensagem_boas_vindas: string | null
          modelo: string
          n8n_webhook_url: string | null
          nome: string
          objetivo: string | null
          persona: string | null
          rag_ativo: boolean | null
          rag_resultados: number | null
          rag_threshold: number | null
          regras: string | null
          score_fatores: Json | null
          score_updated_at: string | null
          temperatura: number
          tom: string
          updated_at: string
          user_id: string
          voice_id: string | null
          voice_similarity: number | null
          voice_stability: number | null
          webhook_indexacao: string | null
          webhook_principal: string | null
          webhook_teste: string | null
          whatsapp_score: number | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          elevenlabs_model?: string | null
          evolution_api_key?: string | null
          evolution_instancia?: string | null
          evolution_server_url?: string | null
          id?: string
          max_tokens?: number
          mensagem_boas_vindas?: string | null
          modelo?: string
          n8n_webhook_url?: string | null
          nome: string
          objetivo?: string | null
          persona?: string | null
          rag_ativo?: boolean | null
          rag_resultados?: number | null
          rag_threshold?: number | null
          regras?: string | null
          score_fatores?: Json | null
          score_updated_at?: string | null
          temperatura?: number
          tom?: string
          updated_at?: string
          user_id: string
          voice_id?: string | null
          voice_similarity?: number | null
          voice_stability?: number | null
          webhook_indexacao?: string | null
          webhook_principal?: string | null
          webhook_teste?: string | null
          whatsapp_score?: number | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          elevenlabs_model?: string | null
          evolution_api_key?: string | null
          evolution_instancia?: string | null
          evolution_server_url?: string | null
          id?: string
          max_tokens?: number
          mensagem_boas_vindas?: string | null
          modelo?: string
          n8n_webhook_url?: string | null
          nome?: string
          objetivo?: string | null
          persona?: string | null
          rag_ativo?: boolean | null
          rag_resultados?: number | null
          rag_threshold?: number | null
          regras?: string | null
          score_fatores?: Json | null
          score_updated_at?: string | null
          temperatura?: number
          tom?: string
          updated_at?: string
          user_id?: string
          voice_id?: string | null
          voice_similarity?: number | null
          voice_stability?: number | null
          webhook_indexacao?: string | null
          webhook_principal?: string | null
          webhook_teste?: string | null
          whatsapp_score?: number | null
        }
        Relationships: []
      }
      ai_conversas: {
        Row: {
          contato_id: string | null
          created_at: string
          id: string
          titulo: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          contato_id?: string | null
          created_at?: string
          id?: string
          titulo?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          contato_id?: string | null
          created_at?: string
          id?: string
          titulo?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversas_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_fila: {
        Row: {
          concluido_em: string | null
          conteudo_texto: string | null
          conversa_id: string | null
          created_at: string
          erro_msg: string | null
          id: string
          instance_name: string
          max_tentativas: number
          media_mimetype: string | null
          media_url: string | null
          processar_apos: string
          remote_jid: string
          status: string
          tentativas: number
          tipo: string
          updated_at: string
          user_id: string
          wa_message_id: string
        }
        Insert: {
          concluido_em?: string | null
          conteudo_texto?: string | null
          conversa_id?: string | null
          created_at?: string
          erro_msg?: string | null
          id?: string
          instance_name: string
          max_tentativas?: number
          media_mimetype?: string | null
          media_url?: string | null
          processar_apos?: string
          remote_jid: string
          status?: string
          tentativas?: number
          tipo: string
          updated_at?: string
          user_id: string
          wa_message_id: string
        }
        Update: {
          concluido_em?: string | null
          conteudo_texto?: string | null
          conversa_id?: string | null
          created_at?: string
          erro_msg?: string | null
          id?: string
          instance_name?: string
          max_tentativas?: number
          media_mimetype?: string | null
          media_url?: string | null
          processar_apos?: string
          remote_jid?: string
          status?: string
          tentativas?: number
          tipo?: string
          updated_at?: string
          user_id?: string
          wa_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_fila_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
      cargos: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          permissoes: string[]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          permissoes?: string[]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          permissoes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cargos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogo_mensagens_logs: {
        Row: {
          catalogo_id: string | null
          contato_id: string | null
          created_at: string | null
          erro_mensagem: string | null
          id: string
          mensagem_texto: string | null
          midia_url: string | null
          produto_id: string | null
          status: string
          telefone: string
          tipo: string
          user_id: string
        }
        Insert: {
          catalogo_id?: string | null
          contato_id?: string | null
          created_at?: string | null
          erro_mensagem?: string | null
          id?: string
          mensagem_texto?: string | null
          midia_url?: string | null
          produto_id?: string | null
          status: string
          telefone: string
          tipo: string
          user_id: string
        }
        Update: {
          catalogo_id?: string | null
          contato_id?: string | null
          created_at?: string | null
          erro_mensagem?: string | null
          id?: string
          mensagem_texto?: string | null
          midia_url?: string | null
          produto_id?: string | null
          status?: string
          telefone?: string
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_mensagens_logs_catalogo_id_fkey"
            columns: ["catalogo_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogo_mensagens_logs_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogo_mensagens_logs_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogos: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string | null
          id: string
          nome: string
          ordem: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome: string
          ordem?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          ordem?: number | null
          updated_at?: string | null
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
          instancia: string | null
          message_type: string | null
          nomewpp: string | null
          phone: string | null
          user_id: string | null
          user_message: string | null
        }
        Insert: {
          active?: boolean | null
          bot_message?: string | null
          created_at?: string
          id?: number
          instancia?: string | null
          message_type?: string | null
          nomewpp?: string | null
          phone?: string | null
          user_id?: string | null
          user_message?: string | null
        }
        Update: {
          active?: boolean | null
          bot_message?: string | null
          created_at?: string
          id?: number
          instancia?: string | null
          message_type?: string | null
          nomewpp?: string | null
          phone?: string | null
          user_id?: string | null
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
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          phone?: string | null
          updated_at?: string
          user_id?: string | null
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
          atendimento_ia: string | null
          created_at: string
          email: string | null
          estado_civil: string | null
          fgts: number | null
          id: number
          nome_completo: string | null
          nomewpp: string | null
          pausa_timestamp: string | null
          renda_bruta: number | null
          setor: string | null
          telefone: string | null
          tipo_trabalho: string | null
          updated_at: string | null
          user_id: string | null
          valor_entrada: number | null
        }
        Insert: {
          atendimento_ia?: string | null
          created_at?: string
          email?: string | null
          estado_civil?: string | null
          fgts?: number | null
          id?: number
          nome_completo?: string | null
          nomewpp?: string | null
          pausa_timestamp?: string | null
          renda_bruta?: number | null
          setor?: string | null
          telefone?: string | null
          tipo_trabalho?: string | null
          updated_at?: string | null
          user_id?: string | null
          valor_entrada?: number | null
        }
        Update: {
          atendimento_ia?: string | null
          created_at?: string
          email?: string | null
          estado_civil?: string | null
          fgts?: number | null
          id?: number
          nome_completo?: string | null
          nomewpp?: string | null
          pausa_timestamp?: string | null
          renda_bruta?: number | null
          setor?: string | null
          telefone?: string | null
          tipo_trabalho?: string | null
          updated_at?: string | null
          user_id?: string | null
          valor_entrada?: number | null
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
      disparo_optouts: {
        Row: {
          created_at: string | null
          id: string
          motivo: string | null
          telefone: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          motivo?: string | null
          telefone: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          motivo?: string | null
          telefone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disparo_optouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      disparo_rate_limit: {
        Row: {
          last_disparo_at: string
          user_id: string
        }
        Insert: {
          last_disparo_at?: string
          user_id: string
        }
        Update: {
          last_disparo_at?: string
          user_id?: string
        }
        Relationships: []
      }
      disparos: {
        Row: {
          agendado_para: string | null
          concluido_em: string | null
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          entregues: number | null
          enviados: number
          falhas: number
          horario_fim: string
          horario_inicio: string
          id: string
          iniciado_em: string | null
          instancias_ids: string[] | null
          intervalo_max: number
          intervalo_min: number
          legenda_midia: string | null
          limite_dia_instancia: number | null
          limite_erros_consecutivos: number | null
          lista_id: string | null
          mensagem_template: string | null
          nome: string
          pausa_a_cada: number
          pausa_bloqueios_detectados: boolean | null
          pausa_duracao: number
          pausa_erros_consecutivos: boolean | null
          pausa_fins_semana: boolean | null
          perfil_velocidade: string | null
          respondidos: number | null
          status: string
          tipo_midia: string | null
          total_leads: number
          updated_at: string
          url_midia: string | null
          user_id: string
        }
        Insert: {
          agendado_para?: string | null
          concluido_em?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          entregues?: number | null
          enviados?: number
          falhas?: number
          horario_fim?: string
          horario_inicio?: string
          id?: string
          iniciado_em?: string | null
          instancias_ids?: string[] | null
          intervalo_max?: number
          intervalo_min?: number
          legenda_midia?: string | null
          limite_dia_instancia?: number | null
          limite_erros_consecutivos?: number | null
          lista_id?: string | null
          mensagem_template?: string | null
          nome: string
          pausa_a_cada?: number
          pausa_bloqueios_detectados?: boolean | null
          pausa_duracao?: number
          pausa_erros_consecutivos?: boolean | null
          pausa_fins_semana?: boolean | null
          perfil_velocidade?: string | null
          respondidos?: number | null
          status?: string
          tipo_midia?: string | null
          total_leads?: number
          updated_at?: string
          url_midia?: string | null
          user_id: string
        }
        Update: {
          agendado_para?: string | null
          concluido_em?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          entregues?: number | null
          enviados?: number
          falhas?: number
          horario_fim?: string
          horario_inicio?: string
          id?: string
          iniciado_em?: string | null
          instancias_ids?: string[] | null
          intervalo_max?: number
          intervalo_min?: number
          legenda_midia?: string | null
          limite_dia_instancia?: number | null
          limite_erros_consecutivos?: number | null
          lista_id?: string | null
          mensagem_template?: string | null
          nome?: string
          pausa_a_cada?: number
          pausa_bloqueios_detectados?: boolean | null
          pausa_duracao?: number
          pausa_erros_consecutivos?: boolean | null
          pausa_fins_semana?: boolean | null
          perfil_velocidade?: string | null
          respondidos?: number | null
          status?: string
          tipo_midia?: string | null
          total_leads?: number
          updated_at?: string
          url_midia?: string | null
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
      equipe_chat: {
        Row: {
          conteudo: string
          created_at: string
          equipe_id: string
          id: string
          user_id: string
        }
        Insert: {
          conteudo: string
          created_at?: string
          equipe_id: string
          id?: string
          user_id: string
        }
        Update: {
          conteudo?: string
          created_at?: string
          equipe_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipe_chat_equipe_id_fkey"
            columns: ["equipe_id"]
            isOneToOne: false
            referencedRelation: "equipes"
            referencedColumns: ["id"]
          },
        ]
      }
      equipe_membros: {
        Row: {
          convidado_por: string | null
          equipe_id: string
          id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          convidado_por?: string | null
          equipe_id: string
          id?: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          convidado_por?: string | null
          equipe_id?: string
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipe_membros_equipe_id_fkey"
            columns: ["equipe_id"]
            isOneToOne: false
            referencedRelation: "equipes"
            referencedColumns: ["id"]
          },
        ]
      }
      equipes: {
        Row: {
          created_at: string
          id: string
          nome: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      evolution_instances: {
        Row: {
          api_response: Json | null
          connected_at: string | null
          created_at: string
          customer_id: string | null
          id: string
          instance_id: string | null
          instance_name: string
          integration: string | null
          owner_jid: string | null
          phone_number: string | null
          profile_name: string | null
          project_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_response?: Json | null
          connected_at?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          instance_id?: string | null
          instance_name: string
          integration?: string | null
          owner_jid?: string | null
          phone_number?: string | null
          profile_name?: string | null
          project_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_response?: Json | null
          connected_at?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          instance_id?: string | null
          instance_name?: string
          integration?: string | null
          owner_jid?: string | null
          phone_number?: string | null
          profile_name?: string | null
          project_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      facebook_campanhas: {
        Row: {
          atualizado_em: string | null
          fim: string | null
          id: string
          inicio: string | null
          metricas: Json | null
          nome: string | null
          objetivo: string | null
          orcamento_diario: number | null
          orcamento_total: number | null
          plataforma: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          atualizado_em?: string | null
          fim?: string | null
          id: string
          inicio?: string | null
          metricas?: Json | null
          nome?: string | null
          objetivo?: string | null
          orcamento_diario?: number | null
          orcamento_total?: number | null
          plataforma?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          atualizado_em?: string | null
          fim?: string | null
          id?: string
          inicio?: string | null
          metricas?: Json | null
          nome?: string | null
          objetivo?: string | null
          orcamento_diario?: number | null
          orcamento_total?: number | null
          plataforma?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      facebook_contas: {
        Row: {
          access_token: string
          ad_account_id: string
          atualizado_em: string | null
          criado_em: string | null
          id: string
          nome_conta: string | null
          token_expira_em: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          ad_account_id: string
          atualizado_em?: string | null
          criado_em?: string | null
          id?: string
          nome_conta?: string | null
          token_expira_em?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          ad_account_id?: string
          atualizado_em?: string | null
          criado_em?: string | null
          id?: string
          nome_conta?: string | null
          token_expira_em?: string | null
          user_id?: string
        }
        Relationships: []
      }
      follow_ups: {
        Row: {
          contato_id: string | null
          created_at: string | null
          data_retorno: string
          id: string
          motivo: string | null
          observacao: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          contato_id?: string | null
          created_at?: string | null
          data_retorno: string
          id?: string
          motivo?: string | null
          observacao?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          contato_id?: string | null
          created_at?: string | null
          data_retorno?: string
          id?: string
          motivo?: string | null
          observacao?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      funil_estagios: {
        Row: {
          cor: string | null
          created_at: string | null
          id: string
          nome: string
          ordem: number | null
          user_id: string
        }
        Insert: {
          cor?: string | null
          created_at?: string | null
          id?: string
          nome: string
          ordem?: number | null
          user_id: string
        }
        Update: {
          cor?: string | null
          created_at?: string | null
          id?: string
          nome?: string
          ordem?: number | null
          user_id?: string
        }
        Relationships: []
      }
      galeria_imagens: {
        Row: {
          created_at: string | null
          filename: string
          id: string
          tags: string[] | null
          tamanho: number | null
          tipo: string | null
          titulo: string | null
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          filename: string
          id?: string
          tags?: string[] | null
          tamanho?: number | null
          tipo?: string | null
          titulo?: string | null
          url: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          filename?: string
          id?: string
          tags?: string[] | null
          tamanho?: number | null
          tipo?: string | null
          titulo?: string | null
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      galeria_midias: {
        Row: {
          created_at: string | null
          descricao: string | null
          filename: string
          id: string
          media_type: string | null
          pasta: string | null
          tags: string[] | null
          tamanho: number | null
          tipo: string | null
          titulo: string | null
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          filename: string
          id?: string
          media_type?: string | null
          pasta?: string | null
          tags?: string[] | null
          tamanho?: number | null
          tipo?: string | null
          titulo?: string | null
          url: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          filename?: string
          id?: string
          media_type?: string | null
          pasta?: string | null
          tags?: string[] | null
          tamanho?: number | null
          tipo?: string | null
          titulo?: string | null
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      ia_pausa_log: {
        Row: {
          acao: string
          atendente_id: string | null
          contato_id: string | null
          created_at: string | null
          duracao_min: number | null
          id: string
          observacao: string | null
          telefone: string | null
          user_id: string
        }
        Insert: {
          acao: string
          atendente_id?: string | null
          contato_id?: string | null
          created_at?: string | null
          duracao_min?: number | null
          id?: string
          observacao?: string | null
          telefone?: string | null
          user_id: string
        }
        Update: {
          acao?: string
          atendente_id?: string | null
          contato_id?: string | null
          created_at?: string | null
          duracao_min?: number | null
          id?: string
          observacao?: string | null
          telefone?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_pausa_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
      kanban_colunas: {
        Row: {
          cor: string | null
          created_at: string
          id: string
          limite_wip: number | null
          nome: string
          ordem: number
          user_id: string
        }
        Insert: {
          cor?: string | null
          created_at?: string
          id?: string
          limite_wip?: number | null
          nome: string
          ordem?: number
          user_id: string
        }
        Update: {
          cor?: string | null
          created_at?: string
          id?: string
          limite_wip?: number | null
          nome?: string
          ordem?: number
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
      marketing_leads: {
        Row: {
          campanha: string | null
          campanha_id: string | null
          capturado_em: string | null
          dados_extras: Json | null
          email: string | null
          formulario_id: string | null
          id: string
          meta_lead_id: string | null
          nome: string | null
          plataforma: string | null
          status_crm: string | null
          telefone: string | null
          user_id: string
        }
        Insert: {
          campanha?: string | null
          campanha_id?: string | null
          capturado_em?: string | null
          dados_extras?: Json | null
          email?: string | null
          formulario_id?: string | null
          id?: string
          meta_lead_id?: string | null
          nome?: string | null
          plataforma?: string | null
          status_crm?: string | null
          telefone?: string | null
          user_id: string
        }
        Update: {
          campanha?: string | null
          campanha_id?: string | null
          capturado_em?: string | null
          dados_extras?: Json | null
          email?: string | null
          formulario_id?: string | null
          id?: string
          meta_lead_id?: string | null
          nome?: string | null
          plataforma?: string | null
          status_crm?: string | null
          telefone?: string | null
          user_id?: string
        }
        Relationships: []
      }
      n8n_chat_histories: {
        Row: {
          created_at: string
          id: number
          instancia: string | null
          message: Json
          session_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          instancia?: string | null
          message: Json
          session_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          instancia?: string | null
          message?: Json
          session_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      oauth_state: {
        Row: {
          expires_at: string
          nonce: string
          user_id: string
        }
        Insert: {
          expires_at: string
          nonce: string
          user_id: string
        }
        Update: {
          expires_at?: string
          nonce?: string
          user_id?: string
        }
        Relationships: []
      }
      opt_out_contatos: {
        Row: {
          created_at: string | null
          id: number
          keyword: string | null
          telefone: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          keyword?: string | null
          telefone: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          keyword?: string | null
          telefone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opt_out_contatos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_imagens: {
        Row: {
          created_at: string | null
          galeria_imagem_id: string | null
          id: string
          legenda: string | null
          ordem: number | null
          principal: boolean | null
          produto_id: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          galeria_imagem_id?: string | null
          id?: string
          legenda?: string | null
          ordem?: number | null
          principal?: boolean | null
          produto_id: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          galeria_imagem_id?: string | null
          id?: string
          legenda?: string | null
          ordem?: number | null
          principal?: boolean | null
          produto_id?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_imagens_galeria_imagem_id_fkey"
            columns: ["galeria_imagem_id"]
            isOneToOne: false
            referencedRelation: "galeria_imagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_imagens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean | null
          catalogo_id: string | null
          codigo: string | null
          created_at: string | null
          custom_fields: Json | null
          descricao: string | null
          estoque: number | null
          id: string
          nome: string
          ordem: number | null
          preco: number | null
          preco_promocional: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ativo?: boolean | null
          catalogo_id?: string | null
          codigo?: string | null
          created_at?: string | null
          custom_fields?: Json | null
          descricao?: string | null
          estoque?: number | null
          id?: string
          nome: string
          ordem?: number | null
          preco?: number | null
          preco_promocional?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ativo?: boolean | null
          catalogo_id?: string | null
          codigo?: string | null
          created_at?: string | null
          custom_fields?: Json | null
          descricao?: string | null
          estoque?: number | null
          id?: string
          nome?: string
          ordem?: number | null
          preco?: number | null
          preco_promocional?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_catalogo_id_fkey"
            columns: ["catalogo_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
        ]
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
      refresh_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          revoked: boolean | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          revoked?: boolean | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          revoked?: boolean | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      respostas_rapidas: {
        Row: {
          atalho: string
          created_at: string | null
          id: string
          mensagem: string
          titulo: string
          user_id: string
        }
        Insert: {
          atalho: string
          created_at?: string | null
          id?: string
          mensagem: string
          titulo: string
          user_id: string
        }
        Update: {
          atalho?: string
          created_at?: string | null
          id?: string
          mensagem?: string
          titulo?: string
          user_id?: string
        }
        Relationships: []
      }
      sub_perfis: {
        Row: {
          ativo: boolean
          avatar_cor: string | null
          created_at: string
          email: string
          id: string
          membro_id: string | null
          modulos: string[]
          nome: string
          primeiro_acesso: boolean
          senha_temp: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          avatar_cor?: string | null
          created_at?: string
          email: string
          id?: string
          membro_id?: string | null
          modulos?: string[]
          nome: string
          primeiro_acesso?: boolean
          senha_temp?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          avatar_cor?: string | null
          created_at?: string
          email?: string
          id?: string
          membro_id?: string | null
          modulos?: string[]
          nome?: string
          primeiro_acesso?: boolean
          senha_temp?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          cor: string | null
          created_at: string | null
          id: string
          nome: string
          user_id: string
        }
        Insert: {
          cor?: string | null
          created_at?: string | null
          id?: string
          nome: string
          user_id: string
        }
        Update: {
          cor?: string | null
          created_at?: string | null
          id?: string
          nome?: string
          user_id?: string
        }
        Relationships: []
      }
      tarefa_comentarios: {
        Row: {
          conteudo: string
          created_at: string
          id: string
          tarefa_id: string
          user_id: string
        }
        Insert: {
          conteudo: string
          created_at?: string
          id?: string
          tarefa_id: string
          user_id: string
        }
        Update: {
          conteudo?: string
          created_at?: string
          id?: string
          tarefa_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefa_comentarios_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas: {
        Row: {
          atribuido_a: string | null
          coluna_id: string
          concluida_em: string | null
          contato_id: string | null
          conversa_id: string | null
          created_at: string
          criada_por: string | null
          data_limite: string | null
          descricao: string | null
          id: string
          lead_id: string | null
          ordem: number
          origem: string | null
          prioridade: string
          resumo_ia: string | null
          sub_perfil_id: string | null
          tags: string[] | null
          titulo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          atribuido_a?: string | null
          coluna_id: string
          concluida_em?: string | null
          contato_id?: string | null
          conversa_id?: string | null
          created_at?: string
          criada_por?: string | null
          data_limite?: string | null
          descricao?: string | null
          id?: string
          lead_id?: string | null
          ordem?: number
          origem?: string | null
          prioridade?: string
          resumo_ia?: string | null
          sub_perfil_id?: string | null
          tags?: string[] | null
          titulo: string
          updated_at?: string
          user_id: string
        }
        Update: {
          atribuido_a?: string | null
          coluna_id?: string
          concluida_em?: string | null
          contato_id?: string | null
          conversa_id?: string | null
          created_at?: string
          criada_por?: string | null
          data_limite?: string | null
          descricao?: string | null
          id?: string
          lead_id?: string | null
          ordem?: number
          origem?: string | null
          prioridade?: string
          resumo_ia?: string | null
          sub_perfil_id?: string | null
          tags?: string[] | null
          titulo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_coluna_id_fkey"
            columns: ["coluna_id"]
            isOneToOne: false
            referencedRelation: "kanban_colunas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "ai_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_sub_perfil_id_fkey"
            columns: ["sub_perfil_id"]
            isOneToOne: false
            referencedRelation: "sub_perfis"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_whatsapp: {
        Row: {
          connected_at: string | null
          created_at: string
          error_message: string | null
          id: string
          instance_name: string
          last_disconnect_at: string | null
          phone_number: string | null
          qr_code: string | null
          qr_expires_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          instance_name: string
          last_disconnect_at?: string | null
          phone_number?: string | null
          qr_code?: string | null
          qr_expires_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          instance_name?: string
          last_disconnect_at?: string | null
          phone_number?: string | null
          qr_code?: string | null
          qr_expires_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      user_modulos: {
        Row: {
          ativo: boolean
          created_at: string | null
          id: string
          modulo: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string | null
          id?: string
          modulo: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string | null
          id?: string
          modulo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_modulos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      users: {
        Row: {
          active: boolean
          avatar_url: string | null
          cargo_id: string | null
          created_at: string
          display_name: string | null
          email: string
          email_verified: boolean
          id: string
          last_login_at: string | null
          owner_id: string | null
          password_hash: string
          role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          cargo_id?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          email_verified?: boolean
          id?: string
          last_login_at?: string | null
          owner_id?: string | null
          password_hash: string
          role?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          cargo_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          email_verified?: boolean
          id?: string
          last_login_at?: string | null
          owner_id?: string | null
          password_hash?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_cargo_id_fkey"
            columns: ["cargo_id"]
            isOneToOne: false
            referencedRelation: "cargos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_mensagens_processadas: {
        Row: {
          criado_em: string | null
          instancia: string | null
          message_id: string
        }
        Insert: {
          criado_em?: string | null
          instancia?: string | null
          message_id: string
        }
        Update: {
          criado_em?: string | null
          instancia?: string | null
          message_id?: string
        }
        Relationships: []
      }
      whatsapp_chat_prefs: {
        Row: {
          archived: boolean | null
          created_at: string | null
          id: string
          muted_until: string | null
          pinned: boolean | null
          remote_jid: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          archived?: boolean | null
          created_at?: string | null
          id?: string
          muted_until?: string | null
          pinned?: boolean | null
          remote_jid: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          archived?: boolean | null
          created_at?: string | null
          id?: string
          muted_until?: string | null
          pinned?: boolean | null
          remote_jid?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_chat_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_message_status: {
        Row: {
          id: string
          instance_name: string
          message_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          instance_name: string
          message_id: string
          status: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          instance_name?: string
          message_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          content: string | null
          created_at: string | null
          deleted_at: string | null
          from_me: boolean
          id: string
          instance_name: string
          is_hidden: boolean | null
          is_read: boolean | null
          media_mimetype: string | null
          media_url: string | null
          message_id: string | null
          message_type: string
          midia_nome: string | null
          push_name: string | null
          remote_jid: string
          reply_to_content: string | null
          reply_to_message_id: string | null
          reply_to_sender: string | null
          sent_by_user_id: string | null
          session_id: string
          status: string | null
          timestamp_unix: number | null
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          deleted_at?: string | null
          from_me?: boolean
          id: string
          instance_name: string
          is_hidden?: boolean | null
          is_read?: boolean | null
          media_mimetype?: string | null
          media_url?: string | null
          message_id?: string | null
          message_type?: string
          midia_nome?: string | null
          push_name?: string | null
          remote_jid: string
          reply_to_content?: string | null
          reply_to_message_id?: string | null
          reply_to_sender?: string | null
          sent_by_user_id?: string | null
          session_id: string
          status?: string | null
          timestamp_unix?: number | null
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          deleted_at?: string | null
          from_me?: boolean
          id?: string
          instance_name?: string
          is_hidden?: boolean | null
          is_read?: boolean | null
          media_mimetype?: string | null
          media_url?: string | null
          message_id?: string | null
          message_type?: string
          midia_nome?: string | null
          push_name?: string | null
          remote_jid?: string
          reply_to_content?: string | null
          reply_to_message_id?: string | null
          reply_to_sender?: string | null
          sent_by_user_id?: string | null
          session_id?: string
          status?: string | null
          timestamp_unix?: number | null
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
      get_next_disparo_batch: {
        Args: { p_limit: number }
        Returns: {
          disparo_id: string
          legenda_midia: string
          log_id: string
          mensagem: string
          telefone: string
          tipo_midia: string
          url_midia: string
          user_id: string
        }[]
      }
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
