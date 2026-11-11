const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireAdminOrStateCoordinator } = require('./authMiddleware');
const { broadcast } = require('../utils/realtime');

// GET /api/coordinators/public/all - Get all coordinators for public directory lookup
router.get('/public/all', async (req, res) => {
  try {
    const list = await db.query('SELECT * FROM coordinators ORDER BY state ASC, district ASC, taluk ASC, unit_name ASC');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/coordinators - Retrieve list according to location scope
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let list;
    if (userScope.role === 'admin' || !userScope.state) {
      list = await db.query('SELECT * FROM coordinators ORDER BY state ASC, district ASC, taluk ASC, unit_name ASC');
    } else if (userScope.role === 'state_coordinator') {
      list = await db.query(
        'SELECT * FROM coordinators WHERE state = ? ORDER BY district ASC, taluk ASC, unit_name ASC',
        [userScope.state]
      );
    } else if (userScope.role === 'district_coordinator') {
      list = await db.query(
        'SELECT * FROM coordinators WHERE state = ? AND district = ? ORDER BY taluk ASC, unit_name ASC',
        [userScope.state, userScope.district]
      );
    } else if (userScope.role === 'taluk_coordinator') {
      list = await db.query(
        'SELECT * FROM coordinators WHERE state = ? AND district = ? AND taluk = ? ORDER BY unit_name ASC',
        [userScope.state, userScope.district, userScope.taluk]
      );
    } else {
      list = [];
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/coordinators/:id - Single coordinator
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const coord = await db.get('SELECT * FROM coordinators WHERE id = ?', [req.params.id]);
    if (!coord) {
      return res.status(404).json({ error: 'Coordinator not found' });
    }

    const userScope = await db.getUserLocationScope(req.user);
    if (userScope.role !== 'admin' && userScope.state && coord.state !== userScope.state) {
      return res.status(403).json({ error: `Access denied. You only have access to ${userScope.state} coordinators.` });
    }

    res.json(coord);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/coordinators - Create new coordinator
router.post('/', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const { state, district, taluk, unit_name, coordinator_name, role, phone, email, address } = req.body;
  if (!state || !district || !taluk || !unit_name || !coordinator_name || !role) {
    return res.status(400).json({ error: 'State, District, Taluk, Unit Name, Coordinator Name, and Role are required' });
  }

  const userScope = await db.getUserLocationScope(req.user);
  if (userScope.role === 'state_coordinator' && userScope.state && state !== userScope.state) {
    return res.status(403).json({ error: `You can only add coordinators within your assigned state (${userScope.state}).` });
  }

  try {
    const result = await db.run(
      'INSERT INTO coordinators (state, district, taluk, unit_name, coordinator_name, role, phone, email, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [state, district, taluk, unit_name, coordinator_name, role, phone || '', email || '', address || '']
    );
    db.invalidateScopeCache();

    // Auto-create login credentials for the new coordinator
    await createLoginForCoordinator({ state, district, taluk, coordinator_name, role, email });

    broadcast('COORDINATOR_UPDATED', { action: 'create', id: result.id, state, district, taluk, coordinator_name });

    res.status(201).json({ message: 'Coordinator added successfully', coordinatorId: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/coordinators/:id - Update coordinator
router.put('/:id', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const { state, district, taluk, unit_name, coordinator_name, role, phone, email, address } = req.body;
  if (!state || !district || !taluk || !unit_name || !coordinator_name || !role) {
    return res.status(400).json({ error: 'State, District, Taluk, Unit Name, Coordinator Name, and Role are required' });
  }

  const userScope = await db.getUserLocationScope(req.user);
  const existingCoord = await db.get('SELECT * FROM coordinators WHERE id = ?', [req.params.id]);
  if (!existingCoord) {
    return res.status(404).json({ error: 'Coordinator not found' });
  }

  if (userScope.role === 'state_coordinator' && userScope.state) {
    if (existingCoord.state !== userScope.state || state !== userScope.state) {
      return res.status(403).json({ error: `You can only modify coordinators within your assigned state (${userScope.state}).` });
    }
  }

  try {
    await db.run(
      'UPDATE coordinators SET state = ?, district = ?, taluk = ?, unit_name = ?, coordinator_name = ?, role = ?, phone = ?, email = ?, address = ? WHERE id = ?',
      [state, district, taluk, unit_name, coordinator_name, role, phone || '', email || '', address || '', req.params.id]
    );
    db.invalidateScopeCache();

    // Auto-create/update login credentials if needed
    await createLoginForCoordinator({ state, district, taluk, coordinator_name, role, email });

    broadcast('COORDINATOR_UPDATED', { action: 'update', id: Number(req.params.id), state, district, taluk, coordinator_name });

    res.json({ message: 'Coordinator updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/coordinators/:id - Delete coordinator
router.delete('/:id', authenticateToken, requireAdminOrStateCoordinator, async (req, res) => {
  const userScope = await db.getUserLocationScope(req.user);
  const existingCoord = await db.get('SELECT * FROM coordinators WHERE id = ?', [req.params.id]);
  if (!existingCoord) {
    return res.status(404).json({ error: 'Coordinator not found' });
  }

  if (userScope.role === 'state_coordinator' && userScope.state && existingCoord.state !== userScope.state) {
    return res.status(403).json({ error: `You can only delete coordinators within your assigned state (${userScope.state}).` });
  }

  try {
    await db.run('DELETE FROM coordinators WHERE id = ?', [req.params.id]);
    db.invalidateScopeCache();
    broadcast('COORDINATOR_UPDATED', { action: 'delete', id: Number(req.params.id) });
    res.json({ message: 'Coordinator deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function createLoginForCoordinator(coord) {
  const bcrypt = require('bcryptjs');
  const roleLower = coord.role ? coord.role.toLowerCase() : '';
  let userRole = null;

  if (roleLower.includes('state coordinator')) {
    userRole = 'state_coordinator';
  } else if (roleLower.includes('district coordinator')) {
    userRole = 'district_coordinator';
  } else if (roleLower.includes('taluk coordinator')) {
    userRole = 'taluk_coordinator';
  }

  if (!userRole) return; // Only create logins for state, district, and taluk coordinators

  const stateCodes = {
    'andhra pradesh': 'ap',
    'karnataka': 'ka',
    'kerala': 'kl',
    'tamil nadu': 'tn',
    'telangana': 'tg'
  };
  const stateCode = stateCodes[coord.state.toLowerCase()] || coord.state.toLowerCase().slice(0, 2);

  // Determine clean place name formats
  const districtClean = coord.district.toLowerCase().replace(/[^a-z0-9]/g, '');
  const talukClean = coord.taluk.toLowerCase().replace(/[^a-z0-9]/g, '');

  let username = '';
  let defaultPassword = '';

  if (userRole === 'state_coordinator') {
    username = coord.state.toLowerCase().replace(/[^a-z0-9]/g, '');
    defaultPassword = 'state123';
  } else if (userRole === 'district_coordinator') {
    // Check if duplicate district exists in another state in coordinators table
    const duplicate = await db.get(
      'SELECT id FROM coordinators WHERE LOWER(district) = ? AND LOWER(state) != ?',
      [coord.district.toLowerCase(), coord.state.toLowerCase()]
    );
    username = duplicate ? `${stateCode}_${districtClean}` : districtClean;
    defaultPassword = 'district123';
  } else if (userRole === 'taluk_coordinator') {
    // Check if duplicate taluk exists in another state/district
    const duplicate = await db.get(
      'SELECT id FROM coordinators WHERE LOWER(taluk) = ? AND (LOWER(district) != ? OR LOWER(state) != ?)',
      [coord.taluk.toLowerCase(), coord.district.toLowerCase(), coord.state.toLowerCase()]
    );
    username = duplicate ? `${stateCode}_${talukClean}_tq` : `${talukClean}_tq`;
    defaultPassword = 'taluk123';
  }

  const email = coord.email && coord.email.includes('@')
    ? coord.email.toLowerCase()
    : `${username}@sstpa.org`;

  // Check if user already exists
  const existingUser = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
  if (!existingUser) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(defaultPassword, salt);
    await db.run(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, hash, userRole]
    );
    console.log(`Automatically created login for new coordinator '${coord.coordinator_name}': ${username} / ${defaultPassword}`);
  }
}

module.exports = router;
