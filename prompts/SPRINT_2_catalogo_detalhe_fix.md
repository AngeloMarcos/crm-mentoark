# SPRINT 2 — Corrigir CatalogoDetalhe.tsx (CRUD de Produtos Quebrado)

## Contexto do Projeto
CRM com backend Express.js/TypeScript e frontend React/Vite.
- Variável de ambiente: `VITE_API_URL` (ex: `https://api.mentoark.com.br`)
- JWT em `localStorage.getItem('access_token')`
- O cliente `api.from(tabela)` é um helper interno que chama `/api/<tabela>` via REST genérico
  e NÃO suporta paths aninhados como `catalogos/${id}/produtos`

---

## Problema

O arquivo `src/pages/CatalogoDetalhe.tsx` usa chamadas erradas para criar/editar/deletar produtos:

```typescript
// QUEBRADO — gera URL errada: /api/catalogos/123/produtos (rota não existe)
await api.from(`catalogos/${id}/produtos`).update(form).eq("id", editingProduto.id);
await api.from(`catalogos/${id}/produtos`).insert([form]);
await api.from(`catalogos/${id}/produtos`).delete().eq("id", p.id);

// QUEBRADO — gera URL errada: /api/catalogo/imagens?id=...
await api.from("catalogo/imagens").delete().eq("id", img.id);
```

O backend `backend/src/routes/catalogo.ts` tem as rotas certas, mas com paths diferentes:
- `POST   /api/catalogo/:catalogoId/produtos`         — criar produto
- `PUT    /api/catalogo/:catalogoId/produtos/:id`      — editar produto
- `DELETE /api/catalogo/:catalogoId/produtos/:id`      — deletar produto
- `DELETE /api/catalogo/imagens/:id`                   — deletar imagem

O `api.from()` genérico **não funciona** para rotas aninhadas. Usar `fetch` direto com as rotas corretas.

---

## O Que Fazer

### Arquivo: `src/pages/CatalogoDetalhe.tsx`

**Adicionar constante de API_BASE** logo após os imports:

```typescript
const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';
const getToken = () => localStorage.getItem('access_token') || '';
```

---

**Substituir a função `salvarProduto` inteira:**

```typescript
const salvarProduto = async () => {
  if (!form.nome?.trim()) {
    toast.error('Informe o nome do produto');
    return;
  }
  try {
    if (editingProduto) {
      // PUT /api/catalogo/:catalogoId/produtos/:produtoId
      const res = await fetch(`${API_BASE}/api/catalogo/${id}/produtos/${editingProduto.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Erro ao atualizar produto');
      }
      toast.success('Produto atualizado');
    } else {
      // POST /api/catalogo/:catalogoId/produtos
      const res = await fetch(`${API_BASE}/api/catalogo/${id}/produtos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Erro ao criar produto');
      }
      toast.success('Produto criado');
    }
    setModalProduto(false);
    setEditingProduto(null);
    carregar();
  } catch (err: any) {
    toast.error(err.message);
  }
};
```

---

**Substituir o botão de deletar produto** (dentro do `.map((p: Produto) => ...)`):

```typescript
// ANTES:
<Button variant="ghost" size="sm" onClick={async () => {
  await api.from(`catalogos/${id}/produtos`).delete().eq("id", p.id);
  carregar();
}}>

// DEPOIS:
<Button variant="ghost" size="sm" onClick={async () => {
  if (!confirm(`Remover "${p.nome}"?`)) return;
  const res = await fetch(`${API_BASE}/api/catalogo/${id}/produtos/${p.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.ok || res.status === 204) {
    toast.success('Produto removido');
    carregar();
  } else {
    toast.error('Erro ao remover produto');
  }
}}>
```

---

**Substituir a função `handleUpload`** (upload de imagem para produto):

```typescript
const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  if (!e.target.files || !activeProduto) return;
  try {
    for (let i = 0; i < e.target.files.length; i++) {
      const fd = new FormData();
      fd.append('imagem', e.target.files[i]);
      const res = await fetch(`${API_BASE}/api/catalogo/produtos/${activeProduto.id}/imagens`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Erro no upload');
      }
    }
    toast.success('Upload concluído');
    carregar();
    // Atualiza activeProduto
    const updated = await fetch(`${API_BASE}/api/catalogo/${id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const updatedData = await updated.json();
    const updatedP = updatedData.produtos?.find((p: any) => p.id === activeProduto.id);
    if (updatedP) setActiveProduto(updatedP);
  } catch (err: any) {
    toast.error(err.message);
  }
};
```

---

**Substituir o botão de deletar imagem** (dentro do modal de galeria):

```typescript
// ANTES:
<Button size="icon" variant="ghost" onClick={async () => {
  await api.from("catalogo/imagens").delete().eq("id", img.id);
  carregar();
}}>

// DEPOIS:
<Button size="icon" variant="ghost" onClick={async () => {
  const res = await fetch(`${API_BASE}/api/catalogo/imagens/${img.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.ok || res.status === 204) {
    carregar();
    const updated = await fetch(`${API_BASE}/api/catalogo/${id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const updatedData = await updated.json();
    const updatedP = updatedData.produtos?.find((p: any) => p.id === activeProduto?.id);
    if (updatedP) setActiveProduto(updatedP);
  } else {
    toast.error('Erro ao remover imagem');
  }
}}>
```

---

**Corrigir também a função `carregar`** — ela já usa `fetch` direto, mas o token pode não estar sendo lido corretamente. Verificar que usa:
```typescript
headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` }
```

Se usar `import.meta.env.VITE_API_URL` raw, substituir por `API_BASE` (a constante definida acima).

---

## Checklist de Verificação

- [ ] Criar produto funciona (POST /api/catalogo/:id/produtos)
- [ ] Editar produto funciona (PUT /api/catalogo/:id/produtos/:produtoId)
- [ ] Deletar produto funciona (DELETE /api/catalogo/:id/produtos/:produtoId)
- [ ] Upload de imagem funciona (POST /api/catalogo/produtos/:produtoId/imagens)
- [ ] Deletar imagem funciona (DELETE /api/catalogo/imagens/:id)
- [ ] Nenhum erro de TypeScript no arquivo
- [ ] Toast de sucesso/erro aparece corretamente em cada operação

---

## Nota sobre o `api.from()` genérico

O helper `api.from("tabela")` em `src/integrations/database/client.ts` **só funciona** para tabelas simples com rotas `/api/<tabela>`. Para rotas aninhadas (como `/api/catalogo/:id/produtos`), sempre usar `fetch` direto com o token no header.
