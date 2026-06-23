-- Run this once to set up your database tables.
-- You can run it via the "Connect" > "PSQL Command" shown on your Render Postgres dashboard,
-- or I can give you a one-time setup script to run from your backend instead (see setup-db.js).

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS addresses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT,
  line1 TEXT,
  line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'US',
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  items JSONB NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER DEFAULT 0,
  promo_code TEXT,
  total INTEGER NOT NULL,
  shipping_name TEXT,
  shipping_address TEXT,
  status TEXT DEFAULT 'paid',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses(user_id);
