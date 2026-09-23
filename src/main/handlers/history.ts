// @ts-check
import electron from 'electron';
const { app, ipcMain } = electron as any;
import path from 'path';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

let _db: any = null;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function ensureOptionHistorySchema(db: any) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='option_history'").get();
  if (!table || !table.sql) return;

  if (!table.sql.includes("'reverted'")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS option_history_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        option_path TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('set', 'added', 'removed', 'reverted')),
        old_value TEXT,
        new_value TEXT,
        file TEXT NOT NULL
      )
    `);
    db.exec(`
      INSERT INTO option_history_v2 (id, timestamp, option_path, action, old_value, new_value, file)
      SELECT id, timestamp, option_path, action, old_value, new_value, file
      FROM option_history
    `);
    db.exec('DROP TABLE option_history');
    db.exec('ALTER TABLE option_history_v2 RENAME TO option_history');
    db.exec('CREATE INDEX IF NOT EXISTS idx_option_history_timestamp ON option_history(timestamp DESC)');
  }
}

function getDb() {
  if (!_db) {
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    const dbPath = path.join(userDataPath, 'history.sqlite');
    _db = new DatabaseSync(dbPath);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        pkgname TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('added', 'removed')),
        file TEXT NOT NULL,
        type TEXT,
        user_name TEXT
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS option_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        option_path TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('set', 'added', 'removed', 'reverted')),
        old_value TEXT,
        new_value TEXT,
        file TEXT NOT NULL
      )
    `);
    ensureOptionHistorySchema(_db);
    _db.exec(`
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC)
    `);
    _db.exec(`
      CREATE INDEX IF NOT EXISTS idx_option_history_timestamp ON option_history(timestamp DESC)
    `);
  }
  return _db;
}

/**
 * @param {OptionHistoryEntry} entry
 */
function addOptionHistoryEntry(entry: any) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO option_history (timestamp, option_path, action, old_value, new_value, file) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(Date.now(), entry.optionPath, entry.action, entry.oldValue || null, entry.newValue || null, entry.file);
}

type HistoryDeps = {
  ipcMain?: import('electron').IpcMain;
  getDb?: () => import('node:sqlite').DatabaseSync;
  addOptionHistoryEntry?: (entry: OptionHistoryEntry) => void;
  now?: () => number;
};

export type OptionHistoryEntry = {
  optionPath: string;
  action: 'set'|'added'|'removed'|'reverted';
  oldValue?: string;
  newValue?: string;
  file: string;
};

/**
 * @param {HistoryDeps} [deps]
 */
function createHistoryHandlers(deps: HistoryDeps = {}) {
  const depsGetDb = deps.getDb || getDb;
  const depsAddOptionHistoryEntry = deps.addOptionHistoryEntry || addOptionHistoryEntry;
  const depsNow = deps.now || Date.now;

  return {
    historyGet: async () => {
      try {
        const db = depsGetDb();
        const rows = db.prepare(`
          SELECT timestamp, 'package' AS entry_type, pkgname AS subject, action, file, type, user_name, NULL AS old_value, NULL AS new_value
          FROM history
          UNION ALL
          SELECT timestamp, 'option' AS entry_type, option_path AS subject, action, file, NULL AS type, NULL AS user_name, old_value, new_value
          FROM option_history
          ORDER BY timestamp DESC
          LIMIT 500
        `).all();
        return { success: true, entries: rows };
      } catch (e: any) {
        console.error('Failed to read history:', e);
        return { success: false, error: e.message };
      }
    },

    historyAdd: async (entry: any) => {
      try {
        const db = depsGetDb();
        const stmt = db.prepare('INSERT INTO history (timestamp, pkgname, action, file, type, user_name) VALUES (?, ?, ?, ?, ?, ?)');
        stmt.run(depsNow(), entry.pkgname, entry.action, entry.file, entry.type || null, entry.userName || null);
        return { success: true };
      } catch (e: any) {
        console.error('Failed to add history entry:', e);
        return { success: false, error: e.message };
      }
    },

    historyAddOption: async (entry: any) => {
      try {
        depsAddOptionHistoryEntry(entry);
        return { success: true };
      } catch (e: any) {
        console.error('Failed to add option history entry:', e);
        return { success: false, error: e.message };
      }
    }
  };
}

/**
 * @param {HistoryDeps} [deps]
 */
function register(deps: HistoryDeps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createHistoryHandlers(deps);

  depsIpcMain.handle('history-get', async () => {
    return handlers.historyGet();
  });

  depsIpcMain.handle('history-add', async (_event: any, entry: any) => {
    return handlers.historyAdd(entry);
  });

  depsIpcMain.handle('history-add-option', async (_event: any, entry: any) => {
    return handlers.historyAddOption(entry);
  });
}

export { register, getDb, addOptionHistoryEntry, ensureOptionHistorySchema, createHistoryHandlers };

export {};
