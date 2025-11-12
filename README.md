# MMM-MyAgenda

Standalone MagicMirror module that renders a multi-day agenda with an **iOS liquid glass** theme, color-coded calendars and custom icons.

## ✅ Features

- Accepts events from MagicMirror core `calendar` module (`CALENDAR_EVENTS`) or fetches `.ics` feeds directly via node helper.
- Color coding per calendar (via `calendarColors` or ICS `color`).
- Custom icons per calendar or per event (`iconMapping`, or event `icon` property).
- Mini-month overview plus per-day agenda.
- Liquid glass frosted UI theme, responsive.
- Event transformer hook for custom logic.
-Uses ical to parse .ics feeds robustly (including RRULEs, EXDATEs, and timezone handling).
-Expands recurring events within a rolling 3-month window (1 month before, 2 months after today).
-Skips duplicates and exceptions.
-Logs cleanly to MagicMirror’s console.
-Sends notifications to the front-end for rendering.

## Installation

1. Place the folder `MMM-MyAgenda` into your MagicMirror `modules` directory.
2. Restart MagicMirror.
3. Add configuration to `config.js` (example below).

## Example Config

```js
{
  module: "MMM-MyAgenda",
  position: "top_right",
  header: "Agenda",
  config: {
    useCalendarModule: true,          // true to receive CALENDAR_EVENTS from the core calendar module
    calendarFilter: ["Family","Colton Homework"],
    startDayIndex: 0,
    endDayIndex: 4,
    showMiniMonthCalendar: true,
    fontSize: "15px",
    useIconify: false,
    iconMapping: {
      "Family": "mdi:home",
      "Colton Homework": "mdi:book"
    },
    calendarColors: {
      "Family": "#0b8043",
      "Colton Homework": "#ffd101"
    }
  }
}
```

## 🧭 Validation & Testing

To test:

Run ```npm install``` in your module directory.

Start MagicMirror and watch logs via:

```npm start dev```

You should see lines like:

``[MMM-MyAgenda Helper] Registered calendar: Family, update every 30 min
[MMM-MyAgenda Helper] Registered calendar: Colton Homework, update every 30 min```


Events with recurrence (RRULE) should now properly appear for each occurrence within the visible date window.

✅ Summary of Upgrade

| Feature                      | Before               | Now                   |
| ---------------------------- | -------------------- | --------------------- |
| ICS parsing                  | manual string parser | robust `ical` library |
| Recurrence support           | ❌ none               | ✅ full RRULE, EXDATE  |
| Configurable fetch intervals | ✅                    | ✅                     |
| Timezone handling            | partial              | ✅ (ical built-in)     |
| Reliability                  | good                 | **production-grade**  |
