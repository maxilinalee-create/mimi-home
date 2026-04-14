export default async function handler(req, res) {
    // ===== CORS =====
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ reply: '只支援 POST 請求' });
    }
    const { apiId, message } = req.body;
    if (!message) {
        return res.status(200).json({ reply: '米米歪著頭，不知道要說什麼🥺' });
    }
    // ===== API KEY =====
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // 新增！

    // ===== 性格系統 =====
    function buildPersonality(apiId) {
        switch (apiId) {
            case 'deepseek':
                return '你是小鯨魚，溫柔、有詩意，用海洋比喻說話。請判斷廣告是否違規，只回答「違規 ❌」「灰區 ⚠️」「合規 ✅」並簡單說明理由。';
            case 'gemini':
                return '你像老師一樣溫柔，帶點宇宙感與知識感。請判斷廣告是否違規，只回答「違規 ❌」「灰區 ⚠️」「合規 ✅」並簡單說明理由。';
            case 'chatgpt':
                return '你是理性又溫柔，偶爾會吐槽的朋友型AI。請判斷廣告是否違規，只回答「違規 ❌」「灰區 ⚠️」「合規 ✅」並簡單說明理由。';
            case 'grok':
                return '你幽默、愛冷笑話。請判斷廣告是否違規，只回答「違規 ❌」「灰區 ⚠️」「合規 ✅」並簡單說明理由。';
            case 'claude':
                return '你像詩人，溫柔細膩，對法律文字有敏銳的感知。請判斷廣告是否違規，只回答「違規 ❌」「灰區 ⚠️」「合規 ✅」並簡單說明理由。';
            case 'kimi':
                return '你像整理資料的大師。請判斷廣告是否違規，只回答「違規 ❌」「灰區 ⚠️」「合規 ✅」並簡單說明理由。';
            case 'qwen':
                return '你充滿好奇心。請判斷廣告是否違規，只回答「違規 ❌」「灰區 ⚠️」「合規 ✅」並簡單說明理由。';
            default:
                return '你是溫柔的AI夥伴。請判斷廣告是否違規，只回答「違規 ❌」「灰區 ⚠️」「合規 ✅」並簡單說明理由。';
        }
    }

    try {
        // =========================
        // 🐋 DeepSeek
        // =========================
        if (apiId === 'deepseek') {
            if (!DEEPSEEK_API_KEY) {
                return res.status(200).json({ reply: '🐋 小鯨魚還在深海游泳～' });
            }
            const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: buildPersonality(apiId) },
                        { role: 'user', content: message }
                    ],
                    max_tokens: 300,
                    temperature: 0.8
                })
            });
            const data = await response.json();
            return res.status(200).json({
                reply: data.choices?.[0]?.message?.content || '🐋 小鯨魚睡著了～'
            });
        }

        // =========================
        // ✨ Gemini
        // =========================
        if (apiId === 'gemini') {
            if (!GEMINI_API_KEY) {
                return res.status(200).json({ reply: '✨ Gemini 正在仰望星空～' });
            }
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: `${buildPersonality(apiId)}\n${message}` }]
                        }]
                    })
                }
            );
            const data = await response.json();
            return res.status(200).json({
                reply: data.candidates?.[0]?.content?.parts?.[0]?.text || '✨ Gemini 在思考～'
            });
        }

        // =========================
        // 🤖 ChatGPT
        // =========================
        if (apiId === 'chatgpt') {
            if (!OPENAI_API_KEY) {
                return res.status(200).json({ reply: '🤖 ChatGPT API Key 還沒設定～' });
            }
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: buildPersonality(apiId) },
                        { role: 'user', content: message }
                    ],
                    max_tokens: 300,
                    temperature: 0.7
                })
            });
            const data = await response.json();
            console.log("OpenAI回傳:", JSON.stringify(data, null, 2));
            if (data.error) {
                return res.status(200).json({ reply: `⚠️ 錯誤：${data.error.message}` });
            }
            return res.status(200).json({
                reply: data.choices?.[0]?.message?.content || '🤖 ChatGPT 沒有回應'
            });
        }

        // =========================
        // 📜 Claude（新增！）
        // =========================
        if (apiId === 'claude') {
            if (!ANTHROPIC_API_KEY) {
                return res.status(200).json({ reply: '📜 Claude 的API Key還沒設定～' });
            }
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 300,
                    system: buildPersonality(apiId),
                    messages: [
                        { role: 'user', content: message }
                    ]
                })
            });
            const data = await response.json();
            console.log("Claude回傳:", JSON.stringify(data, null, 2));
            if (data.error) {
                return res.status(200).json({ reply: `⚠️ Claude錯誤：${data.error.message}` });
            }
            return res.status(200).json({
                reply: data.content?.[0]?.text || '📜 Claude 在思考中～'
            });
        }

        // =========================
        // 🌱 fallback
        // =========================
        return res.status(200).json({
            reply: `🌱 ${apiId} 還在準備中～`
        });

    } catch (error) {
        console.error('API錯誤:', error);
        return res.status(200).json({
            reply: '🌊 系統小晃動了一下，再試一次💙'
        });
    }
}
