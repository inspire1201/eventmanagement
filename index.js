require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(cors({
  origin: ['https://lively-starship-fecd31.netlify.app','http://localhost:5173'], 
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Add OPTIONS handler for preflight requests
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));  

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
    if (file.fieldname === 'video' && file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else if (file.fieldname.startsWith('photo') && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else if (file.fieldname.startsWith('media_photo') && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});

const multerStorage = multer.memoryStorage();
const uploadCloud = multer({ 
  storage: multerStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

db.connect((err) => {
  if (err) {
    console.error('connection error:', err);
    return;
  }
  console.log('MySQL Connected Successfully');
});

function toMySQLDateTime(isoString) {
  return new Date(isoString).toISOString().slice(0, 19).replace('T', ' ');
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'पिन आवश्यक है' });
  }

  db.query('SELECT * FROM users WHERE Pin = ?', [pin], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
    }
    if (results.length === 0) {
      return res.status(401).json({ error: 'अमान्य पिन' });
    }
    const user = results[0];

    // Log user visit
    const visitDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const month = visitDateTime.slice(0, 7);
    db.query(
      'INSERT INTO user_visits (user_id, visit_date_time, month) VALUES (?, ?, ?)',
      [user.ID, visitDateTime, month],
      (err) => {
        if (err) console.error('Visit log error:', err);
      }
    );

    res.json({
      id: user.ID,
      username: user.User_Name,
      designation: user.Designation,
      pin: user.Pin
    });
  });
});

// Get user visits
app.get('/api/user_visits/:user_id', (req, res) => {
  const { user_id } = req.params;
  const month = new Date().toISOString().slice(0, 7);
  db.query(
    'SELECT MAX(visit_date_time) as last_visit, COUNT(*) as monthly_count FROM user_visits WHERE user_id = ? AND month = ?',
    [user_id, month],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
      }
      res.json(results[0]);
    }
  );
});

// Get events
app.get('/api/events', (req, res) => {
  const { status } = req.query;
  db.query('SELECT * FROM events WHERE status = ?', [status], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
    }
    res.json(results);
  });
});

// Mark event as viewed
app.post('/api/event_view', (req, res) => {
  const { event_id, user_id } = req.body;
  const viewDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.query(
    'INSERT IGNORE INTO event_views (event_id, user_id, view_date_time) VALUES (?, ?, ?)',
    [event_id, user_id, viewDateTime],
    (err) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
      }
      res.json({ success: true });
    }
  );
});

// Enhanced Cloudinary upload helper with better video handling
async function uploadToCloudinary(file, folder) {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      resource_type: 'auto', // This automatically detects video/image
    };

    // For video files, add video-specific options
    if (file.mimetype.startsWith('video/')) {
      uploadOptions.resource_type = 'video';
      uploadOptions.quality = 'auto';
      uploadOptions.format = 'mp4'; // Convert to mp4 for better compatibility
    }

    cloudinary.uploader.upload_stream(uploadOptions, (err, result) => {
      if (err) {
        console.error('Cloudinary upload error:', err);
        reject(err);
      } else {
        resolve(result.secure_url);
      }
    }).end(file.buffer);
  });
}

