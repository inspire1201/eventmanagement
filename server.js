require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const eventRoutes = require('./routes/eventRoutes');
const reportRoutes = require('./routes/reportRoutes');

const app = express();

app.use(cors({
  origin: ['https://incevents.netlify.app', 'http://localhost:5173'],
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api', authRoutes);
app.use('/api', eventRoutes);
app.use('/api', reportRoutes);

// Start server
app.listen(5000, () => console.log('Server running on port 5000'));
