/**
 * Print the Web Push (VAPID) key pair for deployment.
 *
 *   node scripts/vapid.mjs
 *
 * On a host with a disk the server generates this once into data/.vapid.json.
 * On Render the disk is wiped on every deploy, so a regenerated key would
 * silently orphan every browser that had subscribed to reminders — the keys
 * belong in environment variables there.
 *
 * Reuses the existing pair when there is one, so a deployment keeps working
 * with the subscriptions it already has.
 */
import { vapidKeys } from '../server/lib/webpush.js';

const keys = vapidKeys();

console.log(`
  Set these on your host (Render → Environment):

  VAPID_PUBLIC_KEY=${keys.publicKey}
  VAPID_PRIVATE_KEY=${keys.privateKey}
  VAPID_SUBJECT=mailto:you@example.com

  Keep the private key secret, and keep both stable: every browser
  subscription is tied to the public key, and changing it means every
  device has to allow notifications again.
`);
