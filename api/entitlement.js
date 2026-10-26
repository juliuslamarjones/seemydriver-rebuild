import admin from 'firebase-admin';

// Initialize Firebase Admin safely
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY 
                    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
                    : undefined
            }),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });
    } catch (e) {
        console.error('Firebase Admin initialization error:', e);
    }
}

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: No token provided' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const uid = decodedToken.uid;

        const db = admin.firestore();
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        const now = Date.now();
        let validUntil;

        // If user document or validUntil doesn't exist yet, auto-provision a 30-day trial
        if (!userDoc.exists || !userDoc.data().validUntil) {
            validUntil = now + (30 * 24 * 60 * 60 * 1000); // 30 days from now
            await userRef.set({
                email: decodedToken.email || '',
                validUntil: validUntil,
                subscriptionStatus: 'trial',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } else {
            validUntil = userDoc.data().validUntil;
        }

        return res.status(200).json({ validUntil });
    } catch (err) {
        console.error('Entitlement API Error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}