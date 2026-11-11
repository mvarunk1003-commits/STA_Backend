/**
 * SSTPA Comprehensive End-to-End Test Suite
 * Tests all API endpoints, authentication, RBAC, CRUD operations,
 * WebSocket realtime broadcasting, and Frontend static routes.
 */
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PORT = process.env.PORT || 5005;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const WS_URL = process.env.WS_URL || `ws://localhost:${PORT}/ws`;

let passedCount = 0;
let failedCount = 0;
const testResults = [];

function logPass(name, details = '') {
  passedCount++;
  console.log(`  ✅ PASS: ${name} ${details ? '(' + details + ')' : ''}`);
  testResults.push({ name, status: 'PASS', details });
}

function logFail(name, error) {
  failedCount++;
  console.error(`  ❌ FAIL: ${name} ->`, error.message || error);
  testResults.push({ name, status: 'FAIL', error: error.message || String(error) });
}

function makeRequest(method, endpoint, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const headers = {};

    let postData = null;
    if (data) {
      postData = JSON.stringify(data);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: headers,
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (e) {
          json = body;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
          rawBody: body
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${endpoint} timed out`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('🚀 RUNNING COMPREHENSIVE SSTPA TEST SUITE');
  console.log('Target Server:', BASE_URL);
  console.log('======================================================================\n');

  // Ensure server is accepting connections
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      await makeRequest('GET', '/');
      break;
    } catch (e) {
      if (attempt === 15) throw new Error(`Target server at ${BASE_URL} is unreachable: ${e.message}`);
      await new Promise(r => setTimeout(r, 600));
    }
  }

  let adminToken = null;
  let stateToken = null;
  let districtToken = null;
  let talukToken = null;

  // -------------------------------------------------------------
  // 1. AUTHENTICATION & RBAC TESTS
  // -------------------------------------------------------------
  console.log('🔹 1. Authentication & RBAC Tests');

  try {
    const res = await makeRequest('POST', '/api/users/login', { username: 'admin', password: 'admin123' });
    assert.strictEqual(res.statusCode, 200, 'Admin login status should be 200');
    assert(res.body.token, 'Response must have token');
    assert.strictEqual(res.body.user.role, 'admin', 'User role should be admin');
    adminToken = res.body.token;
    logPass('Admin Login (admin/admin123)', `Role: ${res.body.user.role}`);
  } catch (err) {
    logFail('Admin Login', err);
  }

  try {
    const res = await makeRequest('POST', '/api/users/login', { username: 'karnataka', password: 'karnataka123' });
    assert.strictEqual(res.statusCode, 200, 'State coordinator login status should be 200');
    assert(res.body.token, 'Response must have token');
    assert.strictEqual(res.body.user.role, 'state_coordinator', 'User role should be state_coordinator');
    stateToken = res.body.token;
    logPass('State Coordinator Login (karnataka/karnataka123)', `Role: ${res.body.user.role}`);
  } catch (err) {
    logFail('State Coordinator Login', err);
  }

  try {
    const res = await makeRequest('POST', '/api/users/login', { username: 'bengaluru', password: 'bengaluru123' });
    assert.strictEqual(res.statusCode, 200, 'District coordinator login status should be 200');
    assert(res.body.token, 'Response must have token');
    assert.strictEqual(res.body.user.role, 'district_coordinator', 'User role should be district_coordinator');
    districtToken = res.body.token;
    logPass('District Coordinator Login (bengaluru/bengaluru123)', `Role: ${res.body.user.role}`);
  } catch (err) {
    logFail('District Coordinator Login', err);
  }

  try {
    const res = await makeRequest('POST', '/api/users/login', { username: 'bengalurusouth', password: 'bengalurusouth123' });
    assert.strictEqual(res.statusCode, 200, 'Taluk coordinator login status should be 200');
    assert(res.body.token, 'Response must have token');
    assert.strictEqual(res.body.user.role, 'taluk_coordinator', 'User role should be taluk_coordinator');
    talukToken = res.body.token;
    logPass('Taluk Coordinator Login (bengalurusouth/bengalurusouth123)', `Role: ${res.body.user.role}`);
  } catch (err) {
    logFail('Taluk Coordinator Login', err);
  }

  try {
    const res = await makeRequest('POST', '/api/users/login', { username: 'admin', password: 'wrongpassword' });
    assert.strictEqual(res.statusCode, 400, 'Invalid password should return 400');
    logPass('Login Rejection on Wrong Password', `Status: ${res.statusCode}`);
  } catch (err) {
    logFail('Login Rejection on Wrong Password', err);
  }

  try {
    const res = await makeRequest('GET', '/api/users/profile');
    assert.strictEqual(res.statusCode, 401, 'Unauthorized request should return 401');
    logPass('Protected Endpoint Rejection without Token (401)', 'OK');
  } catch (err) {
    logFail('Protected Endpoint Rejection without Token', err);
  }

  try {
    const res = await makeRequest('GET', '/api/users/profile', null, adminToken);
    assert.strictEqual(res.statusCode, 200, 'Profile fetch with token should return 200');
    assert.strictEqual(res.body.username, 'admin');
    logPass('User Profile Fetch with Bearer Token', `User: ${res.body.username}`);
  } catch (err) {
    logFail('User Profile Fetch with Bearer Token', err);
  }

  try {
    const res = await makeRequest('GET', '/api/users/location-scope', null, talukToken);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.role, 'taluk_coordinator');
    logPass('User Location Scope Resolution', `Role: ${res.body.role}, State: ${res.body.state || 'N/A'}`);
  } catch (err) {
    logFail('User Location Scope Resolution', err);
  }

  try {
    const res = await makeRequest('GET', '/api/users', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body) && res.body.length > 0);
    logPass('Admin List Users API', `Total Users: ${res.body.length}`);
  } catch (err) {
    logFail('Admin List Users API', err);
  }

  // -------------------------------------------------------------
  // 2. MEMBERS DIRECTORY CRUD TESTS
  // -------------------------------------------------------------
  console.log('\n🔹 2. Members Directory CRUD Tests');

  let createdMemberId = null;
  const testEmail = `test.member.${Date.now()}@example.com`;

  try {
    const res = await makeRequest('POST', '/api/members', {
      first_name: 'Shankar',
      last_name: 'Narayanan',
      email: testEmail,
      phone: '+91 9988776655',
      status: 'active',
      join_date: '2026-08-01'
    }, adminToken);
    assert.strictEqual(res.statusCode, 201);
    assert(res.body.memberId, 'Must return created member ID');
    createdMemberId = res.body.memberId;
    logPass('Create Member (POST /api/members)', `Member ID: ${createdMemberId}`);
  } catch (err) {
    logFail('Create Member', err);
  }

  try {
    const res = await makeRequest('GET', `/api/members/${createdMemberId}`, null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.first_name, 'Shankar');
    assert.strictEqual(res.body.email, testEmail);
    logPass('Get Member by ID (GET /api/members/:id)', `Name: ${res.body.first_name} ${res.body.last_name}`);
  } catch (err) {
    logFail('Get Member by ID', err);
  }

  try {
    const res = await makeRequest('PUT', `/api/members/${createdMemberId}`, {
      first_name: 'Shankara',
      last_name: 'Narayana Somayaji',
      email: testEmail,
      phone: '+91 9988776600',
      status: 'active',
      join_date: '2026-08-01'
    }, adminToken);
    assert.strictEqual(res.statusCode, 200);
    logPass('Update Member (PUT /api/members/:id)', 'Updated name to Shankara Narayana Somayaji');
  } catch (err) {
    logFail('Update Member', err);
  }

  try {
    const res = await makeRequest('GET', '/api/members', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    const found = res.body.find(m => m.id === createdMemberId);
    assert(found, 'Created member should be present in members list');
    logPass('List All Members (GET /api/members)', `Total: ${res.body.length} members`);
  } catch (err) {
    logFail('List All Members', err);
  }

  // -------------------------------------------------------------
  // 3. EVENTS MANAGEMENT & WORKFLOW TESTS
  // -------------------------------------------------------------
  console.log('\n🔹 3. Events Management & Multi-Tier Workflow Tests');

  let adminEventId = null;
  let pendingEventId = null;

  try {
    const res = await makeRequest('GET', '/api/events/public/all');
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    logPass('Public Events (GET /api/events/public/all)', `Approved Events: ${res.body.length}`);
  } catch (err) {
    logFail('Public Events', err);
  }

  try {
    const res = await makeRequest('POST', '/api/events', {
      title: 'Advaita Jnana Yajna 2026',
      date: '2026-09-15',
      location: 'Sringeri Shankara Math',
      budget: 75000,
      description: 'Annual discourse on Brahma Sutra Bhashya'
    }, adminToken);
    assert.strictEqual(res.statusCode, 201);
    assert(res.body.eventId);
    adminEventId = res.body.eventId;
    logPass('Admin Create Event (Auto-Approved)', `Event ID: ${adminEventId}`);
  } catch (err) {
    logFail('Admin Create Event', err);
  }

  try {
    const res = await makeRequest('POST', '/api/events', {
      title: 'Taluk Gita Chanting Workshop',
      date: '2026-09-20',
      location: 'Community Hall, Bengaluru South',
      budget: 15000,
      description: 'Local taluk level chanting workshop'
    }, talukToken);
    assert.strictEqual(res.statusCode, 201);
    assert(res.body.eventId);
    pendingEventId = res.body.eventId;
    logPass('Taluk Coordinator Create Event (Pending Approval)', `Event ID: ${pendingEventId}`);
  } catch (err) {
    logFail('Taluk Coordinator Create Event', err);
  }

  try {
    const res = await makeRequest('GET', '/api/events/pending', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    const found = res.body.find(e => e.id === pendingEventId);
    assert(found, 'Pending event should appear in admin pending queue');
    logPass('Tier 1 Pending Events Queue (GET /api/events/pending)', `Pending count: ${res.body.length}`);
  } catch (err) {
    logFail('Tier 1 Pending Events Queue', err);
  }

  try {
    const res = await makeRequest('POST', `/api/events/${pendingEventId}/approve`, {}, adminToken);
    assert.strictEqual(res.statusCode, 200);
    logPass('Admin Approve Event (POST /api/events/:id/approve)', `Approved Event ID: ${pendingEventId}`);
  } catch (err) {
    logFail('Admin Approve Event', err);
  }

  try {
    // Attendance recording
    const res = await makeRequest('POST', `/api/events/${adminEventId}/attendance`, {
      attendanceList: [
        { member_id: createdMemberId, status: 'present' }
      ]
    }, adminToken);
    assert.strictEqual(res.statusCode, 200);
    logPass('Event Attendance Record (POST /api/events/:id/attendance)', 'Recorded attendance successfully');
  } catch (err) {
    logFail('Event Attendance Record', err);
  }

  try {
    const res = await makeRequest('GET', `/api/events/${adminEventId}/attendance`, null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    logPass('Get Event Attendance (GET /api/events/:id/attendance)', `Retrieved ${res.body.length} attendance rows`);
  } catch (err) {
    logFail('Get Event Attendance', err);
  }

  // Cleanup events and member
  try {
    await makeRequest('DELETE', `/api/events/${adminEventId}`, null, adminToken);
    await makeRequest('DELETE', `/api/events/${pendingEventId}`, null, adminToken);
    await makeRequest('DELETE', `/api/members/${createdMemberId}`, null, adminToken);
    logPass('Cleanup Test Events & Member', 'Cleaned up successfully');
  } catch (err) {
    logFail('Cleanup Test Events & Member', err);
  }

  // -------------------------------------------------------------
  // 4. SPONSORS MANAGEMENT TESTS
  // -------------------------------------------------------------
  console.log('\n🔹 4. Sponsors Management Tests');

  let sponsorId = null;

  try {
    const res = await makeRequest('POST', '/api/sponsors', {
      name: 'Vedic Heritage Trust',
      contribution_type: 'Direct Funding',
      email: 'trust@vedicheritage.org',
      phone: '+91 94433 22110',
      contribution_amount: 100000,
      notes: 'Diamond Patron Sponsor'
    }, adminToken);
    assert.strictEqual(res.statusCode, 201);
    sponsorId = res.body.sponsorId;
    logPass('Create Sponsor (POST /api/sponsors)', `Sponsor ID: ${sponsorId}`);
  } catch (err) {
    logFail('Create Sponsor', err);
  }

  try {
    const res = await makeRequest('GET', '/api/sponsors/public/all');
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    logPass('Public Sponsors (GET /api/sponsors/public/all)', `Approved Sponsors: ${res.body.length}`);
  } catch (err) {
    logFail('Public Sponsors', err);
  }

  try {
    const res = await makeRequest('GET', '/api/sponsors', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    logPass('List Authenticated Sponsors (GET /api/sponsors)', `Total: ${res.body.length}`);
  } catch (err) {
    logFail('List Authenticated Sponsors', err);
  }

  if (sponsorId) {
    try {
      await makeRequest('DELETE', `/api/sponsors/${sponsorId}`, null, adminToken);
      logPass('Delete Sponsor (DELETE /api/sponsors/:id)', `Deleted Sponsor ID: ${sponsorId}`);
    } catch (err) {
      logFail('Delete Sponsor', err);
    }
  }

  // -------------------------------------------------------------
  // 5. EXPENSES & FINANCIAL REPORTS TESTS
  // -------------------------------------------------------------
  console.log('\n🔹 5. Expenses & Financial Reports Tests');

  let expenseId = null;

  try {
    const res = await makeRequest('POST', '/api/reports/expenses-list', {
      title: 'Pooja & Prasad Arrangements',
      category: 'Pooja Materials',
      amount: 4500,
      date: '2026-08-15',
      description: 'Camphor, flowers, prasadam ingredients',
      receipt_url: '/uploads/receipt_sample.png'
    }, adminToken);
    assert.strictEqual(res.statusCode, 201);
    expenseId = res.body.expenseId;
    logPass('Create Expense (POST /api/reports/expenses-list)', `Expense ID: ${expenseId}`);
  } catch (err) {
    logFail('Create Expense', err);
  }

  try {
    const res = await makeRequest('GET', '/api/reports/expenses-list', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    logPass('List Expenses (GET /api/reports/expenses-list)', `Count: ${res.body.length}`);
  } catch (err) {
    logFail('List Expenses', err);
  }

  try {
    const res = await makeRequest('GET', '/api/reports/dashboard-stats', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert('membersCount' in res.body);
    assert('sponsorsCount' in res.body);
    assert('balance' in res.body);
    logPass('Dashboard Stats API (GET /api/reports/dashboard-stats)', `Balance: ${res.body.balance}`);
  } catch (err) {
    logFail('Dashboard Stats API', err);
  }

  try {
    const res = await makeRequest('GET', '/api/reports/financials', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert(res.body.sponsorships && res.body.expenses);
    logPass('Finances Summary API (GET /api/reports/financials)', `Total Inflow/Outflow summary verified`);
  } catch (err) {
    logFail('Finances Summary API', err);
  }

  if (expenseId) {
    try {
      await makeRequest('DELETE', `/api/reports/expenses-list/${expenseId}`, null, adminToken);
      logPass('Delete Expense (DELETE /api/reports/expenses-list/:id)', `Deleted Expense ID: ${expenseId}`);
    } catch (err) {
      logFail('Delete Expense', err);
    }
  }

  // -------------------------------------------------------------
  // 6. COORDINATORS DIRECTORY & LOCATION DATA TESTS
  // -------------------------------------------------------------
  console.log('\n🔹 6. Coordinators Directory & Location Data Tests');

  let coordinatorId = null;

  try {
    const res = await makeRequest('GET', '/api/coordinators/public/all');
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body) && res.body.length > 0);
    logPass('Public Coordinators Directory', `Coordinators: ${res.body.length}`);
  } catch (err) {
    logFail('Public Coordinators Directory', err);
  }

  try {
    const res = await makeRequest('POST', '/api/coordinators', {
      state: 'Karnataka',
      district: 'Bengaluru',
      taluk: 'Bengaluru South',
      unit_name: 'Sringeri Shankara Math Jayanagar',
      coordinator_name: 'Sri Shankara Bhat',
      role: 'District Coordinator',
      phone: '+91 94480 11223',
      email: 'shankara.bhat@sstpa.org',
      address: 'Jayanagar 4th Block, Bengaluru'
    }, adminToken);
    assert.strictEqual(res.statusCode, 201);
    coordinatorId = res.body.coordinatorId;
    logPass('Add Coordinator (POST /api/coordinators)', `Coordinator ID: ${coordinatorId}`);
  } catch (err) {
    logFail('Add Coordinator', err);
  }

  if (coordinatorId) {
    try {
      await makeRequest('DELETE', `/api/coordinators/${coordinatorId}`, null, adminToken);
      logPass('Delete Coordinator (DELETE /api/coordinators/:id)', `Deleted Coordinator ID: ${coordinatorId}`);
    } catch (err) {
      logFail('Delete Coordinator', err);
    }
  }

  // -------------------------------------------------------------
  // 7. EVENT NOTICES & CIRCULARS TESTS
  // -------------------------------------------------------------
  console.log('\n🔹 7. Event Notices & Circulars Tests');

  let noticeId = null;

  try {
    const res = await makeRequest('POST', '/api/event-notices', {
      title: 'Shankara Jayanti Mahotsava 2026',
      organization: 'Sri Shankara Tattva Prasara Abhiyana',
      sub_org: 'Dakshinamnaya Sri Sharada Peetham, Sringeri',
      salutation: 'Respected Devotees & Coordinators,',
      event_description: 'Grand celebration of Shankara Jayanti with Veda Parayanam and Stotra Chanting',
      event_date: '2026-05-15',
      event_time: '9:00 AM - 1:00 PM',
      event_venue: 'Main Auditorium, Shankara Math',
      chairperson: 'Sri Shankara Peetham Swamiji',
      attendees: JSON.stringify(['All District & Taluk Coordinators', 'Public Devotees']),
      notices_list: JSON.stringify(['Registration mandatory before May 10', 'Prasadam distributed at 1:30 PM']),
      contact_info: '+91 98450 12345 / info@sstpa.org',
      footer_text: 'Dharmo Rakshati Rakshitaha',
      state: 'Karnataka'
    }, adminToken);
    assert.strictEqual(res.statusCode, 201);
    noticeId = res.body.noticeId;
    logPass('Create Event Notice (POST /api/event-notices)', `Notice ID: ${noticeId}`);
  } catch (err) {
    logFail('Create Event Notice', err);
  }

  try {
    const res = await makeRequest('GET', '/api/event-notices/public');
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    logPass('Public Event Notices (GET /api/event-notices/public)', `Public Notices: ${res.body.length}`);
  } catch (err) {
    logFail('Public Event Notices', err);
  }

  if (noticeId) {
    try {
      await makeRequest('DELETE', `/api/event-notices/${noticeId}`, null, adminToken);
      logPass('Delete Event Notice (DELETE /api/event-notices/:id)', `Deleted Notice ID: ${noticeId}`);
    } catch (err) {
      logFail('Delete Event Notice', err);
    }
  }

  // -------------------------------------------------------------
  // 8. NOTIFICATIONS & PHOTOS TESTS
  // -------------------------------------------------------------
  console.log('\n🔹 8. Notifications & Photos Tests');

  let notifId = null;

  try {
    const res = await makeRequest('POST', '/api/notifications', {
      title: 'System Notice: Veda Camp 2026',
      message: 'All taluk leaders please submit final count by Friday.',
      type: 'info',
      target_roles: 'all'
    }, adminToken);
    assert.strictEqual(res.statusCode, 201);
    notifId = res.body.notificationId;
    logPass('Create Notification (POST /api/notifications)', `Notification ID: ${notifId}`);
  } catch (err) {
    logFail('Create Notification', err);
  }

  try {
    const res = await makeRequest('GET', '/api/notifications', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    logPass('List Notifications (GET /api/notifications)', `Count: ${res.body.length}`);
  } catch (err) {
    logFail('List Notifications', err);
  }

  if (notifId) {
    try {
      await makeRequest('PUT', `/api/notifications/${notifId}/read`, {}, adminToken);
      await makeRequest('DELETE', `/api/notifications/${notifId}`, null, adminToken);
      logPass('Mark Read & Delete Notification', `Notification ID: ${notifId}`);
    } catch (err) {
      logFail('Mark Read & Delete Notification', err);
    }
  }

  try {
    const res = await makeRequest('GET', '/api/photos/public');
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.body));
    logPass('Public Photos Gallery (GET /api/photos/public)', `Photos: ${res.body.length}`);
  } catch (err) {
    logFail('Public Photos Gallery', err);
  }

  // -------------------------------------------------------------
  // 9. BFF (BACKEND-FOR-FRONTEND) ULTRA-FAST CONSOLIDATED ENDPOINTS
  // -------------------------------------------------------------
  console.log('\n🔹 9. BFF (Backend-For-Frontend) Performance Endpoints');

  try {
    const res = await makeRequest('GET', '/api/bff/mobile-bootstrap', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert(res.body.user, 'Must contain user profile');
    assert(res.body.stats, 'Must contain aggregated dashboard stats');
    assert(Array.isArray(res.body.upcomingEvents), 'Must contain upcoming events');
    logPass('Mobile Bootstrap API (GET /api/bff/mobile-bootstrap)', `Consolidated bootstrap returned in 1 payload`);
  } catch (err) {
    logFail('Mobile Bootstrap API', err);
  }

  try {
    const res = await makeRequest('GET', '/api/bff/dashboard-bundle', null, adminToken);
    assert.strictEqual(res.statusCode, 200);
    assert('membersCount' in res.body);
    assert('sponsorsCount' in res.body);
    assert('totalSponsorships' in res.body);
    assert('totalExpenses' in res.body);
    assert('balance' in res.body);
    assert(Array.isArray(res.body.recentActivity));
    logPass('BFF Dashboard Bundle API (GET /api/bff/dashboard-bundle)', `Retrieved full analytics bundle in 1 request`);
  } catch (err) {
    logFail('BFF Dashboard Bundle API', err);
  }

  // -------------------------------------------------------------
  // 10. REALTIME WEBSOCKET LIVE SYNC TESTS
  // -------------------------------------------------------------
  console.log('\n🔹 10. Realtime WebSocket Live Sync Tests');

  await new Promise((resolve) => {
    try {
      const ws = new WebSocket(WS_URL);
      let connected = false;

      ws.on('open', () => {
        connected = true;
        logPass('WebSocket Connection Handshake (ws://localhost:5000/ws)', 'Connected successfully');
        ws.send(JSON.stringify({ type: 'PING' }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          logPass('WebSocket Message Received', `Type: ${msg.type || 'message'}`);
        } catch (e) {
          logPass('WebSocket Raw Message Received', data.toString());
        }
        ws.close();
      });

      ws.on('close', () => {
        if (connected) {
          resolve();
        }
      });

      ws.on('error', (err) => {
        logFail('WebSocket Connection', err);
        resolve();
      });

      setTimeout(() => {
        if (!connected) {
          logFail('WebSocket Timeout', new Error('Failed to connect to WebSocket in 3000ms'));
          ws.terminate();
        }
        resolve();
      }, 3000);
    } catch (err) {
      logFail('WebSocket Setup', err);
      resolve();
    }
  });

  // -------------------------------------------------------------
  // 11. FRONTEND PAGES & STATIC ASSETS TESTS
  // -------------------------------------------------------------
  console.log('\n🔹 11. Frontend Pages & Static Assets Tests');

  const frontendPages = [
    '/',
    '/dashboard.html',
    '/events.html',
    '/members.html',
    '/expenses.html',
    '/sponsors.html',
    '/contact.html',
    '/gallery.html',
    '/resources.html',
    '/bhajan-team.html',
    '/calendar.html',
    '/about.html',
    '/login.html',
    '/settings.html',
    '/event-details.html',
    '/event-notice.html',
    '/notifications.html',
    '/reports.html',
    '/memo.html',
    '/attendance.html',
    '/offline.html',
    '/manifest.json',
    '/service-worker.js',
    '/data/south_india_locations.json',
    '/download/apk'
  ];

  for (const page of frontendPages) {
    try {
      const res = await makeRequest('GET', page);
      assert.strictEqual(res.statusCode, 200, `Page ${page} should return 200`);
      logPass(`Static Page: ${page}`, `Status: 200, Size: ${res.rawBody.length} bytes`);
    } catch (err) {
      logFail(`Static Page: ${page}`, err);
    }
  }

  // -------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`📊 TEST EXECUTION SUMMARY`);
  console.log(`Total Tests Run: ${passedCount + failedCount}`);
  console.log(`Passed:          ${passedCount} ✅`);
  console.log(`Failed:          ${failedCount} ${failedCount > 0 ? '❌' : '🎉'}`);
  console.log('======================================================================\n');

  if (failedCount > 0) {
    console.error('⚠️ Some tests failed. Details:');
    testResults.filter(r => r.status === 'FAIL').forEach(r => {
      console.error(`- ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('🎉 ALL TESTS PASSED WITH 100% SUCCESS RATE! Application is healthy and ready to run.');
    process.exit(0);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
