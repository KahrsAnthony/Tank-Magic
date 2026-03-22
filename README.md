# Tank Magic

A self-hosted aquarium control system with a mobile-friendly web UI, role-based access, and real-time system control.

---

## 🚀 Overview

Tank Magic is a custom-built control panel for managing an aquarium system from any device.

This project is designed as both:
- a **real aquarium automation system**
- a **portfolio project demonstrating full-stack development**

---

## 🔥 Features

- 🌧️ Rain system with server-side timer
- 🔊 Sound system (ambient effects)
- 🌱 Plant dosing control
- 🍤 Shrimp feeding control
- 🛑 Stop Everything (global reset)
- 🔐 Role-based authentication (admin / user / viewer)
- 📊 Activity logging system
- 🌐 Multi-device synchronization
- 🔒 Password hashing with bcrypt

---

## 🔐 Authentication System

- Passwords are securely hashed using bcrypt
- No plain-text credentials stored
- Role-based access:

| Role   | Access Level |
|--------|-------------|
| Admin  | Full control |
| User   | Normal control |
| Viewer | Read-only |

![Login UI](./screenshots/login-screen.png)

---

## 🎛️ Control Panel

![Main UI](./screenshots/main-ui.png)

---

## 🌧️ Rain Timer

- Server-controlled 45-minute timer
- Synced across all devices
- Prevents duplicate triggers

![Rain Timer](./screenshots/rain-timer.png)

---

## 📊 Activity Logging

- Tracks all system interactions
- Logs user, action, and timestamp
- Useful for debugging and auditing

![Activity Log](./screenshots/activity-log.png)

---

## 🧠 System Design

- Backend: Node.js + Express
- Frontend: HTML / CSS / JavaScript
- State stored and synced server-side
- Designed to run on a Raspberry Pi for hardware control

---

## ⚙️ How to Run

```bash
git clone https://github.com/KahrsAnthony/Tank-Magic.git
cd Tank-Magic
npm install
node server.js
