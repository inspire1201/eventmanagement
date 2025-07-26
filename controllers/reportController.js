const db = require('../config/db');

exports.getEventReport = (req, res) => {
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
      if (err) return res.status(500).json({ error: 'डेटाबेस त्रुटि' });

      db.query('SELECT * FROM events WHERE id = ?', [event_id], (err, eventDetails) => {
        if (err) return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
        res.json({ users: results, event: eventDetails[0] });
      });
    }
  );
};

exports.getUserEventDetails = (req, res) => {
  const { event_id, user_id } = req.params;
  db.query(
    'SELECT * FROM event_updates WHERE event_id = ? AND user_id = ? ORDER BY update_date DESC, id DESC LIMIT 1',
    [event_id, user_id],
    (err, results) => {
      if (err) return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
      res.json(results[0] || {});
    }
  );
};
