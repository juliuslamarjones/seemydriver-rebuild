export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name } = req.body;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'SeeMyDriver <onboarding@resend.dev>',
        to: [email],
        subject: 'Welcome to SeeMyDriver — Your 30-Day Trial is Active',
        html: `
          <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
            <h2>Welcome to SeeMyDriver, ${name || 'Driver'}!</h2>
            <p>Your account is locked and loaded. Your 30-day free trial has officially started.</p>
            <p>No credit card required right now. Just log in, spin up your live tracking link, and keep your clients updated without the constant 'Where are you?' texts.</p>
            <p style="margin-top: 30px;">— The SeeMyDriver Team</p>
          </div>
        `,
      }),
    });

    const data = await response.json();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}