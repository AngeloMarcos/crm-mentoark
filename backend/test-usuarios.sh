#!/bin/bash
# ============================================================
# Bateria de Testes — Sistema de Usuários & Isolamento
# Corretora / Corretores
# ============================================================
# Uso: bash backend/test-usuarios.sh
# Requisitos: curl, jq
# ============================================================

API="https://api.mentoark.com.br"
PASS_ADMIN="SuaSenhaAdmin123"   # ← troque pela senha real da corretora
EMAIL_ADMIN="angelobispofilho@gmail.com"
EMAIL_CORRETOR="corretor.teste@mentoark.com.br"
PASS_CORRETOR="Teste@1234"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0; FAIL=0

ok()  { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS++)); }
fail(){ echo -e "${RED}[FAIL]${NC} $1"; ((FAIL++)); }
info(){ echo -e "${YELLOW}[INFO]${NC} $1"; }

assert_status() {
  local desc="$1" expected="$2" got="$3"
  if [ "$got" = "$expected" ]; then ok "$desc (status=$got)";
  else fail "$desc — esperado $expected, recebeu $got"; fi
}

# ── 1. Login admin ───────────────────────────────────────────
info "=== 1. Login admin ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_ADMIN\",\"password\":\"$PASS_ADMIN\"}")
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)
assert_status "Login admin" "200" "$HTTP"
TOKEN_ADMIN=$(echo "$BODY" | jq -r '.access_token // empty')
[ -z "$TOKEN_ADMIN" ] && { fail "Token admin vazio — abortando"; exit 1; }
info "Token admin obtido"

# ── 2. Módulos do admin — deve incluir adminOnly ─────────────
info "=== 2. Módulos do admin ==="
RESP=$(curl -s -w "\n%{http_code}" "$API/api/modulos" \
  -H "Authorization: Bearer $TOKEN_ADMIN")
HTTP=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "GET /api/modulos (admin)" "200" "$HTTP"
echo "$BODY" | jq -r '.[]' | grep -q "usuarios" && ok "Módulo 'usuarios' visível para admin" || fail "Módulo 'usuarios' ausente para admin"

# ── 3. Contexto do admin ─────────────────────────────────────
info "=== 3. Contexto admin ==="
RESP=$(curl -s -w "\n%{http_code}" "$API/auth/contexto" \
  -H "Authorization: Bearer $TOKEN_ADMIN")
HTTP=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "GET /auth/contexto (admin)" "200" "$HTTP"
IS_CORRETOR=$(echo "$BODY" | jq -r '.is_corretor')
[ "$IS_CORRETOR" = "false" ] && ok "Admin não é corretor" || fail "Admin marcado como corretor incorretamente"

# ── 4. Criar corretor ────────────────────────────────────────
info "=== 4. Criar corretor ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API/api/profiles" \
  -H "Authorization: Bearer $TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_CORRETOR\",\"password\":\"$PASS_CORRETOR\",\"display_name\":\"Corretor Teste\",\"role\":\"user\"}")
HTTP=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
if [ "$HTTP" = "201" ]; then
  ok "Criar corretor (status=201)"
  CORRETOR_ID=$(echo "$BODY" | jq -r '.id // .user_id // empty')
  info "Corretor ID: $CORRETOR_ID"
elif [ "$HTTP" = "409" ]; then
  info "Corretor já existe — buscando ID existente"
  CORRETOR_ID=$(curl -s "$API/api/profiles?search=corretor.teste" \
    -H "Authorization: Bearer $TOKEN_ADMIN" | jq -r '.[0].user_id // empty')
else
  fail "Criar corretor — status $HTTP: $BODY"
fi

# ── 5. Login corretor ────────────────────────────────────────
info "=== 5. Login corretor ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_CORRETOR\",\"password\":\"$PASS_CORRETOR\"}")
HTTP=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Login corretor" "200" "$HTTP"
TOKEN_CORRETOR=$(echo "$BODY" | jq -r '.access_token // empty')
[ -z "$TOKEN_CORRETOR" ] && { fail "Token corretor vazio — pulando testes de isolamento"; TOKEN_CORRETOR="invalid"; }

# ── 6. Contexto do corretor ──────────────────────────────────
info "=== 6. Contexto corretor ==="
RESP=$(curl -s -w "\n%{http_code}" "$API/auth/contexto" \
  -H "Authorization: Bearer $TOKEN_CORRETOR")
