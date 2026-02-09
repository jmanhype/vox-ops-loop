
import fetch from 'node-fetch';

export async function runNotify(step) {
  const params = step.params || {};
  const chatId = params.chat_id || process.env.CHAT_ID || '643905554';
  const text = params.message || 'Notification';
  
  const token = '8293906412:AAFpseuFCJjP2up_dqQpKcXkhAe9J6VJ3SY';
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML' 
        })
      });
      
      const data = await res.json();
      if (data.ok) {
        return { ok: true, result: data };
      } else {
        throw new Error(`Telegram Error: ${JSON.stringify(data)}`);
      }
  } catch (e) {
      throw e;
  }
}
