async function callKimi(msg) {
    if (!TOGETHER_API_KEY) return '🌙 Kimi還在宇宙旅行～';
    const systemPrompt = customSystemPrompt || buildPersonality('kimi', classification);
    const userContent = [];
    const allImgs = getAllImages().slice(0, 3);
    allImgs.forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.type};base64,${img.base64}` }
      });
    });
    userContent.push({ type: 'text', text: msg });
    return safeCall(async () => {
      const r = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOGETHER_API_KEY}` },
        body: JSON.stringify({
          model: 'moonshotai/Kimi-K2.6',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: allImgs.length > 0 ? userContent : msg }
          ],
          max_tokens: 3000,
          temperature: 0.6
        })
      });
      const d = await r.json();
      if (d.error || !d.choices?.[0]?.message) {
        console.log('🔍 Kimi 異常回應：', JSON.stringify(d));
        console.log('🔍 Kimi HTTP status：', r.status);
      }
      if (d.error) return `⚠️ Kimi：${d.error.message || JSON.stringify(d.error)}`;
      const msg2 = d.choices?.[0]?.message;
      return msg2?.content || msg2?.reasoning || '🌙 Kimi在思考中～';
    }, 45000, '⚠️ Kimi 超時');
  }
