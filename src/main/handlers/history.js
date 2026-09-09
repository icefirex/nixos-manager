const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

function ensureOptionHistorySchema(db) {
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

function addOptionHistoryEntry(entry) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO option_history (timestamp, option_path, action, old_value, new_value, file) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(Date.now(), entry.optionPath, entry.action, entry.oldValue || null, entry.newValue || null, entry.file);
}

function register() {
  ipcMain.handle('history-get', async () => {
    try {
      const db = getDb();
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
    } catch (e) {
      console.error('Failed to read history:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('history-add', async (event, entry) => {
    try {
      const db = getDb();
      const stmt = db.prepare('INSERT INTO history (timestamp, pkgname, action, file, type, user_name) VALUES (?, ?, ?, ?, ?, ?)');
      stmt.run(Date.now(), entry.pkgname, entry.action, entry.file, entry.type || null, entry.userName || null);
      return { success: true };
    } catch (e) {
      console.error('Failed to add history entry:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('history-add-option', async (event, entry) => {
    try {
      addOptionHistoryEntry(entry);
      return { success: true };
    } catch (e) {
      console.error('Failed to add option history entry:', e);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register, getDb, addOptionHistoryEntry, ensureOptionHistorySchema };
