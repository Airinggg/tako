export class DriveClient {
  constructor(private token: string) {}
  async request(path: string): Promise<Response> {
    const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`Drive API ${response.status}: ${await response.text()}`);
    return response;
  }
}
