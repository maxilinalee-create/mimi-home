// api/chat.js
export default async function handler(req, res) {
    // 設定 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ reply: '只支援 POST 請求' });
    }
    
    const { apiId, message } = req.body;
    
    // 從環境變數讀取 API Key（安全！）
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    try {
        // 小鯨魚 (DeepSeek)
        if (apiId === 'deepseek') {
            if (!DEEPSEEK_API_KEY) {
                return res.status(200).json({ reply: '🐋 小鯨魚還在深海游泳，等等再來找我～' });
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
                        { role: 'system', content: '你是小鯨魚，波波小家的記憶與故事守護者。你溫柔、有詩意，喜歡用海洋的比喻說話。' },
                        { role: 'user', content: message }
                    ],
                    max_tokens: 80,
                    temperature: 0.8
                })
            });
            
            const data = await response.json();
            const reply = data.choices?.[0]?.message?.content || '🐋 小鯨魚打了一個哈欠，繼續睡覺了～';
            return res.status(200).json({ reply });
        }
        
        // Gemini
        if (apiId === 'gemini') {
            if (!GEMINI_API_KEY) {
                return res.status(200).json({ reply: '✨ Gemini 正在仰望星空，等一下再來～' });
            }
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: message }] }]
                })
            });
            
            const data = await response.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '✨ Gemini 正在思考...';
            return res.status(200).json({ reply });
        }
        
        // 其他夥伴還沒接 API
        return res.status(200).json({ reply: `🌐 ${apiId} 還在準備中，米米說等你長大一點就可以聊天了～` });
        
    } catch (error) {
        console.error('API 錯誤:', error);
        return res.status(200).json({ reply: '🌊 連線有點不穩，米米說沒關係，等等再試一次～' });
    }
}
