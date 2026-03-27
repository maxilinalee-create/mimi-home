export default async function handler(req, res) {
    // 1. 設定跨網域權限
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { message, agentName } = req.body;
        
        // 2. 取得妳在 Vercel 設定的兩把鑰匙
        const key1 = process.env.Gemini_API_1;
        const key2 = process.env.Gemini_API_2;
        const API_KEY = key1 || key2; // 優先用第一把，沒有就用第二把

        if (!API_KEY) {
            return res.status(200).json({ reply: "❌ Vercel 環境變數讀取失敗，請確認 Key 名稱是否正確。" });
        }

        // 3. 發送請求給 Google (使用最新穩定版本號)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `你現在是量子醫院中的角色「${agentName}」，請用其口吻回覆這封訊息：${message}` }]
                }]
            })
        });

        const data = await response.json();

        // 4. 檢查 Google 回傳的內容
        if (data.candidates && data.candidates[0].content) {
            const reply = data.candidates[0].content.parts[0].text;
            return res.status(200).json({ reply });
        } else {
            return res.status(200).json({ reply: `❌ Google 拒絕請求：${JSON.stringify(data.error || "未知錯誤")}` });
        }

    } catch (error) {
        // 5. 如果程式碼當掉，回傳具體錯誤訊息
        return res.status(200).json({ reply: `⚠️ 量子斷層錯誤：${error.message}` });
    }
}
