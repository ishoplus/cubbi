# Cubbi for Claude Code

Watch your Claude Code sessions as coworkers in a cozy 3D office: a coworker types while Claude edits files, runs to the terminal for commands, and raises a hand the moment Claude needs your permission or answer.

This plugin adds:

- **Live events**: hooks for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop and SessionEnd, so the office reacts right away (including permission prompts, which Claude Code doesn't write to its logs).
- **`/cubbi`**: opens the office and flies the camera to this session's coworker.

## Use it

```
/plugin marketplace add ishoplus/cubbi
/plugin install cubbi@ishoplus-cubbi
```

1. Install the plugin (above), then run the office in its own terminal: `npx cubbi` (Node 20+).
2. Start or continue a Claude Code session and open http://127.0.0.1:4321/ (or type `/cubbi`).

If the office isn't running, the hook exits immediately and does nothing.

## Privacy

Everything stays on your computer. The hook sends a trimmed copy of each event (event name, session id, working folder, tool name, a short command or file path, the first 400 characters of a prompt) to the Cubbi server on `127.0.0.1` only. Nothing is sent to any other service, and the plugin stores nothing itself.

If you also installed Cubbi's hooks by hand (`npx cubbi install-hooks`), the plugin's hook steps aside so events aren't doubled. `npx cubbi doctor` shows which one is active.

## More

- Source, full docs and the phone remote: https://github.com/ishoplus/cubbi
- Issues: https://github.com/ishoplus/cubbi/issues

Cubbi is not affiliated with Anthropic. MIT license.
