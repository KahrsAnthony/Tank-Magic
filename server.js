
// ---- Imports ----

const { spawn } = require('child_process');
let noiseProcess = null;

const SCHEDULED_STORM_HOUR = 20;
const SCHEDULED_STORM_MINUTE = 0;

let lastScheduledStormRun = null;

const fs = require('fs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const express = require('express');
const app = express();
const bcrypt = require('bcrypt');

// ---- Test Log Storage ----

const DATA_DIR = path.join(__dirname, 'data');
const TEST_LOGS_FILE = path.join(DATA_DIR, 'test-logs.json');

function ensureTestLogsFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(TEST_LOGS_FILE)) {
    fs.writeFileSync(TEST_LOGS_FILE, '[]', 'utf8');
  }
}

function readTestLogs() {
  try {
    ensureTestLogsFile();
    return JSON.parse(fs.readFileSync(TEST_LOGS_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read test logs:', err.message);
    return [];
  }
}

function writeTestLogs(logs) {
  try {
    ensureTestLogsFile();
    fs.writeFileSync(TEST_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write test logs:', err.message);
  }
}

ensureTestLogsFile();

// ---- GPIO / Tank Controls ----

let fogPin = null;
let rainPin = null;
let waterLevelPin = null;
let lightningPin = null;
let lightningTimer = null;
let rainPlayer = null;
let thunderTimers = [];

let gpioStatus = {
  fog: false,
  rain: false,
  water: false
};

let Gpio = null;

try {
  ({ Gpio } = require('pigpio'));
  console.log('pigpio loaded');
} catch (err) {
  console.error('pigpio load failed:', err.message);
}

try {
  lightningPin = new Gpio(23, { mode: Gpio.OUTPUT });
  lightningPin.digitalWrite(1); // default OFF for active-low relay
  console.log('lightningPin initialized on GPIO23');
} catch (err) {
  console.error('lightningPin init failed:', err.message);
}

if (Gpio) {
  try {
    fogPin = new Gpio(17, { mode: Gpio.OUTPUT });
    gpioStatus.fog = true;
    console.log('fogPin initialized (GPIO17)');
  } catch (err) {
    console.error('fogPin init failed:', err.message);
  }

  try {
    rainPin = new Gpio(27, { mode: Gpio.OUTPUT });
    gpioStatus.rain = true;
    console.log('rainPin initialized (GPIO27)');
  } catch (err) {
    console.error('rainPin init failed:', err.message);
  }

  try {
waterLevelPin = new Gpio(22, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP
});

gpioStatus.water = !!waterLevelPin.digitalRead();
console.log('waterLevelPin initialized (GPIO22)');
console.log('Initial water level raw state:', gpioStatus.water);
  } catch (err) {
    console.error('waterLevelPin init failed:', err.message);
  }
}

function setFog(on) {
  try {
    if (fogPin) {
      fogPin.digitalWrite(on ? 0 : 1); // active-low relay
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
      rainPin.digitalWrite(on ? 0 : 1); // active-low relay
      console.log(on ? 'RAIN ON' : 'RAIN OFF');
    } else {
      console.log(on ? 'RAIN ON (simulated)' : 'RAIN OFF (simulated)');
    }
  } catch (err) {
    console.log('Rain write failed:', err.message);
  }
}

function getWaterLevelStatus() {
  if (!waterLevelPin) return 'GPIO OFFLINE';

  try {
    const value = waterLevelPin.digitalRead();
    return value === 1 ? 'OKAY' : 'LOW';
  } catch (err) {
    console.log('Error reading water level pin:', err.message);
    return 'READ ERROR';
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

// ----Lightning

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function flashLightning(pattern = [60, 40, 100, 30]) {
  if (!lightningPin) {
    console.log('⚡ flashLightning skipped: lightningPin not initialized');
    return;
  }

  console.log('⚡ FLASH pattern:', pattern);

  for (const duration of pattern) {
    console.log(`⚡ ON for ${duration}ms`);
    lightningPin.digitalWrite(0); // ON for active-low relay
    await sleep(duration);

    console.log('⚡ OFF');
    lightningPin.digitalWrite(1); // OFF
    await sleep(40 + Math.floor(Math.random() * 120));
  }
   scheduleThunder();
}

function scheduleLightning() {
  if (lightningTimer) {
    clearTimeout(lightningTimer);
    lightningTimer = null;
  }

  if (worldState !== 'storm') {
    console.log(`⚡ scheduleLightning aborted: worldState=${worldState}`);
    return;
  }

  const delay = 2000 + Math.floor(Math.random() * 6000);
  console.log(`⚡ Next lightning strike in ${delay}ms`);

  lightningTimer = setTimeout(async () => {
    if (worldState !== 'storm') {
      console.log(`⚡ Lightning cancelled before flash: worldState=${worldState}`);
      return;
    }

    const patterns = [
      [50, 35, 90],
      [80, 50],
      [40, 30, 60, 25],
      [120],
      [30, 20, 30, 20, 80]
    ];

    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    await flashLightning(pattern);
    scheduleLightning();
  }, delay);
}

function stopLightning() {
  if (lightningTimer) {
    clearTimeout(lightningTimer);
    lightningTimer = null;
  }

  if (lightningPin) {
    lightningPin.digitalWrite(1);
  }

  console.log('⚡ Lightning stopped');
}

// ----Thunder Sounds

function soundPath(file) {
  return path.join(__dirname, 'sounds', file);
}

function startRainAmbience() {
  if (rainPlayer) return;

  rainPlayer = spawn('mpg123', ['-q', '-f', '30000', '--loop', '-1', soundPath('rain-loop.mp3')], {
     stdio: 'ignore'
  });

  rainPlayer.on('exit', () => {
    rainPlayer = null;
  });

  console.log('🌧️ Rain ambience started');
}

function stopRainAmbience() {
  if (!rainPlayer) return;

  rainPlayer.kill('SIGTERM');
  rainPlayer = null;
  console.log('🌧️ Rain ambience stopped');
}

function playThunder() {
  const thunderFiles = [
    'thunder1.mp3',
    'thunder2.mp3',
    'thunder3.mp3',
    'thunder-roll1.mp3',
    'thunder-roll2.mp3'
  ];

  const file = thunderFiles[Math.floor(Math.random() * thunderFiles.length)];

  const child = spawn('mpg123', ['-q', soundPath(file)], {
    stdio: 'ignore'
  });

  child.on('exit', () => {
    console.log(`🔊 Thunder finished: ${file}`);
  });

  console.log(`🔊 Thunder started: ${file}`);
}

function scheduleThunder() {
  const delay = 500 + Math.floor(Math.random() * 2500);

  console.log(`🔊 Thunder scheduled in ${delay}ms`);

  const timer = setTimeout(() => {
    thunderTimers = thunderTimers.filter(t => t !== timer);

    if (worldState === 'storm') {
      playThunder();
    }
  }, delay);

  thunderTimers.push(timer);
}

function clearThunderTimers() {
  thunderTimers.forEach(clearTimeout);
  thunderTimers = [];
}

// ----STORM MODE
function startStormMode() {
  if (worldState === 'storm') {
    return { ok: false, message: 'Storm already running ⛈️' };
  }

  setWorldState('storm');

  startDrizzle();
  startRain();
  scheduleLightning();
  startRainAmbience();

  console.log('Storm Mode -> ON');

  return { ok: true, message: 'Storm Mode started ⛈️' };
}

function stopStormMode() {
  stopLightning();
  stopRainAmbience();
  clearThunderTimers();
  stopRain();
  stopDrizzle();
  setWorldState('clear');

  console.log('Storm Mode -> OFF');

  return { ok: true, message: 'Storm Mode stopped 🌤️' };
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

function stopStormMode() {
  stopLightning();
  stopRainAmbience();
  clearThunderTimers();
  stopRain();
  stopDrizzle();
  setWorldState('clear');

  console.log('Storm Mode -> OFF');

  return { ok: true, message: 'Storm Mode stopped 🌤️' };
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
  if (worldState !== 'storm') {
    worldState = 'drizzle';
  }
  console.log('Drizzle started');
}

function stopDrizzle() {
  worldState = 'clear';
  setFog(false);
  console.log('Drizzle stopped');
}

function checkScheduledStorm() {
  const now = new Date();

  const runKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

  if (
    now.getHours() === SCHEDULED_NOISE_HOUR &&
    now.getMinutes() === SCHEDULED_NOISE_MINUTE &&
    lastScheduledNoiseRun !== runKey
  ) {
    const result = startStormMode();

    if (result.ok) {
      logSystemAction('storm', true);
      updateLastPressed('storm', 'system');
      setActionActive('storm', 'system', 10);
      lastScheduledNoiseRun = runKey;
      console.log('⏰ Scheduled storm started');
    } else {
      console.log(`⏰ Scheduled storm skipped: ${result.message}`);
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

app.get('/api/tank-status', (req, res) => {
  let raw = null;
  let waterLevel = 'GPIO OFFLINE';

  try {
    if (waterLevelPin) {
      raw = waterLevelPin.digitalRead();
      waterLevel = raw === 1 ? 'OKAY' : 'LOW';
    }
  } catch (err) {
    waterLevel = 'READ ERROR';
  }

  res.json({
    waterLevel,
    waterRaw: raw,
    temperature: null,
    gpioStatus
  });
});

app.get("/api/test-logs", (req, res) => {
  const logs = readTestLogs().sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  res.json(logs);
});

app.post("/api/test-logs", express.json(), (req, res) => {
  try {
    const {
      ph,
      highRangePh,
      ammonia,
      nitrite,
      nitrate,
      ppm,
      kh,
      gh,
      notes = ""
    } = req.body;

    const newLog = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),

temperatureF: null,
waterLevel: getWaterLevelStatus(),

      ph: ph ?? null,
      highRangePh: highRangePh ?? null,
      ammonia: ammonia ?? null,
      nitrite: nitrite ?? null,
      nitrate: nitrate ?? null,
      ppm: ppm ?? null,
      kh: kh ?? null,
      gh: gh ?? null,
      notes: String(notes).trim()
    };

    const logs = readTestLogs();
    logs.push(newLog);
    writeTestLogs(logs);

    res.json({ success: true, log: newLog });
  } catch (error) {
    console.error("Failed to save test log:", error);
    res.status(500).json({ success: false, error: "Failed to save test log" });
  }
});

app.delete('/api/test-logs/:id', (req, res) => {
  try {
    const logId = req.params.id;

    if (!fs.existsSync(TEST_LOGS_FILE)) {
      return res.status(404).json({ error: 'Log file not found' });
    }

    const raw = fs.readFileSync(TEST_LOGS_FILE, 'utf8');
    const logs = raw ? JSON.parse(raw) : [];

    const updatedLogs = logs.filter(log => String(log.id) !== String(logId));

    if (updatedLogs.length === logs.length) {
      return res.status(404).json({ error: 'Log not found' });
    }

    fs.writeFileSync(TEST_LOGS_FILE, JSON.stringify(updatedLogs, null, 2));
    res.json({ success: true, message: 'Log deleted' });
  } catch (err) {
    console.error('Failed to delete log:', err);
    res.status(500).json({ error: 'Failed to delete log' });
  }
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

app.get('/storm', (req, res) => {
  const blocked = !req.session.user || req.session.user.role === 'viewer';
  logAction(req, 'storm', !blocked);

  if (blocked) {
    return res.send('Viewer cannot control system');
  }

  if (isEStopActive()) {
    return res.send('E-stop is active. Admin must reset the system.');
  }

  updateLastPressed('storm', req.session.user.username);

  if (worldState === 'storm') {
    const result = stopStormMode();
    return res.send(result.message);
  }

  setMomentaryActive('storm', req.session.user.username, 45);

  const result = startStormMode();

  console.log('🌧️ Storm rolling in 🌧️');
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
// ----TIME

setInterval(() => {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const todayKey = now.toDateString();

  if (
    currentHour === SCHEDULED_STORM_HOUR &&
    currentMinute === SCHEDULED_STORM_MINUTE &&
    lastScheduledStormRun !== todayKey
  ) {
    if (isEStopActive()) {
      console.log('Scheduled storm skipped: E-stop active');
      return;
    }

    const result = startStormMode();
    console.log(`Scheduled storm check -> ${result.message}`);

    if (result.ok) {
      lastScheduledStormRun = todayKey;
    }
  }
}, 20000);

app.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://localhost:3000');
});
