export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-boba-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ reply: '只支援 POST 請求' });

  const secret = req.headers['x-boba-secret'];
  if (secret !== 'bobohouse2024') {
    return res.status(403).json({ reply: '⛔ 未授權的請求' });
  }

  const { apiId, message, imageBase64, imageType } = req.body;
  if (!message) return res.status(200).json({ reply: '米米歪著頭，不知道要說什麼🥺' });

  const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GROK_API_KEY      = process.env.GROK_API_KEY;

  const hasImage = !!imageBase64;

  function buildPersonality(id) {
    const base = '請判斷廣告是否違規，第一行必須只寫【違規】、【灰區】或【合規】，第二行起說明理由（500字以內）。';
    switch (id) {
      case 'gpt4o':    return `你是理性又溫柔的夥伴醬，分析廣告時兼顧法律與消費者感受。${base}`;
      case 'grok':     return `你是 Grok，直率敢說，擅長找出廣告中的邏輯漏洞和隱藏意圖。${base}`;
      case 'chatgpt':  return `你是嚴謹的法律分析師，用條列式說明違規理由，不放過任何細節。${base}`;
      case 'claude':   return `你像詩人，溫柔細膩，對法律文字有敏銳感知，善於發現廣告的隱性暗示。${base}`;
      default:         return `你是溫柔的AI夥伴。${base}`;
    }
  }

  // ===== 共用 OpenAI 格式呼叫函數（OpenAI + Grok 都用這個格式）=====
  async function callOpenAIFormat(endpoint, apiKey, model, personality) {
    if (!apiKey) return `⚠️ API Key 還沒設定～`;
    const userContent = [];
    if (hasImage) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${imageType || 'image/jpeg'};base64,${imageBase64}` }
      });
    }
    userContent.push({ type: 'text', text: message });
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: personality },
            { role: 'user', content: userContent }
          ],
          max_tokens: 600,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ 錯誤：${d.error.message}`;
      return d.choices?.[0]?.message?.content || '沒有回應';
    } catch (e) {
      return `⚠️ 連線失敗：${e.message}`;
    }
  }

  try {

    // ===== 🤖 第1層 A：gpt-4o 夥伴醬（支援圖片）=====
    if (apiId === 'gpt4o') {
      const reply = await callOpenAIFormat(
        'https://api.openai.com/v1/chat/completions',
        OPENAI_API_KEY,
        'gpt-4o',
        buildPersonality('gpt4o')
      );
      return res.status(200).json({ reply });
    }

    // ===== 🛋️ 第1層 B：Grok 4（OpenAI相容格式，支援圖片）=====
    if (apiId === 'grok') {
      const reply = await callOpenAIFormat(
        'https://api.x.ai/v1/chat/completions',
        GROK_API_KEY,
        'grok-4-0709',
        buildPersonality('grok')
      );
      return res.status(200).json({ reply });
    }

    // ===== ⚡ 第2層：gpt-5.4-mini Challenger（支援圖片）=====
    if (apiId === 'chatgpt') {
      const reply = await callOpenAIFormat(
        'https://api.openai.com/v1/chat/completions',
        OPENAI_API_KEY,
        'gpt-5.4-mini',
        buildPersonality('chatgpt')
      );
      return res.status(200).json({ reply });
    }

    // ===== 📜 第3層：Claude 仲裁（支援圖片）=====
    if (apiId === 'claude') {
      if (!ANTHROPIC_API_KEY) return res.status(200).json({ reply: '📜 Claude 的API Key還沒設定～' });
      const userContent = [];
      if (hasImage) {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: imageType || 'image/jpeg',
            data: imageBase64
          }
        });
      }
      userContent.push({ type: 'text', text: message });
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: buildPersonality('claude'),
          messages: [{ role: 'user', content: userContent }]
        })
      });
      const d = await r.json();
      if (d.error) return res.status(200).json({ reply: `⚠️ Claude錯誤：${d.error.message}` });
      return res.status(200).json({ reply: d.content?.[0]?.text || '📜 Claude 在思考中～' });
    }

    return res.status(200).json({ reply: `🌱 ${apiId} 還在準備中～` });

  } catch (error) {
    console.error('API錯誤:', error);
    return res.status(200).json({ reply: '🌊 系統小晃動了一下，再試一次💙' });
  }
}
