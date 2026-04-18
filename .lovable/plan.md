

## Diagnóstico

O usuário `mentoark@gmail.com` foi inserido manualmente em `auth.users` via migration, mas com colunas de token (`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current`, `reauthentication_token`) como `NULL`. O GoTrue v2.188.1 não aceita NULL nessas colunas — precisa de string vazia. Resultado: **todo login retorna 500**, não só o desse usuário.

## Plano

**1 migration única que faz duas coisas:**

1. **Apaga o usuário corrompido** `mentoark@gmail.com` de `auth.users` (cascata limpa `auth.identities`, `profiles`, `user_roles`).
2. **Corrige globalmente** todas as colunas de token NULL em `auth.users` para `''` (defensivo, caso haja outros).

**Depois, criar a conta da forma correta:** usar a tela de cadastro normal em `/login` (aba "Cadastre-se"). O trigger `handle_new_user` já está configurado para detectar o email `mentoark@gmail.com` e atribuir role `admin` automaticamente. Como auto-confirm está ativo, o login funciona imediatamente após o cadastro.

## SQL da migration

```sql
-- Remove usuário corrompido inserido manualmente
DELETE FROM auth.users WHERE email = 'mentoark@gmail.com';

-- Corrige NULLs em colunas de token que quebram o GoTrue
UPDATE auth.users SET
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  phone_change_token = COALESCE(phone_change_token, '');
```

## Próximo passo do usuário

1. Aprovar a migration
2. Hard refresh (Ctrl+Shift+R) na tela `/login`
3. Clicar em **"Não tem conta? Cadastre-se"**
4. Cadastrar com `mentoark@gmail.com` / `Mentoark@2025`
5. Fazer login — virará admin automaticamente