// Update event with improved video handling
app.post('/api/event_update', uploadCloud.fields([
  { name: 'photos', maxCount: 10 },
  { name: 'video', maxCount: 1 },
  { name: 'media_photos', maxCount: 5 },
]), async (req, res) => {
  // Add CORS headers explicitly
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  try {
    console.log('Event update request received');
    console.log('Request body:', req.body);
    console.log('Files:', req.files);

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

    // Validate required fields
    if (!event_id || !user_id) {
      return res.status(400).json({ 
        error: 'Event ID और User ID आवश्यक हैं',
        received: { event_id, user_id }
      });
    }

    // Format date strings to MySQL-safe format (only if they exist)
    const formattedStart = start_date_time ? toMySQLDateTime(start_date_time) : null;
    const formattedEnd = end_date_time ? toMySQLDateTime(end_date_time) : null;
    const formattedIssue = issue_date ? toMySQLDateTime(issue_date) : null;
    const update_date = new Date().toISOString().slice(0, 10);

    // Handle photos
    let photos = [];
    if (req.files && req.files.photos) {
      console.log('Processing photos:', req.files.photos.length);
      for (const file of req.files.photos) {
        try {
          const url = await uploadToCloudinary(file, 'event_photos');
          photos.push(url);
        } catch (photoError) {
          console.error('Photo upload failed:', photoError);
          // Continue with other photos even if one fails
        }
      }
    }

    // Handle video with improved error handling
    let video = null;
    if (req.files && req.files.video && req.files.video[0]) {
      try {
        console.log('Uploading video to Cloudinary...');
        console.log('Video file details:', {
          originalname: req.files.video[0].originalname,
          mimetype: req.files.video[0].mimetype,
          size: req.files.video[0].size
        });
        
        video = await uploadToCloudinary(req.files.video[0], 'event_videos');
        console.log('Video uploaded successfully:', video);
      } catch (videoError) {
        console.error('Video upload failed:', videoError);
        return res.status(500).json({ 
          error: 'वीडियो अपलोड त्रुटि', 
          details: videoError.message 
        });
      }
    }

    // Handle media photos
    let media_photos = [];
    if (req.files && req.files.media_photos) {
      console.log('Processing media photos:', req.files.media_photos.length);
      for (const file of req.files.media_photos) {
        try {
          const url = await uploadToCloudinary(file, 'event_media_photos');
          media_photos.push(url);
        } catch (mediaPhotoError) {
          console.error('Media photo upload failed:', mediaPhotoError);
          // Continue with other media photos even if one fails
        }
      }
    }

    // Insert into DB
    console.log('Inserting into database...');
    db.query(
      `INSERT INTO event_updates (
        event_id, user_id, name, description,
        start_date_time, end_date_time, issue_date,
        location, attendees, update_date,
        photos, video, media_photos, type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event_id,
        user_id,
        name || null,
        description || null,
        formattedStart,
        formattedEnd,
        formattedIssue,
        location || null,
        attendees || null,
        update_date,
        JSON.stringify(photos),
        video,
        JSON.stringify(media_photos),
        type || null
      ],
      (err, result) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ 
            error: 'डेटाबेस त्रुटि', 
            details: err.message,
            sqlMessage: err.sqlMessage 
          });
        }
        
        console.log('Database insert successful');
        res.json({ 
          success: true, 
          photos, 
          video, 
          media_photos,
          message: 'Event updated successfully',
          insertId: result.insertId
        });
      }
    );

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ 
      error: 'सर्वर त्रुटि', 
      details: error.message,
      stack: error.stack
    });
  }
});

// Add event (Admin) with improved video handling
app.post('/api/event_add', uploadCloud.fields([
  { name: 'photos', maxCount: 10 },
  { name: 'video', maxCount: 1 },
]), async (req, res) => {
  try {
    const { name, description, start_date_time, end_date_time, issue_date, location, type, user } = req.body;

    // Handle photos
    let photos = [];
    if (req.files && req.files.photos) {
      for (const file of req.files.photos) {
        const url = await uploadToCloudinary(file, 'event_photos');
        photos.push(url);
      }
    }

    // Handle video
    let video = null;
    if (req.files && req.files.video && req.files.video[0]) {
      try {
        console.log('Uploading video to Cloudinary...');
        video = await uploadToCloudinary(req.files.video[0], 'event_videos');
        console.log('Video uploaded successfully:', video);
      } catch (videoError) {
        console.error('Video upload failed:', videoError);
        return res.status(500).json({ 
          error: 'वीडियो अपलोड त्रुटि', 
          details: videoError.message 
        });
      }
    }

    const status = new Date(start_date_time) > new Date() ? 'ongoing' : 'previous';

    db.query(
      'INSERT INTO events (name, description, start_date_time, end_date_time, issue_date, location, type, status, photos, video) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description, start_date_time, end_date_time, issue_date, location, type, status, JSON.stringify(photos), video],
      (err, result) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
        }
        
        const event_id = result.insertId;
        
        // Link to all users if "All Jila Addhyaksh"
        if (user === 'All Jila Addhyaksh') {
          db.query('SELECT ID FROM users WHERE Designation != "Admin"', (err, users) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
            }
            const values = users.map(u => [event_id, u.ID]);
            db.query('INSERT INTO event_users (event_id, user_id) VALUES ?', [values], (err) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
              }
              res.json({ 
                success: true, 
                event_id,
                video,
                photos,
                message: 'Event added successfully'
              });
            });
          });
        } else {
          res.json({ 
            success: true, 
            event_id,
            video,
            photos,
            message: 'Event added successfully'
          });
        }
      }
    );
  } catch (error) {
    console.error('Add event error:', error);
    res.status(500).json({ error: 'सर्वर त्रुटि', details: error.message });
  }
});

// Get event report (Admin)
app.get('/api/event_report/:event_id', (req, res) => {
  const { event_id } = req.params;
  db.query(
    `SELECT u.ID, u.User_Name as name, u.Designation as designation,
            (SELECT COUNT(*) FROM event_views ev WHERE ev.user_id = u.ID AND ev.event_id = ?) as viewed,
            (SELECT COUNT(*) FROM event_updates eu WHERE eu.user_id = u.ID AND eu.event_id = ?) as updated
     FROM users u
     JOIN event_users eu ON u.ID = eu.user_id
     WHERE eu.event_id = ? AND u.Designation != "Admin"`,
    [event_id, event_id, event_id],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
      }
      db.query('SELECT * FROM events WHERE id = ?', [event_id], (err, eventResults) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
        }
        res.json({ users: results, event: eventResults[0] });
      });
    }
  );
});

// Get user event details (Admin)
app.get('/api/event_user_details/:event_id/:user_id', (req, res) => {
  const { event_id, user_id } = req.params;
  db.query('SELECT * FROM event_updates WHERE event_id = ? AND user_id = ?', [event_id, user_id], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
    }
    res.json(results[0] || {});
  });
});

app.listen(5000, () => {
  console.log('Server running on port 5000');
});