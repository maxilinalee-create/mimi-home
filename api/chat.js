export default async function handler(req, res) {
  const { message, agentName } = req.body;
  const API_KEY = process.env.GEMINI_API_KEY;

  console.log("ENV TEST:", API_KEY);

  // 👉 先擋掉沒 key 的情況
  if (!API_KEY) {
    return res.status(500).json({
      error: "沒有讀到 API KEY（Vercel env 問題）"
    });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `你現在是「${agentName}」，請對使用者說：${message}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    console.log("Gemini raw:", JSON.stringify(data, null, 2));

    // 👉 防呆（超重要）
    if (!data.candidates || !data.candidates[0]) {
      return res.status(500).json({
        error: "Gemini 沒回應",
        detail: data
      });
    }

    const reply = data.candidates[0].content.parts[0].text;

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("ERROR:", error);
    return res.status(500).json({
      error: "連線 Gemini 失敗"
    });
  }
}
