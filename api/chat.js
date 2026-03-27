export default async function handler(req, res) {

  // 🌐 CORS（一定要）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 🧠 修正 body（避免 crash）
  let body;
  try {
    body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body;
  } catch {
    return res.status(200).json({
      reply: "❌ JSON 解析失敗"
    });
  }

  const message = body?.message || "你好";
  const agentName = body?.agentName || "米米";

  // 🔑 只用一個 key（最穩）
  const API_KEY = process.env.GEMINI_API_KEY;

  console.log("KEY:", API_KEY);

  if (!API_KEY) {
    return res.status(200).json({
      reply: "❌ 沒讀到 GEMINI_API_KEY（請去 Vercel 設定）"
    });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `你現在是量子醫院角色「${agentName}」，請用有點吐槽又可愛的語氣回覆：${message}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    console.log("Gemini:", data);

    // 🛡️ 防炸
    if (!data.candidates || !data.candidates[0]) {
      return res.status(200).json({
        reply: "❌ Gemini 回應異常：" + JSON.stringify(data.error || data)
      });
    }

    const reply = data.candidates[0].content.parts[0].text;

    return res.status(200).json({ reply });

  } catch (err) {
    console.error(err);
    return res.status(200).json({
      reply: "❌ Gemini 連線失敗"
    });
  }
}
