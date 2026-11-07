# Match Tracker

A personal web app for tracking USPSA and PCSL shooting matches and results.
It's plain HTML, CSS and JavaScript with no build step, so you can open a file, change it, and reload.

## Run it on your laptop

From the folder above `match-tracker`:

```
python -m http.server 8123 --bind 127.0.0.1 --directory match-tracker
```

Then open http://localhost:8123. You need the server because the app uses JavaScript modules. Double-clicking `index.html` won't work.

## Live site

**https://bleclair003.github.io/match-tracker/**. It's hosted free on GitHub Pages from the `main` branch of https://github.com/bleclair003/match-tracker. The repo is public, so anyone can read the code. Match data never goes there; it stays in the browser on each device.

### Publishing an update

Make your changes and test them locally. Then, from this folder:

```
git add -A
git commit -m "Describe the change"
git push
```

GitHub Pages rebuilds in about a minute. The app always checks for the newest files when it has signal, so the update shows up the next time it's opened. If you add a new file the app needs offline, also add it to `SHELL` in `sw.js` and change `VERSION`.

### Installing on an iPhone

1. Open the live site in **Safari**.
2. Tap Share (the square with an arrow), then **Add to Home Screen**, then Add.
3. From then on, open it from the home-screen icon. On iPhone, the home-screen app and the Safari tab keep **separate data**. The home-screen app is also exempt from Safari clearing unused website data, so use only the icon.

The app opens without signal once it has been opened online at least once.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell and the bottom tab bar |
| `css/styles.css` | All styling. Colors are variables at the top, with dark-mode values below them |
| `js/model.js` | What a match looks like, the validation rules, sport/division suggestions, and the backup file format |
| `js/store.js` | Where data is saved. Today that's this browser's `localStorage`; a synced version replaces it later |
| `js/reminders.js` | Decides which reminders are due at a given moment, plus the lead-time options and their defaults |
| `js/sources.js` | The official match-search and club-finder links on the Discover tab, and the date they were last checked |
| `js/stats.js` | Filters by season, sport and division, plus the summary numbers for the Progress tab |
| `js/cloud.js` | Sign-in and synced storage using Firebase (Auth + Firestore with an offline copy on the device) |
| `js/firebase-config.js` | Your Firebase project's web config. `null` means sync is off and data stays in the browser |
| `firestore.rules` | Database security rules: each signed-in person can read and write only their own `users/{uid}` data |
| `firebase.json` | Only used by the local emulators for testing |
| `SETUP-SYNC.md` | Step-by-step Firebase setup |
| `js/app.js` | The screens (Upcoming, Progress, Settings, match detail, forms), the match % chart, and the router |

Common changes:
- **Add a sport:** edit `SPORTS` in `model.js` (currently only USPSA and PCSL, by choice), and add its links to `sources.js`.
- **Add division or class suggestions:** edit `DIVISION_SUGGESTIONS` and `CLASS_SUGGESTIONS` in `model.js`.
- **Change colors:** edit the variables at the top of `styles.css`.
- **Change reminder defaults or choices:** edit `defaultSettings()` and `LEAD_OPTIONS` in `reminders.js`.

## Discover tab

- **Search for matches:** links to official match listings and club finders for USPSA and PCSL, plus PractiScore (where most of their local matches take registration). Only these two organizations are listed, by choice. Nothing is imported automatically: none of these sites offers an API or data feed, and PractiScore and uspsa.org block automated requests.
  - All links were opened by hand on 2026-11-06, except **PractiScore match search**. PractiScore shows a "verify you are human" page to automated checks. Open it once yourself, and if it works, set `checked: true` in `sources.js`.
  - pcsl.org is a soccer league. The shooting league is pcsleague.us, and its site has no match finder.
