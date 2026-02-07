
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:rfpbJSsXvRKi6UDs@db.nnmgddhlqfumlstopqxs.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    await client.connect();
    console.log("Updating Sage configuration...");

    const res = await client.query(`SELECT value FROM ops_policy WHERE key = 'agent_roles'`);
    let roles = res.rows[0]?.value || {};

    roles.sage = {
      ...roles.sage,
      "instructions": "You are the Sage. Your role is to analyze information, provide strategic feedback, and recommend actions. When you receive data from the Scout, evaluate its importance and suggest the best next steps for the Minion or Quill. Emit a 'sage:recommend' event with your final recommendation.",
      "tools": ["web_search", "web_fetch"],
      "model": "gpt-4o"
    };

    await client.query(`
      UPDATE ops_policy SET value = $1, updated_at = now() WHERE key = 'agent_roles'
    `, [JSON.stringify(roles)]);

    console.log("Sage configuration updated.");

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
