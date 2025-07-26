const db = require('../config/db');
const cloudinary = require('../config/cloudinary');
const { uploadToCloudinary, toMySQLDateTime } = require('../utils/helpers');

exports.getEvents = (req, res) => {
  const { status, user_id } = req.query;
  db.query('SELECT * FROM events WHERE status = ?', [status], (err, results) => {
    if (err) return res.status(500).json({ error: 'डेटाबेस त्रुटि' });

    if (!user_id) return res.json(results);

    const eventIds = results.map(ev => ev.id || ev.ID);
    if (!eventIds.length) return res.json([]);

    db.query('SELECT event_id FROM event_updates WHERE user_id = ? AND event_id IN (?)', [user_id, eventIds], (err2, updated) => {
      if (err2) return res.status(500).json({ error: 'डेटाबेस त्रुटि' });

      const updatedIds = new Set(updated.map(row => row.event_id));
      const merged = results.map(ev => ({ ...ev, userHasUpdated: updatedIds.has(ev.id || ev.ID) }));
      res.json(merged);
    });
  });
};

exports.markEventViewed = (req, res) => {
  const { event_id, user_id } = req.body;
  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.query(
    'INSERT IGNORE INTO event_views (event_id, user_id, view_date_time) VALUES (?, ?, ?)',
    [event_id, user_id, date],
    (err) => {
      if (err) return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
      res.json({ success: true });
    }
  );
};

exports.updateEvent = async (req, res) => {
  try {
    const { event_id, user_id, name, description, start_date_time, end_date_time, issue_date, location, attendees, type } = req.body;

    const formattedStart = toMySQLDateTime(start_date_time);
    const formattedEnd = toMySQLDateTime(end_date_time);
    const formattedIssue = toMySQLDateTime(issue_date);
    const update_date = new Date().toISOString().slice(0, 10);

    let photos = [];
    if (req.files?.photos) {
      for (const file of req.files.photos) {
        const url = await uploadToCloudinary(file, 'event_photos', cloudinary);
        photos.push(url);
      }
    }

    let video = null;
    if (req.files?.video) {
      video = await uploadToCloudinary(req.files.video[0], 'event_videos', cloudinary);
    }

    let media_photos = [];
    if (req.files?.media_photos) {
      for (const file of req.files.media_photos) {
        const url = await uploadToCloudinary(file, 'event_media_photos', cloudinary);
        media_photos.push(url);
      }
    }

    db.query(
      `INSERT INTO event_updates (
        event_id, user_id, name, description,
        start_date_time, end_date_time, issue_date,
        location, attendees, update_date,
        photos, video, media_photos, type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event_id, user_id, name, description,
        formattedStart, formattedEnd, formattedIssue,
        location, attendees, update_date,
        JSON.stringify(photos), video, JSON.stringify(media_photos), type
      ],
      (err) => {
        if (err) return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
        res.json({ success: true, photos, video, media_photos });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'सर्वर त्रुटि', details: err.message });
  }
};
