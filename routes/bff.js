const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireTier1, TIER1_ROLES } = require('./authMiddleware');

// Re-use centralized location scoping from db.js
const getScopedUserIds = db.getScopedUserIds;

/**
 * GET /api/bff/mobile-bootstrap
 * Ultra-fast consolidated startup payload for mobile.
 * Replaces 6+ individual HTTP waterfall requests on app launch.
 */
router.get('/mobile-bootstrap', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    const scopedUserIds = await getScopedUserIds(userScope);
    const idsPlaceholder = scopedUserIds === null ? null : (scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0');

    // 1. Fetch User Profile
    const users = await db.query("SELECT id, username, email, role, created_at FROM users WHERE id = ?", [req.user.id]);
    const userProfile = users.length > 0 ? users[0] : req.user;

    // 2. Fetch Aggregated Dashboard Counters
    let membersCountQuery = "SELECT COUNT(*) as count FROM members WHERE status = 'active'";
    if (idsPlaceholder !== null) {
      membersCountQuery = `SELECT COUNT(*) as count FROM members WHERE status = 'active' AND (created_by IN (${idsPlaceholder}) OR created_by IS NULL)`;
    }
    const membersRes = await db.query(membersCountQuery);
    const membersCount = membersRes[0]?.count || 0;

    let sponsorsCountQuery = "SELECT COUNT(*) as count, COALESCE(SUM(contribution_amount), 0) as total FROM sponsors WHERE status = 'approved'";
    if (idsPlaceholder !== null) {
      sponsorsCountQuery = `SELECT COUNT(*) as count, COALESCE(SUM(contribution_amount), 0) as total FROM sponsors WHERE status = 'approved' AND (submitted_by IN (${idsPlaceholder}) OR submitted_by IS NULL)`;
    }
    const sponsorsRes = await db.query(sponsorsCountQuery);
    const sponsorsCount = sponsorsRes[0]?.count || 0;
    const totalSponsorships = sponsorsRes[0]?.total || 0;

    let expensesQuery = "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE status = 'approved'";
    if (idsPlaceholder !== null) {
      expensesQuery = `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE status = 'approved' AND (submitted_by IN (${idsPlaceholder}) OR submitted_by IS NULL)`;
    }
    const expensesRes = await db.query(expensesQuery);
    const totalExpenses = expensesRes[0]?.total || 0;
    const balance = totalSponsorships - totalExpenses;

    // 3. Pending Approvals (for Tier 1 users)
    const isTier1 = TIER1_ROLES.includes(req.user.role);
    let pendingCounts = { events: 0, sponsors: 0, expenses: 0, resources: 0, photos: 0, notices: 0, total: 0 };
    if (isTier1) {
      let peQ = "SELECT COUNT(*) as c FROM events WHERE status = 'pending'";
      let psQ = "SELECT COUNT(*) as c FROM sponsors WHERE status = 'pending'";
      let pxQ = "SELECT COUNT(*) as c FROM expenses WHERE status = 'pending'";
      let prQ = "SELECT COUNT(*) as c FROM resources WHERE status = 'pending'";
      let ppQ = "SELECT COUNT(*) as c FROM photos WHERE status = 'pending'";
      let pnQ = "SELECT COUNT(*) as c FROM event_notices WHERE status = 'pending'";

      if (idsPlaceholder !== null) {
        peQ += ` AND created_by IN (${idsPlaceholder})`;
        psQ += ` AND submitted_by IN (${idsPlaceholder})`;
        pxQ += ` AND submitted_by IN (${idsPlaceholder})`;
        prQ += ` AND uploaded_by IN (${idsPlaceholder})`;
        ppQ += ` AND uploaded_by IN (${idsPlaceholder})`;
        pnQ += ` AND submitted_by IN (${idsPlaceholder})`;
      }

      const [pe, ps, px, pr, pp, pn] = await Promise.all([
        db.query(peQ),
        db.query(psQ),
        db.query(pxQ),
        db.query(prQ),
        db.query(ppQ),
        db.query(pnQ).catch(() => [{ c: 0 }])
      ]);

      pendingCounts.events = pe[0]?.c || 0;
      pendingCounts.sponsors = ps[0]?.c || 0;
      pendingCounts.expenses = px[0]?.c || 0;
      pendingCounts.resources = pr[0]?.c || 0;
      pendingCounts.photos = pp[0]?.c || 0;
      pendingCounts.notices = pn[0]?.c || 0;
      pendingCounts.total = pendingCounts.events + pendingCounts.sponsors + pendingCounts.expenses + pendingCounts.resources + pendingCounts.photos + pendingCounts.notices;
    }

    // 4. Next 3 Upcoming Approved Events
    const upcomingEvents = await db.query(`
      SELECT id, title, description, date, location, budget
      FROM events
      WHERE status = 'approved' AND date >= date('now')
      ORDER BY date ASC
      LIMIT 3
    `);

    // 5. Recent 3 Event Notices
    let recentNotices = [];
    try {
      recentNotices = await db.query(`
        SELECT id, title, organization, sub_org, event_description, event_date, event_time, event_venue, status, created_at
        FROM event_notices
        WHERE status = 'approved'
        ORDER BY created_at DESC
        LIMIT 3
      `);
    } catch (e) {
      recentNotices = [];
    }

    // 6. Unread Notifications Count & Recent 5
    const unreadNotifRes = await db.query(
      "SELECT COUNT(*) as count FROM notifications WHERE (target_user_id = ? OR target_roles = 'all' OR target_roles LIKE ?) AND is_read = 0",
      [req.user.id, `%${req.user.role}%`]
    );
    const unreadNotificationsCount = unreadNotifRes[0]?.count || 0;

    const recentNotifications = await db.query(`
      SELECT id, title, message, type, is_read, created_at
      FROM notifications
      WHERE (target_user_id = ? OR target_roles = 'all' OR target_roles LIKE ?)
      ORDER BY created_at DESC
      LIMIT 5
    `, [req.user.id, `%${req.user.role}%`]);

    res.json({
      user: userProfile,
      scope: userScope,
      stats: {
        membersCount,
        sponsorsCount,
        totalSponsorships,
        totalExpenses,
        balance,
        nextEvent: upcomingEvents.length > 0 ? upcomingEvents[0] : null,
        pendingCounts
      },
      upcomingEvents,
      recentNotices,
      notifications: {
        unreadCount: unreadNotificationsCount,
        recent: recentNotifications
      },
      realtime: {
        wsPath: '/ws',
        serverTime: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error in /api/bff/mobile-bootstrap:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bff/dashboard-bundle
 * Comprehensive aggregated payload for mobile Dashboard and analytics.
 */
router.get('/dashboard-bundle', authenticateToken, async (req, res) => {
  try {
    const userScope = await db.getUserLocationScope(req.user);
    const scopedUserIds = await getScopedUserIds(userScope);
    const idsPlaceholder = scopedUserIds === null ? null : (scopedUserIds.length > 0 ? scopedUserIds.join(',') : '0');

    // Stats
    let mCountQ = "SELECT COUNT(*) as count FROM members WHERE status = 'active'";
    let sCountQ = "SELECT COUNT(*) as count, COALESCE(SUM(contribution_amount), 0) as total FROM sponsors WHERE status = 'approved'";
    let eCountQ = "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE status = 'approved'";
    
    if (idsPlaceholder !== null) {
      mCountQ += ` AND (created_by IN (${idsPlaceholder}) OR created_by IS NULL)`;
      sCountQ += ` AND (submitted_by IN (${idsPlaceholder}) OR submitted_by IS NULL)`;
      eCountQ += ` AND (submitted_by IN (${idsPlaceholder}) OR submitted_by IS NULL)`;
    }

    const [membersRes, sponsorsRes, expensesRes] = await Promise.all([
      db.query(mCountQ),
      db.query(sCountQ),
      db.query(eCountQ)
    ]);

    const membersCount = membersRes[0]?.count || 0;
    const sponsorsCount = sponsorsRes[0]?.count || 0;
    const totalSponsorships = sponsorsRes[0]?.total || 0;
    const totalExpenses = expensesRes[0]?.total || 0;
    const balance = totalSponsorships - totalExpenses;

    // Next Event
    const nextEventRes = await db.query(
      "SELECT id, title, description, date, location, budget FROM events WHERE status = 'approved' AND date >= date('now') ORDER BY date ASC LIMIT 1"
    );

    // Category breakdown
    let catQ = "SELECT category, COALESCE(SUM(amount), 0) as total FROM expenses WHERE status = 'approved'";
    if (idsPlaceholder !== null) {
      catQ += ` AND (submitted_by IN (${idsPlaceholder}) OR submitted_by IS NULL)`;
    }
    catQ += " GROUP BY category ORDER BY total DESC";
    const categoryBreakdown = await db.query(catQ);

    // Recent activity
    const recentActivity = await db.query(`
      SELECT 'event' as type, title, date as created_at FROM events WHERE status = 'approved'
      UNION ALL
      SELECT 'sponsor' as type, name as title, created_at FROM sponsors WHERE status = 'approved'
      UNION ALL
      SELECT 'expense' as type, title, date as created_at FROM expenses WHERE status = 'approved'
      ORDER BY created_at DESC
      LIMIT 6
    `);

    res.json({
      membersCount,
      sponsorsCount,
      totalSponsorships,
      totalExpenses,
      balance,
      nextEvent: nextEventRes.length > 0 ? nextEventRes[0] : null,
      categoryBreakdown,
      recentActivity
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
