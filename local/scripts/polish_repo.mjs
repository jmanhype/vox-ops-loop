
import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';

const projectDir = process.cwd();
const slug = process.env.SLUG || path.basename(projectDir);

const apiKey = process.env.ZAI_API_KEY || process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.log("Skipping polish: No API Key found.");
  process.exit(0);
}

const client = new OpenAI({ 
  apiKey, 
  baseURL: 'https://open.bigmodel.cn/api/paas/v4' 
});

async function main() {
  console.log(`✨ Polishing repository: ${slug}`);

  // 1. Scan file structure (shallow)
  const files = fs.readdirSync(projectDir).filter(f => !f.startsWith('.')).join(', ');

  // 2. Read Strategy if exists
  let strategy = "";
  try {
    strategy = fs.readFileSync('strategy.md', 'utf8').substring(0, 2000);
  } catch (e) {}

  const prompt = `
    Project: ${slug}
    Files: ${files}
    Strategy Context: ${strategy}
    
    Task: Generate a professional README.md and a short description.
    
    Output format:
    ---README---
    (Markdown content with emojis, badges, install instructions)
    ---DESC---
    (One sentence description for GitHub)
  `;

  try {
    const completion = await client.chat.completions.create({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: prompt }]
    });

    const text = completion.choices[0].message.content;
    const parts = text.split('---DESC---');

    if (parts.length >= 2) {
      const readme = parts[0].replace('---README---', '').trim();
      const desc = parts[1].trim();

      fs.writeFileSync('README.md', readme);
      fs.writeFileSync('repo_desc.txt', desc);
      console.log("✅ Polish complete.");
    } else {
      console.error("❌ Polish failed: Invalid format returned.");
    }
  } catch (e) {
    console.error(`❌ Polish error: ${e.message}`);
  }
}

main();
