---
tags: [match-tracker, home]
updated: 2026-11-21
---

# Match Tracker — vault home

A free web app for tracking shooting matches (USPSA and PCSL) and results. **Live:** https://bleclair003.github.io/match-tracker/ · **Repo:** github.com/bleclair003/match-tracker

> [!warning] This repository is public
> Everything committed here, including these notes, is publicly readable on GitHub and on the live site. Keep personal details (addresses, names, account emails, passwords) out of notes in this vault.

This folder is both the git repository and the Obsidian vault. Notes and code live side by side; code files show in the file explorer and open in your editor.

## Notes

| Note | What it covers |
|---|---|
| [[README]] | How to run it, publish updates, install on iPhone; files; Discover, Progress, Reminders, Data, Sync |
| [[SETUP-SYNC]] | Step-by-step Firebase sync setup |

## Code map

| File | What it does |
|---|---|
| `index.html` | Page shell and the bottom tab bar |
| `css/styles.css` | All styling; colour variables at the top |
| `js/app.js` | Screens, chart and router |
| `js/model.js` | Match records, validation, sports and divisions, backup format |
| `js/store.js` | Where data is saved (browser storage, or synced) |
| `js/cloud.js` | Sign-in and sync (Firebase Auth + Firestore) |
| `js/firebase-config.js` | Firebase web config (public by design; rules protect the data) |
| `js/reminders.js` | Which in-app reminders are due |
| `js/discover.js` | Discover tabs, followed clubs, new listings |
| `js/sources.js` | Official match-search and club-finder links |
| `js/stats.js` | Progress filters and summary numbers |
| `sw.js` | Offline support (update `VERSION` and `SHELL` when adding files) |
| `firestore.rules` | Each signed-in person reads and writes only their own data |

## Everyday commands

```powershell
python -m http.server 8123 --bind 127.0.0.1 --directory match-tracker   # run from the Codex folder
```

Publish: commit and push to `main`; GitHub Pages updates in about a minute.
