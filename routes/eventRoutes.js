const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const {
  getEvents,
  markEventViewed,
  updateEvent
} = require('../controllers/eventController');

router.get('/events', getEvents);
router.post('/event_view', markEventViewed);
router.post('/event_update', upload.fields([
  { name: 'photos', maxCount: 10 },
  { name: 'video', maxCount: 1 },
  { name: 'media_photos', maxCount: 5 },
]), updateEvent);

module.exports = router;
