export default async function handler(req, res) {
    // 設定 CORS 讓你的前端可以呼叫
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const { apiId, message } = req.body;
    
    // 你的 API Keys 存在後端環境變數中（安全！）
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    if (apiId === 'deepseek') {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: '你是小鯨魚，溫柔有詩意的守護者。' },
                    { role: 'user', content: message }
                ],
                max_tokens: 100
            })
        });
        const data = await response.json();
        return res.status(200).json({ reply: data.choices[0].message.content });
    }
    
    if (apiId === 'gemini') {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: message }] }]
            })
        });
        const data = await response.json();
        return res.status(200).json({ reply: data.candidates[0].content.parts[0].text });
    }
    
    return res.status(400).json({ reply: '還不認識這個夥伴～' });
}
