# Distributing tako to Lirem as a `.dmg`

See `docs/superpowers/specs/2026-09-22-lirem-dmg-distribution-design.md`
for the full design. This doc covers the two things the owner does
*after* the initial install: shipping an update, and removing tako from
a machine entirely.

## Building the installer

```bash
./scripts/build-dmg.sh
```

Produces `dist/tako-installer.dmg`. Hand that file to whoever is doing the
install (yourself, on-site or via remote access at Lirem).

## Installing (first time)

1. Mount the `.dmg`, double-click `Install.command` (opens Terminal).
2. It provisions the machine (Homebrew, `bun`, `ollama`, the required
   models, `~/tako`, `npm install`, `omnibrain setup`) and then stops,
   printing where to fill in real connector credentials.
3. Fill in `~/tako/config/connectors.json` (see
   `docs/CONNECTOR_CREDENTIALS.md` for each connector's token guide).
4. Re-run `Install.command`. This time it installs and starts the
   `com.tako.demo` LaunchAgent and opens `http://localhost:4400`.

## Updating

There is no self-update mechanism (by design — see the spec's non-goals).
To ship a fix or new feature to the pilot machine:

```bash
cd ~/tako
git pull                      # or: git cherry-pick <sha> for a scoped fix
npm install                   # only if dependencies changed
launchctl unload ~/Library/LaunchAgents/com.tako.demo.plist
launchctl load ~/Library/LaunchAgents/com.tako.demo.plist
```

The server restarts running the new code. Check
`~/Library/Logs/tako/demo.log` to confirm it came back up cleanly.

## Removing tako from a machine

```bash
launchctl unload ~/Library/LaunchAgents/com.tako.demo.plist
rm ~/Library/LaunchAgents/com.tako.demo.plist
rm -rf ~/tako
rm -rf ~/Library/Logs/tako
brew uninstall ollama bun     # only if nothing else on the machine needs them
```

Nothing tako-owned exists outside `~/tako`, the one LaunchAgent file, and
`~/Library/Logs/tako` — this is the complete removal list.
