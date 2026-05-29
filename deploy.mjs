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
const PROJECT  = 'C:\\Users\\angel\\Desktop\\claudio\\cris\\crm-mentoark';

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
  'backend/src/db.ts',
  'backend/src/routes/modulos.ts',
  'backend/src/routes/galeria.ts',
  'backend/src/routes/elevenlabs.ts',
  'backend/src/routes/catalogo.ts',
  'backend/src/routes/disparos.ts',
  'backend/src/routes/contatos.ts',
  'backend/src/services/disparoProcessor.ts',
];

const FILES_MIGRATIONS = [
  'supabase/migrations/20260512000001_elevenlabs_voice_id.sql',
  'supabase/migrations/20260512000002_galeria_imagens.sql',
  'supabase/migrations/20260512000003_user_modulos.sql',
];

// ── 1. Git commit + push ──────────────────────────────────────────────────────
console.log('\n🔧 PASSO 1 — Git commit + push\n');
try {
  execSync(`git -C "${PROJECT}" add -A`, { stdio: 'inherit' });
  execSync(
    `git -C "${PROJECT}" commit -m "fix: integracoes_config upsert + equipe + kanban + ai routes\n\n- fix: equipe_membros coluna convidado_por adicionada (causa da tela branca)\n- fix: equipe.ts queries com COALESCE(name, display_name) + ON CONFLICT DO UPDATE\n- feat: kanban.ts webhook publico n8n (kanbanWebhookN8n export)\n- feat: ai-providers.ts rota completa com criptografia AES-256-CBC\n- feat: ai-uso.ts dashboard de uso e custo por provider\n- feat: index.ts registra kanban webhook antes do authMiddleware\n- fix: migrations.ts tabelas equipes/equipe_membros/kanban/tarefas com colunas completas\n- fix: migrations.ts ai_providers + ai_uso_diario + views vw_ai_uso_30d\n- fix: migrations.ts tarefas colunas kanban (contato_nome, remote_jid, etc)\n- feat: PROMPT-MOTOR-INDEPENDENTE.md para abandonar n8n\n- feat: PROMPT-FIX-EQUIPE.md diagnostico e correcao de equipes\n- feat: PROMPT-LOVABLE-KANBAN-TAREFAS.md kanban visual\n- feat: CRiS-workflow-com-kanban.json workflow com card automatico\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"`,
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
  { local: path.join(PROJECT, 'backend/src/index.ts'),                  remote: '/opt/crm/backend/src/index.ts' },
  { local: path.join(PROJECT, 'backend/src/db.ts'),                     remote: '/opt/crm/backend/src/db.ts' },
  { local: path.join(PROJECT, 'backend/src/migrations.ts'),             remote: '/opt/crm/backend/src/migrations.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/modulos.ts'),         remote: '/opt/crm/backend/src/routes/modulos.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/galeria.ts'),         remote: '/opt/crm/backend/src/routes/galeria.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/elevenlabs.ts'),      remote: '/opt/crm/backend/src/routes/elevenlabs.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/catalogo.ts'),        remote: '/opt/crm/backend/src/routes/catalogo.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/disparos.ts'),        remote: '/opt/crm/backend/src/routes/disparos.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/contatos.ts'),        remote: '/opt/crm/backend/src/routes/contatos.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/kanban.ts'),          remote: '/opt/crm/backend/src/routes/kanban.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/equipe.ts'),          remote: '/opt/crm/backend/src/routes/equipe.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/ai-providers.ts'),    remote: '/opt/crm/backend/src/routes/ai-providers.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/ai-uso.ts'),          remote: '/opt/crm/backend/src/routes/ai-uso.ts' },
  { local: path.join(PROJECT, 'backend/src/routes/integracoes.ts'),     remote: '/opt/crm/backend/src/routes/integracoes.ts' },
  { local: path.join(PROJECT, 'backend/src/migrations.ts'),             remote: '/opt/crm/backend/src/migrations.ts' },
  { local: path.join(PROJECT, 'backend/src/services/disparoProcessor.ts'), remote: '/opt/crm/backend/src/services/disparoProcessor.ts' },
];

(async () => {
  try {
    // Garante que os diretórios existem
    await sshRun(['mkdir -p /opt/crm/backend/src/routes /opt/crm/backend/src/services /opt/crm/backend/src']);

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
