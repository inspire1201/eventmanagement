const express = require('express');
const router = express.Router();
const {
  getEventReport,
  getUserEventDetails
} = require('../controllers/reportController');

router.get('/event_report/:event_id', getEventReport);
router.get('/event_user_details/:event_id/:user_id', getUserEventDetails);

module.exports = router;
