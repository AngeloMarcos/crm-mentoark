# Prompt Lovable A — Sidebar: Ícones únicos para todos os módulos

## Objetivo
Corrigir os ícones duplicados e atribuir um ícone exclusivo e semântico para cada módulo. O problema atual: **Marketing Digital** e **Campanhas** usam o mesmo ícone `Megaphone`.

---

## Arquivo: `src/components/AppSidebar.tsx`

Substituir o bloco de imports e o array `items` completo pelo código abaixo. **Não alterar nenhuma outra parte do componente.**

### Novo bloco de imports

```tsx
import {
  LayoutDashboard, BarChart3, UserPlus, Tags, BookUser,
  PhoneCall, Filter, MessageCircle, Timer, Zap,
  Send, Megaphone, Rocket, GitBranch, Bot, Plug,
  Brain, Package, Images, BookOpen, ShieldCheck, LogOut,
} from "lucide-react";
```

### Novo array `items`

```tsx
const items = [
  // Visão Geral
  { title: "Dashboard",         url: "/dashboard",   icon: LayoutDashboard, modulo: "dashboard",   color: "text-blue-500"    },
  { title: "Central de BI",     url: "/bi",          icon: BarChart3,       modulo: "dashboard",   color: "text-cyan-500"    },

  // Clientes & Vendas
  { title: "Leads",             url: "/leads",       icon: UserPlus,        modulo: "leads",       color: "text-indigo-500"  },
  { title: "Tags e Funil",      url: "/tags-funil",  icon: Tags,            modulo: "leads",       color: "text-violet-500"  },
  { title: "Contatos",          url: "/contatos",    icon: BookUser,        modulo: "contatos",    color: "text-purple-500"  },
  { title: "Funil de Vendas",   url: "/funil",       icon: Filter,          modulo: "funil",       color: "text-orange-500"  },

  // Atendimento
  { title: "WhatsApp",          url: "/whatsapp",    icon: MessageCircle,   modulo: "whatsapp",    color: "text-green-500"   },
  { title: "Discagem",          url: "/discagem",    icon: PhoneCall,       modulo: "discagem",    color: "text-emerald-500" },
  { title: "SLA",               url: "/sla",         icon: Timer,           modulo: "whatsapp",    color: "text-yellow-500"  },
  { title: "Respostas Rápidas", url: "/respostas",   icon: Zap,             modulo: "whatsapp",    color: "text-amber-500"   },

  // Comunicação
  { title: "Disparos",          url: "/disparos",    icon: Send,            modulo: "disparos",    color: "text-sky-500"     },
  { title: "Campanhas",         url: "/campanhas",   icon: Megaphone,       modulo: "campanhas",   color: "text-rose-500"    },
  { title: "Marketing Digital", url: "/marketing-digital", icon: Rocket,   modulo: "campanhas",   color: "text-blue-600"    },

  // Automação & IA
  { title: "Workflows",         url: "/workflows",   icon: GitBranch,       modulo: "workflows",   color: "text-violet-500"  },
  { title: "Agentes",           url: "/agentes",     icon: Bot,             modulo: "agentes",     color: "text-teal-500"    },
  { title: "Cérebro do Agente", url: "/cerebro",     icon: Brain,           modulo: "cerebro",     color: "text-purple-400"  },
  { title: "Integrações",       url: "/integracoes", icon: Plug,            modulo: "integracoes", color: "text-amber-500"   },

  // Conteúdo
  { title: "Catálogo",          url: "/catalogo",    icon: Package,         modulo: "catalogo",    color: "text-fuchsia-500" },
  { title: "Galeria",           url: "/galeria",     icon: Images,          modulo: "galeria",     color: "text-pink-500"    },

  // Admin
  { title: "Documentação",      url: "/docs",        icon: BookOpen,        modulo: "docs",        color: "text-slate-400"   },
  { title: "Usuários",          url: "/usuarios",    icon: ShieldCheck,     modulo: "usuarios",    color: "text-teal-600"    },
];
```

---

## Resumo das mudanças de ícone

| Módulo | Antes | Depois |
|--------|-------|--------|
| Marketing Digital | `Megaphone` (igual a Campanhas) | `Rocket` 🚀 |
| Central de BI | `PieChart` | `BarChart3` |
| Leads | `Users` | `UserPlus` |
| Tags e Funil | (novo) | `Tags` |
| Contatos | `Contact` | `BookUser` |
| Funil de Vendas | `Kanban` | `Filter` |
| SLA | (novo) | `Timer` |
| Respostas Rápidas | (novo) | `Zap` |
| Catálogo | `LayoutGrid` | `Package` |

---

## Não alterar
Nenhuma outra parte do `AppSidebar.tsx`. Apenas os imports e o array `items`.
