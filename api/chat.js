export default async function handler(req, res) {

  // 🌐 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 🧠 防炸 body
  let body;
  try {
    body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body;
  } catch {
    return res.status(200).json({ reply: "❌ JSON 解析失敗" });
  }

  const message = body?.message || "你好";
  const agentName = body?.agentName || "米米";

  // ===== 🔑 多 API KEY（重點在這裡）=====
  const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
  ].filter(Boolean);

  if (API_KEYS.length === 0) {
    return res.status(200).json({
      reply: "❌ 沒讀到任何 GEMINI API KEY"
    });
  }

  let lastError = null;

  // ===== 🔁 自動輪替嘗試 =====
  for (let i = 0; i < API_KEYS.length; i++) {

    const API_KEY = API_KEYS[i];

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`,
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

      // 🛡️ 成功回傳
      if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const reply = data.candidates[0].content.parts[0].text;
        return res.status(200).json({ reply });
      }

      // ❌ API 回傳異常 → 換下一個 key
      lastError = data;

    } catch (err) {
      lastError = err;
    }
  }

  // ❌ 全部 key 都失敗
  return res.status(200).json({
    reply: "❌ 所有 Gemini API Key 都失敗",
    debug: lastError
  });
}
