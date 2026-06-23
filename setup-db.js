// setup-db.js
// One-time script to create your database tables.
// Run this ONCE from your local machine or as a one-off Render job.
//
// HOW TO RUN IT:
// 1. Add this file to your looklabs-backend repo
// 2. In Render, go to your backend service > "Shell" tab (top right)
// 3. Run: node setup-db.js
// 4. You should see "Tables created successfully" — then you can delete this file or leave it, it's harmless to re-run.

const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  try {
    const sql = fs.readFileSync('./schema.sql', 'utf8');
    await pool.query(sql);
    console.log('Tables created successfully');
  } catch (err) {
    console.error('Error creating tables:', err);
  } finally {
    await pool.end();
  }
}

setup();
