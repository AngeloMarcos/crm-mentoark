# Sprint 1 — Auditoria: Auth — Rate Limiting + Validação de Entrada
**Arquivo:** `backend/src/auth.ts`
**Severidade:** 🔴 CRÍTICO

---

## Problemas encontrados

### 1. Sem rate limiting no login — ataque de força bruta possível
`POST /auth/login` aceita tentativas ilimitadas. Um bot pode testar senhas
indefinidamente sem nenhum bloqueio.

### 2. Sem rate limiting no registro — criação de contas spam
`POST /auth/register` também sem proteção. Bots podem criar milhares de contas.

### 3. Sem validação de formato de e-mail no registro
`email.toLowerCase().trim()` sem verificar se é um e-mail válido.
Um body `{ "email": "qualquercoisa", "password": "123456" }` é aceito.

### 4. Login faz 2 queries ao banco quando senha usa pgcrypto (legado)
Se a senha não começa com `$2` (bcrypt), faz uma segunda query com `crypt()`.
Usuários antigos sempre pagam custo duplo.

---

## Fixes

### Instalar dependência de rate limiting
```bash
npm install express-rate-limit
```

### Substituição completa do arquivo `backend/src/auth.ts`

Adicionar no topo:
```typescript
import rateLimit from 'express-rate-limit';

// Rate limiter: máximo 10 tentativas por IP em 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 10,
  message: { message: 'Muitas tentativas de login. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Combina IP + email para bloquear por alvo, não só por IP
    const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
    const email = (req.body?.email || '').toLowerCase().trim();
    return `${ip}:${email}`;
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hora
  max: 5,
  message: { message: 'Limite de cadastros por IP atingido. Aguarde 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Regex simples para validar formato de e-mail
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

Aplicar o limiter nas rotas:

```typescript
// POST /auth/login — com rate limiter
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
    }

    // Validar formato de e-mail
    if (!EMAIL_REGEX.test(String(email))) {
      return res.status(400).json({ message: 'Formato de e-mail inválido' });
    }
    // ... resto do handler igual
  }
});

// POST /auth/register — com rate limiter
router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
    }

    // Validar formato de e-mail
    if (!EMAIL_REGEX.test(String(email))) {
      return res.status(400).json({ message: 'Formato de e-mail inválido' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Senha deve ter pelo menos 6 caracteres' });
    }
    // ... resto do handler igual
  }
});
```

### Otimizar pgcrypto fallback (log de migração pendente)

No bloco de login, logar quando a migração de senha for feita, para
acompanhar a progressão:

```typescript
    // Rehash com bcrypt ao primeiro login com pgcrypto (migração automática)
    if (valid) {
      const newHash = await bcrypt.hash(password, 12);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
      console.log(`[AUTH] Senha migrada de pgcrypto → bcrypt para user ${user.id}`);
    }
```

---

## Relatório solicitado ao final

Após aplicar, informe:
1. Rate limiter instalado e ativo em login e registro?
2. Validação de e-mail adicionada?
3. Log de migração pgcrypto funcionando?
4. Quais outros problemas de segurança foram identificados no arquivo?
