const fs = require('fs');
const session = require('express-session');
const path = require('path');
const express = require('express');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: 'tank-magic-secret',
  resave: false,
  saveUninitialized: false
}));
const PORT = 3000;

const STATE_FILE = 'button-state.json';

function readButtonState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    return {
      rain: null,
      dose: null,
      noise: null,
      shrimp: null,
      stop: null
    };
  }
}

function isActionActive(action) {
  const state = readButtonState();
  const info = state[action];

  if (!info || !info.activeUntil) return false;

  return new Date(info.activeUntil) > new Date();
}

function setActionActive(action, username, minutes) {
  const state = readButtonState();
  const now = new Date();
  const activeUntil = new Date(now.getTime() + minutes * 60 * 1000);

  state[action] = {
    time: now.toISOString(),
    user: username,
    activeUntil: activeUntil.toISOString()
  };

  writeButtonState(state);
}

function clearExpiredActions() {
  const state = readButtonState();
  let changed = false;
  const now = new Date();

  Object.keys(state).forEach((action) => {
    const info = state[action];
    if (info && info.activeUntil && new Date(info.activeUntil) <= now) {
      delete info.activeUntil;
      changed = true;
    }
  });

  if (changed) {
    writeButtonState(state);
  }
}

function writeButtonState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updateLastPressed(action, username) {
  const state = readButtonState();

  state[action] = {
    time: new Date().toISOString(),
    user: username
  };

  writeButtonState(state);
}

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

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/button-state', (req, res) => {
  clearExpiredActions();
  res.json(readButtonState());
});

app.get('/rain', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';

  logAction(req, 'rain', !blocked);

  if (blocked) {
    return res.send('Viewer cannot control system');
  }

  clearExpiredActions();

  if (isActionActive('rain')) {
    return res.send('Rain is already running 🌧️');
  }

  setActionActive('rain', req.session.user.username, 45);

  console.log('🌧️ Water valve activated');
  res.send('Rain cycle started');
});

app.get('/dose', (req, res) => {
  const blocked = !req.session.user || req.session.user.role ==='viewer';
 
logAction(req, 'dose', !blocked);

  if (blocked) {
     return res.send('Viewer cannot control system');
}

 updateLastPressed('dose', req.session.user.username);

  console.log('🌱 Dosing system activated');
  res.send('Plant food added');
});

app.get('/noise', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';

logAction(req, 'noise', !blocked);

    if (blocked) {
       return res.send('Viewer cannot control system');
}

 updateLastPressed('noise', req.session.user.username);

  console.log('🔊 Speaker activated');
  res.send('Sound started');
});

app.get('/shrimp', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';

logAction(req, 'shrimp', !blocked);

    if (blocked) {
       return res.send('Viewer cannot control system');
}

 updateLastPressed('shrimp', req.session.user.username);

  console.log('🍤 Shrimp feeder activated');
  res.send('Shrimp feeding triggered');
});

app.get('/stop', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';

  logAction(req, 'stop', !blocked);

  if (blocked) {
    return res.send('Viewer cannot control system');
  }

  const state = readButtonState();

  if (state.rain) {
    delete state.rain.activeUntil;
  }

  state.stop = {
    time: new Date().toISOString(),
    user: req.session.user.username
  };

  writeButtonState(state);

  console.log('🛑 Stop everything triggered');
  res.send('All actions stopped');
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://localhost:3000');
});
