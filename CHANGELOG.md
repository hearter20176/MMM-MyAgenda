# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `package.json`: repository, homepage, bugs, license and keywords fields.
- README: Update section and trailing commas in the config examples.
- Node built-ins are imported with the `node:` scheme (for example `node:https`).
- ESLint (flat config) with an `npm run lint` script.
- Added CHANGELOG, CODE_OF_CONDUCT and a Dependabot configuration.

## [1.1.0]

Released before this changelog was started. Commit history, newest first:

### 2026-10-03

- README: current screenshot and documentation review

### 2026-09-29

- Show fetch errors, honour EXDATE and overrides, fit rows to the card, stop tracking private ICS

### 2026-09-25

- Add maxEvents with a "+N more" line
- Retry ICS fetches and fall back to the last good copy
- Add maxWidth option so two agendas can share the top row
- Fix calendars not loading: send User-Agent; isolate instances; add excludeText

### 2025-12-11

- modified:   MMM-MyAgenda.css 	modified:   MMM-MyAgenda.js
- modified:   MMM-MyAgenda.css 	modified:   MMM-MyAgenda.js
- modified:   MMM-MyAgenda.css
- modified:   MMM-MyAgenda.css
- modified:   MMM-MyAgenda.js 	modified:   node_helper.js
- modified:   MMM-MyAgenda.js
- modified:   MMM-MyAgenda.js
- modified:   MMM-MyAgenda.js 	modified:   node_helper.js
- modified:   MMM-MyAgenda.js
- modified:   MMM-MyAgenda.js
- modified:   MMM-MyAgenda.js

### 2025-11-23

- deleted:    MMM-MyAgenda.code-workspace 	deleted:    docs/MMM-MyAgenda.css.txt 	deleted:    docs/MMM-MyAgenda.js.txt 	deleted:    docs/node_helper.js.txt
- Handle calendar payload shape and legacy day config
- Enhance loading state and glass styling

### 2025-11-17

- modified:   MMM-MyAgenda.css
- modified:   MMM-MyAgenda.css 	modified:   MMM-MyAgenda.js
- modified:   MMM-MyAgenda.css
- modified:   MMM-MyAgenda.css 	modified:   MMM-MyAgenda.js 	modified:   node_helper.js 	modified:   package-lock.json 	modified:   package.json
- modified:   MMM-MyAgenda.js

### 2025-11-16

- modified:   MMM-MyAgenda.css 	modified:   MMM-MyAgenda.js 	modified:   node_helper.js

### 2025-11-13

- Add title wrapping, icon mapping, and color coding
- modified:   MMM-MyAgenda.css 	modified:   MMM-MyAgenda.js 	modified:   README.md 	new file:   docs/myagenda_day.png 	new file:   docs/myagenda_night.png 	modified:   node_helper.js

### 2025-11-12

- modified:   MMM-MyAgenda.css 	modified:   MMM-MyAgenda.js 	modified:   README.md
- new file:   MMM-MyAgenda.css 	new file:   MMM-MyAgenda.js 	modified:   README.md 	new file:   node_helper.js 	new file:   package-lock.json 	new file:   package.json
- Initial commit
