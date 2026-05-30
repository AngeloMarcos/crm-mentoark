## Objetivo
Completar a gestão de usuários em `/usuarios` (a página já tem listagem, excluir, resetar senha, alternar admin e gerenciar módulos). Falta o **"+ Adicionar Novo Usuário"** e ajustar o padrão de módulos para o mínimo: **Dashboard + Leads + WhatsApp**.

## O que vai mudar

### 1. Backend — nova rota `POST /api/profiles` (admin only)
Arquivo: `backend/src/routes/usuarios.ts`

- Recebe `{ email, password, display_name }`
- Valida: email único, senha ≥ 6 chars
- Cria usuário em `users` (hash bcrypt, `role='user'`)
- Insere `user_modulos` apenas com `['dashboard','leads','whatsapp']` (`ativo=true`)
- Retorna `{ user_id, email, display_name }`

### 2. Backend — alterar padrão de módulos
Arquivo: `backend/src/routes/modulos.ts` (lista `TODOS_MODULOS`)

Mudar `padrao: true` para `false` em **contatos, discagem, funil, disparos**. Permanecem `padrao: true` apenas: **dashboard, leads, whatsapp**. Isso afeta:
- Novos signups via `/auth/register` (que provavelmente cria com padrão — vamos checar)
- Botão "Resetar para padrão" no modal de módulos
- Fallback quando usuário não tem nenhum registro em `user_modulos`

### 3. Frontend — modal "Adicionar Novo Usuário"
Arquivo: `src/pages/Usuarios.tsx`

- Botão **"+ Adicionar Novo Usuário"** no topo direito do header da página
- Modal com campos: Nome Completo, E-mail, Senha, Confirmar Senha
- Validação client-side (zod-style inline): email válido, senha ≥ 6, senhas iguais
- Submit → `POST /api/profiles` → toast sucesso → recarrega lista
- Mensagem de feedback: "Usuário criado com acesso a Dashboard, Leads e WhatsApp. Use o botão Módulos para liberar mais."

## Detalhes técnicos

- Token: `getAuthToken()` (já em uso no arquivo)
- Base URL: `VITE_API_URL` (já em uso)
- Inserts no backend rodam em transação (`BEGIN/COMMIT`) para garantir consistência de `users` + `user_modulos`
- Admin não pode se auto-excluir (já implementado)

## Fora do escopo
- Cargos/Departamentos/Filiais (telas das imagens anexadas — não implementar agora, são referência visual)
- Edição inline de nome/e-mail do usuário (pode entrar em sprint futura)
- Convite por e-mail — usuário recebe a senha direto do admin

## Após aprovação
Implemento os 2 arquivos frontend + 2 arquivos backend e te entrego o `scp` pronto para deploy na VPS (já que o backend roda em `api.mentoark.com.br`, não no Lovable).
