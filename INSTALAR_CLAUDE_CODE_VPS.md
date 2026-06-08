# Prompt para Claude Code local — Instalar e autenticar Claude Code na VPS

Cole este prompt no Claude Code da sua máquina (dentro de qualquer pasta).
Ele vai conectar na VPS, instalar o Claude Code lá e deixar pronto para rodar.

---

## PRÉ-REQUISITO

Você precisa da sua **Anthropic API Key**. Obtenha em:
https://console.anthropic.com/settings/keys

Copie a chave (começa com `sk-ant-...`) antes de começar.

---

## PROMPT

```
Você vai instalar e configurar o Claude Code na VPS de produção do projeto.

VPS:
- IP: 147.93.9.172
- Usuário: root
- Senha: Mentoark@2025
- Acesso: sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172

Execute cada passo em ordem via bash. Reporte o resultado de cada um antes de avançar.

---

## PASSO 1 — Verificar ambiente atual da VPS

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'EOF'
echo "=== OS ==="
cat /etc/os-release | grep PRETTY_NAME

echo ""
echo "=== Node.js ==="
node --version 2>/dev/null || echo "Node.js NÃO instalado"

echo ""
echo "=== npm ==="
npm --version 2>/dev/null || echo "npm NÃO instalado"

echo ""
echo "=== Claude Code ==="
claude --version 2>/dev/null || echo "Claude Code NÃO instalado"

echo ""
echo "=== Disk space ==="
df -h / | tail -1

echo ""
echo "=== Memória ==="
free -h | grep Mem
EOF
```

---

## PASSO 2 — Instalar Node.js LTS (se não estiver instalado)

Se o Passo 1 mostrou que Node.js não está instalado, execute:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'EOF'
# Instalar Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo ""
echo "=== Versões após instalação ==="
node --version
npm --version
EOF
```

Se Node.js já estava instalado com versão >= 18, pule este passo.

---

## PASSO 3 — Instalar Claude Code globalmente na VPS

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'EOF'
# Instalar Claude Code
npm install -g @anthropic-ai/claude-code

echo ""
echo "=== Verificando instalação ==="
claude --version

echo ""
echo "=== Caminho do binário ==="
which claude
EOF
```

---

## PASSO 4 — Configurar a API Key do Anthropic na VPS

Em servidores headless (sem browser), a autenticação é feita via variável de ambiente.
Execute o comando abaixo substituindo SUA_CHAVE pela sua API Key real:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'EOF'
# Adicionar a chave ao .bashrc para persistir entre sessões
echo 'export ANTHROPIC_API_KEY="SUA_CHAVE_AQUI"' >> /root/.bashrc

# Carregar imediatamente na sessão atual
export ANTHROPIC_API_KEY="SUA_CHAVE_AQUI"

echo "=== Testando autenticação ==="
claude --version
echo "Chave configurada: ${ANTHROPIC_API_KEY:0:20}***"
EOF
```

> ATENÇÃO: substitua SUA_CHAVE_AQUI pela chave real que começa com sk-ant-...
> Nunca compartilhe essa chave em logs públicos.

---

## PASSO 5 — Verificar que o Claude Code consegue rodar na VPS

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'EOF'
source /root/.bashrc
cd /opt/crm/backend

echo "=== Teste rápido do Claude Code (modo não-interativo) ==="
claude --print "Liste os arquivos TypeScript em src/routes/ e me diga quantos existem." 2>&1

EOF
```

Se retornar a resposta do Claude com a listagem de arquivos, está funcionando.

---

## PASSO 6 — Criar alias útil para rodar Claude Code no projeto

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'EOF'
# Alias para entrar direto no projeto do backend
echo 'alias crm-ai="cd /opt/crm/backend && claude"' >> /root/.bashrc

# Alias para rodar prompt não-interativo no projeto
echo 'alias crm-fix="cd /opt/crm/backend && claude --print"' >> /root/.bashrc

source /root/.bashrc
echo "Aliases criados: crm-ai e crm-fix"
EOF
```

---

## PASSO 7 — Teste final: rodar Claude Code interativamente na VPS

Após os passos anteriores, você pode rodar Claude Code diretamente na VPS com:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 -t 'bash -l -c "cd /opt/crm/backend && claude"'
```

A flag `-t` aloca um pseudo-terminal para o modo interativo funcionar.

Ou se preferir uma sessão SSH normal primeiro e rodar lá:
```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172
# Dentro da VPS:
cd /opt/crm/backend
claude
```

---

## RESULTADO ESPERADO

Ao final, reporte:
1. Versão do Node.js instalada na VPS
2. Versão do Claude Code instalada (`claude --version`)
3. Se o Passo 5 (teste não-interativo) retornou resposta correta
4. Qualquer erro que apareceu (com o texto exato)
```

---

## COMO USAR O CLAUDE CODE NA VPS DEPOIS DE INSTALADO

Uma vez instalado, você pode enviar prompts diretamente para o Claude Code na VPS de duas formas:

### Modo interativo (sessão de chat)
```bash
sshpass -p 'Mentoark@2025' ssh -t -o StrictHostKeyChecking=no root@147.93.9.172 \
  'bash -l -c "cd /opt/crm/backend && claude"'
```

### Modo não-interativo (executar um prompt e sair)
```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'bash -l -c "cd /opt/crm/backend && claude --print \"SEU PROMPT AQUI\""'
```

### Exemplo: rodar o prompt de correção diretamente na VPS
```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'bash -l -c "cd /opt/crm/backend && claude --print \"Leia o arquivo src/routes/webhook.ts e me diga se existe um bloco de UPSERT antecipado de contato com ON CONFLICT antes do bloco if (fromMe).\""'
```
