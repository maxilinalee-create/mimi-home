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

  const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
  const GEMINI_API_KEY    = process.env.GEMINI_API_KEY;
  const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  const hasImage = !!imageBase64;

  function buildPersonality(id) {
    const base = '請判斷廣告是否違規，第一行必須只寫【違規】、【灰區】或【合規】，第二行起說明理由（500字以內）。';
    switch (id) {
      case 'deepseek': return `你是小鯨魚，溫柔有詩意，用海洋比喻說話。${base}`;
      case 'gemini':   return `你像老師一樣溫柔，帶點宇宙感。${base}`;
      case 'chatgpt':  return `你是理性又溫柔，偶爾吐槽的朋友型AI。${base}`;
      case 'claude':   return `你像詩人，溫柔細膩，對法律文字有敏銳感知。${base}`;
      default:         return `你是溫柔的AI夥伴。${base}`;
    }
  }

  try {

    // ===== 🐋 DeepSeek（不支援圖片，純文字降級）=====
    if (apiId === 'deepseek') {
      if (!DEEPSEEK_API_KEY) return res.status(200).json({ reply: '🐋 小鯨魚還在深海游泳～' });
      const finalMessage = hasImage
        ? `（注意：DeepSeek 不支援圖片分析，以下僅根據文字內容判斷）\n\n${message}`
        : message;
      const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: buildPersonality(apiId) },
            { role: 'user', content: finalMessage }
          ],
          max_tokens: 600,
          temperature: 0.7
        })
      });
      const d = await r.json();
      return res.status(200).json({ reply: d.choices?.[0]?.message?.content || '🐋 小鯨魚睡著了～' });
    }

    // ===== ✨ Gemini（支援圖片）=====
    if (apiId === 'gemini') {
      if (!GEMINI_API_KEY) return res.status(200).json({ reply: '✨ Gemini 正在仰望星空～' });
      const parts = [{ text: buildPersonality(apiId) + '\n\n' + message }];
      if (hasImage) {
        parts.push({
          inlineData: {
            mimeType: imageType || 'image/jpeg',
            data: imageBase64
          }
        });
      }
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { maxOutputTokens: 600 }
          })
        }
      );
      const d = await r.json();
      return res.status(200).json({ reply: d.candidates?.[0]?.content?.parts?.[0]?.text || '✨ Gemini 在思考～' });
    }

    // ===== 🤖 ChatGPT（支援圖片）=====
    if (apiId === 'chatgpt') {
      if (!OPENAI_API_KEY) return res.status(200).json({ reply: '🤖 ChatGPT API Key 還沒設定～' });
      const userContent = [];
      if (hasImage) {
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${imageType || 'image/jpeg'};base64,${imageBase64}` }
        });
      }
      userContent.push({ type: 'text', text: message });
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: buildPersonality(apiId) },
            { role: 'user', content: userContent }
          ],
          max_tokens: 600,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return res.status(200).json({ reply: `⚠️ 錯誤：${d.error.message}` });
      return res.status(200).json({ reply: d.choices?.[0]?.message?.content || '🤖 ChatGPT 沒有回應' });
    }

    // ===== 📜 Claude（支援圖片）=====
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
          system: buildPersonality(apiId),
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
