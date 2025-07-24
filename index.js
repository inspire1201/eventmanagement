require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

const app = express();

// CORS Configuration
app.use(cors({
  origin: ['https://incevents.netlify.app','http://localhost:5173'], 
  credentials: true, 
}));

app.use(express.json());  
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 🚀 PRODUCTION-READY MySQL CONNECTION POOL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  
  // Production Settings for 24/7 uptime
  connectionLimit: 10,              // Max connections
  queueLimit: 0,                   // Unlimited queue
  acquireTimeout: 60000,           // 60 seconds timeout
  timeout: 60000,                  // Query timeout
  reconnect: true,                 // Auto reconnect
  
  // Keep connections alive
  keepAliveInitialDelay: 0,
  enableKeepAlive: true,
  
  // Handle connection drops gracefully
  idleTimeout: 900000,             // 15 minutes
  minimumIdle: 2,                  // Minimum connections
  maximumIdle: 10,                 // Maximum idle connections
  
  // Additional stability settings
  ssl: false,                      // Railway doesn't need SSL
  connectTimeout: 60000,           // Connection timeout
  
  // Handle connection errors
  multipleStatements: false,
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
});


async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Database Pool Connected Successfully');
    console.log(`📊 Host: ${process.env.DB_HOST}`);
    console.log(`🔌 Port: ${process.env.DB_PORT}`);
    connection.release();
  } catch (error) {
    console.error('❌ Database Pool Connection Failed:', error.message);
    // Retry connection after 5 seconds
    setTimeout(initializeDatabase, 5000);
  }
}

// Initialize database on startup
initializeDatabase();

// 🩺 HEALTH CHECK ENDPOINT
app.get('/health', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT 1 as health_check');
    res.status(200).json({ 
      status: '✅ OK', 
      database: '🟢 Connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ 
      status: '❌ ERROR', 
      database: '🔴 Disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🛡️ SAFE QUERY WRAPPER with Auto-Retry
async function safeQuery(sql, params = []) {
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      const [rows] = await pool.execute(sql, params);
      return rows;
    } catch (error) {
      retryCount++;
      console.error(`Query attempt ${retryCount} failed:`, error.message);
      
      if (retryCount >= maxRetries) {
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
    }
  }
}

// Multer Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video' && file.mimetype.startsWith('video/') && file.size >= 10 * 1024 * 1024) {
      cb(null, true);
    } else if (file.fieldname.startsWith('photo') && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else if (file.fieldname.startsWith('media_photo') && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type or size'), false);
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 }, 
});

const multerStorage = multer.memoryStorage();
const uploadCloud = multer({ storage: multerStorage });

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Utility Functions
function toMySQLDateTime(isoString) {
  return new Date(isoString).toISOString().slice(0, 19).replace('T', ' ');
}

// 🔐 LOGIN ENDPOINT
app.post('/api/login', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ error: 'पिन आवश्यक है' });
    }

    const users = await safeQuery('SELECT * FROM users WHERE Pin = ?', [pin]);
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'अमान्य पिन' });
    }
    
    const user = users[0];

    // Log user visit
    const visitDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const month = visitDateTime.slice(0, 7);
    
    try {
      await safeQuery(
        'INSERT INTO user_visits (user_id, visit_date_time, month) VALUES (?, ?, ?)',
        [user.ID, visitDateTime, month]
      );
    } catch (visitError) {
      console.error('Visit log error:', visitError);
      // Don't fail login if visit logging fails
    }

    res.json({
      id: user.ID,
      username: user.User_Name,
      designation: user.Designation,
      pin: user.Pin
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'डेटाबेस त्रुटि' });
  }
});

// 📊 GET USER VISITS
app.get('/api/user_visits/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const month = new Date().toISOString().slice(0, 7);
    
    const results = await safeQuery(
      'SELECT MAX(visit_date_time) as last_visit, COUNT(*) as monthly_count FROM user_visits WHERE user_id = ? AND month = ?',
      [user_id, month]
    );
    
    res.json(results[0] || { last_visit: null, monthly_count: 0 });
  } catch (error) {
    console.error('User visits error:', error);
    res.status(500).json({ error: 'डेटाबेस त्रुटि' });
  }
});

