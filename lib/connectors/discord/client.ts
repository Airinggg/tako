export type DiscordRequest = (path: string, query?: Record<string, string | number | undefined>) => Promise<any>;

/** Thin GET wrapper over https://discord.com/api/v10. Bot-token auth. One retry
 * on 429 honouring `retry_after`. */
export class DiscordClient {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  get: DiscordRequest = async (path, query = {}) => {
    const url = new URL(`https://discord.com/api/v10${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.fetchImpl(url, { headers: { Authorization: `Bot ${this.token}` } });
      if (res.status === 429 && attempt === 0) {
        const body = await res.json().catch(() => ({ retry_after: 1 }));
        await new Promise((r) => setTimeout(r, Math.min(10_000, (body.retry_after ?? 1) * 1000)));
        continue;
      }
      if (!res.ok) throw new Error(`Discord GET ${path}: HTTP ${res.status} ${await res.text()}`);
      return res.json();
    }
    throw new Error(`Discord GET ${path}: rate-limited twice`);
  };
}
