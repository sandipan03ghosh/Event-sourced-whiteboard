# Event-Sourced Collaborative Canvas

Real-time multiplayer whiteboard where every stroke, undo, and clear is an immutable event, not a mutation to some shared canvas state. That's not an implementation detail — it's what makes the history scrubber below possible, and what makes concurrent edits from multiple users reconcile correctly instead of racing.

[![Server tests](https://github.com/sandipan03ghosh/Event-sourced-whiteboard/actions/workflows/test.yml/badge.svg)](https://github.com/sandipan03ghosh/Event-sourced-whiteboard/actions/workflows/test.yml)

## Why event sourcing, not just "real-time sync"

Most collaborative whiteboards store the current canvas and broadcast diffs. This one stores the full sequence of events — stroke, undo, redo, clear-canvas, clear-user — and *derives* the visible canvas by replaying that log. Two things fall out of that for free, rather than needing to be built separately:

- **Time travel.** A slider replays a room's history to any point, including strokes that were later undone or cleared. Not a bolted-on feature — a direct consequence of the log being the source of truth.
- **Cheap reconnects.** A client that drops and comes back doesn't re-download the whole board. It sends the last event ID it has and gets only the delta, with a snapshot checkpoint every N events so replay doesn't walk the entire log from event zero as a room grows.

## Architecture

```
client (optimistic) ──stroke──▶ socket.io ──▶ append to event log (MongoDB)
      ▲                                                  │
      └───────────── ack / reconciliation ◀───────────────┘
                                 │
                   replay engine ── snapshot checkpoint
                                 │
                        derived visible state
```

- **`replay.js`** — a pure function, one forward pass over the event log. Handles per-author undo/redo stacks and clear semantics. No I/O, fully unit tested.
- **Snapshots** — once a room's log crosses a configurable threshold, a checkpoint is cached so replay resumes from there instead of the beginning.
- **Optimistic UI** — each stroke renders locally the instant it's drawn; a server ack reconciles the state, or triggers a full resync if something didn't persist.
- **Authorization is server-side**, not client-declared — a socket registers its `authorId` at join time, and every later write is checked against it, so one client can't act as another.

## Features

- Infinite pan/zoom canvas, spatial-grid-culled rendering
- Per-author undo/redo, live cursors, presence roster with editable name/color
- Clear the whole board, or just one author's own drawings — enforced server-side, not just hidden in the UI
- Optional bcrypt-hashed room passwords, created via an atomic upsert (no race between two simultaneous "create this room" requests)
- History scrubber — drag through a room's full timeline, undone and cleared strokes included
- Dark mode that follows system preference; the canvas itself always stays light, since strokes are calibrated against a white background
- Toast feedback for connection state, save failures, and reconciliation — no silent failures
- Rate limiting on write-heavy socket events, payload validation on every event, no unauthenticated write path

## Stack

React · Vite · Socket.IO · Express · MongoDB / Mongoose · Vitest

## Running it

```bash
git clone https://github.com/sandipan03ghosh/Event-sourced-whiteboard.git
cd Event-sourced-whiteboard
npm install --prefix server
npm install --prefix clients
```

Create `server/.env`:
```
MONGO_URI=mongodb://127.0.0.1:27017/canvassync
PORT=5000
```

Then, from the repo root:
```bash
npm run dev
```
runs both the API (`http://127.0.0.1:5000`) and the client (`http://localhost:5173`) together.

## Tests

```bash
npm test --prefix server
```

35 tests over the replay engine and snapshot logic — the two places where a silent bug would corrupt every room's history. Runs on every push via GitHub Actions.

## A few things that weren't obvious going in

- The naive "find the room, then create it" join flow has a real race: two near-simultaneous first joins to a brand-new room — React StrictMode's double effect in dev is enough to trigger this — can both see "room doesn't exist" and collide on MongoDB's unique index. Fixed with an atomic upsert instead of find-then-save.
- bcrypt silently truncates passwords past 72 *bytes*, not characters. Validated in bytes, not string length, so two different long passwords can't quietly hash to the same value.
- Undo isn't "delete the last stroke" — it has to be per-author, redo-stack-aware, and interact correctly with a later `clear-canvas` or `clear-user` event from someone else. That logic lives in one pure, fully-tested function instead of being scattered across socket handlers.
