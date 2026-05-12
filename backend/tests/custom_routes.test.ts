import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../src/middleware';
import catalogoRouter from '../src/routes/catalogo';
import galeriaRouter from '../src/routes/galeria';

process.env.JWT_SECRET = 'test-secret-multitenant-v2';

type Capture = { sql: string; params: any[] };
const captured: Capture[] = [];

const mockPool: any = {
  query: async (sql: string, params: any[] = []) => {
    captured.push({ sql, params });
    return { rows: [{ id: '1', user_id: 'user-A', url: 'http://test.com/img.jpg', filename: 'img.jpg' }], rowCount: 1 };
  },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/catalogo', authMiddleware, catalogoRouter(mockPool));
  app.use('/api/galeria', authMiddleware, galeriaRouter(mockPool));
  return app;
}

const sign = (payload: any) => jwt.sign(payload, process.env.JWT_SECRET!);

describe('Custom Route Isolation — Catalogo & Galeria', () => {
  let app: express.Express;
  beforeAll(() => { app = buildApp(); });

  it('CATALOGO: DELETE /api/catalogo/:id/produtos/:prodId filtra imagens por user_id', async () => {
    captured.length = 0;
    const token = sign({ sub: 'user-A' });
    await request(app)
      .delete('/api/catalogo/cat-1/produtos/prod-1')
      .set('Authorization', `Bearer ${token}`);
    
    // Deve ter feito um SELECT nas imagens antes de deletar o produto
    const selectImgs = captured.find(c => c.sql.includes('SELECT url FROM produto_imagens'));
    expect(selectImgs).toBeDefined();
    expect(selectImgs?.sql).toMatch(/AND user_id = \$2/);
    expect(selectImgs?.params).toContain('user-A');

    // Deve ter deletado o produto com user_id
    const deleteProd = captured.find(c => c.sql.includes('DELETE FROM produtos'));
    expect(deleteProd?.sql).toMatch(/AND user_id = \$2/);
    expect(deleteProd?.params).toContain('user-A');
  });

  it('GALERIA: DELETE /api/galeria/:id filtra por user_id', async () => {
    captured.length = 0;
    const token = sign({ sub: 'user-B' });
    await request(app)
      .delete('/api/galeria/img-1')
      .set('Authorization', `Bearer ${token}`);
    
    const deleteSql = captured.find(c => c.sql.includes('DELETE FROM galeria_imagens'));
    expect(deleteSql?.sql).toMatch(/AND user_id = \$2/);
    expect(deleteSql?.params).toContain('user-B');
  });

  it('GALERIA: Vincular imagem ao produto (POST /produto/:id) filtra galeria por user_id', async () => {
    captured.length = 0;
    const token = sign({ sub: 'user-A' });
    await request(app)
      .post('/api/galeria/produto/prod-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ galeria_imagem_id: 'gal-1', principal: true });
    
    const selectGal = captured.find(c => c.sql.includes('SELECT * FROM galeria_imagens'));
    expect(selectGal?.sql).toMatch(/AND user_id = \$2/);
    expect(selectGal?.params).toContain('user-A');

    const updatePrincipal = captured.find(c => c.sql.includes('UPDATE produto_imagens SET principal = false'));
    expect(updatePrincipal?.sql).toMatch(/AND user_id = \$2/);
    expect(updatePrincipal?.params).toContain('user-A');
  });
});
