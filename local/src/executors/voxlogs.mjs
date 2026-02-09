import pg from 'pg';
import { OpenAI } from 'openai';

const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const zai = new OpenAI({
  apiKey: process.env.ZAI_API_KEY,
  baseURL: 'https://open.bigmodel.cn/api/paas/v4'
});

export default async function voxlogsExecutor(params, context) {
  const { event } = context;
  const { log_level = 'info' } = params;

  if (!event || !event.thought) {
    return { status: 'skipped', reason: 'No thought found in event' };
  }

  try {
    // 1. Generate Embedding for the "Thought"
    const embeddingResponse = await zai.embeddings.create({
      model: 'embedding-2', // GLM-4 embedding model
      input: event.thought
    });
    const embedding = embeddingResponse.data[0].embedding;

    // 2. Insert into the new logs table
    const query = `
      INSERT INTO logs (
        agent, 
        event_type, 
        log_level, 
        message, 
        data, 
        embedding, 
        session_id, 
        source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    const values = [
      event.type.split(':')[0] || 'unknown',
      event.type,
      log_level,
      event.thought,
      JSON.stringify(event.data || {}),
      JSON.stringify(embedding),
      event.data?.session_id || null,
      'ops-loop-forwarder'
    ];

    await pgPool.query(query, values);

    return { 
      status: 'succeeded', 
      summary: `Forwarded thought from ${event.type} to Vox-Logs with vector embedding.` 
    };
  } catch (err) {
    console.error('Vox-Logs Forwarder Error:', err);
    return { status: 'failed', error: err.message };
  }
}