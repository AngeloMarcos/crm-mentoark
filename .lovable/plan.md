
Adicionar um botão do WhatsApp ao lado do telefone na lista de leads que abre `https://wa.me/<numero>` em nova aba. Vou:

1. Criar helper `formatWhatsappNumber` que limpa o telefone (remove `()`, espaços, `-`, `+`) e adiciona `55` (Brasil) caso o número não tenha código de país.
2. Adicionar o botão (ícone do WhatsApp em verde) ao lado do número na coluna telefone da tabela em `src/pages/Leads.tsx`, com `target="_blank"` e `e.stopPropagation()` para não disparar o click da linha.
3. Usar o token semântico `--whatsapp` já existente no design system.
