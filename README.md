# ⏱️ WorkDay Tracker

A beautiful, zero-dependency browser app to track your **8-hour workday** — clock in, log breaks, monitor progress, and review your full work history. All data is stored **locally in your browser** with no account or server required.

![WorkDay Tracker](https://img.shields.io/badge/WorkDay-Tracker-a78bfa?style=for-the-badge&logo=clock&logoColor=white)
![HTML](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

---

## 🌟 Features

### ⏰ Core Tracking
- **One-click Clock In** — starts your workday timer instantly
- **Custom Arrival Time** — forgot to clock in? Set the time manually
- **Live circular progress ring** — shows worked time vs your daily goal
- **Estimated finish time** — dynamically updates based on breaks taken
- **Overtime tracking** — red ring indicator if you go past your goal

### ☕ Break Management
- **Lunch Break** — dedicated button, duration excluded from work time
- **Custom Breaks** — name your break (Coffee, Prayer, Doctor, etc.)
- **One-click End Break** — resumes work timer instantly
- **Edit past breaks** — fix the start/end time if you forgot to stop the timer
- **Delete break entries** — accidentally started a break? Remove it and the time is restored

### 📊 Stats & History
- Live cards: **Arrived**, **Total Breaks**, **Remaining**, **Est. Finish**
- Full **Today's Timeline** with every event timestamped
- **End-of-day summary** — worked time, break time, vs goal
- **Copy Report** — paste a text summary anywhere (email, Slack, etc.)
- **History Tab** — all past days stored and browsable
  - Summary bar: total days, total hours worked, daily average, goal achievement count
  - Per-day detail view with full timeline
  - Delete individual day records or clear all history

### 🔔 Smart Alerts
- Milestone toasts at **50%**, **87.5%** (1 hour left), and **100%** (goal reached)
- Optional **browser notifications**
- Optional **sound alerts** (subtle tones)

### 💾 Persistent Storage
- All data stored in **`localStorage`** — survives browser close and restarts
- Today's session is **automatically restored** when you reopen the tab or browser
- Completed days are **auto-archived** to history when you end your day
- Stale sessions from previous days are automatically archived on next open

### 🎨 UI / UX
- Dark mode by default with a **Light/Dark mode toggle**
- Animated **glassmorphism** cards and glowing background orbs
- Fully **responsive** — works on desktop, tablet, and mobile
- No frameworks, no dependencies — pure HTML, CSS, JavaScript

---

## 📁 Project Structure

```
workday-tracker/
├── index.html   # App structure, all screens & modals
├── style.css    # Premium dark UI, animations, responsive layout
├── app.js       # All tracking logic, storage, history, break editing
└── README.md    # This file
```

---

## 🚀 Getting Started

### Option 1 — Open directly (no server needed)
Just open `index.html` in your browser. Google Fonts will load from CDN.

### Option 2 — Local server
```bash
# Python
python3 -m http.server 5173

# Node.js (npx)
npx serve .
```
Then open http://localhost:5173

### Option 3 — Deploy to Vercel
```bash
npm i -g vercel
vercel --prod
```
Or connect this repo on [vercel.com](https://vercel.com) → **Import Project** → deploy in 30 seconds.

---

## 🖥️ How to Use

| Step | Action |
|------|--------|
| 1 | Click **"Clock In Now"** when you arrive, or set a custom arrival time |
| 2 | Use **Lunch Break** or **Take Break** buttons to pause your timer |
| 3 | Click the button again to **End Break** and resume work |
| 4 | Watch the **ring fill up** as you approach your 8-hour goal |
| 5 | Click **End Day** when you leave — your day is saved to History |
| 6 | Visit the **History tab** to browse all past days |

### Editing a Break
If you accidentally started a break or forgot to end it:
1. Find the break entry in **Today's Timeline**
2. Click the **✏️ Edit** button on it
3. Adjust the start/end time or reason, then **Save Changes**
4. Or click **Remove Entry** to delete it (time is restored to work time)

---

## ⚙️ Settings

Open **Settings** (⚙️ icon in the header) to configure:

| Setting | Description |
|---------|-------------|
| Daily target | Change from default 8 hours to any value (e.g. 7.5h, 9h) |
| Your name | Personalizes the greeting and end-of-day message |
| Browser notifications | Get OS-level alerts at milestones |
| Sound alerts | Subtle tones at 50%, 87.5%, and 100% completion |

---

## 💾 Data & Privacy

> **All data stays on your device.** Nothing is sent to any server.

- Data is stored in **`localStorage`** — tied to your browser on your device
- Clearing browser data / site data will erase your history
- Each person who opens the app on their own device gets **completely separate data**
- If you use it on both your PC and phone, the data is **not synced** between them

### localStorage Keys

| Key | Contents |
|-----|----------|
| `wdt_state` | Today's active session |
| `wdt_history` | Array of all completed days (up to 90 days) |
| `wdt_settings` | Your preferences |
| `wdt_theme` | Light or dark mode preference |

---

## 📱 Responsive Design

| Screen | Layout |
|--------|--------|
| Desktop (> 680px) | Side-by-side ring + stats grid |
| Tablet (420–680px) | Stacked ring, 2-column action bar |
| Mobile (< 420px) | Compact ring, single-column layout |

---

## 🛠️ Tech Stack

| Technology | Usage |
|-----------|-------|
| HTML5 | Structure, semantic elements |
| Vanilla CSS | Glassmorphism UI, animations, responsive layout |
| Vanilla JavaScript | All logic — no frameworks or libraries |
| Google Fonts | Inter (UI) + JetBrains Mono (times/numbers) |
| Web Storage API | localStorage for persistence |
| Web Audio API | Sound milestone alerts |
| Notifications API | Optional OS-level push notifications |

---

## 🤝 Contributing

Pull requests are welcome! To contribute:

```bash
git clone https://github.com/AkshKansagara/workday-tracker.git
cd workday-tracker
# Open index.html in your browser — no build step needed
```

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

Made with ❤️ to fix the broken office portal timer