// 📅 GET EVENTS
app.get('/api/events', async (req, res) => {
  try {
    const { status, user_id } = req.query;
    
    const events = await safeQuery('SELECT * FROM events WHERE status = ?', [status]);
    
    if (!user_id) {
      return res.json(events);
    }

    // Check which events user has updated
    const eventIds = events.map(ev => ev.id || ev.ID);
    if (eventIds.length === 0) return res.json([]);
    
    const updatedRows = await safeQuery(
      'SELECT event_id FROM event_updates WHERE user_id = ? AND event_id IN (?)',
      [user_id, eventIds]
    );
    
    const updatedEventIds = new Set(updatedRows.map(row => row.event_id));
    const eventsWithFlag = events.map(ev => ({
      ...ev,
      userHasUpdated: updatedEventIds.has(ev.id || ev.ID)
    }));
    
    res.json(eventsWithFlag);
  } catch (error) {
    console.error('Events error:', error);
    res.status(500).json({ error: 'डेटाबेस त्रुटि' });
  }
});

// 👁️ MARK EVENT AS VIEWED
app.post('/api/event_view', async (req, res) => {
  try {
    const { event_id, user_id } = req.body;
    const viewDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    await safeQuery(
      'INSERT IGNORE INTO event_views (event_id, user_id, view_date_time) VALUES (?, ?, ?)',
      [event_id, user_id, viewDateTime]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Event view error:', error);
    res.status(500).json({ error: 'डेटाबेस त्रुटि' });
  }
});

// 🔄 UPDATE EVENT
app.post('/api/event_update', uploadCloud.fields([
  { name: 'photos', maxCount: 10 },
  { name: 'video', maxCount: 1 },
  { name: 'media_photos', maxCount: 5 },
]), async (req, res) => {
  try {
    const {
      event_id,
      user_id,
      name,
      description,
      start_date_time,
      end_date_time,
      issue_date,
      location,
      attendees,
      type
    } = req.body;

    // Format date strings
    const formattedStart = toMySQLDateTime(start_date_time);
    const formattedEnd = toMySQLDateTime(end_date_time);
    const formattedIssue = toMySQLDateTime(issue_date);
    const update_date = new Date().toISOString().slice(0, 10);

    // Cloudinary upload helper
    async function uploadToCloudinary(file, folder) {
      return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: file.mimetype && file.mimetype.startsWith('video/') ? 'video' : 'image'
          },
          (err, result) => {
            if (err) reject(err);
            else resolve(result.secure_url);
          }
        ).end(file.buffer);
      });
    }

    // Handle photos
    let photos = [];
    if (req.files && req.files.photos) {
      for (const file of req.files.photos) {
        if (!file || !file.buffer) continue;
        const url = await uploadToCloudinary(file, 'event_photos');
        photos.push(url);
      }
    }

    // Handle video
    let video = null;
    if (req.files && req.files.video) {
      video = await uploadToCloudinary(req.files.video[0], 'event_videos');
      if (typeof video !== 'string') {
        video = String(video?.secure_url || video || '');
      }
      if (!video) video = null;
    }

    // Handle media photos
    let media_photos = [];
    if (req.files && req.files.media_photos) {
      for (const file of req.files.media_photos) {
        if (!file || !file.buffer) continue;
        const url = await uploadToCloudinary(file, 'event_media_photos');
        media_photos.push(url);
      }
    }

    // Insert into database
    await safeQuery(
      `INSERT INTO event_updates (
        event_id, user_id, name, description,
        start_date_time, end_date_time, issue_date,
        location, attendees, update_date,
        photos, video, media_photos, type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event_id,
        user_id,
        name,
        description,
        formattedStart,
        formattedEnd,
        formattedIssue,
        location,
        attendees,
        update_date,
        JSON.stringify(photos),
        video,
        JSON.stringify(media_photos),
        type
      ]
    );

    res.json({ success: true, photos, video, media_photos });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'सर्वर त्रुटि', details: error.message });
  }
});

// ➕ ADD EVENT (Admin)
app.post('/api/event_add', uploadCloud.fields([
  { name: 'photos', maxCount: 10 },
  { name: 'video', maxCount: 1 },
]), async (req, res) => {
  try {
    const { name, description, start_date_time, end_date_time, issue_date, location, type, user } = req.body;
    
    // Cloudinary upload logic
    async function uploadToCloudinary(file, folder) {
      return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream({ folder }, (err, result) => {
          if (err) reject(err);
          else resolve(result.secure_url);
        }).end(file.buffer);
      });
    }

    let photos = [];
    if (req.files && req.files.photos) {
      for (const file of req.files.photos) {
        const url = await uploadToCloudinary(file, 'event_photos');
        photos.push(url);
      }
    }

    let video = null;
    if (req.files && req.files.video) {
      video = await uploadToCloudinary(req.files.video[0], 'event_videos');
    }

    const status = new Date(start_date_time) > new Date() ? 'ongoing' : 'previous';

    const result = await safeQuery(
      'INSERT INTO events (name, description, start_date_time, end_date_time, issue_date, location, type, status, photos, video) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description, start_date_time, end_date_time, issue_date, location, type, status, JSON.stringify(photos), video]
    );

    const event_id = result.insertId;
    
    // Link to all users if "All Jila Addhyaksh"
    if (user === 'All Jila Addhyaksh') {
      const users = await safeQuery('SELECT ID FROM users WHERE Designation != "Admin"');
      if (users.length > 0) {
        const values = users.map(u => [event_id, u.ID]);
        await safeQuery('INSERT INTO event_users (event_id, user_id) VALUES ?', [values]);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Add event error:', error);
    res.status(500).json({ error: 'डेटाबेस त्रुटि' });
  }
});

// 📋 GET EVENT REPORT (Admin)
app.get('/api/event_report/:event_id', async (req, res) => {
  try {
    const { event_id } = req.params;
    
    const users = await safeQuery(
      `SELECT u.ID, u.User_Name as name, u.Designation as designation,
              (SELECT COUNT(*) FROM event_views ev WHERE ev.user_id = u.ID AND ev.event_id = ?) as viewed,
              (SELECT COUNT(*) FROM event_updates eu WHERE eu.user_id = u.ID AND eu.event_id = ?) as updated
       FROM users u
       JOIN event_users eu ON u.ID = eu.user_id
       WHERE eu.event_id = ? AND u.Designation != "Admin"`,
      [event_id, event_id, event_id]
    );
    
    const eventResults = await safeQuery('SELECT * FROM events WHERE id = ?', [event_id]);
    
    res.json({ users, event: eventResults[0] });
  } catch (error) {
    console.error('Event report error:', error);
    res.status(500).json({ error: 'डेटाबेस त्रुटि' });
  }
});

// 👤 GET USER EVENT DETAILS (Admin)
app.get('/api/event_user_details/:event_id/:user_id', async (req, res) => {
  try {
    const { event_id, user_id } = req.params;
    
    const results = await safeQuery(
      'SELECT * FROM event_updates WHERE event_id = ? AND user_id = ? ORDER BY update_date DESC, id DESC LIMIT 1',
      [event_id, user_id]
    );
    
    res.json(results[0] || {});
  } catch (error) {
    console.error('User event details error:', error);
    res.status(500).json({ error: 'डेटाबेस त्रुटि' });
  }
});

// 🔄 GRACEFUL SHUTDOWN
process.on('SIGTERM', async () => {
  console.log('🔄 SIGTERM received. Closing database pool...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔄 SIGINT received. Closing database pool...');
  await pool.end();
  process.exit(0);
});

// 🚀 START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('🚀 Server running on port', PORT);
  console.log('🩺 Health check available at /health');
  console.log('💾 Database pool initialized with auto-reconnection');
  console.log('✅ Production-ready setup active');
});