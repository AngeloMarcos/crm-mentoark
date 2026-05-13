/**
 * deploy.mjs — Commit + Push GitHub + Deploy VPS
 * Uso: node deploy.mjs
 */
import { execSync } from 'child_process';
import { createConnection } from 'net';
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import path from 'path';

const VPS_HOST = '147.93.9.172';
const VPS_USER = 'root';
const VPS_PASS = 'Mentoark@2025';
const PROJECT  = 'C:\\Users\\angel\\Desktop\\claudio\\crm-mentoark';

const FILES_FRONTEND = [
  'src/hooks/useAuth.tsx',
  'src/components/ProtectedRoute.tsx',
  'src/components/AppSidebar.tsx',
  'src/App.tsx',
  'src/pages/Galeria.tsx',
  'src/pages/Usuarios.tsx',
];

const FILES_BACKEND = [
  'backend/src/index.ts',
  'backend/src/routes/modulos.ts',
  'backend/src/routes/galeria.ts',
  'backend/src/routes/elevenlabs.ts',
  'backend/src/routes/catalogo.ts',
];

const FILES_MIGRATIONS = [
  'supabase/migrations/20260512000001_elevenlabs_voice_id.sql',
  'supabase/migrations/20260512000002_galeria_imagens.sql',
  'supabase/migrations/20260512000003_user_modulos.sql',
];

// ── 1. Git commit + push ──────────────────────────────────────────────────────
console.log('\n🔧 PASSO 1 — Git commit + push\n');
try {
  const allFiles = [...FILES_FRONTEND, ...FILES_BACKEND, ...FILES_MIGRATIONS, 'prompts/'].join(' ');
  execSync(`git -C "${PROJECT}" add ${allFiles}`, { stdio: 'inherit' });
  execSync(
    `git -C "${PROJECT}" commit -m "feat: RBAC modulos + Galeria + ElevenLabs + Catalogo WhatsApp\n\n- useAuth: modulos[], hasModulo(), modulosLoading\n- ProtectedRoute: requireModulo prop\n- AppSidebar: filtro por modulo, Galeria adicionada\n- App.tsx: todas rotas protegidas por requireModulo\n- Galeria.tsx: biblioteca central de midia\n- Usuarios.tsx: painel de modulos com toggles\n- backend: modulos.ts, galeria.ts, elevenlabs.ts\n- backend/catalogo.ts: endpoints WhatsApp send\n- migrations: voice_id, galeria_imagens, user_modulos\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"`,
    { stdio: 'inherit', cwd: PROJECT }
  );
  execSync(`git -C "${PROJECT}" push origin main`, { stdio: 'inherit' });
  console.log('✅ Git OK\n');
} catch (e) {
  console.error('❌ Git falhou:', e.message);
  process.exit(1);
}

// ── 2. Deploy VPS via SSH ─────────────────────────────────────────────────────
console.log('\n🚀 PASSO 2 — Deploy VPS\n');

function sshRun(commands) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';

    conn.on('ready', () => {
      const cmd = commands.join(' && ');
      console.log(`  → ${cmd}\n`);
      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on('data', d => { process.stdout.write(d); output += d; });
        stream.stderr.on('data', d => { process.stderr.write(d); });
        stream.on('close', (code) => {
          conn.end();
          if (code === 0) resolve(output);
          else reject(new Error(`Comando saiu com código ${code}`));
        });
      });
    }).connect({ host: VPS_HOST, port: 22, username: VPS_USER, password: VPS_PASS });

    conn.on('error', reject);
  });
}

function sshSendFile(localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        sftp.fastPut(localPath, remotePath, (err2) => {
          conn.end();
          if (err2) reject(err2);
          else resolve();
        });
      });
    }).connect({ host: VPS_HOST, port: 22, username: VPS_USER, password: VPS_PASS });
    conn.on('error', reject);
  });
}

const backendFiles = [
  { local: path.join(PROJECT, 'backend/src/index.ts'),              remote: '/opt/crm/backend/src/index.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/modulos.ts'),     remote: '/opt/crm/backend/src/routes/modulos.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/galeria.ts'),     remote: '/opt/crm/backend/src/routes/galeria.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/elevenlabs.ts'),  remote: '/opt/crm/backend/src/routes/elevenlabs.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/catalogo.ts'),    remote: '/opt/crm/backend/src/routes/catalogo.ts' },
];

(async () => {
  try {
    // Garante que os diretórios existem
    await sshRun(['mkdir -p /opt/crm/backend/src/routes']);

    // Envia arquivos
    for (const f of backendFiles) {
      process.stdout.write(`  📤 ${path.basename(f.local)} → ${f.remote} ... `);
      await sshSendFile(f.local, f.remote);
      console.log('✓');
    }

    // Build + restart
    console.log('\n  🏗️  Build + restart container...\n');
    await sshRun([
      'cd /opt/crm/backend',
      'docker compose build --no-cache',
      'docker compose up -d',
    ]);

    // Verifica logs
    console.log('\n  📋 Logs do container (últimas 5 linhas):');
    await sshRun(['docker logs crm-api --tail 5 2>&1']);

    console.log('\n✅ Deploy concluído!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Erro no deploy:', err.message);
    process.exit(1);
  }
})();
