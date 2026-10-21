# Cubbi

Your Claude Code sessions as little brick figures in a 3D office.

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

## Privacy

Cubbi only **reads** local files (`~/.claude/projects`, and `~/.codex` if you use Codex), listens on `127.0.0.1`, and never sends anything anywhere. Its own data lives in `~/.cubbi`.

## Options

```sh
npx cubbi --port 4321 --no-open
```

Works on macOS, Linux and Windows with Node 20+.

## Embedding

Cubbi is also a library: a host app can add its own session sources, actions (reply, answer, new session) and plugins. See `server/index.js` and `web/space/host.js`.

## License

MIT
