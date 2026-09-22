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
   macOS will likely block the first double-click with an "Apple could
   not verify... unidentified developer" warning — the installer isn't
   signed or notarized (by design, see the spec's non-goals). Either
   right-click `Install.command` and choose "Open" (confirms a one-time
   override), or run this from Terminal first:
   ```bash
   xattr -dr com.apple.quarantine "/Volumes/tako installer/Install.command"
   ```
2. It provisions the machine (Homebrew, `bun`, `ollama`, the required
   models, `~/tako`, `npm install`, `packages/brain`'s `bun install`,
   `omnibrain setup`) and then stops, printing where to fill in real
   connector credentials.
3. Edit `~/tako/config/connectors.json`. It's scaffolded from
   `config/connectors.example.json`, which has a block for every
   supported connector (notion, slack, notes, drive, discord, cad, mcp).
   Going live requires every `env:`-prefixed placeholder still present
   in the file to have its environment variable actually set — so for
   any connector this pilot isn't using, **delete that connector's whole
   JSON block** rather than leaving its placeholder in place. See
   `docs/CONNECTOR_CREDENTIALS.md` for each connector's token guide.

   Worked example — a Slack-only pilot: delete the `notion`, `notes`,
   `drive`, `discord`, `cad`, and `mcp` blocks entirely from
   `connectors.json`, keeping only `slack`, and set `SLACK_BOT_TOKEN` in
   the environment to a real token so `slack.token`'s `env:SLACK_BOT_TOKEN`
   placeholder resolves.
4. Re-run `Install.command`. This time it installs and starts the
   `com.tako.demo` LaunchAgent and opens `http://localhost:4400`.

## Updating

There is no self-update mechanism (by design — see the spec's non-goals),
and `~/tako` on the pilot machine is not a git repository: `build-dmg.sh`
uses `git archive`, which strips `.git`, so `git pull` cannot work there.
Instead, push the update from your own dev machine over SSH (assuming you
already have remote/SSH access to the pilot machine, as is the case for
Lirem):

```bash
# From your own dev machine, after committing your fix and re-running tests:
rsync -a --exclude 'config/*.json' --exclude '.git' --exclude node_modules \
  ./ lirem-mac:~/tako/
ssh lirem-mac 'cd ~/tako && npm install && cd packages/brain && bun install'
ssh lirem-mac 'launchctl unload ~/Library/LaunchAgents/com.tako.demo.plist && launchctl load ~/Library/LaunchAgents/com.tako.demo.plist'
```

(`lirem-mac` is whatever SSH host alias you've set up for the pilot
machine; the `config/*.json` exclude keeps the rsync from clobbering the
real, filled-in `connectors.json` already on that machine.)

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
