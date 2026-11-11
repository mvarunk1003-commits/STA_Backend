const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { initRealtimeServer } = require('./utils/realtime');

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server to attach both Express and WebSocket
const server = http.createServer(app);

// Initialize Realtime WebSocket Server
initRealtimeServer(server);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files statically with cache
const mediaCacheOptions = { maxAge: '7d', etag: true };
app.use('/uploads', express.static(uploadsDir, mediaCacheOptions));

// API Routes
const usersRoutes = require('./routes/users');
const membersRoutes = require('./routes/members');
const eventsRoutes = require('./routes/events');
const sponsorsRoutes = require('./routes/sponsors');
const reportsRoutes = require('./routes/reports');
const coordinatorsRoutes = require('./routes/coordinators');
const photosRoutes = require('./routes/photos');
const notificationsRoutes = require('./routes/notifications');
const eventNoticesRoutes = require('./routes/event-notices');
const bffRoutes = require('./routes/bff');

app.use('/api/users', usersRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/sponsors', sponsorsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/coordinators', coordinatorsRoutes);
app.use('/api/photos', photosRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/event-notices', eventNoticesRoutes);
app.use('/api/bff', bffRoutes);

// File Upload Endpoint
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ message: 'File uploaded successfully', fileUrl });
});

// Serve Flutter Web App statically if available
const flutterWebDir = path.join(__dirname, '../mobile_app/build/web');
const staticCacheOptions = { maxAge: 0, etag: true, extensions: ['html'] };

if (fs.existsSync(flutterWebDir)) {
  app.use(['/flutter', '/mobile'], express.static(flutterWebDir, staticCacheOptions));
}

// Serve Frontend statically in production/local environment
const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir, staticCacheOptions));
app.use('/images', express.static(path.join(frontendDir, 'images'), mediaCacheOptions));

// Fallback for Flutter web routes
if (fs.existsSync(flutterWebDir)) {
  app.get(['/flutter/*', '/mobile/*'], (req, res) => {
    res.sendFile(path.join(flutterWebDir, 'index.html'));
  });
}

// Direct Flutter APK download endpoint (with multi-path release discovery)
app.get(['/download/apk', '/app-release.apk'], (req, res) => {
  const candidatePaths = [
    path.join(__dirname, 'releases/app-release.apk'),
    path.join(__dirname, '../mobile_app/build/app/outputs/flutter-apk/app-release.apk'),
    path.join(__dirname, '../mobile_app/build/app/outputs/apk/release/app-release.apk'),
    path.join(__dirname, 'uploads/app-release.apk')
  ];
  const foundPath = candidatePaths.find(p => fs.existsSync(p));
  if (foundPath) {
    res.download(foundPath, 'STPA-Release.apk');
  } else {
    res.status(404).json({
      error: 'Release APK is not built yet. Run "npm run build:mobile" to generate it.',
      candidatePaths
    });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Something went wrong on the server!' });
});

const HOST = process.env.HOST || '0.0.0.0';
const os = require('os');

function startServer(portToTry) {
  server.listen(portToTry, HOST, () => {
    console.log(`====================================================`);
    console.log(`SSTPA Server Running on Drive F: (Port ${portToTry})`);
    console.log(`- Local PC:       http://localhost:${portToTry}`);
    console.log(`- WebSocket:      ws://localhost:${portToTry}/ws`);

    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`- Local Network (${name}): http://${iface.address}:${portToTry}`);
        }
      }
    }
    console.log(`- APK Download:   http://localhost:${portToTry}/download/apk`);
    console.log(`- Public Access:  Run 'npm run tunnel' or START_PUBLIC_SERVER.bat`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${portToTry} in use. Attempting fallback on port ${portToTry + 1}...`);
      setTimeout(() => startServer(portToTry + 1), 500);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(Number(PORT));


