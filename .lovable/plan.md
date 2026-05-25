
# Reorganizar sidebar com subgrupos colapsáveis

## Objetivo

Transformar o sidebar de 2 níveis (categoria → item) para **3 níveis** (categoria → subgrupo expansível → itens), no estilo da imagem de referência. Criar uma seção grande "WhatsApp Chat" que centraliza tudo relacionado a atendimento e à IA do chat, todos fechados por padrão.

## Nova estrutura do sidebar

```text
VISÃO GERAL
  • Dashboard
  • Central de BI

CLIENTES & VENDAS
  • Leads
  • Tags e Funil
  • Contatos
  • Funil de Vendas

CHAT
  ▸ WhatsApp Chat              (fechado por padrão)
      • WhatsApp
      • Caixa de Entrada       (nova aba dentro de /whatsapp)
      • Respostas Rápidas
      • SLA / Gestão
      • Cérebro do Agente
      • Agentes
      • Workflows
      • Integrações
  ▸ Telefonia                  (fechado por padrão)
      • Discagem

COMUNICAÇÃO
  ▸ Campanhas & Disparos
      • Disparos
      • Campanhas
      • Marketing Digital

CONTEÚDO
  ▸ Biblioteca
      • Catálogo
      • Galeria
      • Documentação

ADMINISTRAÇÃO  (admin only)
  ▸ Acessos
      • Usuários
      • Segurança
```

Todos os subgrupos iniciam **fechados**. O usuário expande manualmente.

## Mudanças visuais (estilo da imagem)

- Linha do subgrupo: ícone à esquerda, título, chevron à direita; fundo levemente destacado quando ativo (gradiente da marca).
- Quando aberto, mostra uma **guia vertical** (border-l) à esquerda dos sub-itens com indentação extra (~pl-8).
- Sub-itens com ícone menor + texto, hover sutil; item ativo recebe a barra vertical gradiente já existente.

## Arquivos afetados

### `src/components/AppSidebar.tsx`
- Adicionar tipo `NavSubgroup { label, icon, items, defaultOpen? }` e ajustar `NavGroup` para aceitar **`subgroups`** ao invés de (ou além de) `items` planos.
- Reescrever `navGroups` na nova estrutura acima.
- Criar `NavSubgroupSection` (item colapsável com ícone + chevron) reaproveitando o estilo dos botões atuais.
- Em `NavGroupSection`, renderizar a lista de subgrupos; a categoria continua sendo só o label (CHAT, COMUNICAÇÃO, etc.).
- Estado `open` dos subgrupos inicializa em `false` (todos fechados); apenas o subgrupo que contém a rota ativa abre automaticamente na primeira renderização.
- Modo `collapsed` (sidebar mini): subgrupo vira só o ícone com tooltip; ao clicar, abre um popover/flyout — para simplificar, no colapsado os subgrupos ficam sempre "achatados" mostrando os ícones dos sub-itens diretamente.

### `src/pages/WhatsApp.tsx`
- Adicionar uma terceira aba **"Caixa de Entrada"** ao lado de "Conversas" e "Instâncias".
- Reusa `WhatsAppInterface` (mesma UI das conversas) ou um filtro de "não lidas"; nesta passada, "Caixa de Entrada" exibirá `<WhatsAppInterface />` (mesmo componente — apenas título/ícone diferentes). Ajuste fino fica para um próximo prompt.

## Fora de escopo

- Nenhuma mudança no backend, banco, ou rotas Express.
- Sem novas rotas no React Router; "Caixa de Entrada" é uma aba dentro de `/whatsapp`.
- Não mexer em tokens de cor nem no layout das páginas internas.

## Detalhes técnicos

- A persistência do estado aberto/fechado fica em memória (`useState` local). Sem `localStorage` nesta passada.
- `adminOnly` continua suportado por subgrupo e por item (cascateia). Workflows / Agentes / Cérebro / Integrações mantêm `adminOnly: true`.
- Manter `hasModulo` em todos os itens; subgrupo só renderiza se tiver pelo menos um item visível.
