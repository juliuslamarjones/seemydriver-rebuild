// /api/stripe-webhook.js  (Vercel serverless function, CommonJS)
// Stripe events -> entitlements/{uid}/validUntil in the Realtime Database.
const admin = require('firebase-admin');
const Stripe = require('stripe');

const DATABASE_URL = 'https://seemydriver-prod-default-rtdb.firebaseio.com';

function getAdmin() {
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

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function grant(fb, uid, untilMs) {
  const ref = fb.database().ref('entitlements/' + uid + '/validUntil');
  const current = (await ref.once('value')).val() || 0;
  await ref.set(Math.max(current, untilMs));
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const buf = await rawBody(req);
    event = stripe.webhooks.constructEvent(buf, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send('Bad signature');
  }

  try {
    const fb = getAdmin();
    const obj = event.data.object;

    if (event.type === 'checkout.session.completed') {
      const uid = obj.client_reference_id;
      if (uid && obj.customer) {
        await fb.database().ref('stripeCustomers/' + obj.customer).set(uid); // remember who this customer is
        await grant(fb, uid, Date.now() + 31 * 24 * 60 * 60 * 1000);          // access starts right away
      }
    } else if (event.type === 'invoice.paid') {
      const uid = (await fb.database().ref('stripeCustomers/' + obj.customer).once('value')).val();
      const periodEnd = obj.lines && obj.lines.data && obj.lines.data[0] && obj.lines.data[0].period && obj.lines.data[0].period.end;
      if (uid && periodEnd) await grant(fb, uid, periodEnd * 1000 + 2 * 24 * 60 * 60 * 1000); // period end + 2 days grace
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).end(); // Stripe will retry
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
