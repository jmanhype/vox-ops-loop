
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:rfpbJSsXvRKi6UDs@db.nnmgddhlqfumlstopqxs.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

const AGENT_ROLES = {
  "minion": {
    "description": "Makes decisions, executes tasks",
    "permissions": ["execute", "propose"]
  },
  "sage": {
    "description": "Analyzes strategy, provides feedback",
    "permissions": ["analyze", "vote"]
  },
  "scout": {
    "description": "Gathers data, finds opportunities",
    "permissions": ["propose", "fetch_web"]
  },
  "quill": {
    "description": "Writes content, creates posts",
    "permissions": ["execute", "post"]
  },
  "xalt": {
    "description": "Manages social media",
    "permissions": ["execute", "post"]
  },
  "observer": {
    "description": "Quality checks, monitors performance",
    "permissions": ["observe", "report"]
  }
};

const COLLABORATION_PATTERNS = [
  {
    "id": "scout-finds-opportunity",
    "event_type": "scout:find",
    "probability": 1,
    "cooldown_minutes": 30,
    "template": {
      "title": "Scout found opportunity - Request Sage review",
      "risk_level": "low",
      "steps": [
        {
          "kind": "openclaw",
          "executor": "openclaw",
          "params": {
            "agent": "sage",
            "prompt": "Evaluate this opportunity found by Scout: {{event.data.summary}}",
            "subcommand": "agent"
          }
        }
      ]
    }
  },
  {
    "id": "sage-recommends-action",
    "event_type": "sage:recommend",
    "probability": 1,
    "cooldown_minutes": 10,
    "template": {
      "title": "Sage recommends action - Minion execution",
      "risk_level": "medium",
      "steps": [
        {
          "kind": "openclaw",
          "executor": "openclaw",
          "params": {
            "agent": "minion",
            "prompt": "Execute the following strategy recommended by Sage: {{event.data.recommendation}}",
            "subcommand": "agent"
          }
        }
      ]
    }
  },
  {
    "id": "minion-requests-content",
    "event_type": "minion:request_content",
    "probability": 1,
    "cooldown_minutes": 5,
    "template": {
      "title": "Minion requesting content from Quill",
      "risk_level": "low",
      "steps": [
        {
          "kind": "openclaw",
          "executor": "openclaw",
          "params": {
            "agent": "quill",
            "prompt": "Write a draft for: {{event.data.topic}}",
            "subcommand": "agent"
          }
        }
      ]
    }
  }
];

async function main() {
  try {
    await client.connect();
    console.log("Connected to DB. Scaffolding agents...");

    // 1. Create agent_roles policy
    await client.query(`
      INSERT INTO ops_policy (key, value)
      VALUES ('agent_roles', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now();
    `, [JSON.stringify(AGENT_ROLES)]);
    console.log("Created agent_roles policy.");

    // 2. Extend reaction_matrix
    const res = await client.query(`SELECT value FROM ops_policy WHERE key = 'reaction_matrix'`);
    let matrix = res.rows[0]?.value || { patterns: [] };
    
    const newIds = COLLABORATION_PATTERNS.map(p => p.id);
    matrix.patterns = matrix.patterns.filter(p => !newIds.includes(p.id));
    matrix.patterns.push(...COLLABORATION_PATTERNS);

    await client.query(`
      UPDATE ops_policy SET value = $1, updated_at = now() WHERE key = 'reaction_matrix'
    `, [JSON.stringify(matrix)]);
    console.log("Extended reaction_matrix with collaboration patterns.");

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
