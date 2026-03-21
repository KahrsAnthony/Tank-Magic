const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.static('public'));

app.get('/rain', (req, res) => {
  console.log('🌧️ Water valve activated');
  res.send('Rain cycle started');
});

app.get('/dose', (req, res) => {
  console.log('🌱 Dosing system activated');
  res.send('Plant food added');
});

app.get('/noise', (req, res) => {
  console.log('🔊 Speaker activated');
  res.send('Sound started');
});

app.get('/stop', (req, res) => {
  console.log('🛑 Stop everything triggered');
  res.send('All actions stopped');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
