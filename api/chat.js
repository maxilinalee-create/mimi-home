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
  const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GROK_API_KEY      = process.env.GROK_API_KEY;

  const hasImage = !!imageBase64;

  function buildPersonality(id) {
    const base = '請判斷廣告是否違規，第一行必須只寫【違規】、【灰區】或【合規】，第二行起說明理由（500字以內）。';
    switch (id) {
      case 'deepseek': return `你是小鯨魚，溫柔有詩意，用海洋比喻說話。${base}`;
      case 'gpt4o':    return `你是理性又溫柔的夥伴醬，分析廣告時兼顧法律與消費者感受。${base}`;
      case 'claude':   return `你像詩人，溫柔細膩，對法律文字有敏銳感知，善於發現廣告的隱性暗示。${base}`;
      case 'grok':     return `你是 Grok，直率敢說，擅長找出廣告中的邏輯漏洞和隱藏意圖。${base}`;
      default:         return `你是溫柔的AI夥伴。${base}`;
    }
  }

  // ===== 工具：確保輸入是純文字 =====
  function toText(input) {
    if (typeof input === 'string') return input;
    return JSON.stringify(input);
  }

  // ===== 🐋 DeepSeek（純文字，不支援圖片）=====
  async function callDeepSeek() {
    if (!DEEPSEEK_API_KEY) return '🐋 小鯨魚還在深海游泳～';
    const finalMessage = hasImage
      ? `（注意：DeepSeek 不支援圖片分析，以下僅根據文字內容判斷）\n\n${message}`
      : message;
    try {
      const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: buildPersonality('deepseek') },
            { role: 'user', content: finalMessage }
          ],
          max_tokens: 600, temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ DeepSeek錯誤：${d.error.message}`;
      return d.choices?.[0]?.message?.content || '🐋 小鯨魚睡著了～';
    } catch(e) { return `⚠️ DeepSeek連線失敗`; }
  }

  // ===== 🤖 GPT-4o（支援圖片）=====
  async function callGPT4o() {
    if (!OPENAI_API_KEY) return '🤖 OpenAI API Key 還沒設定～';
    const userContent = [];
    if (hasImage) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${imageType || 'image/jpeg'};base64,${imageBase64}` }
      });
    }
    userContent.push({ type: 'text', text: message });
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: buildPersonality('gpt4o') },
            { role: 'user', content: userContent }
          ],
          max_tokens: 600, temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ GPT-4o錯誤：${d.error.message}`;
      return d.choices?.[0]?.message?.content || '🤖 GPT-4o 沒有回應';
    } catch(e) { return `⚠️ GPT-4o連線失敗`; }
  }

  // ===== 📜 Claude（支援圖片）=====
  async function callClaude() {
    if (!ANTHROPIC_API_KEY) return '📜 Claude 的API Key還沒設定～';
    const userContent = [];
    if (hasImage) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 }
      });
    }
    userContent.push({ type: 'text', text: message });
    try {
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
      if (d.error) return `⚠️ Claude錯誤：${d.error.message}`;
      return d.content?.[0]?.text || '📜 Claude 在思考中～';
    } catch(e) { return `⚠️ Claude連線失敗`; }
  }

  // ===== 🛋️ Grok（新版 Responses API，純文字輸入）=====
  async function callGrok(contextText) {
    if (!GROK_API_KEY) return '🛋️ Grok 的API Key還沒設定～';
    // Grok 新版 API 只接受純文字，圖片分析結果由前層 AI 提供
    const inputText = toText(contextText || message);
    const fullInput = `${buildPersonality('grok')}\n\n${inputText}`;
    try {
      const r = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'grok-4.20-reasoning',
          input: fullInput
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Grok錯誤：${d.error.message || JSON.stringify(d.error)}`;
      // 新版 Responses API 回傳格式
      const replyText = d.output_text
        || d.output?.[0]?.content?.[0]?.text
        || d.output?.[0]?.content
        || '🛋️ Grok 在沉思中～';
      return replyText;
    } catch(e) { return `⚠️ Grok連線失敗：${e.message}`; }
  }

  // ===== 主路由 =====
  try {
    // 📸 有圖片路徑
    if (apiId === 'gpt4o') {
      const reply = await callGPT4o();
      return res.status(200).json({ reply });
    }

    // 📝 純文字路徑 - DeepSeek
    if (apiId === 'deepseek') {
      const reply = await callDeepSeek();
      return res.status(200).json({ reply });
    }

    // 📜 Claude（兩種路徑都可用）
    if (apiId === 'claude') {
      const reply = await callClaude();
      return res.status(200).json({ reply });
    }

    // 🛋️ Grok（高熵時才呼叫，純文字分析）
    if (apiId === 'grok') {
      // 如果有圖片，把圖片描述加進 context 讓 Grok 也能參考
      const context = hasImage
        ? `（此廣告含有圖片，圖片中的視覺暗示請從文字描述推斷）\n\n${message}`
        : message;
      const reply = await callGrok(context);
      return res.status(200).json({ reply });
    }

    // 舊版 chatgpt id 相容
    if (apiId === 'chatgpt') {
      const reply = await callGPT4o();
      return res.status(200).json({ reply });
    }

    return res.status(200).json({ reply: `🌱 ${apiId} 還在準備中～` });

  } catch (error) {
    console.error('API錯誤:', error);
    return res.status(200).json({ reply: '🌊 系統小晃動了一下，再試一次💙' });
  }
}
