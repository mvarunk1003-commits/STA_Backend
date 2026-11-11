const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.sqlite');
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    // Performance PRAGMAs for high-speed concurrent I/O
    db.serialize(() => {
      db.run("PRAGMA journal_mode = WAL");
      db.run("PRAGMA synchronous = NORMAL");
      db.run("PRAGMA cache_size = 10000");
      db.run("PRAGMA temp_store = MEMORY");
    });
    initializeDatabase();
  }
});

function initializeDatabase() {
  try {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    // split the schema by semicolon to run statements sequentially, or use db.exec
    db.exec(schema, (err) => {
      if (err) {
        console.error('Failed to initialize database schema:', err.message);
      } else {
        console.log('Database schema loaded/verified successfully.');
        
        // High-Performance Query Indexes
        const indexes = [
          "CREATE INDEX IF NOT EXISTS idx_events_status_date ON events(status, date)",
          "CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by)",
          "CREATE INDEX IF NOT EXISTS idx_members_status ON members(status)",
          "CREATE INDEX IF NOT EXISTS idx_members_created_by ON members(created_by)",
          "CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status)",
          "CREATE INDEX IF NOT EXISTS idx_expenses_submitted_by ON expenses(submitted_by)",
          "CREATE INDEX IF NOT EXISTS idx_sponsors_status ON sponsors(status)",
          "CREATE INDEX IF NOT EXISTS idx_sponsors_submitted_by ON sponsors(submitted_by)",
          "CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_user_id, is_read)",
          "CREATE INDEX IF NOT EXISTS idx_coordinators_loc ON coordinators(state, district, taluk)",
          "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)",
          "CREATE INDEX IF NOT EXISTS idx_notices_status ON event_notices(status)"
        ];
        indexes.forEach(sql => db.run(sql));

        // Ensure members table has created_by column for user-specific location scoping
        db.run("ALTER TABLE members ADD COLUMN created_by INTEGER", (alterErr) => {
          // Safely ignore error if column already exists
        });

        // Add target_user_id to notifications for per-user targeting
        db.run("ALTER TABLE notifications ADD COLUMN target_user_id INTEGER REFERENCES users(id)", (alterErr) => {
          // Safely ignore error if column already exists
        });

        // Ensure event_notices has notice_language column
        db.run("ALTER TABLE event_notices ADD COLUMN notice_language TEXT DEFAULT 'kn'", (alterErr) => {
          // Safely ignore error if column already exists
        });

        // Create event_notices table if not exists
        db.run(`CREATE TABLE IF NOT EXISTS event_notices (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          title            TEXT NOT NULL,
          organization     TEXT DEFAULT '',
          sub_org          TEXT DEFAULT '',
          salutation       TEXT DEFAULT '',
          event_description TEXT DEFAULT '',
          event_date       TEXT DEFAULT '',
          event_time       TEXT DEFAULT '',
          event_venue      TEXT DEFAULT '',
          chairperson      TEXT DEFAULT '',
          attendees        TEXT DEFAULT '[]',
          notices_list     TEXT DEFAULT '[]',
          contact_info     TEXT DEFAULT '',
          footer_text      TEXT DEFAULT '',
          state            TEXT DEFAULT '',
          header_image_url TEXT DEFAULT '',
          status           TEXT DEFAULT 'pending',
          submitted_by     INTEGER REFERENCES users(id),
          created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (tableErr) => {
          if (tableErr) console.error('Failed to create event_notices table:', tableErr.message);
        });

        // Add default users if they don't exist
        createDefaultUsers();
        seedDefaultCoordinators();
      }
    });
  } catch (error) {
    console.error('Failed to read schema file:', error.message);
  }
}

function createDefaultUsers() {
  const bcrypt = require('bcryptjs');
  const defaultUsers = [
    { username: 'admin', email: 'admin@example.com', password: 'admin123', role: 'admin' },
    { username: 'state', email: 'state@example.com', password: 'state123', role: 'state_coordinator' },
    { username: 'district', email: 'district@example.com', password: 'district123', role: 'district_coordinator' },
    { username: 'taluk', email: 'taluk@example.com', password: 'taluk123', role: 'taluk_coordinator' },

    // South Indian States (State Coordinators)
    { username: 'karnataka', email: 'karnataka@sstpa.org', password: 'karnataka123', role: 'state_coordinator' },
    { username: 'tamilnadu', email: 'tamilnadu@sstpa.org', password: 'tamilnadu123', role: 'state_coordinator' },
    { username: 'kerala', email: 'kerala@sstpa.org', password: 'kerala123', role: 'state_coordinator' },
    { username: 'andhrapradesh', email: 'andhrapradesh@sstpa.org', password: 'andhrapradesh123', role: 'state_coordinator' },
    { username: 'telangana', email: 'telangana@sstpa.org', password: 'telangana123', role: 'state_coordinator' },

    // Default/Database Districts (District Coordinators)
    { username: 'bengaluru', email: 'bengaluru@sstpa.org', password: 'bengaluru123', role: 'district_coordinator' },
    { username: 'mysuru', email: 'mysuru@sstpa.org', password: 'mysuru123', role: 'district_coordinator' },
    { username: 'kolar', email: 'kolar@sstpa.org', password: 'kolar123', role: 'district_coordinator' },
    { username: 'chennai', email: 'chennai@sstpa.org', password: 'chennai123', role: 'district_coordinator' },
    { username: 'eranakulam', email: 'eranakulam@sstpa.org', password: 'eranakulam123', role: 'district_coordinator' },
    { username: 'chittoor', email: 'chittoor@sstpa.org', password: 'chittoor123', role: 'district_coordinator' },
    { username: 'hyderabad', email: 'hyderabad@sstpa.org', password: 'hyderabad123', role: 'district_coordinator' },

    // Default/Database Taluks (Taluk Coordinators)
    { username: 'bengalurusouth', email: 'bengalurusouth@sstpa.org', password: 'bengalurusouth123', role: 'taluk_coordinator' },
    { username: 'bengalurunorth', email: 'bengalurunorth@sstpa.org', password: 'bengalurunorth123', role: 'taluk_coordinator' },
    { username: 'mysurutaluk', email: 'mysurutaluk@sstpa.org', password: 'mysurutaluk123', role: 'taluk_coordinator' },
    { username: 'mylapore', email: 'mylapore@sstpa.org', password: 'mylapore123', role: 'taluk_coordinator' },
    { username: 'kochi', email: 'kochi@sstpa.org', password: 'kochi123', role: 'taluk_coordinator' },
    { username: 'tirupati', email: 'tirupati@sstpa.org', password: 'tirupati123', role: 'taluk_coordinator' },
    { username: 'secunderabad', email: 'secunderabad@sstpa.org', password: 'secunderabad123', role: 'taluk_coordinator' }
  ];

  let completedCount = 0;
  defaultUsers.forEach(user => {
    db.get('SELECT * FROM users WHERE username = ? OR email = ?', [user.username, user.email], (err, row) => {
      completedCount++;
      if (err) {
        console.error(err.message);
      } else if (!row) {
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(user.password, salt);
        db.run(
          'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
          [user.username, user.email, hash, user.role],
          (insertErr) => {
            if (insertErr) {
              console.error(`Failed to create default user ${user.username}:`, insertErr.message);
            } else {
              console.log(`Default ${user.role} account created (${user.username}/${user.password}).`);
            }
          }
        );
      }

      if (completedCount === defaultUsers.length) {
        seedAllLocationsDefaultLogins();
      }
    });
  });
}

function seedAllLocationsDefaultLogins() {
  const fs = require('fs');
  const path = require('path');
  const bcrypt = require('bcryptjs');

  const locationsPath = path.join(__dirname, '..', '..', 'frontend', 'data', 'south_india_locations.json');
  if (!fs.existsSync(locationsPath)) {
    console.log('Location data file not found at:', locationsPath);
    return;
  }

  let locationsData;
  try {
    locationsData = JSON.parse(fs.readFileSync(locationsPath, 'utf8'));
  } catch (err) {
    console.error('Failed to parse location data JSON:', err.message);
    return;
  }

  // Check if we already seeded all location logins to avoid doing it every run
  db.get("SELECT COUNT(*) as count FROM users WHERE username LIKE '%_tq'", [], (err, row) => {
    if (err) {
      console.error(err.message);
      return;
    }
    // If we already have seeded logins (e.g. more than 100), skip to prevent overhead
    if (row && row.count > 100) {
      return;
    }

    // Clean up old format logins to prevent duplicates or pollution
    db.run("DELETE FROM users WHERE username LIKE '%_district' OR username LIKE '%_taluk' OR username LIKE '%_state' OR username LIKE '%_tq'");

    console.log('Seeding comprehensive default logins for all South Indian states, districts, and taluks...');

    // Precompute hashes for speed
    const stateHash = bcrypt.hashSync('state123', 10);
    const districtHash = bcrypt.hashSync('district123', 10);
    const talukHash = bcrypt.hashSync('taluk123', 10);

    const stateCodes = {
      'Andhra Pradesh': 'ap',
      'Karnataka': 'ka',
      'Kerala': 'kl',
      'Tamil Nadu': 'tn',
      'Telangana': 'tg'
    };

    // 1. Build sets to identify duplicates
    const districtStates = {}; // district_clean -> Set of state codes
    const talukStates = {};    // taluk_clean -> Set of state codes

    for (const [stateName, districts] of Object.entries(locationsData)) {
      const stateCode = stateCodes[stateName] || stateName.toLowerCase().slice(0, 2);
      for (const [districtName, taluks] of Object.entries(districts)) {
        const districtClean = districtName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!districtStates[districtClean]) {
          districtStates[districtClean] = new Set();
        }
        districtStates[districtClean].add(stateCode);

        taluks.forEach(talukName => {
          const talukClean = talukName.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!talukStates[talukClean]) {
            talukStates[talukClean] = new Set();
          }
          talukStates[talukClean].add(stateCode);
        });
      }
    }

    // 2. Build list of users to insert
    const usersToInsert = [];

    for (const [stateName, districts] of Object.entries(locationsData)) {
      const stateCode = stateCodes[stateName] || stateName.toLowerCase().slice(0, 2);
      const stateUsername = stateName.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // State login
      usersToInsert.push({
        username: stateUsername,
        email: `${stateUsername}@sstpa.org`,
        hash: stateHash,
        role: 'state_coordinator'
      });

      for (const [districtName, taluks] of Object.entries(districts)) {
        const districtClean = districtName.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // If district exists in multiple states, prefix with state code
        const isDistrictDuplicate = districtStates[districtClean].size > 1;
        const districtUsername = isDistrictDuplicate 
          ? `${stateCode}_${districtClean}` 
          : districtClean;

        // District login
        usersToInsert.push({
          username: districtUsername,
          email: `${districtUsername}@sstpa.org`,
          hash: districtHash,
          role: 'district_coordinator'
        });

        // Taluk logins
        taluks.forEach(talukName => {
          const talukClean = talukName.toLowerCase().replace(/[^a-z0-9]/g, '');
          
          // If taluk exists in multiple states, prefix with state code
          const isTalukDuplicate = talukStates[talukClean].size > 1;
          const talukUsername = isTalukDuplicate 
            ? `${stateCode}_${talukClean}_tq` 
            : `${talukClean}_tq`;

          usersToInsert.push({
            username: talukUsername,
            email: `${talukUsername}@sstpa.org`,
            hash: talukHash,
            role: 'taluk_coordinator'
          });
        });
      }
    }

    console.log(`Prepared ${usersToInsert.length} location-based logins. Inserting...`);

    // Insert all inside a transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare('INSERT OR IGNORE INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)');
      
      usersToInsert.forEach(u => {
        stmt.run([u.username, u.email, u.hash, u.role]);
      });

      stmt.finalize();
      db.run('COMMIT', (commitErr) => {
        if (commitErr) {
          console.error('Transaction commit failed:', commitErr.message);
        } else {
          console.log(`Successfully seeded ${usersToInsert.length} location-based logins (state/state123, district/district123, taluk/taluk123).`);
        }
      });
    });
  });
}

// Promisify database operations for async/await usage
const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

function seedDefaultCoordinators() {
  db.get('SELECT COUNT(*) as count FROM coordinators', (err, row) => {
    if (err) {
      console.error(err.message);
      return;
    }
    if (row && row.count === 0) {
      const coordinators = [
        ['Karnataka', 'Bengaluru', 'Bengaluru South', 'Sri Shankara Seva Samithi (SSTPA-001)', 'Sri R. K. Shastri', 'Regional Convener', '+91 98450 12345', 'rk.shastri@shankaratattva.org', 'Sankara Math, Jayanagar 4th Block, Bengaluru - 560011'],
        ['Karnataka', 'Bengaluru', 'Bengaluru South', 'Advaita Vahini Sangha (SSTPA-002)', 'Dr. Arundhati Hegde', 'Vedic Education Coordinator', '+91 94481 67890', 'arundhati.h@shankaratattva.org', 'Advaita Peetha Road, Banashankari, Bengaluru - 560085'],
        ['Karnataka', 'Bengaluru', 'Bengaluru North', 'Adi Shankara Jnana Kendra (SSTPA-003)', 'Sri Vidyaranya Bhat', 'Tattva Prasara Leader', '+91 99002 34567', 'vidyaranya@shankaratattva.org', 'Shankara Krupa, Malleshwaram 15th Cross, Bengaluru - 560003'],
        ['Karnataka', 'Mysuru', 'Mysuru Taluk', 'Mysore Advaita Sabha (SSTPA-004)', 'Sri N. M. Upadhyaya', 'District Coordinator', '+91 98800 54321', 'upadhyaya.nm@shankaratattva.org', 'Chamundi Hill Road, Mysuru - 570010'],
        ['Tamil Nadu', 'Chennai', 'Mylapore', 'Chennai Shankara Gurukulam (SSTPA-005)', 'Sri S. Subramanian', 'State Co-Convener', '+91 91760 98765', 'subramanian.s@shankaratattva.org', 'Venkatesa Agraharam Street, Mylapore, Chennai - 600004']
      ];
      const stmt = db.prepare('INSERT INTO coordinators (state, district, taluk, unit_name, coordinator_name, role, phone, email, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      let completedCount = 0;
      coordinators.forEach(c => {
        stmt.run(c, (runErr) => {
          completedCount++;
          if (completedCount === coordinators.length) {
            stmt.finalize();
            console.log('Seeded default coordinators database entries.');
            seedCoordinatorsLogins();
          }
        });
      });
    } else {
      seedCoordinatorsLogins();
    }
  });
}

function seedCoordinatorsLogins() {
  const bcrypt = require('bcryptjs');
  db.all('SELECT * FROM coordinators', [], (err, rows) => {
    if (err) {
      console.error('Error fetching coordinators for login seeding:', err.message);
      return;
    }
    if (!rows) return;

    rows.forEach(coord => {
      let userRole = null;
      const roleLower = coord.role.toLowerCase();

      if (roleLower.includes('district coordinator')) {
        userRole = 'district_coordinator';
      } else if (roleLower.includes('taluk coordinator')) {
        userRole = 'taluk_coordinator';
      }

      // If it matches one of these roles, create a login
      if (userRole) {
        // Determine username
        let username = '';
        if (coord.email && coord.email.includes('@')) {
          username = coord.email.split('@')[0].toLowerCase();
        } else {
          // generate from name
          username = coord.coordinator_name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, ''); // strip spaces and special chars
        }

        // Determine email
        const email = coord.email && coord.email.includes('@') 
          ? coord.email.toLowerCase() 
          : `${username}@sstpa.org`;

        // Check if username or email already exists in users table
        db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, email], (checkErr, userRow) => {
          if (checkErr) {
            console.error(`Error checking user ${username}:`, checkErr.message);
            return;
          }

          if (!userRow) {
            const password = `${username}123`;
            const salt = bcrypt.genSaltSync(10);
            const hash = bcrypt.hashSync(password, salt);

            db.run(
              'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
              [username, email, hash, userRole],
              (insertErr) => {
                if (insertErr) {
                  console.error(`Failed to seed login for coordinator ${coord.coordinator_name}:`, insertErr.message);
                } else {
                  console.log(`Seeded login for coordinator '${coord.coordinator_name}' (role: ${userRole}, username: ${username}, password: ${password})`);
                }
              }
            );
          }
        });
      }
    });
  });
}

const userScopeCache = new Map();
const scopedUsersCache = new Map();

function invalidateScopeCache() {
  userScopeCache.clear();
  scopedUsersCache.clear();
}

let locationIndex = null;

function getLocationIndex() {
  if (locationIndex) return locationIndex;
  locationIndex = new Map();

  // Organization custom aliases
  const customAliases = {
    state: { state: 'Karnataka', district: null, taluk: null },
    district: { state: 'Karnataka', district: 'Bengaluru', taluk: null },
    taluk: { state: 'Karnataka', district: 'Mysuru', taluk: 'Mysuru Taluk' },
    bengaluru: { state: 'Karnataka', district: 'Bengaluru', taluk: null },
    mysuru: { state: 'Karnataka', district: 'Mysuru', taluk: 'Mysuru Taluk' },
    kolar: { state: 'Karnataka', district: 'Kolar', taluk: 'Kolar' },
    chennai: { state: 'Tamil Nadu', district: 'Chennai', taluk: null },
    mylapore: { state: 'Tamil Nadu', district: 'Chennai', taluk: 'Mylapore' },
    eranakulam: { state: 'Kerala', district: 'Ernakulam', taluk: null },
    ernakulam: { state: 'Kerala', district: 'Ernakulam', taluk: null },
    kochi: { state: 'Kerala', district: 'Ernakulam', taluk: 'Kochi' },
    chittoor: { state: 'Andhra Pradesh', district: 'Chittoor', taluk: null },
    tirupati: { state: 'Andhra Pradesh', district: 'Chittoor', taluk: 'Tirupati' },
    hyderabad: { state: 'Telangana', district: 'Hyderabad', taluk: null },
    secunderabad: { state: 'Telangana', district: 'Hyderabad', taluk: 'Secunderabad' },
    bengalurusouth: { state: 'Karnataka', district: 'Bengaluru', taluk: 'Bengaluru South' },
    bengalurunorth: { state: 'Karnataka', district: 'Bengaluru', taluk: 'Bengaluru North' },
    mysurutaluk: { state: 'Karnataka', district: 'Mysuru', taluk: 'Mysuru Taluk' }
  };

  for (const [key, val] of Object.entries(customAliases)) {
    locationIndex.set(key, val);
  }

  const stateCodes = {
    'Andhra Pradesh': 'ap',
    'Karnataka': 'ka',
    'Kerala': 'kl',
    'Tamil Nadu': 'tn',
    'Telangana': 'tg'
  };

  const locationsPath = path.join(__dirname, '..', '..', 'frontend', 'data', 'south_india_locations.json');
  if (fs.existsSync(locationsPath)) {
    try {
      const locationsData = JSON.parse(fs.readFileSync(locationsPath, 'utf8'));
      for (const [stateName, districts] of Object.entries(locationsData)) {
        const sc = stateCodes[stateName] || stateName.toLowerCase().slice(0, 2);
        const stateClean = stateName.toLowerCase().replace(/[^a-z0-9]/g, '');

        locationIndex.set(stateClean, { state: stateName, district: null, taluk: null });
        locationIndex.set(`${sc}_state`, { state: stateName, district: null, taluk: null });

        for (const [districtName, taluks] of Object.entries(districts)) {
          const districtClean = districtName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const distVal = { state: stateName, district: districtName, taluk: null };

          if (!locationIndex.has(districtClean)) {
            locationIndex.set(districtClean, distVal);
          }
          locationIndex.set(`${sc}_${districtClean}`, distVal);

          taluks.forEach(talukName => {
            const talukClean = talukName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const tqVal = { state: stateName, district: districtName, taluk: talukName };

            if (!locationIndex.has(talukClean)) {
              locationIndex.set(talukClean, tqVal);
            }
            if (!locationIndex.has(`${talukClean}_tq`)) {
              locationIndex.set(`${talukClean}_tq`, tqVal);
            }
            locationIndex.set(`${sc}_${talukClean}`, tqVal);
            locationIndex.set(`${sc}_${talukClean}_tq`, tqVal);
          });
        }
      }
    } catch (e) {
      console.error('Error parsing south_india_locations.json in db.js:', e.message);
    }
  }

  return locationIndex;
}

// Helper to strip prefixes and suffixes for place matching
function cleanPlaceName(uname) {
  let name = (uname || '').toLowerCase();
  if (/^(ap|ka|kl|tn|tg)_/.test(name)) {
    name = name.substring(3);
  }
  name = name.replace(/_tq$/, '').replace(/_district$/, '').replace(/_state$/, '');
  return name.replace(/[^a-z0-9]/g, '');
}

async function getUserLocationScope(user) {
  if (!user) return { role: 'user', state: null, district: null, taluk: null };
  
  // If admin, scope is unrestricted (all states, all districts, all taluks)
  if (user.role === 'admin') {
    return { role: 'admin', state: null, district: null, taluk: null };
  }

  const cacheKey = `${user.id || 0}_${user.username || ''}_${user.role || ''}`;
  if (userScopeCache.has(cacheKey)) {
    return userScopeCache.get(cacheKey);
  }

  // 1. First try matching by coordinator database entry
  let coord = null;
  if (user.email) {
    coord = await get('SELECT * FROM coordinators WHERE LOWER(email) = ?', [user.email.toLowerCase()]);
  }
  
  if (!coord && user.username) {
    coord = await get('SELECT * FROM coordinators WHERE LOWER(email) LIKE ?', [`%${user.username.toLowerCase()}%`]);
  }

  if (!coord && user.username) {
    const placeClean = cleanPlaceName(user.username);
    if (user.role === 'state_coordinator') {
      coord = await get(
        "SELECT * FROM coordinators WHERE LOWER(replace(replace(state, ' ', ''), '-', '')) = ? OR LOWER(replace(replace(state, ' ', ''), '-', '')) LIKE ? LIMIT 1",
        [placeClean, `%${placeClean}%`]
      );
    } else if (user.role === 'district_coordinator') {
      coord = await get(
        "SELECT * FROM coordinators WHERE LOWER(replace(replace(district, ' ', ''), '-', '')) = ? OR LOWER(replace(replace(district, ' ', ''), '-', '')) LIKE ? LIMIT 1",
        [placeClean, `%${placeClean}%`]
      );
    } else if (user.role === 'taluk_coordinator') {
      coord = await get(
        "SELECT * FROM coordinators WHERE LOWER(replace(replace(taluk, ' ', ''), '-', '')) = ? OR LOWER(replace(replace(taluk, ' ', ''), '-', '')) LIKE ? LIMIT 1",
        [placeClean, `%${placeClean}%`]
      );
    }

    if (!coord) {
      coord = await get(
        "SELECT * FROM coordinators WHERE LOWER(replace(replace(coordinator_name, ' ', ''), '.', '')) LIKE ? LIMIT 1",
        [`%${placeClean}%`]
      );
    }
  }

  // If coordinator is found, extract state, district, and taluk
  if (coord) {
    const scopeResult = {
      role: user.role,
      state: coord.state,
      district: user.role === 'state_coordinator' ? null : coord.district,
      taluk: (user.role === 'state_coordinator' || user.role === 'district_coordinator') ? null : coord.taluk
    };
    userScopeCache.set(cacheKey, scopeResult);
    return scopeResult;
  }

  // 2. Try location index map
  const locMap = getLocationIndex();
  const rawUname = (user.username || '').toLowerCase().trim();
  const cleanUname = rawUname.replace(/[^a-z0-9_]/g, '');
  const strippedName = cleanPlaceName(rawUname);

  const locMatch = locMap.get(cleanUname) || locMap.get(strippedName) || locMap.get(rawUname);
  if (locMatch) {
    const scopeResult = {
      role: user.role,
      state: locMatch.state,
      district: user.role === 'state_coordinator' ? null : locMatch.district,
      taluk: (user.role === 'state_coordinator' || user.role === 'district_coordinator') ? null : locMatch.taluk
    };
    userScopeCache.set(cacheKey, scopeResult);
    return scopeResult;
  }

  // 3. Fallback: Substring detection
  let state = null;
  let district = null;
  let taluk = null;

  if (rawUname.includes('karnataka') || rawUname.startsWith('ka_') || rawUname === 'state') state = 'Karnataka';
  else if (rawUname.includes('tamilnadu') || rawUname.includes('chennai') || rawUname.startsWith('tn_')) state = 'Tamil Nadu';
  else if (rawUname.includes('kerala') || rawUname.startsWith('kl_')) state = 'Kerala';
  else if (rawUname.includes('andhra') || rawUname.startsWith('ap_')) state = 'Andhra Pradesh';
  else if (rawUname.includes('telangana') || rawUname.startsWith('tg_')) state = 'Telangana';

  if (rawUname.includes('bengaluru')) {
    state = 'Karnataka';
    district = 'Bengaluru';
    if (rawUname.includes('south')) taluk = 'Bengaluru South';
    if (rawUname.includes('north')) taluk = 'Bengaluru North';
  } else if (rawUname.includes('mysuru')) {
    state = 'Karnataka';
    district = 'Mysuru';
    taluk = 'Mysuru Taluk';
  } else if (rawUname.includes('chennai') || rawUname.includes('mylapore')) {
    state = 'Tamil Nadu';
    district = 'Chennai';
    if (rawUname.includes('mylapore')) taluk = 'Mylapore';
  } else if (rawUname.includes('kochi') || rawUname.includes('eranakulam')) {
    state = 'Kerala';
    district = 'Ernakulam';
    taluk = 'Kochi';
  } else if (rawUname.includes('tirupati') || rawUname.includes('chittoor')) {
    state = 'Andhra Pradesh';
    district = 'Chittoor';
    taluk = 'Tirupati';
  } else if (rawUname.includes('hyderabad') || rawUname.includes('secunderabad')) {
    state = 'Telangana';
    district = 'Hyderabad';
    if (rawUname.includes('secunderabad')) taluk = 'Secunderabad';
  }

  if (user.role === 'state_coordinator') {
    district = null;
    taluk = null;
  } else if (user.role === 'district_coordinator') {
    taluk = null;
  }

  const scopeResult = {
    role: user.role,
    state,
    district,
    taluk
  };
  userScopeCache.set(cacheKey, scopeResult);
  return scopeResult;
}

/**
 * Returns all user IDs that belong to the specified userScope.
 * Returns null if userScope is admin (unrestricted).
 */
async function getScopedUserIds(userScope) {
  if (!userScope || userScope.role === 'admin' || !userScope.state) return null;

  const cacheKey = `${userScope.role}_${userScope.state || ''}_${userScope.district || ''}_${userScope.taluk || ''}`;
  if (scopedUsersCache.has(cacheKey)) {
    return scopedUsersCache.get(cacheKey);
  }

  const allUsers = await query("SELECT id, username, email, role FROM users");
  const scopedUserIds = [];

  for (const u of allUsers) {
    if (u.role === 'admin') continue; // Never include admin accounts in regional scope
    const uScope = await getUserLocationScope(u);
    let matches = false;

    if (userScope.role === 'state_coordinator') {
      matches = (uScope.state === userScope.state);
    } else if (userScope.role === 'district_coordinator') {
      matches = (uScope.state === userScope.state && uScope.district === userScope.district);
    } else if (userScope.role === 'taluk_coordinator') {
      matches = (uScope.state === userScope.state && uScope.district === userScope.district && uScope.taluk === userScope.taluk);
    }

    if (matches) {
      scopedUserIds.push(u.id);
    }
  }

  scopedUsersCache.set(cacheKey, scopedUserIds);
  return scopedUserIds;
}

/**
 * Returns SQL condition snippet for scoping queries by user location.
 * Returns '1=1' for admin/unrestricted, or e.g. "created_by IN (1,2,3)" for scoped coordinators.
 */
async function getScopeCondition(userScope, columnName = 'created_by') {
  if (!userScope || userScope.role === 'admin' || !userScope.state) {
    return '1=1';
  }
  const ids = await getScopedUserIds(userScope);
  if (!ids || ids.length === 0) return '1=0';
  return `${columnName} IN (${ids.join(',')})`;
}

module.exports = {
  db,
  query,
  get,
  run,
  getUserLocationScope,
  getScopedUserIds,
  getScopeCondition,
  invalidateScopeCache
};
