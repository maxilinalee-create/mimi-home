export default async function handler(req, res) {

  // 🧠 修正 body（避免 crash）
  let body;
  try {
    body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body;
  } catch {
    return res.status(400).json({ error: "JSON 解析失敗" });
  }

  const message = body?.message || "你好";
  const agentName = body?.agentName || "米米";

  const API_KEY = process.env.GEMINI_API_KEY;

  console.log("ENV:", API_KEY);

  // 🛑 沒 key 直接回
  if (!API_KEY) {
    return res.status(500).json({
      error: "❌ 沒讀到 GEMINI_API_KEY"
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
                  text: `你現在是「${agentName}」，請用有點吐槽又可愛的語氣回答：${message}`
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
      return res.status(500).json({
        error: "Gemini 沒回應",
        detail: data
      });
    }

    const reply = data.candidates[0].content.parts[0].text;

    return res.status(200).json({ reply });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "❌ Gemini 連線失敗"
    });
  }
}
