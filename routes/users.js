const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { JWT_SECRET, authenticateToken, requireAdminOrStateCoordinator } = require('./authMiddleware');

// POST /api/users/register - Register a user (Admin & State Coordinator only)
router.post('/register', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }

  try {
    const existingUser = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const userRole = role || 'user';

    const result = await db.run(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, passwordHash, userRole]
    );

    res.status(201).json({ message: 'User registered successfully', userId: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/login - Login a user
router.post('/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    if (role && user.role !== role) {
      const prettyRole = role.replace('_', ' ');
      const userPrettyRole = user.role.replace('_', ' ');
      return res.status(403).json({ error: `Unauthorized role choice. This account is registered as '${userPrettyRole}'.` });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const scope = await db.getUserLocationScope(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        state: scope.state,
        district: scope.district,
        taluk: scope.taluk
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/profile - Get current user profile with location scope
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await db.get('SELECT id, username, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const scope = await db.getUserLocationScope(user);
    res.json({
      ...user,
      state: scope.state,
      district: scope.district,
      taluk: scope.taluk
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/location-scope - Get current user location scope
router.get('/location-scope', authenticateToken, async (req, res) => {
  try {
    const scope = await db.getUserLocationScope(req.user);
    res.json(scope);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users - Get users (Admin gets all, State Coordinator gets only their state's users)
router.get('/', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    if (userScope.role === 'admin' || !userScope.state) {
      const users = await db.query('SELECT id, username, email, role, created_at FROM users ORDER BY username ASC');
      return res.json(users);
    }

    const scopedUserIds = await db.getScopedUserIds(userScope);
    const idsPlaceholder = scopedUserIds && scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
    const users = await db.query(
      `SELECT id, username, email, role, created_at FROM users WHERE id IN (${idsPlaceholder}) AND role != 'admin' ORDER BY username ASC`
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/role - Update user role (Admin & State Coordinator only)
router.put('/:id/role', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const { role } = req.body;
  if (!role) {
    return res.status(400).json({ error: 'Role is required' });
  }

  const validRoles = ['admin', 'state_coordinator', 'district_coordinator', 'taluk_coordinator'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const userScope = await db.getUserLocationScope(req.user);
  if (userScope.role === 'state_coordinator') {
    if (role === 'admin') {
      return res.status(403).json({ error: 'State coordinators cannot grant Administrator role' });
    }
    const scopedUserIds = await db.getScopedUserIds(userScope);
    if (!scopedUserIds.includes(Number(req.params.id))) {
      return res.status(403).json({ error: 'You can only update user roles within your assigned state' });
    }
  }

  try {
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    db.invalidateScopeCache();
    res.json({ message: 'User role updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/reset-password - Reset password (Admin & State Coordinator only)
router.post('/:id/reset-password', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ error: 'New password is required' });
  }

  const userScope = await db.getUserLocationScope(req.user);
  if (userScope.role === 'state_coordinator') {
    const scopedUserIds = await db.getScopedUserIds(userScope);
    if (!scopedUserIds.includes(Number(req.params.id))) {
      return res.status(403).json({ error: 'You can only reset passwords for accounts within your assigned state' });
    }
  }

  try {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(newPassword, salt);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.params.id]);
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/create - Create login (Admin & State Coordinator only)
router.post('/create', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'Username, email, password and role are required' });
  }

  const validRoles = ['admin', 'state_coordinator', 'district_coordinator', 'taluk_coordinator'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const userScope = await db.getUserLocationScope(req.user);
  if (userScope.role === 'state_coordinator') {
    if (role === 'admin') {
      return res.status(403).json({ error: 'State coordinators cannot create Administrator accounts' });
    }
    const targetScope = await db.getUserLocationScope({ username, email, role });
    if (targetScope.state && userScope.state && targetScope.state !== userScope.state) {
      return res.status(403).json({ error: `You can only create logins for your assigned state (${userScope.state})` });
    }
  }

  try {
    const existingUser = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    const result = await db.run(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, passwordHash, role]
    );
    db.invalidateScopeCache();

    res.status(201).json({ message: 'User login created successfully', userId: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id - Update user login details (Admin & State Coordinator only)
router.put('/:id', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const { username, email, role, password } = req.body;
  if (!username || !email || !role) {
    return res.status(400).json({ error: 'Username, email and role are required' });
  }

  const validRoles = ['admin', 'state_coordinator', 'district_coordinator', 'taluk_coordinator'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const userScope = await db.getUserLocationScope(req.user);
  if (userScope.role === 'state_coordinator') {
    if (role === 'admin') {
      return res.status(403).json({ error: 'State coordinators cannot grant Administrator accounts' });
    }
    const scopedUserIds = await db.getScopedUserIds(userScope);
    if (!scopedUserIds.includes(Number(req.params.id))) {
      return res.status(403).json({ error: 'You can only edit accounts within your assigned state' });
    }
  }

  try {
    // Check for duplicate username or email excluding current user
    const existingUser = await db.get(
      'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
      [username, email, req.params.id]
    );
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    if (password) {
      // Update with password
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(password, salt);
      await db.run(
        'UPDATE users SET username = ?, email = ?, role = ?, password_hash = ? WHERE id = ?',
        [username, email, role, passwordHash, req.params.id]
      );
    } else {
      // Update without password
      await db.run(
        'UPDATE users SET username = ?, email = ?, role = ? WHERE id = ?',
        [username, email, role, req.params.id]
      );
    }
    db.invalidateScopeCache();

    res.json({ message: 'User login updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id - Delete user login (Admin & State Coordinator only)
router.delete('/:id', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const targetId = req.params.id;

  // Prevent users from deleting their own account
  if (targetId == req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  const userScope = await db.getUserLocationScope(req.user);
  if (userScope.role === 'state_coordinator') {
    const scopedUserIds = await db.getScopedUserIds(userScope);
    if (!scopedUserIds.includes(Number(targetId))) {
      return res.status(403).json({ error: 'You can only delete accounts within your assigned state' });
    }
  }

  try {
    // Get target user info
    const targetUser = await db.get('SELECT username, role FROM users WHERE id = ?', [targetId]);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Safety check: Cannot delete the last admin account
    if (targetUser.role === 'admin') {
      const adminCount = await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
      if (adminCount.count <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last administrator account' });
      }
    }

    await db.run('DELETE FROM users WHERE id = ?', [targetId]);
    db.invalidateScopeCache();
    res.json({ message: `User login for '${targetUser.username}' deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/export-protected - Download password-protected credentials ZIP (Admin & State Coordinator only)
let locationDistrictsSet = null;

function isLocationDistrict(username) {
  if (!locationDistrictsSet) {
    locationDistrictsSet = new Set();
    try {
      const fs = require('fs');
      const path = require('path');
      const locationsPath = path.join(__dirname, '..', '..', 'frontend', 'data', 'south_india_locations.json');
      if (fs.existsSync(locationsPath)) {
        const locationsData = JSON.parse(fs.readFileSync(locationsPath, 'utf8'));
        for (const districts of Object.values(locationsData)) {
          for (const districtName of Object.keys(districts)) {
            locationDistrictsSet.add(districtName.toLowerCase().replace(/[^a-z0-9]/g, ''));
          }
        }
      }
    } catch (e) {
      console.error('Error loading districts for password helper:', e.message);
    }
  }
  return locationDistrictsSet.has(username);
}

function getDefaultPassword(username, role) {
  if (username === 'admin') return 'admin123';
  if (username === 'state') return 'state123';
  if (username === 'district') return 'district123';
  if (username === 'taluk') return 'taluk123';

  // Explicitly check for default users from db.js defaultUsers list
  const customDefaultUsers = [
    'karnataka', 'tamilnadu', 'kerala', 'andhrapradesh', 'telangana',
    'bengaluru', 'mysuru', 'kolar', 'chennai', 'eranakulam', 'chittoor', 'hyderabad',
    'bengalurusouth', 'bengalurunorth', 'mysurutaluk', 'mylapore', 'kochi', 'tirupati', 'secunderabad'
  ];
  if (customDefaultUsers.includes(username)) {
    return `${username}123`;
  }

  if (role === 'state_coordinator') {
    return 'state123';
  }
  if (role === 'district_coordinator') {
    const locationDistricts = ['bengaluru', 'mysuru', 'kolar', 'chennai', 'eranakulam', 'chittoor', 'hyderabad'];
    if (locationDistricts.includes(username) || isLocationDistrict(username)) {
      return 'district123';
    }
    return `${username}123`;
  }
  if (role === 'taluk_coordinator') {
    if (username.endsWith('_tq')) {
      return 'taluk123';
    }
    return `${username}123`;
  }
  return 'N/A';
}

const archiver = require('archiver');
try {
  archiver.registerFormat('zip-encryptable', require('archiver-zip-encryptable'));
} catch (err) {
  // Ignore error if already registered
}

router.post('/export-protected', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const { zipPassword } = req.body;
  if (!zipPassword) {
    return res.status(400).json({ error: 'Zip password is required' });
  }

  try {
    const userScope = await db.getUserLocationScope(req.user);
    let users;
    if (userScope.role === 'admin' || !userScope.state) {
      users = await db.query('SELECT username, email, role, created_at FROM users');
    } else {
      const scopedUserIds = await db.getScopedUserIds(userScope);
      const idsPlaceholder = scopedUserIds && scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
      users = await db.query(`SELECT username, email, role, created_at FROM users WHERE id IN (${idsPlaceholder}) AND role != 'admin'`);
    }
    
    // Generate CSV string
    let csvContent = 'Username,Email,Role,Registered Date,Default Password/Status\n';
    
    users.forEach(u => {
      const defaultPwd = getDefaultPassword(u.username, u.role);
      const dateStr = new Date(u.created_at).toLocaleDateString();
      // Escape CSV fields
      const escUsername = `"${u.username.replace(/"/g, '""')}"`;
      const escEmail = `"${u.email.replace(/"/g, '""')}"`;
      const escRole = `"${u.role.replace(/"/g, '""')}"`;
      const escPwd = `"${defaultPwd.replace(/"/g, '""')}"`;
      csvContent += `${escUsername},${escEmail},${escRole},${dateStr},${escPwd}\n`;
    });

    // Create password-protected ZIP archive using archiver and stream it
    const archive = archiver('zip-encryptable', {
      zlib: { level: 9 },
      forceLocalTime: true,
      password: zipPassword
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="credentials.zip"');

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });

    archive.pipe(res);
    archive.append(Buffer.from(csvContent, 'utf8'), { name: 'credentials.csv' });
    archive.finalize();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id/coordinator - Get assigned coordinator details for a login (Admin & State Coordinator only)
router.get('/:id/coordinator', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  try {
    const user = await db.get('SELECT username, email, role FROM users WHERE id = ?', [req.params.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 1. First try matching by email
    let coord = await db.get('SELECT * FROM coordinators WHERE LOWER(email) = ?', [user.email.toLowerCase()]);
    if (coord) {
      return res.json({ coordinator: coord });
    }

    // 2. Try matching by username prefix/suffix or clean name
    const cleanUsername = user.username.toLowerCase();
    
    // Helper to strip state code prefix and suffixes
    function cleanPlaceName(uname) {
      let name = uname;
      if (/^(ap|ka|kl|tn|tg)_/.test(name)) {
        name = name.substring(3);
      }
      name = name.replace(/_tq$/, '').replace(/_district$/, '').replace(/_state$/, '');
      return name;
    }

    const placeClean = cleanPlaceName(cleanUsername);

    if (user.role === 'state_coordinator') {
      coord = await db.get(
        "SELECT * FROM coordinators WHERE LOWER(replace(replace(state, ' ', ''), '-', '')) = ? AND role LIKE '%State%'",
        [placeClean]
      );
    } else if (user.role === 'district_coordinator') {
      coord = await db.get(
        "SELECT * FROM coordinators WHERE LOWER(replace(replace(district, ' ', ''), '-', '')) = ? AND role LIKE '%District%'",
        [placeClean]
      );
    } else if (user.role === 'taluk_coordinator') {
      coord = await db.get(
        "SELECT * FROM coordinators WHERE LOWER(replace(replace(taluk, ' ', ''), '-', '')) = ? AND role LIKE '%Taluk%'",
        [placeClean]
      );
    }

    if (coord) {
      return res.json({ coordinator: coord });
    }

    // 3. Try fallback match where username clean name is inside coordinator name
    coord = await db.get(
      "SELECT * FROM coordinators WHERE LOWER(replace(replace(coordinator_name, ' ', ''), '.', '')) LIKE ?",
      [`%${placeClean}%`]
    );

    if (coord) {
      return res.json({ coordinator: coord });
    }

    res.json({ coordinator: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
