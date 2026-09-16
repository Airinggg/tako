export type NotionRequest = (path: string, init?: RequestInit) => Promise<unknown>;

export class NotionClient {
  constructor(private readonly token: string, private readonly notionVersion: string, private readonly fetchImpl = fetch) {}

  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetchImpl(`https://api.notion.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, "Notion-Version": this.notionVersion, "Content-Type": "application/json", ...init.headers },
    });
    if (!response.ok) throw new Error(`Notion API ${response.status}: ${await response.text()}`);
    return response.json();
  }
}
