const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireTier1, TIER1_ROLES, hasCrudAccess } = require('./authMiddleware');
const { broadcast } = require('../utils/realtime');

function statusForUser(user) {
  return TIER1_ROLES.includes(user.role) ? 'approved' : 'pending';
}

// ==========================================
// ANALYTICS & REPORTS ENDPOINTS
// ==========================================

router.get('/dashboard-stats', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    
    // Resolve all scoped users for geographical filtering
    const scopedUserIds = (await db.getScopedUserIds(userScope)) || [];

    let totalMembers, totalSponsors, nextEvent, totalSponsorships, totalExpenses, recentMembers, recentSponsors, pendingCounts;

    if (userScope.role === 'admin') {
      totalMembers = await db.get("SELECT COUNT(*) as count FROM members WHERE status = 'active'");
      totalSponsors = await db.get("SELECT COUNT(*) as count FROM sponsors WHERE status = 'approved'");
      nextEvent = await db.get("SELECT * FROM events WHERE date >= date('now') AND status = 'approved' ORDER BY date ASC LIMIT 1");
      totalSponsorships = await db.get("SELECT SUM(contribution_amount) as total FROM sponsors WHERE status = 'approved'");
      totalExpenses = await db.get("SELECT SUM(amount) as total FROM expenses WHERE status = 'approved'");

      recentMembers = await db.query("SELECT 'member' as type, first_name || ' ' || last_name as title, created_at FROM members ORDER BY created_at DESC LIMIT 3");
      recentSponsors = await db.query("SELECT 'sponsor' as type, name as title, created_at FROM sponsors WHERE status = 'approved' ORDER BY created_at DESC LIMIT 3");

      const pendingEvents = await db.get("SELECT COUNT(*) as count FROM events WHERE status = 'pending'");
      const pendingSponsors = await db.get("SELECT COUNT(*) as count FROM sponsors WHERE status = 'pending'");
      const pendingResources = await db.get("SELECT COUNT(*) as count FROM resources WHERE status = 'pending'");
      const pendingExpenses = await db.get("SELECT COUNT(*) as count FROM expenses WHERE status = 'pending'");
      const pendingPhotos = await db.get("SELECT COUNT(*) as count FROM photos WHERE status = 'pending'");
      pendingCounts = {
        events: pendingEvents.count,
        sponsors: pendingSponsors.count,
        resources: pendingResources.count,
        expenses: pendingExpenses.count,
        photos: pendingPhotos.count,
        total: pendingEvents.count + pendingSponsors.count + pendingResources.count + pendingExpenses.count + pendingPhotos.count
      };
    } else {
      const idsPlaceholder = scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';

      totalMembers = await db.get(`SELECT COUNT(*) as count FROM members WHERE status = 'active' AND created_by IN (${idsPlaceholder})`);
      totalSponsors = await db.get(`SELECT COUNT(*) as count FROM sponsors WHERE status = 'approved' AND submitted_by IN (${idsPlaceholder})`);
      nextEvent = await db.get(`SELECT * FROM events WHERE date >= date('now') AND status = 'approved' AND created_by IN (${idsPlaceholder}) ORDER BY date ASC LIMIT 1`);
      totalSponsorships = await db.get(`SELECT SUM(contribution_amount) as total FROM sponsors WHERE status = 'approved' AND submitted_by IN (${idsPlaceholder})`);
      totalExpenses = await db.get(`SELECT SUM(amount) as total FROM expenses WHERE status = 'approved' AND submitted_by IN (${idsPlaceholder})`);

      recentMembers = await db.query(`SELECT 'member' as type, first_name || ' ' || last_name as title, created_at FROM members WHERE created_by IN (${idsPlaceholder}) ORDER BY created_at DESC LIMIT 3`);
      recentSponsors = await db.query(`SELECT 'sponsor' as type, name as title, created_at FROM sponsors WHERE status = 'approved' AND submitted_by IN (${idsPlaceholder}) ORDER BY created_at DESC LIMIT 3`);

      if (TIER1_ROLES.includes(req.user.role)) {
        const pendingEvents = await db.get(`SELECT COUNT(*) as count FROM events WHERE status = 'pending' AND created_by IN (${idsPlaceholder})`);
        const pendingSponsors = await db.get(`SELECT COUNT(*) as count FROM sponsors WHERE status = 'pending' AND submitted_by IN (${idsPlaceholder})`);
        const pendingResources = await db.get(`SELECT COUNT(*) as count FROM resources WHERE status = 'pending' AND uploaded_by IN (${idsPlaceholder})`);
        const pendingExpenses = await db.get(`SELECT COUNT(*) as count FROM expenses WHERE status = 'pending' AND submitted_by IN (${idsPlaceholder})`);
        const pendingPhotos = await db.get(`SELECT COUNT(*) as count FROM photos WHERE status = 'pending' AND uploaded_by IN (${idsPlaceholder})`);
        pendingCounts = {
          events: pendingEvents.count,
          sponsors: pendingSponsors.count,
          resources: pendingResources.count,
          expenses: pendingExpenses.count,
          photos: pendingPhotos.count,
          total: pendingEvents.count + pendingSponsors.count + pendingResources.count + pendingExpenses.count + pendingPhotos.count
        };
      }
    }

    res.json({
      membersCount: totalMembers.count,
      sponsorsCount: totalSponsors.count,
      nextEvent: nextEvent || null,
      balance: (totalSponsorships.total || 0) - (totalExpenses.total || 0),
      totalSponsorships: totalSponsorships.total || 0,
      totalExpenses: totalExpenses.total || 0,
      recentActivity: [...recentMembers, ...recentSponsors].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5),
      pendingCounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financials', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let sponsorships, eventExpenses, categoryBreakdown;

    if (userScope.role === 'admin' || !userScope.state) {
      sponsorships = await db.query("SELECT name, contribution_amount, contribution_type, created_at FROM sponsors WHERE status = 'approved'");
      eventExpenses = await db.query(`
        SELECT e.title as event_title, ex.title as expense_title, ex.amount, ex.category, ex.date, ex.status
        FROM expenses ex
        LEFT JOIN events e ON ex.event_id = e.id
        ORDER BY ex.date DESC
      `);
      categoryBreakdown = await db.query("SELECT category, SUM(amount) as total FROM expenses WHERE status = 'approved' GROUP BY category");
    } else {
      const scopedUserIds = (await db.getScopedUserIds(userScope)) || [];
      const idsPlaceholder = scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';

      sponsorships = await db.query(
        `SELECT name, contribution_amount, contribution_type, created_at FROM sponsors WHERE status = 'approved' AND (submitted_by IN (${idsPlaceholder}) OR submitted_by = ?)`,
        [req.user.id]
      );
      eventExpenses = await db.query(`
        SELECT e.title as event_title, ex.title as expense_title, ex.amount, ex.category, ex.date, ex.status
        FROM expenses ex
        LEFT JOIN events e ON ex.event_id = e.id
        WHERE ex.submitted_by IN (${idsPlaceholder}) OR ex.submitted_by = ?
        ORDER BY ex.date DESC
      `, [req.user.id]);
      categoryBreakdown = await db.query(
        `SELECT category, SUM(amount) as total FROM expenses WHERE status = 'approved' AND (submitted_by IN (${idsPlaceholder}) OR submitted_by = ?) GROUP BY category`,
        [req.user.id]
      );
    }

    res.json({ sponsorships, expenses: eventExpenses, categoryBreakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/attendance', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let eventAttendance, memberAttendance;

    if (userScope.role === 'admin' || !userScope.state) {
      eventAttendance = await db.query(`
        SELECT e.id as event_id, e.title, e.date,
               COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present_count,
               COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent_count,
               COUNT(a.id) as total_marked
        FROM events e
        LEFT JOIN attendance a ON e.id = a.event_id
        WHERE e.status = 'approved'
        GROUP BY e.id
        ORDER BY e.date DESC
      `);

      memberAttendance = await db.query(`
        SELECT m.id, m.first_name, m.last_name,
               COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present_count,
               COUNT(a.id) as total_events
        FROM members m
        LEFT JOIN attendance a ON m.id = a.member_id
        WHERE m.status = 'active'
        GROUP BY m.id
        ORDER BY m.first_name ASC
      `);
    } else {
      const scopedUserIds = (await db.getScopedUserIds(userScope)) || [];
      const idsPlaceholder = scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';

      eventAttendance = await db.query(`
        SELECT e.id as event_id, e.title, e.date,
               COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present_count,
               COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent_count,
               COUNT(a.id) as total_marked
        FROM events e
        LEFT JOIN attendance a ON e.id = a.event_id
        WHERE e.status = 'approved' AND (e.created_by IN (${idsPlaceholder}) OR e.created_by = ?)
        GROUP BY e.id
        ORDER BY e.date DESC
      `, [req.user.id]);

      memberAttendance = await db.query(`
        SELECT m.id, m.first_name, m.last_name,
               COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present_count,
               COUNT(a.id) as total_events
        FROM members m
        LEFT JOIN attendance a ON m.id = a.member_id
        WHERE m.status = 'active' AND (m.created_by IN (${idsPlaceholder}) OR m.created_by = ?)
        GROUP BY m.id
        ORDER BY m.first_name ASC
      `, [req.user.id]);
    }

    res.json({ events: eventAttendance, members: memberAttendance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// EXPENSES / BUDGET REQUESTS
// ==========================================

router.get('/expenses-list', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let list;
    if (userScope.role === 'admin') {
      list = await db.query(`
        SELECT ex.*, e.title as event_title, u.username as submitter_name
        FROM expenses ex
        LEFT JOIN events e ON ex.event_id = e.id
        LEFT JOIN users u ON ex.submitted_by = u.id
        ORDER BY ex.date DESC
      `);
    } else {
      const allUsers = await db.query("SELECT id, username, email, role FROM users");
      const scopedUserIds = [];
      for (const u of allUsers) {
        const uScope = await db.getUserLocationScope(u);
        let matches = false;
        if (userScope.role === 'state_coordinator') {
          matches = uScope.state === userScope.state;
        } else if (userScope.role === 'district_coordinator') {
          matches = uScope.state === userScope.state && uScope.district === userScope.district;
        } else if (userScope.role === 'taluk_coordinator') {
          matches = uScope.state === userScope.state && uScope.district === userScope.district && uScope.taluk === userScope.taluk;
        }
        if (matches) scopedUserIds.push(u.id);
      }
      const idsPlaceholder = scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
      list = await db.query(`
        SELECT ex.*, e.title as event_title, u.username as submitter_name
        FROM expenses ex
        LEFT JOIN events e ON ex.event_id = e.id
        LEFT JOIN users u ON ex.submitted_by = u.id
        WHERE ex.submitted_by IN (${idsPlaceholder}) OR ex.submitted_by = ?
        ORDER BY ex.date DESC
      `, [req.user.id]);
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/expenses-list', authenticateToken, async (req, res) => {
  const { event_id, title, amount, category, date, receipt_url } = req.body;
  if (!title || !amount || !category || !date) {
    return res.status(400).json({ error: 'Title, amount, category and date are required' });
  }

  const status = statusForUser(req.user);
  try {
    const result = await db.run(
      'INSERT INTO expenses (event_id, title, amount, category, date, receipt_url, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [event_id || null, title, amount, category, date, receipt_url || null, status, req.user.id]
    );

    if (status === 'pending') {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'New Budget Request Pending Approval',
          `Budget request "${title}" (₹${amount}) submitted by ${req.user.username} requires your approval.`,
          'approval_request',
          'admin,state_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'New Budget Request Pending Approval',
        message: `Budget request "${title}" (₹${amount}) submitted by ${req.user.username}`,
        type: 'approval_request'
      });
    }

    broadcast('EXPENSE_CREATED', {
      id: result.id,
      event_id: event_id || null,
      title,
      amount,
      category,
      date,
      status,
      submitted_by: req.user.id
    });

    res.status(201).json({
      message: status === 'approved' ? 'Expense added successfully' : 'Budget request submitted for approval',
      expenseId: result.id,
      status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/expenses-list/:id/approve', authenticateToken, requireTier1, async (req, res) => {
  try {
    const expense = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    
    // Check CRUD / Approval access
    const hasAccess = await hasCrudAccess(req.user, expense.submitted_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Unauthorized to approve this expense request' });
    }

    await db.run("UPDATE expenses SET status = 'approved' WHERE id = ?", [req.params.id]);
    if (expense.submitted_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Budget Request Approved',
          `Your budget request "${expense.title}" has been approved.`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'Budget Request Approved',
        message: `Your budget request "${expense.title}" has been approved.`,
        type: 'approval_result',
        targetUserId: expense.submitted_by
      });
    }

    broadcast('EXPENSE_STATUS_CHANGED', { id: Number(req.params.id), status: 'approved' });

    res.json({ message: 'Expense approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/expenses-list/:id/reject', authenticateToken, requireTier1, async (req, res) => {
  const { reason } = req.body;
  try {
    const expense = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    
    // Check CRUD / Approval access
    const hasAccess = await hasCrudAccess(req.user, expense.submitted_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Unauthorized to reject this expense request' });
    }

    await db.run("UPDATE expenses SET status = 'rejected' WHERE id = ?", [req.params.id]);
    if (expense.submitted_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Budget Request Rejected',
          `Your budget request "${expense.title}" was not approved. ${reason ? 'Reason: ' + reason : ''}`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'Budget Request Rejected',
        message: `Your budget request "${expense.title}" was not approved.`,
        type: 'approval_result',
        targetUserId: expense.submitted_by
      });
    }

    broadcast('EXPENSE_STATUS_CHANGED', { id: Number(req.params.id), status: 'rejected' });

    res.json({ message: 'Expense rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/expenses-list/:id', authenticateToken, async (req, res) => {
  try {
    const expense = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    
    // Check CRUD / Deletion access
    const hasAccess = await hasCrudAccess(req.user, expense.submitted_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to delete this expense' });
    }

    await db.run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    broadcast('EXPENSE_DELETED', { id: Number(req.params.id) });
    res.json({ message: 'Expense deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// BHAJAN SONGS — All authenticated (no approval gate)
// ==========================================

router.get('/bhajans', authenticateToken, async (req, res) => {
  try {
    const list = await db.query(`
      SELECT b.*, u.username as creator_name
      FROM bhajan_songs b LEFT JOIN users u ON b.created_by = u.id
      ORDER BY b.title ASC
    `);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/bhajans/public', async (req, res) => {
  try {
    const list = await db.query('SELECT * FROM bhajan_songs ORDER BY title ASC');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bhajans', authenticateToken, async (req, res) => {
  const { title, scale, lyrics, audio_url } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  try {
    const result = await db.run(
      'INSERT INTO bhajan_songs (title, scale, lyrics, audio_url, created_by) VALUES (?, ?, ?, ?, ?)',
      [title, scale, lyrics, audio_url, req.user.id]
    );
    broadcast('BHAJAN_CHANGED', { action: 'create', id: result.id, title, scale });
    res.status(201).json({ message: 'Bhajan song added successfully', songId: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/bhajans/:id', authenticateToken, async (req, res) => {
  const { title, scale, lyrics, audio_url } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  try {
    const song = await db.get('SELECT * FROM bhajan_songs WHERE id = ?', [req.params.id]);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    if (!TIER1_ROLES.includes(req.user.role) && song.created_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own bhajan entries' });
    }
    await db.run(
      'UPDATE bhajan_songs SET title = ?, scale = ?, lyrics = ?, audio_url = ? WHERE id = ?',
      [title, scale, lyrics, audio_url, req.params.id]
    );
    broadcast('BHAJAN_CHANGED', { action: 'update', id: Number(req.params.id), title, scale });
    res.json({ message: 'Bhajan song updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/bhajans/:id', authenticateToken, async (req, res) => {
  try {
    const song = await db.get('SELECT * FROM bhajan_songs WHERE id = ?', [req.params.id]);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    if (!TIER1_ROLES.includes(req.user.role) && song.created_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own bhajan entries' });
    }
    await db.run('DELETE FROM bhajan_songs WHERE id = ?', [req.params.id]);
    broadcast('BHAJAN_CHANGED', { action: 'delete', id: Number(req.params.id) });
    res.json({ message: 'Bhajan song deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// RESOURCES — Tier 2 submits pending; Tier 1 approves
// ==========================================

router.get('/resources-public', async (req, res) => {
  try {
    const list = await db.query("SELECT r.*, u.username as uploader FROM resources r LEFT JOIN users u ON r.uploaded_by = u.id WHERE r.status = 'approved' ORDER BY r.created_at DESC");
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/resources-list', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    let list;
    if (userScope.role === 'admin') {
      list = await db.query('SELECT r.*, u.username as uploader FROM resources r LEFT JOIN users u ON r.uploaded_by = u.id ORDER BY r.created_at DESC');
    } else {
      const allUsers = await db.query("SELECT id, username, email, role FROM users");
      const scopedUserIds = [];
      for (const u of allUsers) {
        const uScope = await db.getUserLocationScope(u);
        let matches = false;
        if (userScope.role === 'state_coordinator') {
          matches = uScope.state === userScope.state;
        } else if (userScope.role === 'district_coordinator') {
          matches = uScope.state === userScope.state && uScope.district === userScope.district;
        } else if (userScope.role === 'taluk_coordinator') {
          matches = uScope.state === userScope.state && uScope.district === userScope.district && uScope.taluk === userScope.taluk;
        }
        if (matches) scopedUserIds.push(u.id);
      }
      const idsPlaceholder = scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0';
      list = await db.query(`
        SELECT r.*, u.username as uploader
        FROM resources r
        LEFT JOIN users u ON r.uploaded_by = u.id
        WHERE r.uploaded_by IN (${idsPlaceholder}) OR r.uploaded_by = ?
        ORDER BY r.created_at DESC
      `, [req.user.id]);
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resources-list', authenticateToken, async (req, res) => {
  const { title, description, file_url, category } = req.body;
  if (!title || !file_url) return res.status(400).json({ error: 'Title and file path are required' });

  const status = statusForUser(req.user);
  try {
    const result = await db.run(
      'INSERT INTO resources (title, description, file_url, category, uploaded_by, status) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, file_url, category || 'document', req.user.id, status]
    );

    if (status === 'pending') {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'New Resource Pending Approval',
          `Resource "${title}" uploaded by ${req.user.username} requires your approval.`,
          'approval_request',
          'admin,state_coordinator',
          req.user.id
        ]
      );
      broadcast('NOTIFICATION_CREATED', {
        title: 'New Resource Pending Approval',
        message: `Resource "${title}" uploaded by ${req.user.username}`,
        type: 'approval_request'
      });
    }

    broadcast('RESOURCE_CHANGED', { action: 'create', id: result.id, title, status });

    res.status(201).json({
      message: status === 'approved' ? 'Resource added successfully' : 'Resource submitted for approval',
      resourceId: result.id,
      status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resources-list/:id/approve', authenticateToken, requireTier1, async (req, res) => {
  try {
    const resource = await db.get('SELECT * FROM resources WHERE id = ?', [req.params.id]);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    
    // Check CRUD access
    const hasAccess = await hasCrudAccess(req.user, resource.uploaded_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Unauthorized to approve this resource' });
    }

    await db.run("UPDATE resources SET status = 'approved' WHERE id = ?", [req.params.id]);
    if (resource.uploaded_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Resource Approved',
          `Your resource "${resource.title}" has been approved and is now publicly available.`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
    }

    broadcast('RESOURCE_CHANGED', { action: 'approve', id: Number(req.params.id), status: 'approved' });

    res.json({ message: 'Resource approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resources-list/:id/reject', authenticateToken, requireTier1, async (req, res) => {
  const { reason } = req.body;
  try {
    const resource = await db.get('SELECT * FROM resources WHERE id = ?', [req.params.id]);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    
    // Check CRUD access
    const hasAccess = await hasCrudAccess(req.user, resource.uploaded_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Unauthorized to reject this resource' });
    }

    await db.run("UPDATE resources SET status = 'rejected' WHERE id = ?", [req.params.id]);
    if (resource.uploaded_by) {
      await db.run(
        "INSERT INTO notifications (title, message, type, target_roles, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          'Resource Rejected',
          `Your resource "${resource.title}" was not approved. ${reason ? 'Reason: ' + reason : ''}`,
          'approval_result',
          'district_coordinator,taluk_coordinator',
          req.user.id
        ]
      );
    }

    broadcast('RESOURCE_CHANGED', { action: 'reject', id: Number(req.params.id), status: 'rejected' });

    res.json({ message: 'Resource rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/resources-list/:id', authenticateToken, async (req, res) => {
  try {
    const resource = await db.get('SELECT * FROM resources WHERE id = ?', [req.params.id]);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    
    // Check CRUD access
    const hasAccess = await hasCrudAccess(req.user, resource.uploaded_by);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to delete this resource' });
    }

    await db.run('DELETE FROM resources WHERE id = ?', [req.params.id]);
    broadcast('RESOURCE_CHANGED', { action: 'delete', id: Number(req.params.id) });
    res.json({ message: 'Resource deleted from index' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// MEMOS — Tier 1 only create/delete
// ==========================================

router.get('/memos-list', authenticateToken, async (req, res) => {
  try {
    const list = await db.query('SELECT * FROM memos ORDER BY created_at DESC');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/memos-list', authenticateToken, requireTier1, async (req, res) => {
  const { title, content, file_url } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });
  try {
    const result = await db.run(
      'INSERT INTO memos (title, content, file_url) VALUES (?, ?, ?)',
      [title, content, file_url || null]
    );
    broadcast('MEMO_CREATED', { id: result.id, title, content, file_url: file_url || null });
    res.status(201).json({ message: 'Memo posted successfully', memoId: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/memos-list/:id', authenticateToken, requireTier1, async (req, res) => {
  try {
    await db.run('DELETE FROM memos WHERE id = ?', [req.params.id]);
    broadcast('MEMO_DELETED', { id: Number(req.params.id) });
    res.json({ message: 'Memo deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SETTINGS — Tier 1 only
// ==========================================

router.get('/settings-list', authenticateToken, requireTier1, async (req, res) => {
  try {
    const list = await db.query('SELECT * FROM settings');
    const settingsMap = {};
    list.forEach(row => { settingsMap[row.key] = row.value; });
    res.json(settingsMap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings-list', authenticateToken, requireTier1, async (req, res) => {
  const settingsObj = req.body;
  try {
    const promises = Object.keys(settingsObj).map(key => {
      return db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, String(settingsObj[key])]
      );
    });
    await Promise.all(promises);
    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
