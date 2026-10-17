/**
 * Sprint 2 do maturador sem ban (2026-10-17): validação de proxy, regras de aceite do IP de saída
 * e os dois testadores (HTTP em forma absoluta e SOCKS5 com usuário/senha) contra proxies falsos
 * locais que respondem como o ip-api.com.
 */
import { describe, it, expect, afterAll } from 'vitest';
import http from 'http';
import net from 'net';
import { validarProxy, motivoRecusaSaida, testarSaidaProxy, camposEvolution, SaidaProxy } from '../src/services/proxyInstancia';

const RESPOSTA = { status: 'success', query: '177.10.20.30', countryCode: 'BR', regionName: 'São Paulo', city: 'São Paulo', as: 'AS28573 Claro S.A.', org: 'Claro', isp: 'Claro', mobile: false, hosting: false };

describe('validarProxy', () => {
  it('só aceita http e socks5 (a Evolution não entende https/socks4)', () => {
    expect(validarProxy({ host: 'br.proxy.exemplo.com', port: 8000, protocolo: 'http' }).proxy?.protocolo).toBe('http');
    expect(validarProxy({ host: 'br.proxy.exemplo.com', port: 8000, protocolo: 'socks' }).proxy?.protocolo).toBe('socks5');
    expect(validarProxy({ host: 'br.proxy.exemplo.com', port: 8000, protocolo: 'https' }).erro).toMatch(/http ou socks5/);
    expect(validarProxy({ host: 'br.proxy.exemplo.com', port: 8000, protocolo: 'socks4' }).erro).toMatch(/http ou socks5/);
  });
  it('recusa rede privada/local', () => {
    for (const h of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.20.0.3', 'localhost']) expect(validarProxy({ host: h, port: 80 }).erro).toBeTruthy();
  });
});

describe('motivoRecusaSaida', () => {
  const base: SaidaProxy = { ip: '1.2.3.4', pais: 'BR', regiao: null, cidade: null, asn: 'AS1', org: 'x', hospedagem: false, movel: false };
  it('aceita IP brasileiro residencial/ISP e móvel', () => {
    expect(motivoRecusaSaida(base)).toBeNull();
    expect(motivoRecusaSaida({ ...base, movel: true })).toBeNull();
  });
  it('recusa IP de fora do Brasil e IP de datacenter', () => {
    expect(motivoRecusaSaida({ ...base, pais: 'US' })).toMatch(/não do Brasil/);
    expect(motivoRecusaSaida({ ...base, hospedagem: true })).toMatch(/datacenter/);
  });
});

describe('camposEvolution', () => {
  it('codifica usuário e senha (a Evolution monta a URL sem encode)', () => {
    const c = camposEvolution({ host: 'gw.exemplo.com', port: 7000, protocolo: 'http', usuario: 'user-session-1', senha: 'p@ss:w/rd#1' });
    expect(c.password).toBe('p%40ss%3Aw%2Frd%231');
    expect(c.username).toBe('user-session-1');
    expect(c.port).toBe('7000');
  });
});

const servidores: { close: () => void }[] = [];
afterAll(() => servidores.forEach(s => s.close()));

function proxyHttpFalso(exigeAuth: string | null): Promise<number> {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if (exigeAuth && req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from(exigeAuth).toString('base64')) {
        res.writeHead(407); return res.end();
      }
      // Proxy HTTP recebe a URL absoluta do destino.
      if (!String(req.url).startsWith('http://ip-api.com/json/')) { res.writeHead(400); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(RESPOSTA));
    });
    s.listen(0, '127.0.0.1', () => { servidores.push(s); resolve((s.address() as net.AddressInfo).port); });
  });
}

function proxySocks5Falso(usuario: string, senha: string): Promise<number> {
  return new Promise(resolve => {
    const s = net.createServer(c => {
      let etapa = 0;
      c.on('data', d => {
        if (etapa === 0) { c.write(Buffer.from([0x05, 0x02])); etapa = 1; return; }            // pede usuário/senha
        if (etapa === 1) {
          const ul = d[1]; const u = d.subarray(2, 2 + ul).toString(); const pl = d[2 + ul]; const p = d.subarray(3 + ul, 3 + ul + pl).toString();
          c.write(Buffer.from([0x01, u === usuario && p === senha ? 0x00 : 0x01])); etapa = 2; return;
        }
        if (etapa === 2) { c.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); etapa = 3; return; } // CONNECT ok
        if (etapa === 3 && d.toString().startsWith('GET /json/')) {
          const corpo = JSON.stringify(RESPOSTA);
          c.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(corpo)}\r\n\r\n${corpo}`);
        }
      });
    });
    s.listen(0, '127.0.0.1', () => { servidores.push(s); resolve((s.address() as net.AddressInfo).port); });
  });
}

describe('testarSaidaProxy', () => {
  it('HTTP: mede o IP de saída com autenticação', async () => {
    const port = await proxyHttpFalso('u1:s3nh@');
    const r = await testarSaidaProxy({ host: '127.0.0.1', port, protocolo: 'http', usuario: 'u1', senha: 's3nh@' });
    expect(r).toMatchObject({ ip: '177.10.20.30', pais: 'BR', hospedagem: false, asn: 'AS28573 Claro S.A.' });
  });
  it('HTTP: senha errada vira erro claro (407)', async () => {
    const port = await proxyHttpFalso('u1:certa');
    await expect(testarSaidaProxy({ host: '127.0.0.1', port, protocolo: 'http', usuario: 'u1', senha: 'errada' })).rejects.toThrow(/407/);
  });
  it('SOCKS5: handshake com usuário/senha e IP de saída', async () => {
    const port = await proxySocks5Falso('cli', 'pw');
    const r = await testarSaidaProxy({ host: '127.0.0.1', port, protocolo: 'socks5', usuario: 'cli', senha: 'pw' });
    expect(r.ip).toBe('177.10.20.30');
  });
  it('SOCKS5: credencial recusada', async () => {
    const port = await proxySocks5Falso('cli', 'pw');
    await expect(testarSaidaProxy({ host: '127.0.0.1', port, protocolo: 'socks5', usuario: 'cli', senha: 'x' })).rejects.toThrow(/recusou usuário/);
  });
  it('proxy fora do ar vira erro em português', async () => {
    await expect(testarSaidaProxy({ host: '127.0.0.1', port: 1, protocolo: 'http' })).rejects.toThrow(/Não foi possível sair pelo proxy/);
  });
});
