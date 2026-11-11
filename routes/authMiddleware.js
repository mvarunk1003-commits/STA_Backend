const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'organization_super_secret_key';

const TIER1_ROLES = ['admin', 'state_coordinator'];
const TIER2_ROLES = ['district_coordinator', 'taluk_coordinator'];
const ALL_COORDINATOR_ROLES = [...TIER1_ROLES, ...TIER2_ROLES];

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Legacy: kept for backward compatibility
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin privilege required' });
  }
}

// Tier 1: Admin or State Coordinator — full access + approvers
function requireTier1(req, res, next) {
  if (req.user && TIER1_ROLES.includes(req.user.role)) {
    next();
  } else {
    res.status(403).json({ error: 'Admin or State Coordinator privilege required' });
  }
}

// Tier 2: District or Taluk Coordinator — submitters
function requireTier2(req, res, next) {
  if (req.user && TIER2_ROLES.includes(req.user.role)) {
    next();
  } else {
    res.status(403).json({ error: 'District or Taluk Coordinator access required' });
  }
}

// Any authenticated coordinator (Tier 1 or Tier 2)
function requireAnyCoordinator(req, res, next) {
  if (req.user && ALL_COORDINATOR_ROLES.includes(req.user.role)) {
    next();
  } else {
    res.status(403).json({ error: 'Coordinator access required' });
  }
}

const db = require('../database/db');

// Legacy alias used in existing routes
const requireAdminOrStateCoordinator = requireTier1;

async function hasCrudAccess(currentUser, creatorId) {
  if (!currentUser) return false;
  if (currentUser.id === creatorId) return true;
  if (currentUser.role === 'admin') return true;
  
  if (currentUser.role === 'state_coordinator') {
    const userScope = await db.getUserLocationScope(currentUser);
    const creator = await db.get("SELECT * FROM users WHERE id = ?", [creatorId]);
    if (creator) {
      const creatorScope = await db.getUserLocationScope(creator);
      if (userScope.state && creatorScope.state && userScope.state === creatorScope.state) {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireTier1,
  requireTier2,
  requireAnyCoordinator,
  requireAdminOrStateCoordinator,
  hasCrudAccess,
  TIER1_ROLES,
  TIER2_ROLES,
  JWT_SECRET
};
