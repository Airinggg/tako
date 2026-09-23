/**
 * The only network-touching module in the Zoom follow-up meeting feature.
 * Server-to-Server OAuth against Zoom's REST API. Credentials are resolved
 * only from environment variables via the repo's existing resolveSecret()
 * — never a literal value, never logged. See
 * docs/superpowers/specs/2026-09-22-zoom-followup-meeting-design.md Part 3.
 */

import { resolveSecret } from "../../connectors/shared/config.ts";

export type ZoomCredentials = { accountId: string; clientId: string; clientSecret: string };

export function resolveZoomCredentials(env: Record<string, string | undefined> = process.env): ZoomCredentials {
  return {
    accountId: resolveSecret("env:ZOOM_ACCOUNT_ID", env),
    clientId: resolveSecret("env:ZOOM_CLIENT_ID", env),
    clientSecret: resolveSecret("env:ZOOM_CLIENT_SECRET", env),
  };
}

export type ZoomMeetingResult = { id: string; joinUrl: string; startUrl: string };

async function getAccessToken(creds: ZoomCredentials, fetchImpl: typeof fetch): Promise<string> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetchImpl(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${creds.accountId}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw new Error(`zoom oauth ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

/** Creates a real Zoom meeting. Every call requires a human to have already
 *  confirmed the exact topic/agenda/time — see
 *  lib/integrations/zoom/proposal.ts's confirmMeetingProposal(), which the
 *  caller (scripts/demo.ts's confirmZoomMeeting()) must run first. */
export async function createZoomMeeting(
  creds: ZoomCredentials,
  input: { topic: string; agenda: string; startTime: string; durationMinutes: number; participantEmails: string[] },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<ZoomMeetingResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const token = await getAccessToken(creds, fetchImpl);
  const res = await fetchImpl("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      topic: input.topic,
      agenda: input.agenda,
      type: 2,
      start_time: input.startTime,
      duration: input.durationMinutes,
      settings: { join_before_host: false, meeting_invitees: input.participantEmails.map((email) => ({ email })) },
    }),
  });
  if (!res.ok) throw new Error(`zoom create meeting ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { id: String(data.id), joinUrl: data.join_url, startUrl: data.start_url };
}