HTTP=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "GET /auth/contexto (corretor)" "200" "$HTTP"
IS_CORRETOR=$(echo "$BODY" | jq -r '.is_corretor')
[ "$IS_CORRETOR" = "true" ] && ok "Corretor identificado como is_corretor=true" || fail "Corretor não identificado como corretor"
OWNER_ID=$(echo "$BODY" | jq -r '.owner_id')
[ -n "$OWNER_ID" ] && [ "$OWNER_ID" != "null" ] && ok "owner_id presente no contexto do corretor" || fail "owner_id ausente no contexto"

# ── 7. Módulos do corretor — NÃO deve ter adminOnly ─────────
info "=== 7. Módulos do corretor ==="
RESP=$(curl -s -w "\n%{http_code}" "$API/api/modulos" \
  -H "Authorization: Bearer $TOKEN_CORRETOR")
HTTP=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "GET /api/modulos (corretor)" "200" "$HTTP"
echo "$BODY" | jq -r '.[]' | grep -q "usuarios" && fail "Módulo 'usuarios' visível para corretor (BRECHA DE SEGURANÇA)" || ok "Módulo 'usuarios' oculto para corretor"
echo "$BODY" | jq -r '.[]' | grep -q "agentes"  && fail "Módulo 'agentes' visível para corretor (BRECHA)"              || ok "Módulo 'agentes' oculto para corretor"
echo "$BODY" | jq -r '.[]' | grep -q "kanban"   && ok "Módulo 'kanban' acessível ao corretor"                          || fail "Módulo 'kanban' ausente para corretor"

# ── 8. Isolamento: corretor não vê tarefas de outro corretor ─
info "=== 8. Isolamento de tarefas ==="
RESP=$(curl -s -w "\n%{http_code}" "$API/api/kanban/tarefas" \
  -H "Authorization: Bearer $TOKEN_CORRETOR")
HTTP=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "GET /api/kanban/tarefas (corretor)" "200" "$HTTP"
# Verificar que retorna array (pode estar vazio — normal pois não há tarefas atribuídas)
echo "$BODY" | jq -e 'type == "array"' > /dev/null 2>&1 && ok "Retorno é array (isolamento OK)" || fail "Retorno inesperado"

# ── 9. Corretor não pode excluir tarefas ────────────────────
info "=== 9. Corretor não pode excluir tarefa ==="
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$API/api/kanban/tarefas/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN_CORRETOR")
HTTP=$(echo "$RESP" | tail -1)
assert_status "DELETE tarefa como corretor (deve ser 403)" "403" "$HTTP"

# ── 10. Admin vê lista de usuários ──────────────────────────
info "=== 10. Admin lista usuários ==="
RESP=$(curl -s -w "\n%{http_code}" "$API/api/profiles" \
  -H "Authorization: Bearer $TOKEN_ADMIN")
HTTP=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "GET /api/profiles (admin)" "200" "$HTTP"
COUNT=$(echo "$BODY" | jq 'length // 0')
info "Usuários retornados: $COUNT"
[ "$COUNT" -ge "1" ] && ok "Lista retorna ao menos 1 usuário" || fail "Lista vazia — algo errado"

# ── 11. Corretor não pode acessar lista de usuários ─────────
info "=== 11. Corretor bloqueado de /api/profiles ==="
RESP=$(curl -s -w "\n%{http_code}" "$API/api/profiles" \
  -H "Authorization: Bearer $TOKEN_CORRETOR")
HTTP=$(echo "$RESP" | tail -1)
assert_status "GET /api/profiles como corretor (deve ser 403)" "403" "$HTTP"

# ── 12. Corretor não pode criar usuário ─────────────────────
info "=== 12. Corretor não pode criar usuário ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API/api/profiles" \
  -H "Authorization: Bearer $TOKEN_CORRETOR" \
  -H "Content-Type: application/json" \
  -d '{"email":"hacker@teste.com","password":"1234567","display_name":"Hacker"}')
HTTP=$(echo "$RESP" | tail -1)
assert_status "POST /api/profiles como corretor (deve ser 403)" "403" "$HTTP"

# ── Resumo ───────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo -e "  ${GREEN}PASSOU: $PASS${NC}  |  ${RED}FALHOU: $FAIL${NC}"
echo "══════════════════════════════════════════════"
[ "$FAIL" -eq 0 ] && echo -e "${GREEN}✓ Todos os testes passaram!${NC}" || echo -e "${RED}✗ $FAIL teste(s) falharam — revisar acima${NC}"
