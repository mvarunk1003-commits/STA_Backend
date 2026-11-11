const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireTier1, TIER1_ROLES } = require('./authMiddleware');
const { broadcast } = require('../utils/realtime');

function statusForUser(user) {
  return TIER1_ROLES.includes(user.role) ? 'approved' : 'pending';
}

// GET /api/photos/public — Public approved photos only
router.get('/public', async (req, res) => {
  try {
    const photos = await db.query(`
      SELECT p.*, u.username as uploader_name
      FROM photos p LEFT JOIN users u ON p.uploaded_by = u.id
      WHERE p.status = 'approved'
      ORDER BY p.created_at DESC
    `);
    res.json(photos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/photos — Authenticated: Tier 1 sees scoped; Tier 2 sees own + approved
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let photos;
    if (userScope.role === 'admin' || !userScope.state) {
      photos = await db.query(`
        SELECT p.*, u.username as uploader_name
        FROM photos p LEFT JOIN users u ON p.uploaded_by = u.id
        ORDER BY p.created_at DESC
      `);
    } else if (TIER1_ROLES.includes(req.user.role)) {
      const scopedUserIds = await db.getScopedUserIds(userScope);
      const idsPlaceholder = scopedUserIds && scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
      photos = await db.query(`
        SELECT p.*, u.username as uploader_name
        FROM photos p LEFT JOIN users u ON p.uploaded_by = u.id
        WHERE p.uploaded_by IN (${idsPlaceholder}) OR p.uploaded_by = ? OR (p.status = 'approved' AND (p.uploaded_by IN (${idsPlaceholder}) OR p.uploaded_by IS NULL))
        ORDER BY p.created_at DESC
      `, [req.user.id]);
    } else {
      photos = await db.query(`
        SELECT p.*, u.username as uploader_name
        FROM photos p LEFT JOIN users u ON p.uploaded_by = u.id
        WHERE p.status = 'approved' OR p.uploaded_by = ?
        ORDER BY p.created_at DESC
      `, [req.user.id]);
    }
    res.json(photos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/photos/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const photo = await db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    res.json(photo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/photos — Upload photo
router.post('/', authenticateToken, async (req, res) => {
  const { title, description, file_url, event_id } = req.body;
  if (!title || !file_url) {
    return res.status(400).json({ error: 'Title and file URL are required' });
  }

  const status = statusForUser(req.user);
  try {
    const result = await db.run(
      'INSERT INTO photos (title, description, file_url, uploaded_by, event_id, status) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, file_url, req.user.id, event_id || null, status]
    );

    if (status === 'pending') {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'New Photo Pending Approval',
          `Photo "${title}" uploaded by ${req.user.username} requires your approval.`,
          'approval_request',
          'admin,state_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'New Photo Pending Approval',
        message: `Photo "${title}" uploaded by ${req.user.username}`,
        type: 'approval_request'
      });
    }

    broadcast('PHOTO_UPLOADED', {
      id: result.id,
      title,
      description,
      file_url,
      status,
      uploaded_by: req.user.id
    });

    res.status(201).json({
      message: status === 'approved' ? 'Photo added successfully' : 'Photo submitted for approval',
      photoId: result.id,
      status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/photos/public-submit — Public guest upload photo (always pending)
router.post('/public-submit', async (req, res) => {
  const { title, description, file_url, event_id } = req.body;
  if (!title || !file_url) {
    return res.status(400).json({ error: 'Title and file URL are required' });
  }

  const status = 'pending';
  try {
    const result = await db.run(
      'INSERT INTO photos (title, description, file_url, uploaded_by, event_id, status) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description || null, file_url, null, event_id || null, status]
    );

    await db.run(
      "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
      [
        'New Guest Photo Pending Approval',
        `Photo "${title}" uploaded by guest requires your approval.`,
        'approval_request',
        'admin,state_coordinator',
        null
      ]
    );

    broadcast('NOTIFICATION_CREATED', {
      title: 'New Guest Photo Pending Approval',
      message: `Photo "${title}" uploaded by guest requires your approval.`,
      type: 'approval_request'
    });

    broadcast('PHOTO_UPLOADED', {
      id: result.id,
      title,
      file_url,
      status: 'pending'
    });

    res.status(201).json({
      message: 'Photo submitted for approval',
      photoId: result.id,
      status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/photos/:id — Update photo
router.put('/:id', authenticateToken, async (req, res) => {
  const { title, description } = req.body;
  try {
    const photo = await db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    if (!TIER1_ROLES.includes(req.user.role) && photo.uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own photos' });
    }

    await db.run(
      'UPDATE photos SET title = ?, description = ? WHERE id = ?',
      [title || photo.title, description || photo.description, req.params.id]
    );

    broadcast('PHOTO_UPDATED', { id: Number(req.params.id), title, description });

    res.json({ message: 'Photo updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/photos/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const photo = await db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    if (!TIER1_ROLES.includes(req.user.role) && photo.uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own photos' });
    }

    await db.run('DELETE FROM photos WHERE id = ?', [req.params.id]);
    broadcast('PHOTO_DELETED', { id: Number(req.params.id) });
    res.json({ message: 'Photo deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/photos/:id/approve — Tier 1 approves
router.post('/:id/approve', authenticateToken, requireTier1, async (req, res) => {
  try {
    const photo = await db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    await db.run("UPDATE photos SET status = 'approved' WHERE id = ?", [req.params.id]);

    if (photo.uploaded_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Photo Approved',
          `Your photo "${photo.title}" has been approved and is now visible in the gallery.`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'Photo Approved',
        message: `Your photo "${photo.title}" has been approved.`,
        type: 'approval_result',
        targetUserId: photo.uploaded_by
      });
    }

    broadcast('PHOTO_STATUS_CHANGED', { id: Number(req.params.id), status: 'approved' });

    res.json({ message: 'Photo approved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/photos/:id/reject — Tier 1 rejects
router.post('/:id/reject', authenticateToken, requireTier1, async (req, res) => {
  const { reason } = req.body;
  try {
    const photo = await db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    await db.run("UPDATE photos SET status = 'rejected' WHERE id = ?", [req.params.id]);

    if (photo.uploaded_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Photo Rejected',
          `Your photo "${photo.title}" was not approved. ${reason ? 'Reason: ' + reason : ''}`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'Photo Rejected',
        message: `Your photo "${photo.title}" was not approved.`,
        type: 'approval_result',
        targetUserId: photo.uploaded_by
      });
    }

    broadcast('PHOTO_STATUS_CHANGED', { id: Number(req.params.id), status: 'rejected' });

    res.json({ message: 'Photo rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
