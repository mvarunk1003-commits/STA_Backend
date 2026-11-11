const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken } = require('./authMiddleware');
const { broadcast } = require('../utils/realtime');

// Get all members scoped by user location
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    if (userScope.role === 'admin' || !userScope.state) {
      const members = await db.query('SELECT * FROM members ORDER BY first_name ASC');
      return res.json(members);
    }
    const scopedUserIds = await db.getScopedUserIds(userScope);
    const idsPlaceholder = scopedUserIds && scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
    const members = await db.query(
      `SELECT * FROM members WHERE created_by IN (${idsPlaceholder}) OR created_by = ? OR created_by IS NULL ORDER BY first_name ASC`,
      [req.user.id]
    );
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get member by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const member = await db.get('SELECT * FROM members WHERE id = ?', [req.params.id]);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(member);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new member
router.post('/', authenticateToken, async (req, res) => {
  const { first_name, last_name, email, phone, status, join_date } = req.body;
  if (!first_name || !last_name) {
    return res.status(400).json({ error: 'First name and last name are required' });
  }

  try {
    const joinDateVal = join_date || new Date().toISOString().split('T')[0];
    const statusVal = status || 'active';
    const result = await db.run(
      'INSERT INTO members (first_name, last_name, email, phone, status, join_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [first_name, last_name, email, phone, statusVal, joinDateVal, req.user.id]
    );

    broadcast('MEMBER_CREATED', {
      id: result.id,
      first_name,
      last_name,
      email,
      phone,
      status: statusVal,
      join_date: joinDateVal
    });

    res.status(201).json({ message: 'Member created successfully', memberId: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update member
router.put('/:id', authenticateToken, async (req, res) => {
  const { first_name, last_name, email, phone, status, join_date } = req.body;
  if (!first_name || !last_name) {
    return res.status(400).json({ error: 'First name and last name are required' });
  }

  try {
    await db.run(
      'UPDATE members SET first_name = ?, last_name = ?, email = ?, phone = ?, status = ?, join_date = ? WHERE id = ?',
      [first_name, last_name, email, phone, status, join_date, req.params.id]
    );

    broadcast('MEMBER_UPDATED', {
      id: Number(req.params.id),
      first_name,
      last_name,
      email,
      phone,
      status,
      join_date
    });

    res.json({ message: 'Member updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete member
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await db.run('DELETE FROM members WHERE id = ?', [req.params.id]);
    broadcast('MEMBER_DELETED', { id: Number(req.params.id) });
    res.json({ message: 'Member deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
