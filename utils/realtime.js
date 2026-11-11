const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'orgmanager_jwt_secret_key_2026';

let wss = null;
const clients = new Set();

/**
 * Initializes the WebSocket server attached to the Node.js HTTP server.
 * @param {import('http').Server} server 
 */
function initRealtimeServer(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.user = null;

    // Parse URL query params for token
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token') || (req.headers['authorization'] || '').replace('Bearer ', '');

      if (token) {
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
          if (!err && decoded) {
            ws.user = decoded;
          }
        });
      }
    } catch (e) {
      // Ignore token parse error for anonymous public clients
    }

    clients.add(ws);

    // Send initial welcome & connection ack
    ws.send(JSON.stringify({
      type: 'CONNECTION_ESTABLISHED',
      payload: {
        message: 'Connected to SSTPA Realtime Event Bus',
        authenticated: !!ws.user,
        user: ws.user ? { id: ws.user.id, username: ws.user.username, role: ws.user.role } : null,
        timestamp: new Date().toISOString()
      }
    }));

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        // Handle client auth update or ping
        if (data.type === 'AUTH' && data.token) {
          jwt.verify(data.token, JWT_SECRET, (err, decoded) => {
            if (!err && decoded) {
              ws.user = decoded;
              ws.send(JSON.stringify({
                type: 'AUTH_SUCCESS',
                payload: { user: { id: decoded.id, username: decoded.username, role: decoded.role } }
              }));
            }
          });
        } else if (data.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
        }
      } catch (err) {
        // Non-JSON or malformed client message
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  // Heartbeat ping to keep cellular/WiFi connections alive every 30s
  const interval = setInterval(() => {
    if (!wss) return;
    for (const ws of clients) {
      if (ws.isAlive === false) {
        clients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  console.log('⚡ Realtime WebSocket server initialized on /ws');
  return wss;
}

/**
 * Broadcasts an event payload to connected WebSocket clients.
 * @param {string} type - Event identifier (e.g. 'EVENT_CREATED', 'NOTICE_PUBLISHED')
 * @param {object} payload - Event data payload
 * @param {object} [options] - Optional filter options: { targetRoles, targetUserId, excludeUserId }
 */
function broadcast(type, payload = {}, options = {}) {
  if (!wss || clients.size === 0) return;

  const eventMessage = JSON.stringify({
    type,
    payload,
    timestamp: new Date().toISOString()
  });

  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    // Filter by specific user ID if requested
    if (options.targetUserId && client.user && client.user.id !== options.targetUserId) {
      continue;
    }

    // Exclude sender if requested
    if (options.excludeUserId && client.user && client.user.id === options.excludeUserId) {
      continue;
    }

    // Filter by role if requested
    if (options.targetRoles && Array.isArray(options.targetRoles) && options.targetRoles.length > 0) {
      if (!client.user || !options.targetRoles.includes(client.user.role)) {
        continue;
      }
    }

    try {
      client.send(eventMessage);
    } catch (e) {
      console.error('Failed sending WS broadcast to client:', e.message);
    }
  }
}

module.exports = {
  initRealtimeServer,
  broadcast,
  getClientsCount: () => clients.size
};
