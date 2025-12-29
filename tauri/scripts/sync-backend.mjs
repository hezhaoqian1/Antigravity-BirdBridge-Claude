#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tauriDir = join(__dirname, '..');
const repoRoot = join(tauriDir, '..');
const resourcesBase = join(tauriDir, 'src-tauri', 'resources', 'app');
const DASHBOARD_DIST = 'dashboard/dist';

const REQUIRED_PATHS = [
  'bin',
  'desktop',
  DASHBOARD_DIST,
  'node_modules',
  'src',
  'package.json',
  'package-lock.json'
];

function ensureExists(path) {
  try {
    statSync(path);
  } catch (error) {
    console.error(`[sync-backend] Required path missing: ${path}`);
    process.exit(1);
  }
}

function copyRecursive(from, to) {
  cpSync(from, to, { recursive: true, dereference: true });
}

function ensureDashboardBuild() {
  const distPath = join(repoRoot, DASHBOARD_DIST);
  try {
    statSync(distPath);
  } catch {
    console.log('[sync-backend] dashboard/dist missing; building dashboard...');
    execSync('npm run dashboard:build', { cwd: repoRoot, stdio: 'inherit' });
  }
}

function main() {
  ensureDashboardBuild();
  REQUIRED_PATHS.forEach((rel) => ensureExists(join(repoRoot, rel)));

  rmSync(resourcesBase, { recursive: true, force: true });
  mkdirSync(resourcesBase, { recursive: true });

  for (const rel of REQUIRED_PATHS) {
    const source = join(repoRoot, rel);
    const target = join(resourcesBase, rel);
    copyRecursive(source, target);
  }

  console.log(`[sync-backend] Copied backend assets into ${resourcesBase}`);
}

main();
