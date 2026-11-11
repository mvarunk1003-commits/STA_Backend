/**
 * Migration script: Adds RBAC status columns and new tables to existing database.
 * Safe to run multiple times (uses IF NOT EXISTS / tries each ALTER separately).
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const migrations = [
  // Add status to events
  `ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'approved'`,
  // Add status to expenses
  `ALTER TABLE expenses ADD COLUMN status TEXT DEFAULT 'approved'`,
  `ALTER TABLE expenses ADD COLUMN submitted_by INTEGER`,
  // Add status & submitted_by to sponsors
  `ALTER TABLE sponsors ADD COLUMN status TEXT DEFAULT 'approved'`,
  `ALTER TABLE sponsors ADD COLUMN submitted_by INTEGER`,
  `ALTER TABLE sponsors ADD COLUMN event_id INTEGER`,
  // Add status to resources
  `ALTER TABLE resources ADD COLUMN status TEXT DEFAULT 'approved'`,
  // Add created_by to bhajan_songs
  `ALTER TABLE bhajan_songs ADD COLUMN created_by INTEGER`,
  // Create photos table
  `CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    uploaded_by INTEGER,
    event_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uploaded_by) REFERENCES users(id),
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL
  )`,
  // Create notifications table
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    target_roles TEXT DEFAULT 'all',
    is_read INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`
];

db.serialize(() => {
  let completed = 0;
  migrations.forEach((sql, i) => {
    db.run(sql, (err) => {
      completed++;
      if (err && !err.message.includes('duplicate column')) {
        console.log(`Migration ${i + 1}: SKIPPED (${err.message})`);
      } else {
        console.log(`Migration ${i + 1}: OK`);
      }
      if (completed === migrations.length) {
        console.log('\n✅ All migrations complete!');
        db.close();
      }
    });
  });
});
