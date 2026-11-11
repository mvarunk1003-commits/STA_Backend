const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireTier1, TIER1_ROLES } = require('./authMiddleware');
const { broadcast } = require('../utils/realtime');

function statusForUser(user) {
  return TIER1_ROLES.includes(user.role) ? 'approved' : 'pending';
}

// GET /api/sponsors/public/all — Public approved sponsors only
router.get('/public/all', async (req, res) => {
  try {
    const sponsors = await db.query("SELECT * FROM sponsors WHERE status = 'approved' ORDER BY name ASC");
    res.json(sponsors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sponsors/pending — Tier 1 only (scoped)
router.get('/pending', authenticateToken, requireTier1, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let sponsors;
    if (userScope.role === 'admin' || !userScope.state) {
      sponsors = await db.query(`
        SELECT s.*, u.username as submitter_name, u.role as submitter_role
        FROM sponsors s
        LEFT JOIN users u ON s.submitted_by = u.id
        WHERE s.status = 'pending'
        ORDER BY s.created_at DESC
      `);
    } else {
      const scopedUserIds = await db.getScopedUserIds(userScope);
      const idsPlaceholder = scopedUserIds && scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
      sponsors = await db.query(`
        SELECT s.*, u.username as submitter_name, u.role as submitter_role
        FROM sponsors s
        LEFT JOIN users u ON s.submitted_by = u.id
        WHERE s.status = 'pending' AND (s.submitted_by IN (${idsPlaceholder}) OR s.submitted_by = ?)
        ORDER BY s.created_at DESC
      `, [req.user.id]);
    }
    res.json(sponsors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sponsors — Authenticated users (scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let sponsors;
    if (userScope.role === 'admin' || !userScope.state) {
      sponsors = await db.query(`
        SELECT s.*, u.username as submitter_name
        FROM sponsors s LEFT JOIN users u ON s.submitted_by = u.id
        ORDER BY s.name ASC
      `);
    } else if (TIER1_ROLES.includes(req.user.role)) {
      const scopedUserIds = await db.getScopedUserIds(userScope);
      const idsPlaceholder = scopedUserIds && scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
      sponsors = await db.query(`
        SELECT s.*, u.username as submitter_name
        FROM sponsors s LEFT JOIN users u ON s.submitted_by = u.id
        WHERE s.submitted_by IN (${idsPlaceholder}) OR s.submitted_by = ? OR (s.status = 'approved' AND (s.submitted_by IN (${idsPlaceholder}) OR s.submitted_by IS NULL))
        ORDER BY s.name ASC
      `, [req.user.id]);
    } else {
      sponsors = await db.query(`
        SELECT s.*, u.username as submitter_name
        FROM sponsors s LEFT JOIN users u ON s.submitted_by = u.id
        WHERE s.status = 'approved' OR s.submitted_by = ?
        ORDER BY s.name ASC
      `, [req.user.id]);
    }
    res.json(sponsors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sponsors/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const sponsor = await db.get('SELECT * FROM sponsors WHERE id = ?', [req.params.id]);
    if (!sponsor) return res.status(404).json({ error: 'Sponsor not found' });
    res.json(sponsor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sponsors — Create sponsor
router.post('/', authenticateToken, async (req, res) => {
  const { name, email, phone, contribution_type, contribution_amount, notes, event_id } = req.body;
  if (!name || !contribution_type) {
    return res.status(400).json({ error: 'Name and Contribution Type are required' });
  }

  const status = statusForUser(req.user);
  try {
    const result = await db.run(
      'INSERT INTO sponsors (name, email, phone, contribution_type, contribution_amount, notes, status, submitted_by, event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, email, phone, contribution_type, contribution_amount || 0, notes, status, req.user.id, event_id || null]
    );

    if (status === 'pending') {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'New Sponsor Pending Approval',
          `Sponsor "${name}" submitted by ${req.user.username} requires your approval.`,
          'approval_request',
          'admin,state_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'New Sponsor Pending Approval',
        message: `Sponsor "${name}" submitted by ${req.user.username}`,
        type: 'approval_request'
      });
    }

    broadcast('SPONSOR_CREATED', {
      id: result.id,
      name,
      contribution_type,
      contribution_amount: contribution_amount || 0,
      status,
      submitted_by: req.user.id
    });

    res.status(201).json({
      message: status === 'approved' ? 'Sponsor added successfully' : 'Sponsor submitted for approval',
      sponsorId: result.id,
      status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sponsors/:id — Update sponsor
router.put('/:id', authenticateToken, async (req, res) => {
  const { name, email, phone, contribution_type, contribution_amount, notes } = req.body;
  if (!name || !contribution_type) {
    return res.status(400).json({ error: 'Name and Contribution Type are required' });
  }

  try {
    const sponsor = await db.get('SELECT * FROM sponsors WHERE id = ?', [req.params.id]);
    if (!sponsor) return res.status(404).json({ error: 'Sponsor not found' });

    if (!TIER1_ROLES.includes(req.user.role) && sponsor.submitted_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own sponsor submissions' });
    }

    await db.run(
      'UPDATE sponsors SET name = ?, email = ?, phone = ?, contribution_type = ?, contribution_amount = ?, notes = ? WHERE id = ?',
      [name, email, phone, contribution_type, contribution_amount, notes, req.params.id]
    );

    broadcast('SPONSOR_UPDATED', { id: Number(req.params.id), name, contribution_amount });

    res.json({ message: 'Sponsor updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sponsors/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const sponsor = await db.get('SELECT * FROM sponsors WHERE id = ?', [req.params.id]);
    if (!sponsor) return res.status(404).json({ error: 'Sponsor not found' });

    if (!TIER1_ROLES.includes(req.user.role) && sponsor.submitted_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own sponsor submissions' });
    }

    await db.run('DELETE FROM sponsors WHERE id = ?', [req.params.id]);
    broadcast('SPONSOR_DELETED', { id: Number(req.params.id) });
    res.json({ message: 'Sponsor removed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sponsors/:id/approve — Tier 1 approves
router.post('/:id/approve', authenticateToken, requireTier1, async (req, res) => {
  try {
    const sponsor = await db.get('SELECT * FROM sponsors WHERE id = ?', [req.params.id]);
    if (!sponsor) return res.status(404).json({ error: 'Sponsor not found' });

    await db.run("UPDATE sponsors SET status = 'approved' WHERE id = ?", [req.params.id]);

    if (sponsor.submitted_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Sponsor Approved',
          `Your sponsor submission "${sponsor.name}" has been approved.`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'Sponsor Approved',
        message: `Your sponsor submission "${sponsor.name}" has been approved.`,
        type: 'approval_result',
        targetUserId: sponsor.submitted_by
      });
    }

    broadcast('SPONSOR_STATUS_CHANGED', { id: Number(req.params.id), status: 'approved' });

    res.json({ message: 'Sponsor approved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sponsors/:id/reject — Tier 1 rejects
router.post('/:id/reject', authenticateToken, requireTier1, async (req, res) => {
  const { reason } = req.body;
  try {
    const sponsor = await db.get('SELECT * FROM sponsors WHERE id = ?', [req.params.id]);
    if (!sponsor) return res.status(404).json({ error: 'Sponsor not found' });

    await db.run("UPDATE sponsors SET status = 'rejected' WHERE id = ?", [req.params.id]);

    if (sponsor.submitted_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Sponsor Submission Rejected',
          `Your sponsor submission "${sponsor.name}" was not approved. ${reason ? 'Reason: ' + reason : ''}`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'Sponsor Submission Rejected',
        message: `Your sponsor submission "${sponsor.name}" was not approved.`,
        type: 'approval_result',
        targetUserId: sponsor.submitted_by
      });
    }

    broadcast('SPONSOR_STATUS_CHANGED', { id: Number(req.params.id), status: 'rejected' });

    res.json({ message: 'Sponsor rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
