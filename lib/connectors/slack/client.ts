export type SlackRequest = (method: string, params?: Record<string, string | number | boolean | undefined>) => Promise<any>;

/** Thin GET wrapper over https://slack.com/api. Slack returns { ok:false, error }
 * with HTTP 200, so success is `ok`, not the status code. */
export class SlackClient {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  request: SlackRequest = async (method, params = {}) => {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.token}` } });
    const json = await response.json();
    if (!json?.ok) throw new Error(`Slack ${method}: ${json?.error ?? `HTTP ${response.status}`}`);
    return json;
  };
}
