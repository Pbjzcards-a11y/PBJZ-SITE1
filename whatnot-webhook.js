// pbjz.org/api/whatnot-webhook
// Whatnot sends every webhook here. It checks the signature, then drops the event into
// Firebase, where the Diamond Walkouts app on the stream PC picks it up instantly.
//
// Vercel environment variables (Project > Settings > Environment Variables):
//   WHATNOT_WEBHOOK_SECRET   wn_wh_...  (from the Whatnot developer dashboard)
//   FIREBASE_DB_URL          https://pbjz-walkouts-default-rtdb.firebaseio.com
//   FIREBASE_DB_SECRET       database secret from Firebase > Project settings > Service accounts
import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } }; // we need the exact bytes Whatnot signed

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verify(raw, h, secret) {
  const id = h['webhook-id'], ts = h['webhook-timestamp'], sig = h['webhook-signature'];
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^wn_wh_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.`).update(raw).digest();
  return String(sig).split(' ').some(part => {
    const [v, s] = part.split(',');
    if (v !== 'v1' || !s) return false;
    const got = Buffer.from(s, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = (process.env.WHATNOT_WEBHOOK_SECRET || '').trim();
  const db = (process.env.FIREBASE_DB_URL || '').trim().replace(/\/$/, '');
  const dbSecret = (process.env.FIREBASE_DB_SECRET || '').trim();
  if (!secret || !db || !dbSecret) return res.status(500).end('Missing environment variables');

  const raw = await readRaw(req);
  if (!verify(raw, req.headers, secret)) return res.status(400).end('Bad signature');

  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).end('Bad JSON'); }

  const key = String(req.headers['webhook-id']).replace(/[.#$\[\]\/]/g, '_');
  const r = await fetch(`${db}/whatnot/events/${key}.json?auth=${encodeURIComponent(dbSecret)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receivedAt: Date.now(), event })
  });
  if (!r.ok) return res.status(502).end('Relay failed'); // Whatnot retries automatically
  return res.status(204).end();
}
