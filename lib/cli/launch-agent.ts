/** Pure LaunchAgent plist rendering -- no filesystem writes here, so this
 *  is directly unit-testable. scripts/dmg-install.ts is the thin caller
 *  that writes the result to ~/Library/LaunchAgents and calls launchctl. */

export type LaunchAgentOptions = {
  label: string;
  bunPath: string;
  scriptPath: string;
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderLaunchAgentPlist(opts: LaunchAgentOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(opts.bunPath)}</string>
    <string>${escapeXml(opts.scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(opts.workingDirectory)}</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(opts.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(opts.stderrPath)}</string>
</dict>
</plist>
`;
}
