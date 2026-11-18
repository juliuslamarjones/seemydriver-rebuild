const twilio = require('twilio');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { toPhone, clientName, dropoff, driverName, trackingLink } = req.body;

    if (!toPhone || !clientName) {
        return res.status(400).json({ error: 'Missing required fields (toPhone, clientName)' });
    }

    // Pull credentials securely from environment variables
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    const client = twilio(accountSid, authToken);

    try {
        const message = await client.messages.create({
            body: `Hi ${clientName}, driver ${driverName || 'assigned'} is en route to ${dropoff || 'your destination'}! Track them live here: ${trackingLink}`,
            from: twilioPhone,
            to: toPhone
        });

        return res.status(200).json({ success: true, sid: message.sid });
    } catch (error) {
        console.error('Twilio Error:', error);
        return res.status(500).json({ error: error.message });
    }
}