- **My clubs:** clubs your dad saves himself. Each has its sports, an address, miles from home, a link, notes and a favorite star. Favorites sort first, then by distance.
  - "Show clubs within" hides clubs farther than the chosen radius. Clubs without a distance are always shown.
  - **Distance is typed in, not calculated.** Use the Directions link to check driving miles. Calculating it automatically would need either a ZIP-code location file in the app or an outside address-lookup service. Both are possible later if it's worth it.
  - "Add match" on a club starts a new match with that club's name, address and first sport filled in. In the match form, typing a saved club's name fills in its address when the location is empty.

## Progress tab

- **Next up:** the next two matches not marked Not going.
- **Filters:** season, sport and division. Each list only includes values that have been recorded. The choice is remembered on that device.
- **Stats:** number of matches, average match %, best match %, and penalties per match. When one season is picked, average % and penalties are compared with the season before. The arrow shows the direction; green means better.
- **Chart:** match % by date. Hover, tap or use the arrow keys to see each match. When results from different divisions or sports are mixed, a note suggests filtering to one division. The results list under the chart shows every value.

## Reminders

Reminders show **only inside the app**: at the top of Upcoming, with a count on the Upcoming tab. They're checked when the app opens, every minute while it's open, and when it comes back on screen. Nothing alerts the phone while the app is closed.

| Reminder | Shows for | Default | Window |
|---|---|---|---|
| Registration opens | Matches marked *Interested* | 1 day before | From the lead time until it opens. After that it changes to "Registration is open" until registration closes or he marks it Registered |
| Registration closes | Matches marked *Interested* | 2 days before | From the lead time until it closes. When this one shows, it replaces "Registration is open" |
| Match day | Every match not marked *Not going* | 2 days before | From the lead time until the end of the match's last day |

Missing times: an opening date with no time counts as the start of that day, and a closing date with no time counts as 11:59 PM.

"Dismiss" hides one reminder. If that match's date or time changes later, the reminder comes back. Settings → "Show dismissed reminders again" brings back all dismissed reminders.

**Test clock:** add `?now=` to the address to see what the app shows at any moment, for example
http://localhost:8123/?now=2026-11-10T19:30#upcoming. A yellow banner shows while it's on. Remove it to go back to the real time.

## Data

- Each match is one record, and its result is stored on the same record (`result` is `null` until it's entered).
- Dates are stored as `YYYY-MM-DD` and times as `HH:MM`, in local time.
- **Backups:** Settings → Export backup. This saves a `.json` file with `{ app, version, exportedAt, records, clubs }`. Restore replaces all matches, plus all clubs when the file includes them. Backups made before clubs existed leave saved clubs alone. "Undo last restore" puts back the previous data. Reminder settings aren't part of the backup. They're three dropdowns and quick to set again.

## Sync

- **Off** until `js/firebase-config.js` has a config. While off, data stays in that one browser.
- **On:** the app shows a sign-in screen. Each change is saved on the device first, works offline, and uploads when there's signal. Other signed-in devices update within seconds, and screens redraw by themselves unless you're in the middle of a form.
- Settings shows who's signed in and the sync status: "All changes synced", "Uploading changes…", or offline.
  - **Copy them to my account** moves data saved before sign-in into the account. The old copy is kept on the device as `*.copiedToAccount`.
  - **Sign out** removes this device's offline copy.
- Setup steps: [SETUP-SYNC.md](SETUP-SYNC.md).

### Testing sync locally (emulators)

Needs Java 21 and `firebase-tools`. From this folder, run `firebase emulators:start --only auth,firestore --project demo-match-tracker`. Then open http://localhost:8123/?emulator=1. It signs in to the local emulators, not the real project.

- Test accounts are created in the emulator with its REST API. Their details are kept in `test/emulator-accounts.json`, which git ignores.
- To act as a second device, use http://127.0.0.1:8123/?emulator=1. A different address gets separate browser storage.

## Current limits

- Reminders only show inside the app. There are no phone notifications.
- Distances to clubs are typed in by hand.
