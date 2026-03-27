export default async function handler(req, res) {

  // 🌐 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 🧠 解析 body
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

  // 🔑 直接讀三個 API KEY
  const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
  ].filter(Boolean);

  // ❌ 完全沒 key
  if (API_KEYS.length === 0) {
    return res.status(200).json({
      reply: "❌ 沒讀到任何 GEMINI API KEY（請檢查 Vercel env）"
    });
  }

  const MODEL = "gemini-1.5-flash-latest";

  let lastError = null;

  // 🔁 逐個 key 嘗試
  for (let i = 0; i < API_KEYS.length; i++) {

    const API_KEY = API_KEYS[i];

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
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
                    text: `你現在是量子醫院角色「${agentName}」，請用可愛、有點吐槽的語氣回答：${message}`
                  }
                ]
              }
            ]
          })
        }
      );

      const data = await response.json();

      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (reply) {
        return res.status(200).json({ reply });
      }

      lastError = data;

    } catch (err) {
      lastError = err;
    }
  }

  // ❌ 全部失敗
  return res.status(200).json({
    reply: "❌ 所有 Gemini API Key 都失敗",
    debug: lastError
  });
}
