const db = require('../config/db');

exports.login = (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'पिन आवश्यक है' });

  db.query('SELECT * FROM users WHERE Pin = ?', [pin], (err, results) => {
    if (err) return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
    if (results.length === 0) return res.status(401).json({ error: 'अमान्य पिन' });

    const user = results[0];
    const visitDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const month = visitDateTime.slice(0, 7);

    db.query('INSERT INTO user_visits (user_id, visit_date_time, month) VALUES (?, ?, ?)', [user.ID, visitDateTime, month]);

    res.json({
      id: user.ID,
      username: user.User_Name,
      designation: user.Designation,
      pin: user.Pin
    });
  });
};

exports.getUserVisits = (req, res) => {
  const { user_id } = req.params;
  const month = new Date().toISOString().slice(0, 7);
  db.query(
    'SELECT MAX(visit_date_time) as last_visit, COUNT(*) as monthly_count FROM user_visits WHERE user_id = ? AND month = ?',
    [user_id, month],
    (err, results) => {
      if (err) return res.status(500).json({ error: 'डेटाबेस त्रुटि' });
      res.json(results[0]);
    }
  );
};
