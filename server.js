
// ---- Imports ----

const { spawn } = require('child_process');
let noiseProcess = null;

const SCHEDULED_NOISE_HOUR = 20;
const SCHEDULED_NOISE_MINUTE = 0;
let lastScheduledNoiseRun = null;

const fs = require('fs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const express = require('express');
const app = express();
const bcrypt = require('bcrypt');

// ---- GPIO / Tank Controls ----

let fogPin = null;
let rainPin = null;

try {
  const { Gpio } = require('onoff');

  fogPin = new Gpio(17, 'out');
  rainPin = new Gpio(27, 'out');

  console.log('GPIO fogPin initialized (GPIO17)');
  console.log('GPIO rainPin initialized (GPIO27)');

} catch (err) {
  console.log('GPIO unavailable, using no-op fallback:', err.message);
}

function setFog(on) {
  try {
    if (fogPin) {
      fogPin.writeSync(on ? 0 : 1);
      console.log(on ? 'FOG ON' : 'FOG OFF');
    } else {
      console.log(on ? 'FOG ON (simulated)' : 'FOG OFF (simulated)');
    }
  } catch (err) {
    console.log('Fog write failed:', err.message);
  }
}

function setRain(on) {
  try {
    if (rainPin) {
      rainPin.writeSync(on ? 0 : 1); // active LOW relay
      console.log(on ? 'RAIN ON' : 'RAIN OFF');
    } else {
      console.log(on ? 'RAIN ON (simulated)' : 'RAIN OFF (simulated)');
    }
  } catch (err) {
    console.log('Rain write failed:', err.message);
  }
}

// ---- Weather State ----

let drizzleActive = false;
let rainActive = false;
let worldState = 'clear'; // clear | drizzle | storm
let drizzleTimeout = null;

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function clearDrizzleTimeout() {
  if (drizzleTimeout) {
    clearTimeout(drizzleTimeout);
    drizzleTimeout = null;
  }
}

function setWorldState(newState) {
  worldState = newState;
  console.log(`World state -> ${worldState}`);
}

function runDrizzleCycle() {
  if (!drizzleActive) return;

  const fogOnTime = randomBetween(7000, 14000);
  const fogOffTime = randomBetween(5000, 12000);

  setFog(true);
  console.log(`Drizzle fog ON for ${fogOnTime}ms`);

  drizzleTimeout = setTimeout(() => {
    setFog(false);
    console.log(`Drizzle fog OFF for ${fogOffTime}ms`);

    drizzleTimeout = setTimeout(() => {
      runDrizzleCycle();
    }, fogOffTime);
  }, fogOnTime);
}

// ---Drizzle
function startDrizzle() {
  if (drizzleActive) {
    return { ok: false, message: 'Drizzle already running 🌫️' };
  }

  clearDrizzleTimeout();
  drizzleActive = true;
  console.log('Drizzle effect -> ON');
  runDrizzleCycle();

  return { ok: true, message: 'Drizzle started 🌫️' };
}

function stopDrizzle() {
  clearDrizzleTimeout();
  drizzleActive = false;
  setFog(false);
  console.log('Drizzle effect -> OFF');

  return { ok: true, message: 'Drizzle stopped' };
}

// --- Rain
function startRain() {
  if (rainActive) {
    return { ok: false, message: 'Rain already running' };
  }

  rainActive = true;
  setRain(true);
  console.log('Rain effect -> ON');

  return { ok: true, message: 'Rain started 🌧️' };
}

function stopRain() {
  if (!rainActive) {
    return { ok: false, message: 'Rain already stopped' };
  }

  rainActive = false;
  setRain(false);
  console.log('Rain effect -> OFF');

  return { ok: true, message: 'Rain stopped' };
}

// ----STORM
function startStormMode() {
  if (worldState === 'storm') {
    return { ok: false, message: 'Storm already running ⛈️' };
  }

  setWorldState('storm');

  startDrizzle();
  startRain();
  startNoise('system');

  console.log('Storm Mode -> ON');

  return { ok: true, message: 'Storm Mode started ⛈️' };
}

function stopStormMode() {
  stopDrizzle();
  stopRain();
  stopNoiseSafely();

  setWorldState('clear');

  console.log('Storm Mode -> OFF');

  return { ok: true, message: 'Storm Mode stopped' };
}

// ---- somehting ----

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  store: new FileStore({
    path: './sessions',
    retries: 0,
    ttl: 60 * 60 * 4
  }),
  secret: 'tank-magic-secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 4
  }
}));

process.on('SIGTERM', () => { try { setFog(false); } catch {} try { fogPin.unexport(); } catch {} process.exit(0); });
process.on('SIGINT',  () => { try { setFog(false); } catch {} try { fogPin.unexport(); } catch {} process.exit(0); });

