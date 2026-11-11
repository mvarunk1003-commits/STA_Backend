const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireTier1, TIER1_ROLES } = require('./authMiddleware');
const { broadcast } = require('../utils/realtime');

// ============================================================
// Visibility rules:
//   Admin        → sees ALL notifications
//   State/Dist/Taluk → only notifications where:
//       target_user_id = their user id  (directed to them specifically)
//     OR
//       target_user_id IS NULL AND target_roles matches their role
//       (broadcast messages not directed at any specific user)
// ============================================================

function buildUserFilter(user) {
  // Returns { sql, params } for WHERE clause
  const role = user.role;
  const id = user.id;
  return {
    sql: `(
      target_user_id = ?
      OR (
        target_user_id IS NULL AND (
          target_roles = 'all'
          OR target_roles = ?
          OR target_roles LIKE ?
          OR target_roles LIKE ?
        )
      )
    )`,
    params: [id, role, `%,${role}%`, `%${role},%`]
  };
}

// GET /api/notifications — Get notifications visible to current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    let notifications;
    if (req.user.role === 'admin') {
      // Admin sees everything
      notifications = await db.query(`
        SELECT n.*, u.username as sender_name,
               t.username as target_username
        FROM notifications n
        LEFT JOIN users u ON n.created_by = u.id
        LEFT JOIN users t ON n.target_user_id = t.id
        ORDER BY n.created_at DESC
        LIMIT 200
      `);
    } else {
      const filter = buildUserFilter(req.user);
      notifications = await db.query(`
        SELECT n.*, u.username as sender_name,
               t.username as target_username
        FROM notifications n
        LEFT JOIN users u ON n.created_by = u.id
        LEFT JOIN users t ON n.target_user_id = t.id
        WHERE ${filter.sql}
        ORDER BY n.created_at DESC
        LIMIT 100
      `, filter.params);
    }
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/unread-count — Badge count for bell icon
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    let count;
    if (req.user.role === 'admin') {
      count = await db.get("SELECT COUNT(*) as count FROM notifications WHERE is_read = 0");
    } else {
      const filter = buildUserFilter(req.user);
      count = await db.get(
        `SELECT COUNT(*) as count FROM notifications WHERE is_read = 0 AND ${filter.sql}`,
        filter.params
      );
    }
    res.json({ count: count.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/users — List all users for the "Send To" dropdown (Tier 1 only)
router.get('/users', authenticateToken, requireTier1, async (req, res) => {
  try {
    const users = await db.query(
      "SELECT id, username, role FROM users ORDER BY role ASC, username ASC"
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications — Tier 1 creates a notification
router.post('/', authenticateToken, requireTier1, async (req, res) => {
  const { title, message, type, target_roles, target_user_id } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  try {
    // If a specific user is targeted, ignore target_roles
    const finalTargetUserId = target_user_id ? parseInt(target_user_id) : null;
    const finalTargetRoles = finalTargetUserId ? null : (target_roles || 'all');

    const result = await db.run(
      'INSERT INTO notifications (title, message, type, target_roles, target_user_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [title, message, type || 'info', finalTargetRoles, finalTargetUserId, req.user.id]
    );

    const rolesArr = finalTargetRoles === 'all' ? null : (finalTargetRoles ? finalTargetRoles.split(',') : null);
    broadcast('NOTIFICATION_CREATED', {
      id: result.id,
      title,
      message,
      type: type || 'info',
      sender_name: req.user.username
    }, {
      targetUserId: finalTargetUserId,
      targetRoles: rolesArr
    });

    res.status(201).json({ message: 'Notification sent successfully', notificationId: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/:id/read — Mark one as read (only if visible to this user)
router.post('/:id/read', authenticateToken, async (req, res) => {
  try {
    await db.run("UPDATE notifications SET is_read = 1 WHERE id = ?", [req.params.id]);
    broadcast('NOTIFICATION_READ', { id: Number(req.params.id) }, { targetUserId: req.user.id });
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/mark-all-read — Mark all visible notifications as read
router.post('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      await db.run("UPDATE notifications SET is_read = 1");
    } else {
      const filter = buildUserFilter(req.user);
      await db.run(
        `UPDATE notifications SET is_read = 1 WHERE ${filter.sql}`,
        filter.params
      );
    }
    broadcast('NOTIFICATION_READ_ALL', {}, { targetUserId: req.user.id });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notifications/:id — Admin only
router.delete('/:id', authenticateToken, requireTier1, async (req, res) => {
  try {
    await db.run('DELETE FROM notifications WHERE id = ?', [req.params.id]);
    broadcast('NOTIFICATION_DELETED', { id: Number(req.params.id) });
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
