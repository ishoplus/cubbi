# Cubbi

Your Claude Code sessions as little brick figures in a 3D office.

Every session is a coworker at a desk: typing when it edits files, running to the terminal when it runs commands, raising a hand when it needs you, and taking a coffee break when it's done. Background tasks show up as colleagues at the hot desks.

```sh
npx cubbi
```

Cubbi only **reads** your local Claude Code transcripts (`~/.claude/projects`). It listens on `127.0.0.1` only and never sends anything anywhere.

> Work in progress — not published yet.

## Embedding

Cubbi is also a library: a host app can add its own session sources (live events), actions (reply, answer, new session) and plugins. See `server/index.js` and `web/space/host.js`.

## License

MIT