const PORT = 3000;
const STATE_FILE = 'button-state.json';

setInterval(() => {
  if (worldState === 'drizzle') {
    console.log('World state is drizzle, triggering fog');
    setFog(true);

    setTimeout(() => {
      setFog(false);
      console.log('Fog OFF after drizzle pulse');
    }, 10000);
  }
}, 30000);

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

function setMomentaryActive(action, username, seconds) {
  const state = readButtonState();
  const now = new Date();
  const activeUntil = new Date(now.getTime() + seconds * 1000);

  state[action] = {
    time: now.toISOString(),
    user: username,
    activeUntil: activeUntil.toISOString()
  };

  writeButtonState(state);
}

function startNoise(username = 'system') {
  clearExpiredActions();

  if (isActionActive('noise')) {
    return { ok: false, message: 'Noise already running 🔊' };
  }

  if (noiseProcess) {
    return { ok: false, message: 'Noise already running 🔊' };
  }

  noiseProcess = spawn('aplay', ['/home/pi/Tank-Magic/sounds/rain.wav']);

  noiseProcess.on('exit', () => {
    noiseProcess = null;
  });

  setActionActive('noise', username, 45);

  console.log('🔊 Speaker activated');
  return { ok: true, message: 'Thunderstorm started 🌧️' };
}

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function setWorldState(newState) {
  worldState = newState;
  console.log(`World state -> ${worldState}`);
}

function logSystemAction(action, allowed = true) {
  const entry = {
    time: new Date().toISOString(),
    user: 'system',
    role: 'scheduler',
    action,
    allowed
  };

  fs.appendFileSync('activity.log', JSON.stringify(entry) + '\n');
}

function runDrizzleCycle() {
  if (!drizzleActive) return;

  const fogOnTime = randomBetween(7000, 14000);   // 7–14 sec on
  const fogOffTime = randomBetween(5000, 12000);  // 5–12 sec off

  setFog(true);
  console.log(`Drizzle fog ON for ${fogOnTime}ms`);

  drizzleTimeout = setTimeout(() => {
    setFog(false);
    console.log(`Drizzle fog OFF for ${fogOffTime}ms`);

    drizzleTimeout = setTimeout(() => {
      runDrizzleCycle();
    }, fogOffTime);
  }, fogOnTime);
}

function startDrizzle() {
  worldState = 'drizzle';
  console.log('Drizzle started');
}

function stopDrizzle() {
  worldState = 'clear';
  setFog(false);
  console.log('Drizzle stopped');
}

function checkScheduledNoise() {
  const now = new Date();

  const runKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

  if (
    now.getHours() === SCHEDULED_NOISE_HOUR &&
    now.getMinutes() === SCHEDULED_NOISE_MINUTE &&
    lastScheduledNoiseRun !== runKey
  ) {
    const result = startNoise('system');

    if (result.ok) {
      logSystemAction('noise', true);
      lastScheduledNoiseRun = runKey;
      console.log('⏰ Scheduled noise started');
    } else {
      console.log(`⏰ Scheduled noise skipped: ${result.message}`);
    }
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

// ---- Routes ----

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

app.get('/drizzle', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';
  logAction(req, 'drizzle', !blocked);

  if (blocked) {
    return res.send('Viewer cannot control system');
  }

  if (isEStopActive()) {
    return res.send('E-stop is active. Admin must reset the system.');
  }

  const result =
    worldState === 'drizzle'
      ? stopDrizzle()
      : startDrizzle();

  return res.send(result.message);
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

app.get('/storm', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';
  logAction(req, 'storm', !blocked);

  if (blocked) {
    return res.send('Viewer cannot control system');
  }

  if (isEStopActive()) {
    return res.send('E-stop is active. Admin must reset the system.');
  }

  const result =
    worldState === 'storm'
      ? stopStormMode()
      : startStormMode();

  return res.send(result.message);
});

app.get('/dose', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';
  logAction(req, 'dose', !blocked);

  if (blocked) {
    return res.send('Viewer cannot control system');
  }

  updateLastPressed('dose', req.session.user.username);
  setMomentaryActive('dose', req.session.user.username, 10);

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

  const result = startNoise(req.session.user.username);
  return res.send(result.message);
});

app.get('/shrimp', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';
  logAction(req, 'shrimp', !blocked);

  if (blocked) {
    return res.send('Viewer cannot control system');
  }

  updateLastPressed('shrimp', req.session.user.username);
  setMomentaryActive('shrimp', req.session.user.username, 10);

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

if (noiseProcess) {
  noiseProcess.kill('SIGTERM');
  noiseProcess = null;
}

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

app.get('/api/world-state', (req, res) => {
  res.json({ worldState });
});

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

setInterval(checkScheduledNoise, 30000);

app.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://localhost:3000');
});
