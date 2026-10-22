# Cubbi

Your Claude Code sessions as little brick figures in a 3D office.

<p align="center">
  <img src="docs/handoff.gif" width="300" alt="You send a message in Claude Code; in the office, 'you' hands that coworker a sticky note with the same words">
  &nbsp;&nbsp;
  <img src="docs/grows.gif" width="300" alt="The office grows from a garage startup to a headquarters as you work">
</p>
<p align="center"><sub>Left: what you type in Claude Code shows up in the office. Right: the office grows with your real usage.</sub></p>

Every session is a coworker at a desk: typing when it edits files, running to the terminal when it runs commands, raising a hand when it needs you, and taking a coffee break when it's done. Background tasks show up as helpers at the hot desks, and Codex runs as contractors.

```sh
npx cubbi
```

The office **grows with the work you actually do** — from a garage startup to a headquarters — with couriers delivering new monitors, a coffee bar, a game corner and office cats along the way.

## Live updates (optional)

Out of the box Cubbi reads your Claude Code logs, so it can lag a few seconds. For instant updates (raised hands, the command that is running right now), let Claude Code report to Cubbi through hooks:

```sh
npx cubbi install-hooks     # adds a few hooks to ~/.claude/settings.json (backs it up first)
npx cubbi uninstall-hooks   # removes only what Cubbi added
```

The hook sends events to Cubbi on your machine only, adds about 0.1 s per event, and never blocks Claude: if Cubbi isn't running it just exits.

It also adds two small touches inside Claude Code (skipped if you already have your own):

- **Status line** — `🧱 Ah-Fang @ login-page | 3 busy · Small studio`: which figure this session is, right in your terminal
- **`/cubbi`** — opens the office and flies to this session's figure

And when you send a message, a little "you" walks over to that coworker's desk and hands over a sticky note with what you typed.

## Privacy

Cubbi only **reads** local files (`~/.claude/projects`, and `~/.codex` if you use Codex), listens on `127.0.0.1`, and never sends anything anywhere. Its own data lives in `~/.cubbi`.

## Options

```sh
npx cubbi --port 4321 --no-open
```

Works on macOS, Linux and Windows with Node 20+.

## Streaming your office

```sh
npx cubbi --stream 4322
```

Also serves a redacted copy of the office on `127.0.0.1:4322` for a live stream (add it to OBS as a Browser Source, 1920×1080). Everything you type, every title, command and file path is stripped; projects become departments and sessions get nicknames that stay the same across restarts (`~/.cubbi/stream-names.json`). Deliverables, images and buttons are hidden, and nothing can be changed from that port. Figures still walk, type, run commands and raise hands in real time.

## Embedding

Cubbi is also a library: a host app can add its own session sources, actions (reply, answer, new session) and plugins. See `server/index.js` and `web/space/host.js`.

## License

MIT
