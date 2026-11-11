const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireTier1, TIER1_ROLES } = require('./authMiddleware');
const { broadcast } = require('../utils/realtime');

function statusForUser(user) {
  return TIER1_ROLES.includes(user.role) ? 'approved' : 'pending';
}

// GET /api/event-notices/public — Public approved notices only
router.get('/public', async (req, res) => {
  try {
    const notices = await db.query(`
      SELECT n.*, u.username as submitter_name
      FROM event_notices n LEFT JOIN users u ON n.submitted_by = u.id
      WHERE n.status = 'approved'
      ORDER BY n.created_at DESC
    `);
    res.json(notices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/event-notices — Authenticated: Tier1 sees scoped; Tier2 sees own + approved
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let notices;
    if (userScope.role === 'admin' || !userScope.state) {
      notices = await db.query(`
        SELECT n.*, u.username as submitter_name
        FROM event_notices n LEFT JOIN users u ON n.submitted_by = u.id
        ORDER BY n.created_at DESC
      `);
    } else if (TIER1_ROLES.includes(req.user.role)) {
      const scopedUserIds = await db.getScopedUserIds(userScope);
      const idsPlaceholder = scopedUserIds && scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
      notices = await db.query(`
        SELECT n.*, u.username as submitter_name
        FROM event_notices n LEFT JOIN users u ON n.submitted_by = u.id
        WHERE n.state = ? OR n.submitted_by IN (${idsPlaceholder}) OR n.submitted_by = ?
        ORDER BY n.created_at DESC
      `, [userScope.state, req.user.id]);
    } else {
      notices = await db.query(`
        SELECT n.*, u.username as submitter_name
        FROM event_notices n LEFT JOIN users u ON n.submitted_by = u.id
        WHERE (n.status = 'approved' AND (n.state = ? OR n.state = '' OR n.state IS NULL)) OR n.submitted_by = ?
        ORDER BY n.created_at DESC
      `, [userScope.state || '', req.user.id]);
    }
    res.json(notices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/event-notices/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const notice = await db.get('SELECT * FROM event_notices WHERE id = ?', [req.params.id]);
    if (!notice) return res.status(404).json({ error: 'Notice not found' });
    res.json(notice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/event-notices — Submit new notice
router.post('/', authenticateToken, async (req, res) => {
  const {
    title, organization, sub_org, salutation,
    event_description, event_date, event_time, event_venue,
    chairperson, attendees, notices_list, contact_info,
    footer_text, state, header_image_url, notice_language
  } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  const status = statusForUser(req.user);

  try {
    const result = await db.run(
      `INSERT INTO event_notices
        (title, organization, sub_org, salutation, event_description, event_date, event_time,
         event_venue, chairperson, attendees, notices_list, contact_info, footer_text,
         state, header_image_url, notice_language, status, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, organization || '', sub_org || '', salutation || '',
        event_description || '', event_date || '', event_time || '',
        event_venue || '', chairperson || '',
        JSON.stringify(attendees || []),
        JSON.stringify(notices_list || []),
        contact_info || '', footer_text || '',
        state || '', header_image_url || '',
        notice_language || 'kn',
        status, req.user.id
      ]
    );

    // Notify Tier 1 if pending
    if (status === 'pending') {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'New Event Notice Pending Approval',
          `Event notice "${title}" submitted by ${req.user.username} requires your approval.`,
          'approval_request',
          'admin,state_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'New Event Notice Pending Approval',
        message: `Event notice "${title}" submitted by ${req.user.username}`,
        type: 'approval_request'
      });
    }

    broadcast('NOTICE_CREATED', {
      id: result.id,
      title,
      organization,
      event_date,
      event_time,
      event_venue,
      status,
      submitted_by: req.user.id
    });

    res.status(201).json({
      message: status === 'approved' ? 'Notice published!' : 'Notice submitted for approval',
      id: result.id,
      status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/event-notices/:id — Edit own notice
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const notice = await db.get('SELECT * FROM event_notices WHERE id = ?', [req.params.id]);
    if (!notice) return res.status(404).json({ error: 'Notice not found' });

    if (!TIER1_ROLES.includes(req.user.role) && notice.submitted_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own notices' });
    }

    const {
      title, organization, sub_org, salutation,
      event_description, event_date, event_time, event_venue,
      chairperson, attendees, notices_list, contact_info,
      footer_text, state, header_image_url, notice_language
    } = req.body;

    await db.run(
      `UPDATE event_notices SET
        title=?, organization=?, sub_org=?, salutation=?,
        event_description=?, event_date=?, event_time=?, event_venue=?,
        chairperson=?, attendees=?, notices_list=?, contact_info=?,
        footer_text=?, state=?, header_image_url=?, notice_language=?,
        status='pending', updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [
        title || notice.title,
        organization ?? notice.organization,
        sub_org ?? notice.sub_org,
        salutation ?? notice.salutation,
        event_description ?? notice.event_description,
        event_date ?? notice.event_date,
        event_time ?? notice.event_time,
        event_venue ?? notice.event_venue,
        chairperson ?? notice.chairperson,
        JSON.stringify(attendees || JSON.parse(notice.attendees || '[]')),
        JSON.stringify(notices_list || JSON.parse(notice.notices_list || '[]')),
        contact_info ?? notice.contact_info,
        footer_text ?? notice.footer_text,
        state ?? notice.state,
        header_image_url ?? notice.header_image_url,
        notice_language ?? notice.notice_language ?? 'kn',
        req.params.id
      ]
    );

    broadcast('NOTICE_UPDATED', {
      id: Number(req.params.id),
      title: title || notice.title,
      status: 'pending'
    });

    res.json({ message: 'Notice updated and resubmitted for approval' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/event-notices/:id/approve — Tier 1 approves
router.post('/:id/approve', authenticateToken, requireTier1, async (req, res) => {
  try {
    const notice = await db.get('SELECT * FROM event_notices WHERE id = ?', [req.params.id]);
    if (!notice) return res.status(404).json({ error: 'Notice not found' });

    await db.run("UPDATE event_notices SET status='approved', updated_at=CURRENT_TIMESTAMP WHERE id=?", [req.params.id]);

    // Targeted notification back to submitter
    if (notice.submitted_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_user_id, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          '✅ Event Notice Approved',
          `Your event notice "${notice.title}" has been approved and is now published. You can now download it as PDF or PNG.`,
          'approval_result',
          notice.submitted_by,
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: '✅ Event Notice Approved',
        message: `Your event notice "${notice.title}" has been approved.`,
        type: 'approval_result',
        targetUserId: notice.submitted_by
      });
    }

    broadcast('NOTICE_STATUS_CHANGED', { id: Number(req.params.id), status: 'approved' });

    res.json({ message: 'Notice approved and published' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/event-notices/:id/reject — Tier 1 rejects
router.post('/:id/reject', authenticateToken, requireTier1, async (req, res) => {
  const { reason } = req.body;
  try {
    const notice = await db.get('SELECT * FROM event_notices WHERE id = ?', [req.params.id]);
    if (!notice) return res.status(404).json({ error: 'Notice not found' });

    await db.run("UPDATE event_notices SET status='rejected', updated_at=CURRENT_TIMESTAMP WHERE id=?", [req.params.id]);

    if (notice.submitted_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_user_id, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          '❌ Event Notice Rejected',
          `Your event notice "${notice.title}" was not approved.${reason ? ' Reason: ' + reason : ''} Please revise and resubmit.`,
          'approval_result',
          notice.submitted_by,
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: '❌ Event Notice Rejected',
        message: `Your event notice "${notice.title}" was not approved.`,
        type: 'approval_result',
        targetUserId: notice.submitted_by
      });
    }

    broadcast('NOTICE_STATUS_CHANGED', { id: Number(req.params.id), status: 'rejected' });

    res.json({ message: 'Notice rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/event-notices/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const notice = await db.get('SELECT * FROM event_notices WHERE id = ?', [req.params.id]);
    if (!notice) return res.status(404).json({ error: 'Notice not found' });

    if (!TIER1_ROLES.includes(req.user.role) && notice.submitted_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own notices' });
    }

    await db.run('DELETE FROM event_notices WHERE id = ?', [req.params.id]);
    broadcast('NOTICE_DELETED', { id: Number(req.params.id) });
    res.json({ message: 'Notice deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
