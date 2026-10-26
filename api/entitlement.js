// /api/entitlement.js  (Vercel serverless function, ES module style - same as send-email.js)
// Verifies the signed-in user, then sets entitlements/{uid}/validUntil in the Realtime Database.
// Free trial = 30 days from the Firebase Auth account creation time (cannot be faked by the client).

// TEMPORARY: while true, failures include the reason in the response so we can see what is wrong.
// Set to false once sign-in works.
const DEBUG = true;

const DATABASE_URL = 'https://seemydriver-prod-default-rtdb.firebaseio.com';

let admin = null;

// Uses FIREBASE_SERVICE_ACCOUNT (whole JSON) if set, otherwise FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.
// The key must belong to the seemydriver-prod Firebase project.
async function getAdmin() {
  if (!admin) {
    const mod = await import('firebase-admin');
    admin = mod.default || mod;
  }
  if (!admin.apps.length) {
    const credential = process.env.FIREBASE_SERVICE_ACCOUNT
      ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : admin.credential.cert({
          projectId: 'seemydriver-prod',
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
        });
    admin.initializeApp({ credential, databaseURL: DATABASE_URL });
  }
  return admin;
}

export default async function handler(req, res) {
  // CORS so the installed Android app (different origin) can call this too
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  let fb;
  try {
    fb = await getAdmin();
  } catch (err) {
    console.error('Firebase admin setup failed:', err.message);
    return res.status(500).json({ error: 'server_not_configured', detail: DEBUG ? err.message : undefined });
  }

  let uid;
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    ({ uid } = await fb.auth().verifyIdToken(token));
  } catch (err) {
    console.error('Token check failed:', err.message);
    return res.status(401).json({ error: 'unauthorized', detail: DEBUG ? err.message : undefined });
  }

  try {
    const user = await fb.auth().getUser(uid);
    const trialEnd = new Date(user.metadata.creationTime).getTime() + 30 * 24 * 60 * 60 * 1000;
    const ref = fb.database().ref('entitlements/' + uid + '/validUntil');
    const current = (await ref.once('value')).val() || 0;
    const validUntil = Math.max(current, trialEnd); // never shorten a paid period
    if (validUntil !== current) await ref.set(validUntil);
    return res.status(200).json({ validUntil });
  } catch (err) {
    console.error('Entitlement write failed:', err.message);
    return res.status(500).json({ error: 'server_error', detail: DEBUG ? err.message : undefined });
  }
}
