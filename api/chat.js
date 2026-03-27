export default async function handler(req, res) {
    // 1. 處理跨網域 (CORS) 問題
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { message, agentName } = req.body;

    // 2. 讀取妳剛才在 Vercel 設定的兩把鑰匙
    const keys = [
        process.env.Gemini_API_1,
        process.env.Gemini_API_2
    ].filter(k => k); // 過濾掉空的鑰匙

    if (keys.length === 0) {
        return res.status(200).json({ reply: "❌ 系統錯誤：Vercel 找不到任何 API Key，請檢查環境變數設定。" });
    }

    // 3. 隨機挑選一把鑰匙使用
    const API_KEY = keys[Math.floor(Math.random() * keys.length)];

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ 
                    parts: [{ 
                        text: `你現在是「${agentName}」，請用這個角色的口吻對使用者說一句話（量子醫院世界觀）：${message}` 
                    }] 
                }]
            })
        });

        const data = await response.json();
        
        if (data.error) {
            return res.status(200).json({ reply: `[API 報錯] ${data.error.message}` });
        }

        const reply = data.candidates[0].content.parts[0].text;
        res.status(200).json({ reply });
        
    } catch (error) {
        res.status(200).json({ reply: `[量子連線中斷] ${error.message}` });
    }
}
