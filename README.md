# Tank Magic

Tank Magic is a Raspberry Pi–based aquarium control system designed as a full hardware/software integration project.

Instead of being just a web dashboard, the goal is to become a complete cabinet-mounted control platform that manages aquarium effects, automation, and future physical hardware systems from one place.

---

## Overview

Tank Magic is being built as:

- a real aquarium automation and control system
- a Raspberry Pi deployment project
- a full-stack + hardware integration portfolio project

The current software already provides:

- multi-device control through a web interface
- server-side state synchronization
- role-based authentication
- activity logging
- timed action control
- Raspberry Pi deployment with persistent service behavior

The next phase is focused on turning the software platform into a complete integrated cabinet system with audio, plumbing, valves, dosing, and scheduling.

---

## Current System Status

### Software
- Role-based login system
- Password hashing with bcrypt
- Activity logging
- Shared state across devices
- Rain timer
- Noise timer
- Stop/reset control flow
- Raspberry Pi deployment
- Server-side session storage

## Hardware Progress

Tank Magic is now deployed inside an aquarium cabinet with a focus on safe layout, cable management, and future expansion.

### Raspberry Pi Mounting
![Pi Mounting](./screenshots/pi-mounting.png)

### Cable Routing
![Cable Routing](./screenshots/cable-routing.png)

### Relay Mount Location
![Relay Mount Location](./screenshots/relay-mount-location.png)

### Current Setup Notes
- Raspberry Pi mounted high and away from water exposure
- Power strip mounted with clean cable routing
- Clear separation between electronics and wet components
- Space reserved for relay/control enclosure

---

## System Design Direction

Tank Magic is now being developed as a full aquarium systems integration project with these major subsystems:

- **Control System**  
  Raspberry Pi host, server logic, timers, session handling, remote access, and UI

- **Noise System**  
  Thunder and rain audio playback through a mounted speaker and amplifier system

- **Rain System**  
  Motor valve and plumbing path to deploy an overhead rain effect

- **Dosing System**  
  Multi-bottle weekday recipe dosing with controlled output and scheduling

- **Safety / Reset System**  
  Global stop/reset behavior for active effects and future hardware outputs

---

## Planned Hardware Subsystems

### Noise System
The first planned physical subsystem is the sound system.

Goal:
- play thunder and rain sounds on command
- support timed playback
- support future automatic deployment with the rain effect
- use a permanently mounted speaker inside the cabinet
- avoid Bluetooth sleep/reconnect issues by using a hardwired speaker/amplifier path

### Rain Water System
The rain system is planned as a dedicated physical subsystem using:

- motor valve
- plumbing path
- controlled deployment timing
- integration with sound playback

### Dosing System
The long-term dosing plan is an **8-bottle dosing system** that supports:

- weekday recipes
- scheduled deployment
- recipe-based control
- future expansion for different additive combinations

---

## To-Do

- [ ] Build the **noise system** for thunder and rain sounds
- [ ] Add a timer for **automatic deployment of the rain sound system**
- [ ] Install and wire a **mounted speaker**
- [ ] Build the **motor valve and plumbing** for the rain water system
- [ ] Design and implement an **8-bottle dosing system** with weekday recipes

---

## Current Features

- Raspberry Pi deployment
- Node.js + Express backend
- HTML / CSS / JavaScript frontend
- Role-based authentication
- Password hashing
- Server-side state tracking
- Multi-device sync
- Activity logging
- Cabinet-mounted control hardware layout in progress

---

## Screenshots

### Login
![Login UI](./screenshots/login-screen.png)

### Main Control Panel
![Main UI](./screenshots/main-ui.png)

### Rain Timer
![Rain Timer](./screenshots/rain-timer.png)

### Activity Log
![Activity Log](./screenshots/activity-log.png)

### Hardware Progress
![Cabinet Hardware Progress](./screenshots/cabinet-hardware.jpg)

---

## Tech Stack

- Raspberry Pi
- Node.js
- Express
- HTML / CSS / JavaScript
- bcrypt
- session-file-store
- systemd
- Tailscale

---

## How to Run

```bash
git clone https://github.com/KahrsAnthony/Tank-Magic.git
cd Tank-Magic
npm install
node server.js
