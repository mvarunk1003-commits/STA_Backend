-- SQLite schema for Organization Management System

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user', -- 'admin', 'state_coordinator', 'district_coordinator', 'taluk_coordinator'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    status TEXT DEFAULT 'active', -- 'active', 'inactive'
    join_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    date TEXT NOT NULL, -- YYYY-MM-DD
    location TEXT,
    budget REAL DEFAULT 0,
    status TEXT DEFAULT 'approved', -- 'pending', 'approved', 'rejected'
    created_by INTEGER,
    FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'present', 'absent', 'excused'
    marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE,
    UNIQUE(event_id, member_id)
);

CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    title TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    receipt_url TEXT,
    status TEXT DEFAULT 'approved', -- 'pending', 'approved', 'rejected'
    submitted_by INTEGER,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL,
    FOREIGN KEY(submitted_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    contribution_type TEXT NOT NULL, -- 'monetary', 'in-kind', 'services'
    contribution_amount REAL DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'approved', -- 'pending', 'approved', 'rejected'
    submitted_by INTEGER,
    event_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(submitted_by) REFERENCES users(id),
    FOREIGN KEY(event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS bhajan_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    scale TEXT,
    lyrics TEXT,
    audio_url TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    uploaded_by INTEGER,
    category TEXT, -- 'document', 'media', 'form', 'other'
    status TEXT DEFAULT 'approved', -- 'pending', 'approved', 'rejected'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    uploaded_by INTEGER,
    event_id INTEGER,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uploaded_by) REFERENCES users(id),
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info', -- 'info', 'approval_request', 'approval_result', 'warning'
    target_roles TEXT DEFAULT 'all', -- comma-separated roles or 'all'
    is_read INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    file_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coordinators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state TEXT NOT NULL,
    district TEXT NOT NULL,
    taluk TEXT NOT NULL,
    unit_name TEXT NOT NULL,
    coordinator_name TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
