# Prompt Lovable — Login: Verificação Cloudflare Turnstile

## Objetivo
Adicionar o widget de verificação **Cloudflare Turnstile** (o "Verificando..." que o
Cloudflare mostra antes de liberar o acesso) diretamente no formulário de login e
de cadastro. O botão de envio só fica habilitado depois que o Turnstile confirmar que
o usuário é humano. O token gerado é verificado no backend antes de chamar o Supabase.

---

## Antes de aplicar este prompt

No painel da Cloudflare (https://dash.cloudflare.com → Turnstile → Add Site):
1. Crie um site com o domínio `crm.mentoark.com.br` (e `localhost` para dev)
2. Copie a **Site Key** (pública) e a **Secret Key** (privada)
3. No projeto Lovable, adicione em variáveis de ambiente:
   - `VITE_TURNSTILE_SITE_KEY` = sua Site Key pública
4. No VPS, adicione ao `.env` do backend:
   - `TURNSTILE_SECRET_KEY` = sua Secret Key privada

---

## Passo 1 — Instalar pacote

```bash
npm install @marsidev/react-turnstile
```

---

## Passo 2 — `src/pages/Login.tsx`

### Adicionar imports

```tsx
import Turnstile, { useTurnstile } from "@marsidev/react-turnstile";
```

### Adicionar estado e ref do token

Logo após os `useState` existentes, adicionar:

```tsx
const turnstile = useTurnstile();
const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
const [turnstileKey, setTurnstileKey] = useState(0); // força reset do widget
```

### Atualizar `handleSubmit`

Antes de chamar `api.auth.signInWithPassword` ou `api.auth.signUp`, verificar o token
e enviá-lo ao backend para validação:

```tsx
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true);

  if (!acceptedTerms) {
    toast({
      title: "Atenção",
      description: "Você deve aceitar os Termos de Uso e Política de Privacidade.",
      variant: "destructive",
    });
    setLoading(false);
    return;
  }

  if (!turnstileToken) {
    toast({
      title: "Verificação necessária",
      description: "Aguarde a verificação do Cloudflare ser concluída.",
      variant: "destructive",
    });
    setLoading(false);
    return;
  }

  try {
    // Verificar token no backend antes de autenticar
    const verifyResp = await fetch(`${API_BASE}/auth/turnstile-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: turnstileToken }),
    });

    if (!verifyResp.ok) {
      throw new Error("Falha na verificação de segurança. Tente novamente.");
    }

    if (isLogin) {
      const { error } = await api.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate("/dashboard");
    } else {
      const { error } = await api.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: { display_name: displayName || email.split("@")[0] },
        },
      });
      if (error) throw error;
      toast({ title: "Conta criada", description: "Você já pode entrar." });
      setIsLogin(true);
    }
  } catch (err: any) {
    // Reset do widget em caso de erro
    setTurnstileToken(null);
    setTurnstileKey(k => k + 1);
    toast({
      title: "Erro",
      description: err.message?.includes("Invalid login")
        ? "E-mail ou senha incorretos."
        : err.message,
      variant: "destructive",
    });
  } finally {
    setLoading(false);
  }
};
```

### Inserir o widget no formulário

Dentro do `<form>`, entre o bloco do checkbox dos Termos e o botão de submit,
adicionar o widget Turnstile:

```tsx
{/* Cloudflare Turnstile */}
<div className="flex justify-center">
  <Turnstile
    key={turnstileKey}
    siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA"}
    onSuccess={(token) => setTurnstileToken(token)}
    onExpire={() => setTurnstileToken(null)}
    onError={() => {
      setTurnstileToken(null);
      toast({ title: "Erro de verificação", description: "Recarregue a página.", variant: "destructive" });
    }}
    options={{
      theme: "dark",
      language: "pt-BR",
      size: "normal",
    }}
    className="mx-auto"
  />
</div>
```

### Desabilitar botão enquanto aguarda Turnstile

No botão de submit, alterar `disabled`:

```tsx
<Button
  type="submit"
  className="w-full gap-2 bg-gradient-to-r from-purple-600 to-blue-600 ..."
  disabled={loading || !turnstileToken}
>
```

Isso garante que o botão fica cinza e inativo até o Turnstile verificar.

### Reset ao trocar entre Login e Cadastro

Na função ou no botão que alterna `isLogin`, também resetar o Turnstile:

```tsx
onClick={() => {
  setIsLogin(!isLogin);
  setTurnstileToken(null);
  setTurnstileKey(k => k + 1);
}}
```

---

## Passo 3 — Backend: `backend/src/auth.ts`

Adicionar o endpoint de verificação no roteador de autenticação. Localizar o arquivo
`src/auth.ts` e adicionar antes do `export default`:

```typescript
// POST /auth/turnstile-verify
// Verifica o token Turnstile gerado no frontend
authRouter.post('/turnstile-verify', async (req, res) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    return res.status(400).json({ error: 'Token ausente' });
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Se não configurado no servidor, permite passar (dev sem variável)
    console.warn('[Turnstile] TURNSTILE_SECRET_KEY não configurado — verificação ignorada');
    return res.json({ success: true, dev: true });
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token);
    // Opcional: remoteip para maior segurança
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip) formData.append('remoteip', String(ip).split(',')[0].trim());

    const cfResp = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      }
    );

    const result = await cfResp.json() as { success: boolean; 'error-codes'?: string[] };

    if (!result.success) {
      console.warn('[Turnstile] Falha na verificação:', result['error-codes']);
      return res.status(403).json({
        error: 'Verificação de segurança falhou. Tente novamente.',
        codes: result['error-codes'],
      });
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Turnstile] Erro ao verificar:', err.message);
    return res.status(500).json({ error: 'Erro interno na verificação' });
  }
});
```

---

## Como funciona o fluxo completo

```
Usuário abre /login
   └─→ Turnstile carrega automaticamente e mostra "Verificando..."
       └─→ [sucesso] widget some e guarda token no estado
           Botão "Entrar" fica habilitado
           Usuário clica em "Entrar"
           └─→ Frontend chama POST /auth/turnstile-verify com o token
               └─→ Backend verifica com Cloudflare (API privada)
                   └─→ [ok] chama Supabase signInWithPassword
                   └─→ [falha] erro exibido, widget resetado
```

---

## Chave de teste (desenvolvimento)

A Cloudflare disponibiliza chaves de teste para desenvolvimento local:
- Site Key de teste: `1x00000000000000000000AA`
- Secret Key de teste: `1x0000000000000000000000000000000AA`

Com essas chaves o widget sempre passa — bom para desenvolver sem precisar da conta.

---

## O que muda visualmente

| Antes | Depois |
|-------|--------|
| Botão "Entrar" sempre ativo | Botão desabilitado até Turnstile verificar |
| Nenhuma proteção contra bots | Widget Cloudflare entre os Termos e o botão |
| Formulário submete direto | Verificação dupla: Turnstile + Supabase |
| Token não validado no servidor | Backend valida com API privada da Cloudflare |

---

## Não alterar
Apenas `src/pages/Login.tsx` e `backend/src/auth.ts`. Nenhum outro arquivo.
