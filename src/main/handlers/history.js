const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

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
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC)
    `);
  }
  return _db;
}

function register() {
  ipcMain.handle('history-get', async () => {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT timestamp, pkgname, action, file, type, user_name FROM history ORDER BY timestamp DESC LIMIT 500').all();
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
}

module.exports = { register, getDb };
