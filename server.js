const fs = require('fs');
const session = require('express-session');
const path = require('path');
const express = require('express');
const app = express();
const bcrypt = require('bcrypt');
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
  Tony:  { passwordHash: '$2b$10$b9qLrKuC5NZHmdiBKIjBIOPjxGlwtEqQkknqploNerNSvdf6Xox7S',  role: 'admin' },
  Charlene:   { passwordHash: '$2b$10$OBs/Qon8NhNtc0qy4R7R1.kmzlbrDiamcPLD8HvtwI8CCiJwXOja.',   role: 'user' },
  Demo: { passwordHash: '$2b$10$Dtso74uY2hRXv/NpLvq4gOSHODQco7Ekg2gWoxmPR4r7P85cdTSPG', role: 'viewer' }
};

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const account = USERS[username];

  if (!account) {
    return res.send('Invalid login');
  }

  const match = await bcrypt.compare(password, account.passwordHash);

  if (!match) {
    return res.send('Invalid login');
  }

  req.session.user = {
    username,
    role: account.role
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
if (isEStopActive()) {
  return res.send('E-stop is active. Admin must reset the system.');
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
if (isEStopActive()) {
  return res.send('E-stop is active. Admin must reset the system.');
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
if (isEStopActive()) {
  return res.send('E-stop is active. Admin must reset the system.');
}

  clearExpiredActions();

  if (isActionActive('noise')) {
    return res.send('Noise is already running 🔊');
  }

  setActionActive('noise', req.session.user.username, 45);

  console.log('🔊 Speaker activated');
  res.send('Sound started');
});

app.get('/shrimp', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';

logAction(req, 'shrimp', !blocked);

    if (blocked) {
       return res.send('Viewer cannot control system');
}
if (isEStopActive()) {
  return res.send('E-stop is active. Admin must reset the system.');
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

  if (isEStopActive()) {
    return res.send('E-stop is already active 🛑');
  }

  setEStop(req.session.user.username);

  console.log('🛑 Emergency stop activated');
  res.send('Emergency stop activated');
});

app.get('/reset-stop', (req, res) => {
  if (!req.session.user) {
    return res.send('Not logged in');
  }

  if (req.session.user.role !== 'admin') {
    return res.send('Only admin can reset the E-stop');
  }

  clearEStop(req.session.user.username);

  console.log('✅ Emergency stop reset by admin');
  res.send('Emergency stop reset');
});

function isEStopActive() {
  const state = readButtonState();
  return !!(state.stop && state.stop.active === true);
}

function setEStop(username) {
  const state = readButtonState();

  state.stop = {
    active: true,
    time: new Date().toISOString(),
    user: username
  };

  if (state.rain) {
    delete state.rain.activeUntil;
  }

  if (state.noise) {
    delete state.noise.activeUntil;
  }

  writeButtonState(state);
}

function clearEStop(username) {
  const state = readButtonState();

  state.stop = {
    active: false,
    clearedAt: new Date().toISOString(),
    clearedBy: username
  };

  writeButtonState(state);
}

app.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://localhost:3000');
});
