import { promises as fs, existsSync } from 'fs';
import { join, dirname } from 'path';
import { ACCOUNT_CONFIG_PATH } from '../constants.js';
import { getConfigRoot, getConfigPath } from './config-service.js';

const BACKUP_ROOT = join(getConfigRoot(), 'backups');
const MAX_BACKUPS = 5;

async function ensureBackupDir() {
    await fs.mkdir(BACKUP_ROOT, { recursive: true });
}

async function copyIfExists(source, destination) {
    if (existsSync(source)) {
        await fs.mkdir(dirname(destination), { recursive: true }).catch(() => {});
        await fs.copyFile(source, destination);
        return true;
    }
    return false;
}

export async function createBackup(label = 'manual') {
    await ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folder = join(BACKUP_ROOT, `${timestamp}-${label}`);
    await fs.mkdir(folder, { recursive: true });

    const configCopied = await copyIfExists(getConfigPath(), join(folder, 'config.json'));
    const accountsCopied = await copyIfExists(ACCOUNT_CONFIG_PATH, join(folder, 'accounts.json'));

    await pruneBackups();

    return {
        path: folder,
        files: {
            config: configCopied,
            accounts: accountsCopied
        },
        createdAt: new Date().toISOString()
    };
}

export async function listBackups() {
    await ensureBackupDir();
    const entries = await fs.readdir(BACKUP_ROOT, { withFileTypes: true });
    const backups = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const folder = join(BACKUP_ROOT, entry.name);
        const stats = await fs.stat(folder);
        backups.push({
            name: entry.name,
            folder,
            createdAt: stats.birthtime.toISOString()
        });
    }

    return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function pruneBackups(limit = MAX_BACKUPS) {
    const backups = await listBackups();
    if (backups.length <= limit) return;

    const toDelete = backups.slice(limit);
    for (const backup of toDelete) {
        await fs.rm(backup.folder, { recursive: true, force: true });
    }
}

export function getBackupRoot() {
    return BACKUP_ROOT;
}

export async function restoreBackup(name) {
    if (!name) throw new Error('Backup name is required');
    await ensureBackupDir();
    const folder = join(BACKUP_ROOT, name);
    if (!existsSync(folder)) {
        throw new Error(`Backup "${name}" not found`);
    }

    const configPath = join(folder, 'config.json');
    const accountsPath = join(folder, 'accounts.json');

    const tasks = [];
    if (existsSync(configPath)) {
        tasks.push(
            fs.mkdir(dirname(getConfigPath()), { recursive: true })
                .then(() => fs.copyFile(configPath, getConfigPath()))
        );
    }
    if (existsSync(accountsPath)) {
        tasks.push(
            fs.mkdir(dirname(ACCOUNT_CONFIG_PATH), { recursive: true })
                .then(() => fs.copyFile(accountsPath, ACCOUNT_CONFIG_PATH))
        );
    }
    if (!tasks.length) {
        throw new Error(`Backup "${name}" does not contain config or account files`);
    }
    await Promise.all(tasks);
    return { restored: tasks.length, name };
}
