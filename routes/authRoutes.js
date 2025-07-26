const express = require('express');
const router = express.Router();
const { login, getUserVisits } = require('../controllers/authController');

router.post('/login', login);
router.get('/user_visits/:user_id', getUserVisits);

module.exports = router;
