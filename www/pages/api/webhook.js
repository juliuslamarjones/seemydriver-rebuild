import { buffer } from 'micro';
import Stripe from 'stripe';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle successful checkout completion (Upgrade to Pro)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const companyId = session.metadata?.companyId;

    if (companyId) {
      try {
        await admin.database().ref(`companies/${companyId}/subscription`).set({
          status: 'active',
          plan: 'pro',
          stripeCustomerId: session.customer,
          subscriptionId: session.subscription,
          updatedAt: Date.now()
        });
        console.log(`Successfully upgraded company [${companyId}] to Pro tier.`);
      } catch (dbError) {
        console.error(`Failed to update Firebase for company ${companyId}:`, dbError);
        return res.status(500).send('Internal Server Error');
      }
    }
  }

  // Handle subscription updates or cancellations (Lock Pro features)
  if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const companyId = subscription.metadata?.companyId;

    if (companyId && subscription.status !== 'active') {
      try {
        await admin.database().ref(`companies/${companyId}/subscription`).update({
          status: 'inactive',
          updatedAt: Date.now()
        });
        console.log(`Subscription inactive for company [${companyId}]. Pro features locked.`);
      } catch (dbError) {
        console.error(`Failed to downgrade company ${companyId}:`, dbError);
      }
    }
  }

  return res.status(200).json({ received: true });
}