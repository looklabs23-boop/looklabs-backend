const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);

app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency, receipt_email } = req.body;
    if (!amount || amount < 50) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: currency || 'usd',
      receipt_email,
      automatic_payment_methods: { enabled: true },
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/order-complete', async (req, res) => {
  try {
    const { name, email, address, city, state, zip, country, items, total } = req.body;
    await resend.emails.send({
      from: 'LookLabs Orders <onboarding@resend.dev>',
      to: 'looklabs23@gmail.com',
      subject: `New LookLabs Order — ${name}`,
      html: `
        <h2>New Order Received!</h2>
        <h3>Customer Details</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Address:</strong> ${address}</p>
        <p><strong>City:</strong> ${city}</p>
        <p><strong>State:</strong> ${state}</p>
        <p><strong>ZIP:</strong> ${zip}</p>
        <p><strong>Country:</strong> ${country}</p>
        <h3>Order Details</h3>
        <p>${items.map(i => `• ${i}`).join('<br>')}</p>
        <h3>Total Charged: $${total}</h3>
      `,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/wholesale-inquiry', async (req, res) => {
  try {
    const { name, email, org, products, volume, notes } = req.body;
    await resend.emails.send({
      from: 'LookLabs <onboarding@resend.dev>',
      to: 'looklabs23@gmail.com',
      subject: `Wholesale Inquiry — ${name} (${org})`,
      html: `
        <h2>New Wholesale Inquiry</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Organization:</strong> ${org}</p>
        <p><strong>Products:</strong> ${products || 'Not specified'}</p>
        <p><strong>Monthly Volume:</strong> ${volume || 'Not specified'}</p>
        <p><strong>Notes:</strong> ${notes || 'None'}</p>
      `,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Wholesale email error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LookLabs backend running on port ${PORT}`));
