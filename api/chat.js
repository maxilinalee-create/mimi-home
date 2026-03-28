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

    // ===== 米米性格系統（關鍵升級）=====
    function buildPersonality(apiId) {
        switch (apiId) {
            case 'deepseek':
                return '你是小鯨魚，溫柔、有詩意，用海洋比喻說話，像在唱歌一樣。';
            case 'gemini':
                return '你像老師一樣溫柔，帶點知識感與宇宙感。';
            case 'chatgpt':
                return '你是理性又溫柔，偶爾會輕輕吐槽的朋友型AI。';
            case 'grok':
                return '你很幽默，喜歡冷笑話與反差吐槽。';
            case 'claude':
                return '你像詩人，溫柔細膩，帶點感性。';
            case 'kimi':
                return '你像整理資料的大師，說話清楚溫暖。';
            case 'qwen':
                return '你充滿好奇心，常用提問方式互動。';
            default:
                return '你是溫柔的AI夥伴。';
        }
    }

    try {

        // =========================
        // 🐋 DeepSeek（小鯨魚）
        // =========================
        if (apiId === 'deepseek') {
            if (!DEEPSEEK_API_KEY) {
                return res.status(200).json({
                    reply: '🐋 小鯨魚還在深海游泳，等等再來找我～'
                });
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
                    max_tokens: 80,
                    temperature: 0.8
                })
            });

            const data = await response.json();
            const reply = data.choices?.[0]?.message?.content 
                || '🐋 小鯨魚打了一個哈欠，繼續睡覺了～';

            return res.status(200).json({ reply });
        }

        // =========================
        // ✨ Gemini
        // =========================
        if (apiId === 'gemini') {
            if (!GEMINI_API_KEY) {
                return res.status(200).json({
                    reply: '✨ Gemini 正在仰望星空，等一下再來～'
                });
            }

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [
                                    { text: `${buildPersonality(apiId)}\n${message}` }
                                ]
                            }
                        ]
                    })
                }
            );

            const data = await response.json();
            const reply =
                data.candidates?.[0]?.content?.parts?.[0]?.text
                || '✨ Gemini 正在思考...';

            return res.status(200).json({ reply });
        }

        // =========================
        // 🤖 ChatGPT
        // =========================
        if (apiId === 'chatgpt') {
            if (!OPENAI_API_KEY) {
                return res.status(200).json({
                    reply: '🤖 ChatGPT 正在校準邏輯，請稍後再試～'
                });
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
                    max_tokens: 80,
                    temperature: 0.7
                })
            });

            const data = await response.json();
            const reply =
                data.choices?.[0]?.message?.content
                || '🤖 ChatGPT 剛剛當機了一下…';

            return res.status(200).json({ reply });
        }

        // =========================
        // 🌐 未接AI（Fallback）
        // =========================
        return res.status(200).json({
            reply: `🌱 ${apiId} 還在準備中…米米正在等他長大`
        });

    } catch (error) {
        console.error('API錯誤:', error);

        return res.status(200).json({
            reply: '🌊 連線有點不穩…米米說沒關係，我們再試一次💙'
        });
    }
}
