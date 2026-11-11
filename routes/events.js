const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireTier1, TIER1_ROLES, hasCrudAccess } = require('./authMiddleware');
const { broadcast } = require('../utils/realtime');

// Helper: auto-approve for Tier 1, pending for Tier 2
function statusForUser(user) {
  return TIER1_ROLES.includes(user.role) ? 'approved' : 'pending';
}

// GET /api/events/public/all — Public access (approved events only)
router.get('/public/all', async (req, res) => {
  try {
    const events = await db.query("SELECT * FROM events WHERE status = 'approved' ORDER BY date DESC");
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/pending — Tier 1 only: all pending events in scope
router.get('/pending', authenticateToken, requireTier1, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let events;
    if (userScope.role === 'admin' || !userScope.state) {
      events = await db.query(`
        SELECT e.*, u.username as creator_name, u.role as creator_role
        FROM events e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE e.status = 'pending'
        ORDER BY e.date ASC
      `);
    } else {
      const scopedUserIds = (await db.getScopedUserIds(userScope)) || [];
      const idsPlaceholder = scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
      events = await db.query(`
        SELECT e.*, u.username as creator_name, u.role as creator_role
        FROM events e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE e.status = 'pending' AND (e.created_by IN (${idsPlaceholder}) OR e.created_by = ?)
        ORDER BY e.date ASC
      `, [req.user.id]);
    }
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events — Authenticated: filtered to user location scope
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let events;
    if (userScope.role === 'admin' || !userScope.state) {
      events = await db.query(`
        SELECT e.*, u.username as creator_name, u.role as creator_role
        FROM events e
        LEFT JOIN users u ON e.created_by = u.id
        ORDER BY e.date DESC
      `);
    } else {
      const scopedUserIds = (await db.getScopedUserIds(userScope)) || [];
      const idsPlaceholder = scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
      events = await db.query(`
        SELECT e.*, u.username as creator_name, u.role as creator_role
        FROM events e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE e.created_by IN (${idsPlaceholder}) OR e.created_by = ?
        ORDER BY e.date DESC
      `, [req.user.id]);
    }
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id — Single event
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const event = await db.get(`
      SELECT e.*, u.username as creator_name
      FROM events e LEFT JOIN users u ON e.created_by = u.id
      WHERE e.id = ?
    `, [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events — Create event (all authenticated)
router.post('/', authenticateToken, async (req, res) => {
  const { title, description, date, location, budget } = req.body;
  if (!title || !date) {
    return res.status(400).json({ error: 'Title and Date are required' });
  }

  const status = statusForUser(req.user);
  try {
    const result = await db.run(
      'INSERT INTO events (title, description, date, location, budget, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, description, date, location, budget || 0, status, req.user.id]
    );

    // Notify Tier 1 if submitted by Tier 2
    if (status === 'pending') {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'New Event Pending Approval',
          `Event "${title}" submitted by ${req.user.username} (${req.user.role.replace('_', ' ')}) requires your approval.`,
          'approval_request',
          'admin,state_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'New Event Pending Approval',
        message: `Event "${title}" submitted by ${req.user.username}`,
        type: 'approval_request'
      });
    }

    broadcast('EVENT_CREATED', {
      id: result.id,
      title,
      description,
      date,
      location,
      budget: budget || 0,
      status,
      created_by: req.user.id
    });

    res.status(201).json({
      message: status === 'approved' ? 'Event created successfully' : 'Event submitted for approval',
      eventId: result.id,
      status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/events/:id — Update event
router.put('/:id', authenticateToken, async (req, res) => {
  const { title, description, date, location, budget } = req.body;
  if (!title || !date) {
    return res.status(400).json({ error: 'Title and Date are required' });
  }

  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Check CRUD access
    const hasAccess = await hasCrudAccess(req.user, event.created_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Unauthorized to update this event' });
    }

    await db.run(
      'UPDATE events SET title = ?, description = ?, date = ?, location = ?, budget = ? WHERE id = ?',
      [title, description, date, location, budget, req.params.id]
    );

    broadcast('EVENT_UPDATED', {
      id: Number(req.params.id),
      title,
      description,
      date,
      location,
      budget
    });

    res.json({ message: 'Event updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id — Delete event
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Check CRUD access
    const hasAccess = await hasCrudAccess(req.user, event.created_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Unauthorized to delete this event' });
    }

    await db.run('DELETE FROM events WHERE id = ?', [req.params.id]);

    broadcast('EVENT_DELETED', { id: Number(req.params.id) });

    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/approve — Tier 1 approves event
router.post('/:id/approve', authenticateToken, requireTier1, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Check CRUD access
    const hasAccess = await hasCrudAccess(req.user, event.created_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Unauthorized to approve this event' });
    }

    await db.run("UPDATE events SET status = 'approved' WHERE id = ?", [req.params.id]);

    // Notify the submitter
    if (event.created_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Event Approved',
          `Your event "${event.title}" has been approved and is now publicly visible.`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'Event Approved',
        message: `Your event "${event.title}" has been approved.`,
        type: 'approval_result',
        targetUserId: event.created_by
      });
    }

    broadcast('EVENT_STATUS_CHANGED', { id: Number(req.params.id), status: 'approved' });

    res.json({ message: 'Event approved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/reject — Tier 1 rejects event
router.post('/:id/reject', authenticateToken, requireTier1, async (req, res) => {
  const { reason } = req.body;
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Check CRUD access
    const hasAccess = await hasCrudAccess(req.user, event.created_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Unauthorized to reject this event' });
    }

    await db.run("UPDATE events SET status = 'rejected' WHERE id = ?", [req.params.id]);

    if (event.created_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Event Rejected',
          `Your event "${event.title}" was not approved. ${reason ? 'Reason: ' + reason : ''}`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'Event Rejected',
        message: `Your event "${event.title}" was not approved.`,
        type: 'approval_result',
        targetUserId: event.created_by
      });
    }

    broadcast('EVENT_STATUS_CHANGED', { id: Number(req.params.id), status: 'rejected' });

    res.json({ message: 'Event rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET event attendance
router.get('/:id/attendance', authenticateToken, async (req, res) => {
  try {
    const sql = `
      SELECT m.id as member_id, m.first_name, m.last_name, m.email, a.status, a.marked_at
      FROM members m
      LEFT JOIN attendance a ON m.id = a.member_id AND a.event_id = ?
      WHERE m.status = 'active'
      ORDER BY m.first_name ASC
    `;
    const list = await db.query(sql, [req.params.id]);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST mark event attendance
router.post('/:id/attendance', authenticateToken, async (req, res) => {
  const list = Array.isArray(req.body.attendanceList) 
    ? req.body.attendanceList 
    : (req.body.member_id ? [{ member_id: req.body.member_id, status: req.body.status || 'present' }] : null);

  if (!list || list.length === 0) {
    return res.status(400).json({ error: 'attendanceList is required and must be an array, or provide member_id' });
  }

  const eventId = req.params.id;
  try {
    const promises = list.map(item => {
      return db.run(
        `INSERT INTO attendance (event_id, member_id, status, marked_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(event_id, member_id) DO UPDATE SET status = excluded.status, marked_at = CURRENT_TIMESTAMP`,
        [eventId, item.member_id, item.status]
      );
    });
    await Promise.all(promises);

    broadcast('ATTENDANCE_UPDATED', { eventId: Number(eventId) });

    res.json({ message: 'Attendance recorded successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET event expenses
router.get('/:id/expenses', authenticateToken, async (req, res) => {
  try {
    const expenses = await db.query('SELECT * FROM expenses WHERE event_id = ? ORDER BY date DESC', [req.params.id]);
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
