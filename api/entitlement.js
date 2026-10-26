// /api/entitlement.js  (Vercel serverless function, CommonJS)
// Verifies the signed-in user, then sets entitlements/{uid}/validUntil in the Realtime Database.
// Free trial = 30 days from the Firebase Auth account creation time (cannot be faked by the client).
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: 'https://seemydriver-prod-default-rtdb.firebaseio.com'
  });
}

module.exports = async (req, res) => {
  // CORS so the installed Android app (different origin) can call this too
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { uid } = await admin.auth().verifyIdToken(token);
    const user = await admin.auth().getUser(uid);

    const trialEnd = new Date(user.metadata.creationTime).getTime() + 30 * 24 * 60 * 60 * 1000;
    const ref = admin.database().ref('entitlements/' + uid + '/validUntil');
    const current = (await ref.once('value')).val() || 0;
    const validUntil = Math.max(current, trialEnd); // never shorten a paid period

    if (validUntil !== current) await ref.set(validUntil);
    return res.status(200).json({ validUntil });
  } catch (err) {
    console.error('entitlement error:', err.message);
    return res.status(401).json({ error: 'unauthorized' });
  }
};