const fs = require('fs');
const session = require('express-session');
const path = require('path');
const express = require('express');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'tank-magic-secret',
  resave: false,
  saveUninitialized: false
}));
const PORT = 3000;

function logAction(req, action, allowed) {
  const user = req.session.user;

  const entry = {
    time: new Date().toISOString(),
    user: user ? user.username : 'unknown',
    role: user ? user.role : 'none',
    action: action,
    allowed: allowed
  };

  const line = JSON.stringify(entry) + '\n';

  fs.appendFile('activity.log', line, (err) => {
    if (err) console.error('Log write failed:', err);
  });
}

const USERS = {
  Tony:  { password: 'SuperShrimp',  role: 'admin' },
  Charlene:   { password: 'Shrimp',   role: 'user' },
  Demo: { password: 'Demo', role: 'viewer' }
};

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!USERS[username] || USERS[username].password !== password) {
    return res.send('Invalid login');
  }

  req.session.user = {
    username,
    role: USERS[username].role
  };

  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

app.get('/me', (req, res) => {
  if (!req.session.user) return res.json({ loggedIn: false });

  res.json({
    loggedIn: true,
    username: req.session.user.username,
    role: req.session.user.role
  });
});
app.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/rain', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';

  logAction(req, 'rain', !blocked);

  if (blocked) {
    return res.send('Viewer cannot control system');
  }

  console.log('🌧️ Water valve activated');
  res.send('Rain cycle started');
});

app.get('/dose', (req, res) => {
  const blocked = !req.session.user || req.session.user.role ==='viewer';
 
logAction(req, 'dose', !blocked);

  if (blocked) {
     return res.send('Viewer cannot control system');
}

  console.log('🌱 Dosing system activated');
  res.send('Plant food added');
});

app.get('/noise', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';

logAction(req, 'noise', !blocked);

    if (blocked) {
       return res.send('Viewer cannot control system');
}

  console.log('🔊 Speaker activated');
  res.send('Sound started');
});

app.get('/shrimp', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';

logAction(req, 'feed', !blocked);

    if (blocked) {
       return res.send('Viewer cannot control system');
}

  console.log('🍤 Shrimp feeder activated');
  res.send('Shrimp feeding triggered');
});

app.get('/stop', (req, res) => {
  if (!req.session.user || req.session.user.role === 'viewer') {
    return res.send('Viewer cannot control system');
  }
logAction(req, 'stopped', !blocked);
  console.log('🛑 Stop everything triggered');
  res.send('All actions stopped');
});

app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
