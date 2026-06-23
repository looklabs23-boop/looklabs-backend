const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
const resend = new Resend(process.env.RESEND_API_KEY);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================
// EXISTING ROUTES — payments, orders, wholesale
// ============================================

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

    // Email to YOU (store owner) — unchanged
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

    // NEW — confirmation email to the CUSTOMER
    if (email) {
      try {
        await resend.emails.send({
          from: 'LookLabs <onboarding@resend.dev>',
          to: email,
          subject: `Your LookLabs Order is Confirmed`,
          html: `
            <h2>Thanks for your order, ${name}!</h2>
            <p>We've received your order and it's being processed. Here's a summary:</p>
            <h3>Order Details</h3>
            <p>${items.map(i => `• ${i}`).join('<br>')}</p>
            <h3>Total Charged: $${total}</h3>
            <h3>Shipping To</h3>
            <p>${address}<br>${city}, ${state} ${zip}<br>${country}</p>
            <p style="margin-top:24px;color:#888;font-size:13px">If you have any questions about your order, just reply to this email.</p>
          `,
        });
      } catch (custErr) {
        // Don't fail the whole request if just the customer email fails —
        // the order itself already succeeded and you already got notified above.
        console.error('Customer confirmation email error:', custErr);
      }
    }

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

// ============================================
// PROMO CODE TRACKING
// ============================================

app.post('/promo-used', async (req, res) => {
  try {
    const { code, email, name, orderTotal } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Missing promo code' });
    }
    await resend.emails.send({
      from: 'LookLabs <onboarding@resend.dev>',
      to: 'looklabs23@gmail.com',
      subject: `Promo Code Used: ${code}`,
      html: `
        <h2>Promo Code Applied</h2>
        <p><strong>Code:</strong> ${code}</p>
        <p><strong>Customer Name:</strong> ${name || 'N/A'}</p>
        <p><strong>Customer Email:</strong> ${email || 'N/A'}</p>
        <p><strong>Order Total (after discount):</strong> ${orderTotal != null ? '$' + orderTotal : 'N/A'}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</p>
      `,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Promo tracking email error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// AUTH + ACCOUNT ROUTES
// ============================================

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

app.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email.toLowerCase(), passwordHash, name || null]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong creating your account' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong logging in' });
  }
});

app.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.post('/address', requireAuth, async (req, res) => {
  try {
    const { full_name, line1, line2, city, state, zip, country } = req.body;
    const existing = await pool.query('SELECT id FROM addresses WHERE user_id = $1', [req.userId]);
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE addresses SET full_name=$1, line1=$2, line2=$3, city=$4, state=$5, zip=$6, country=$7, updated_at=NOW() WHERE user_id=$8`,
        [full_name, line1, line2, city, state, zip, country || 'US', req.userId]
      );
    } else {
      await pool.query(
        `INSERT INTO addresses (user_id, full_name, line1, line2, city, state, zip, country) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.userId, full_name, line1, line2, city, state, zip, country || 'US']
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Address save error:', err);
    res.status(500).json({ error: 'Could not save address' });
  }
});

app.get('/address', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM addresses WHERE user_id = $1', [req.userId]);
    res.json({ address: result.rows[0] || null });
  } catch (err) {
    console.error('Address fetch error:', err);
    res.status(500).json({ error: 'Could not load address' });
  }
});

app.get('/orders', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json({ orders: result.rows });
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ error: 'Could not load order history' });
  }
});

// ============================================
// HEALTH CHECK + SERVER START
// ============================================

app.get('/health', (req, res) => res.json({ ok: true }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LookLabs backend running on port ${PORT}`));
