/**
 * Web Push, with no dependency beyond node:crypto.
 *
 *   - VAPID (RFC 8292): the server signs a short-lived ES256 JWT so the push
 *     service knows who is sending.
 *   - Message encryption (RFC 8291, "aes128gcm" from RFC 8188): the payload is
 *     encrypted to the browser's own key, so the push service only ever relays
 *     ciphertext. tests/api.test.js checks this against the RFC's test vector.
 *
 * Security: a subscription's endpoint is a URL chosen by the browser, and the
 * server POSTs to it. Accepting any URL would let a client make the server
 * call internal addresses (SSRF), so endpoints must be HTTPS on a known push
 * service (PUSH_SERVICE_HOSTS). PUSH_EXTRA_HOSTS adds to that list.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

const b64url = {
  encode: (buffer) => Buffer.from(buffer).toString('base64url'),
  decode: (text) => Buffer.from(String(text), 'base64url'),
};

/** Push services of the browsers that support Web Push, by host suffix. */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',               // Chrome, Opera, Samsung Internet, Android
  'updates.push.services.mozilla.com', // Firefox
  'push.apple.com',                   // Safari (web.push.apple.com)
  'notify.windows.com',               // Edge (*.notify.windows.com)
];

function allowedHosts() {
  const extra = (process.env.PUSH_EXTRA_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
  return [...PUSH_SERVICE_HOSTS, ...extra];
}

/** True when the endpoint is an HTTPS URL on a known push service. */
export function isAllowedEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return allowedHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// --- VAPID keys ----------------------------------------------------------------

let cachedKeys = null;

/**
 * The server's VAPID key pair, as base64url: `publicKey` is the uncompressed
 * P-256 point the browser needs, `privateKey` the raw scalar.
 *
 * Taken from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set; otherwise generated
 * once and kept in data/.vapid.json. It must stay stable: every browser
 * subscription is bound to it, and a new key silently orphans them all.
 */
export function vapidKeys() {
  if (cachedKeys) return cachedKeys;

  const fromEnv = { publicKey: process.env.VAPID_PUBLIC_KEY?.trim(), privateKey: process.env.VAPID_PRIVATE_KEY?.trim() };
  if (fromEnv.publicKey && fromEnv.privateKey) {
    cachedKeys = fromEnv;
    return cachedKeys;
  }

  const file = path.join(config.dataDir, '.vapid.json');
  if (fs.existsSync(file)) {
    cachedKeys = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cachedKeys;
  }

  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  cachedKeys = {
    publicKey: b64url.encode(Buffer.concat([Buffer.from([0x04]), b64url.decode(jwk.x), b64url.decode(jwk.y)])),
    privateKey: jwk.d,
  };
  fs.writeFileSync(file, JSON.stringify(cachedKeys), { mode: 0o600 });
  return cachedKeys;
}

function privateKeyObject({ publicKey, privateKey }) {
  const point = b64url.decode(publicKey);
  return crypto.createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: privateKey,
      x: b64url.encode(point.subarray(1, 33)),
      y: b64url.encode(point.subarray(33, 65)),
    },
  });
}

/**
 * The Authorization header for one push request (RFC 8292). The JWT's
 * audience is the push service's origin and it expires within 12 hours, the
 * longest some services accept.
 */
export function vapidAuthorization(endpoint, { keys = vapidKeys(), subject, now = Date.now() } = {}) {
  const header = b64url.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: subject || process.env.VAPID_SUBJECT || 'mailto:admin@routine-tracker.local',
  }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: privateKeyObject(keys),
    dsaEncoding: 'ieee-p1363',   // JWS wants raw r||s, not DER
  });
  return `vapid t=${header}.${claims}.${b64url.encode(signature)}, k=${keys.publicKey}`;
}

// --- Encryption (RFC 8291) -------------------------------------------------------

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/**
 * Encrypt a payload for one browser subscription.
 *
 * @param {Buffer|string} payload
 * @param {{ p256dh: string, auth: string }} keys  from the subscription
 * @param {{ localPrivateKey?: Buffer, salt?: Buffer }} [fixed]
 *        only for the RFC test vector; normal calls use fresh random values
 * @returns {Buffer} the aes128gcm message body
 */
export function encryptPayload(payload, { p256dh, auth }, fixed = {}) {
  const userAgentPublic = b64url.decode(p256dh);
  const authSecret = b64url.decode(auth);

  const ecdh = crypto.createECDH('prime256v1');
  if (fixed.localPrivateKey) ecdh.setPrivateKey(fixed.localPrivateKey);
  else ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(userAgentPublic);
  const salt = fixed.salt || crypto.randomBytes(16);

  // RFC 8291 §3.4: mix the auth secret and both public keys into the IKM.
  // Each HKDF-Expand here needs at most 32 bytes, so it is one HMAC block.
  const prkKey = hmac(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), userAgentPublic, serverPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);

  // RFC 8188 §2.2: content-encryption key and nonce.
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);

  // One record: the plaintext, then 0x02 to mark it as the last record.
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic, body]);
}

// --- Sending ------------------------------------------------------------------------

/**
 * Deliver one notification.
 *
 * @returns {Promise<{ ok: boolean, gone: boolean, status: number }>}
 *   `gone` means the subscription no longer exists (404/410) and should be
 *   deleted; any other failure is left for the next attempt.
 */
export async function sendPush(subscription, message, { ttl = 60 * 60, fetchImpl = fetch } = {}) {
  if (!isAllowedEndpoint(subscription.endpoint)) {
    return { ok: false, gone: true, status: 0 };
  }

  const body = encryptPayload(JSON.stringify(message), subscription);
  const res = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // A reminder is useless an hour late, so the push service may drop it.
      TTL: String(ttl),
      Urgency: 'high',
    },
    body,
    redirect: 'error',   // a redirect could point anywhere; never follow one
    signal: AbortSignal.timeout(10_000),
  });

  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}
