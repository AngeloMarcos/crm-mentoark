Adicionarei uma nova página de cadastro (`src/pages/Register.tsx`) e integrarei com o fluxo de autenticação existente.

### Alterações:
1.  **Criar `src/pages/Register.tsx`**: Uma nova tela de cadastro seguindo a identidade visual da página de login, com validações de:
    *   E-mail válido.
    *   Senha com no mínimo 6 caracteres.
    *   Confirmação de senha coincidente.
    *   Nome completo obrigatório.
2.  **Configurar Redirecionamento**: Adicionar a rota `/register` em `App.tsx`.
3.  **Atualizar `src/pages/Login.tsx`**: Ajustar o link "Cadastre-se" para navegar para a nova página `/register` em vez de apenas alternar um estado interno (para melhor experiência de navegação).
4.  **Processo de Confirmação**: O Supabase Auth enviará automaticamente um e-mail de confirmação (se configurado no projeto). A página exibirá uma mensagem clara instruindo o usuário a verificar sua caixa de entrada.

### Detalhes Técnicos:
*   Uso do `api.auth.signUp` do Supabase.
*   Validação de formulário com estados React simples e feedback via `useToast`.
*   Layout responsivo com o painel de branding da MentoArk à direita (consistente com o Login).
