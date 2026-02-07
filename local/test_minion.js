
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:rfpbJSsXvRKi6UDs@db.nnmgddhlqfumlstopqxs.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

const MINION_TEST_PROPOSAL = {
  title: "Minion System Check",
  steps: [
    {
      kind: "minion",
      executor: "minion",
      params: {
        command: "vercel",
        args: ["--version"]
      }
    }
  ]
};

async function main() {
  try {
    await client.connect();
    console.log("Creating Minion test proposal...");

    // Insert proposal (auto-approved for test)
    const { rows } = await client.query(`
      INSERT INTO ops_mission_proposals (source, status, template, dedupe_key)
      VALUES ('manual', 'auto_approved', $1, $2)
      RETURNING id
    `, [JSON.stringify(MINION_TEST_PROPOSAL), 'minion-check-' + Date.now()]);

    const proposalId = rows[0].id;
    console.log("Proposal created:", proposalId);

    // Create Mission
    const missionRes = await client.query(`SELECT ops_create_mission_from_proposal($1) as id`, [proposalId]);
    console.log("Mission created:", missionRes.rows[0].id);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
