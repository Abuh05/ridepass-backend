// Minimal router on node:http (no framework dependency).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

export type Req = IncomingMessage & { params: Record<string, string>; query: URLSearchParams; rawBody?: Buffer; json?: any };
export type Res = ServerResponse;
type H = (req: Req, res: Res) => Promise<void> | void;
type Route = { method: string; re: RegExp; keys: string[]; h: H; body: 'json' | 'raw' | 'none'; limit: number };

export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

export class Router {
  routes: Route[] = [];
  add(method: string, path: string, h: H, opts: { body?: 'json' | 'raw' | 'none'; limit?: number } = {}): this {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, h, body: opts.body ?? (method === 'GET' ? 'none' : 'json'), limit: opts.limit ?? 1_000_000 });
    return this;
  }
  get(p: string, h: H, o?: { body?: 'json' | 'raw' | 'none'; limit?: number }) { return this.add('GET', p, h, o); }
  post(p: string, h: H, o?: { body?: 'json' | 'raw' | 'none'; limit?: number }) { return this.add('POST', p, h, o); }

  async handle(req: IncomingMessage, res: ServerResponse, staticDir: string): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    const r = req as Req;
    r.query = url.searchParams;
    try {
      for (const route of this.routes) {
        if (route.method !== req.method) continue;
        const m = url.pathname.match(route.re);
        if (!m) continue;
        r.params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        if (route.body !== 'none') {
          r.rawBody = await readBody(req, route.limit);
          if (route.body === 'json') {
            try { r.json = r.rawBody.length ? JSON.parse(r.rawBody.toString('utf8')) : {}; } catch { throw new HttpError(400, 'invalid JSON'); }
          }
        }
        await route.h(r, res);
        return;
      }
      if (req.method === 'GET' && serveStatic(url.pathname, res, staticDir)) return;
      sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('[http]', req.method, url.pathname, e);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'internal error' : (e as Error).message });
    }
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
export function sendJson(res: Res, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}
export function sendText(res: Res, status: number, body: string, type = 'text/plain; charset=utf-8', extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

export function serveFile(res: Res, file: string): boolean {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=300', ...SECURITY_HEADERS });
  createReadStream(file).pipe(res);
  return true;
}
function serveStatic(pathname: string, res: Res, dir: string): boolean {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(dir, clean);
  if (!file.startsWith(dir)) return false;
  return serveFile(res, file) || serveFile(res, file + '.html') || serveFile(res, join(file, 'index.html'));
}
