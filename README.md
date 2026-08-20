# Day Plan

An hour-by-hour day planner that installs on an iPhone home screen. No accounts,
no server, no subscription. Everything is stored on the phone itself.

## What's here

| File | What it does |
|---|---|
| `index.html` | The whole app's markup |
| `styles.css` | Styling, light + dark mode, iOS safe-area handling |
| `app.js` | All the logic — tasks, repeats, ticking off, storage |
| `sw.js` | Service worker, so the app opens with no internet |
| `manifest.webmanifest` | Makes iOS treat it as a real app (no browser bars) |
| `icon-*.png` | Home screen icons |

## How it works

- **Hour-by-hour timeline** from your chosen start hour to end hour (default 6am–11pm).
- **Tap a task** to tick it off. Tap **⋯** to edit or delete it.
- **Tap an empty hour** to add something at that time.
- **Repeats**: `Just today`, `Every day`, `Weekdays`, or pick specific days.
  A repeating task can be skipped for one day only, or deleted from every day.
- **Swipe left/right** (or use ‹ ›) to move between days. Tap the date to jump back to today.
- A red **now line** marks the current time, and the app scrolls there on open.
- The **progress bar** in the header counts what you've ticked off for the day you're looking at.
- **Carry forward**: a button at the bottom of the timeline —
  *"Move 2 unfinished to tomorrow →"* — sweeps whatever you didn't get to.
- **⚙ Settings**: change your day window, collapse hours that have passed,
  auto-carry leftovers, export a backup file, restore from one, or wipe everything.

## How carry-forward decides what to move

- **One-off tasks** are moved outright — the task leaves the old day and lands on the new one.
- **Repeating tasks** are left alone if they already come round again on the target day
  (no point duplicating tomorrow's gym session). If they *don't* — a weekday task left
  unfinished on a Friday, say — a one-off copy is made on the target day.
- The target is **tomorrow**, unless you're looking at a day so old that tomorrow is
  already in the past, in which case it's **today**.
- **Settings → Carry unfinished tasks forward automatically** does the same sweep on
  launch, for one-off tasks left undone in the **last 14 days**. Anything older stays
  where it is, so switching this on doesn't dump months of history onto today.

Ticking off is stored per-date, so yesterday's ticks never bleed into today,
and a repeating task starts from the day you created it (it doesn't retroactively
appear in your history).

## Running it locally on the PC

```bash
python -m http.server 5173 --directory C:/Users/Dell/Desktop/DayPlan
```

Then open http://localhost:5173

## Putting it on the iPhone

The files need to sit on an HTTPS URL. Free options:

**GitHub Pages** (permanent, recommended)
1. Create a repo on github.com, e.g. `dayplan`.
2. Upload every file in this folder to it (drag and drop works on the web).
3. Repo → Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/ (root)`.
4. Wait ~1 minute. Your URL is `https://<your-username>.github.io/dayplan/`

**Surge** (one command, no browser)
```bash
npx surge C:/Users/Dell/Desktop/DayPlan
```
It asks for an email and a password the first time, then gives you a URL.

Then on the iPhone: open the URL in **Safari** (not Chrome) → tap **Share** →
**Add to Home Screen**. It now launches full-screen with its own icon and works
offline.

## Updating it later

Re-upload the changed files **and** bump `CACHE = 'dayplan-v1'` in `sw.js` to
`v2`, `v3`, and so on — otherwise phones keep serving the old cached copy.

## Backups

Data lives in the phone's local storage. Deleting the home-screen app or clearing
Safari's website data erases it. Use **Settings → Export data** now and then; the
JSON file goes to Files and can be restored with **Import data**.
