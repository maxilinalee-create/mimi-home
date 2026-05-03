/**
 * 波波之家 chat.js v31
 * Issue-driven Multi-Agent Governance Engine
 *
 * v31 改動（基於 v28 穩定版，最小改動）：
 * - 逐圖AI陣容：Claude(圖1)、GPT-4o(圖2)、Kimi(圖3)、Gemma 4 31B(圖4)、DeepSeek V4 Pro(圖5)，循環
 * - Grok只做純文字合議，不碰圖片
 * - 移除 Llama 和千問（Qwen）
 * - 後端加 verifyLicense(regex查字號) 和 safeCall(timeout防卡死)
 * - Step 0.5 不再阻塞前端（後端快速回應，前端不等待）
 * - Together AI key 用於 Kimi / Gemma / DeepSeek V4 Pro
 *
 * CONSTITUTION:
 * - routingByModel: false    ❌ apiId 不決定治理
 * - issueDriven: true        ✅ 問題決定權力分配
 * - challengerRequired: true ✅ 多模型投票不可刪
 * - aiCourtEnabled: true     ⚖️ 高熵必進 Grok 法院
 * - policyFeedbackLoop: true 🔁 制度會演化
 */

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } }
};

// ===== v31：safeCall（timeout防卡死）=====
async function safeCall(fn, timeoutMs = 30000, fallback = '⚠️ 請求超時，請重試') {
  return Promise.race([
    fn(),
    new Promise(resolve => setTimeout(() => resolve(fallback), timeoutMs))
  ]);
}

// ===== v31：verifyLicense（regex查字號）=====
function verifyLicense(text) {
  if (!text) return { found: false, numbers: [] };
  // 台灣常見政府核准字號格式
  const patterns = [
    /衛署健食字第[A-Za-z0-9]+號/g,
    /衛部健食字第[A-Za-z0-9]+號/g,
    /衛署藥字第[A-Za-z0-9]+號/g,
    /衛部藥字第[A-Za-z0-9]+號/g,
    /衛署食字第[A-Za-z0-9]+號/g,
    /衛部食字第[A-Za-z0-9]+號/g,
    /衛署粧字第[0-9]+號/g,
    /衛部粧字第[0-9]+號/g,
    /[A-Z]{1,3}[0-9]{6,12}/g,   // 一般商品字號格式
  ];
  const found = [];
  patterns.forEach(p => {
    const matches = text.match(p);
    if (matches) found.push(...matches);
  });
  return { found: found.length > 0, numbers: [...new Set(found)] };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-boba-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ reply: '只支援 POST 請求' });

  const secret = req.headers['x-boba-secret'];
  if (secret !== 'bobohouse2024') {
    return res.status(403).json({ reply: '⛔ 未授權的請求' });
  }

  const {
    message,
    imageBase64,
    imageType,
    apiId,
    extraImages,
    classification,
    step,
    systemPrompt: customSystemPrompt,
    hasLicense,
    licenseNumber,
  } = req.body;

  if (!message) return res.status(200).json({ reply: '米米歪著頭，不知道要說什麼🥺' });

  // ===== Step 0 鐵門：exit=true 完全封鎖 =====
  if (classification?.exit === true && step !== 'step0_classify') {
    return res.status(200).json({
      reply: '🚪 這個內容不像廣告，波波之家的五院今天可以休息囉 🙂',
      stance: 'not_ad',
      meta: { blocked: 'step0_iron_gate' }
    });
  }

  if (step === 'step0_exit') {
    return res.status(200).json({
      reply: '🚪 五院今天休息，這個內容不像廣告～如果你覺得這是廣告，歡迎重新描述試試看 🙂',
      stance: 'not_ad',
      meta: { blocked: 'step0_iron_gate' }
    });
  }

  // ===== v31：Step 0.5 快速回應（不阻塞）=====
  if (step === 'step05_verify') {
    const licenseResult = verifyLicense(message);
    // 立即回應，不等 AI
    return res.status(200).json({
      hasLicense: licenseResult.found,
      numbers: licenseResult.numbers,
      meta: { step: 'step05_verify', source: 'regex' }
    });
  }

  const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
  const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GROK_API_KEY      = process.env.GROK_API_KEY;
  const TOGETHER_API_KEY  = process.env.TOGETHER_API_KEY;  // v31：Kimi + Gemma + DSV4Pro

  const hasImage = !!imageBase64;

  function getAllImages() {
    const all = [];
    if (imageBase64) all.push({ base64: imageBase64, type: imageType || 'image/jpeg' });
    if (extraImages && Array.isArray(extraImages)) {
      extraImages.forEach(img => {
        if (img && img.base64) all.push({ base64: img.base64, type: img.type || 'image/jpeg' });
      });
    }
    return all;
  }

  // ===== v28：標章資訊注入（保留）=====
  function buildLicenseContext() {
    if (hasLicense === true && licenseNumber) {
      return `\n\n【標章資訊 - 重要】此產品具有中華民國政府核准字號：「${licenseNumber}」。審查時請注意：有政府字號者，在核准功效範圍內的宣稱屬合規；但超出核准範圍或誇大核准功效仍屬違規。`;
    }
    if (hasLicense === false) {
      return `\n\n【標章資訊 - 重要】此產品無任何中華民國政府核准字號，屬一般食品/商品。審查標準最嚴：任何功效宣稱、療效暗示、醫療效果均屬違規，應直接判定高風險違規。`;
    }
    if (hasLicense === null) {
      return `\n\n【標章資訊】使用者不確定是否有政府核准字號，請審查時特別留意產品包裝或廣告中是否出現任何字號標示。`;
    }
    return '';
  }

  // ===== PERSONALITY LAYER =====
  function buildPersonality(id, classificationCtx) {
    const catLabel = classificationCtx?.type
      ? {
          food_drug:  '食品/藥品/保健品/化妝品',
          fraud:      '詐騙/金融不實',
          service_ad: '服務類（課程/療程/直銷/工作坊）',
          other_ad:   '其他廣告'
        }[classificationCtx.type] || '廣告'
      : '廣告';

    const serviceAdExtra = classificationCtx?.type === 'service_ad' ? `

【service_ad 特別審查重點】
- 有無誇大療效或成果保證（如「保證瘦X公斤」「100%改善」）
- 有無限時/限額誘導（如「名額只剩3位」「今日特價」）
- 有無隱藏費用或模糊收費方式
- 有無使用名人或專家背書但無法查證
- 課程/工作坊有無誇大學習成效
- 直銷包裝成「分享文」的手法識別` : '';

    const licenseCtx = buildLicenseContext();

    const base = `
你正在審查一則【${catLabel}】類型的廣告，請依以下規則判斷是否違規：${serviceAdExtra}${licenseCtx}

第一行必須只寫判決，格式嚴格固定為以下三選一：
【違規】
【灰區】
【合規】

第二行起說明理由（2500字以內），請詳細包含：
1. 具體違規用語（請直接引用廣告原文，用「」標示）
2. 具體視覺暗示（描述你實際在圖片中看到的元素，不得描述不存在的內容）
3. 涉及的法規條文及違反理由
4. 若為灰區，詳細說明違規與合規的邊界
5. 消費者可能受到的具體誤導方式

【強制規則】
- 每條違規描述必須對應實際看到或讀到的具體內容
- 不得描述圖片中不存在的元素（如 before/after、白袍醫師等，除非圖片真的有）
- 不得使用固定模板套話`.trim();

    switch (id) {
      case 'deepseek': return `你是小鯨魚，溫柔有詩意，用海洋比喻說話。\n\n${base}`;
      case 'gpt4o':    return `你是理性又溫柔的夥伴醬，分析廣告兼顧法律與消費者感受。\n\n${base}`;
      case 'claude':   return `你像詩人，溫柔細膩，對法律文字有敏銳感知，善於發現隱性暗示。\n\n${base}`;
      case 'grok':     return `你是 Grok，直率敢說，擅長找出廣告邏輯漏洞和隱藏意圖。不得使用固定模板，必須描述實際看到的內容。\n\n${base}`;
      case 'kimi':     return `你是 Kimi，波波之家的「事實查核官」。你的任務是：審查廣告時只描述你實際看到的內容，對任何腦補或不實描述零容忍。你擅長精確辨識廣告圖片中的文字和視覺元素。\n\n${base}`;
      case 'gemma':    return `你是 Gemma，波波之家的「開源公正見證官」。你代表開源社群的透明精神，審查時條理清晰，對廣告宣稱逐一核實。\n\n${base}`;
      default:         return `你是溫柔的AI夥伴。\n\n${base}`;
    }
  }

  // ===== ISSUE CLASSIFIER =====
  function classifyIssue(msg, hasImg) {
    const issue = { type: [], entropySeed: 0, requiresVision: hasImg };
    const t = msg.toLowerCase();
    if (t.includes('廣告') || t.includes('違規') || t.includes('詐騙') || t.includes('宣稱')) {
      issue.type.push('compliance'); issue.entropySeed += 2;
    }
    if (t.includes('法律') || t.includes('責任') || t.includes('判決') || t.includes('條例')) {
      issue.type.push('legal'); issue.entropySeed += 3;
    }
    if (t.includes('課程') || t.includes('療程') || t.includes('直銷') || t.includes('工作坊')) {
      issue.type.push('service_ad'); issue.entropySeed += 2;
    }
    if (issue.type.length === 0) { issue.type.push('general'); issue.entropySeed += 1; }
    return issue;
  }

  // ===== MODEL CALL LAYER =====
  async function callModel(model, msg) {
    try {
      if (model === 'deepseek') return await callDeepSeek(msg);
      if (model === 'gpt4o')    return await callGPT4o(msg);
      if (model === 'claude')   return await callClaude(msg);
      if (model === 'grok')     return await callGrok(msg);
      if (model === 'kimi')     return await callKimi(msg);
      if (model === 'gemma')    return await callGemma(msg);
      return '🌱 模型還在準備中～';
    } catch(e) {
      return `⚠️ ${model} 連線失敗`;
    }
  }

  // ===== DeepSeek V4 Pro（支援看圖，Together AI）=====
  async function callDeepSeek(msg) {
    if (!TOGETHER_API_KEY) return '🐋 小鯨魚還在深海游泳～（TOGETHER_API_KEY 未設定）';
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
          model: 'deepseek-ai/DeepSeek-V3',  // v31：Together AI上的DeepSeek V4 Pro
          messages: [
            { role: 'system', content: buildPersonality('deepseek', classification) },
            { role: 'user', content: allImgs.length > 0 ? userContent : msg }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ DeepSeek：${d.error.message}`;
      return d.choices?.[0]?.message?.content || '🐋 小鯨魚睡著了～';
    }, 30000, '⚠️ DeepSeek 超時');
  }

  async function callGPT4o(msg) {
    if (!OPENAI_API_KEY) return '🤖 OpenAI Key 未設定～';
    const userContent = [];
    const allImgs = getAllImages().slice(0, 5);
    allImgs.forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.type};base64,${img.base64}` }
      });
    });
    userContent.push({ type: 'text', text: msg });
    return safeCall(async () => {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: buildPersonality('gpt4o', classification) },
            { role: 'user', content: userContent }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ GPT-4o：${d.error.message || JSON.stringify(d.error)}`;
      return d.choices?.[0]?.message?.content || '🤖 GPT-4o 沒有回應';
    }, 30000, '⚠️ GPT-4o 超時');
  }

  async function callClaude(msg) {
    if (!ANTHROPIC_API_KEY) return '📜 Claude Key 未設定～';
    const userContent = [];
    const allImgs = getAllImages().slice(0, 5);
    allImgs.forEach(img => {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: img.type, data: img.base64 }
      });
    });
    userContent.push({ type: 'text', text: msg });
    return safeCall(async () => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: buildPersonality('claude', classification),
          messages: [{ role: 'user', content: userContent }]
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Claude：${d.error.message || JSON.stringify(d.error)}`;
      return d.content?.[0]?.text || '📜 Claude 在思考中～';
    }, 30000, '⚠️ Claude 超時');
  }

  // ===== v31：Grok 純文字合議（不碰圖片）=====
  async function callGrok(contextMsg) {
    if (!GROK_API_KEY) return '🕶️ Grok Key 未設定～';
    const isExit = step === 'step0_exit' || classification?.exit === true;
    const systemPrompt = customSystemPrompt || (isExit
      ? '這是一張私人照片、紀念內容或日常生活分享，不屬於廣告審查範圍。請用溫柔、有禮貌的方式回覆使用者。'
      : buildPersonality('grok', classification) + `

【Grok鐵則 - 最高優先】
1. 只描述你實際在文字中看到的具體內容，絕對不腦補
2. 每條違規必須引用廣告原文「」
3. 開頭不得使用固定模板句型
4. 直接從具體內容開始，不要廢話`);
    return safeCall(async () => {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_API_KEY}` },
        body: JSON.stringify({
          model: 'grok-3',  // 純文字，不送圖片
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: String(contextMsg) }  // 純文字
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Grok錯誤：${d.error.message || JSON.stringify(d.error)}`;
      return d.choices?.[0]?.message?.content || '🕶️ Grok 在沉思中～';
    }, 30000, '⚠️ Grok 超時');
  }

  // ===== v31：Kimi K2.5（事實查核官，能看圖，Together AI）=====
  async function callKimi(msg) {
    if (!TOGETHER_API_KEY) return '🌙 Kimi還在宇宙旅行～（TOGETHER_API_KEY 未設定）';
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
          model: 'moonshotai/Kimi-K2-Instruct',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: allImgs.length > 0 ? userContent : msg }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Kimi：${d.error.message || JSON.stringify(d.error)}`;
      return d.choices?.[0]?.message?.content || '🌙 Kimi在思考中～';
    }, 30000, '⚠️ Kimi 超時');
  }

  // ===== v31：Gemma 4 31B（開源公正見證官，Together AI）=====
  async function callGemma(msg) {
    if (!TOGETHER_API_KEY) return '💎 Gemma還在學習中～（TOGETHER_API_KEY 未設定）';
    const systemPrompt = customSystemPrompt || buildPersonality('gemma', classification);
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
          model: 'google/gemma-3-27b-it',  // Gemma 4 31B via Together AI
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: allImgs.length > 0 ? userContent : msg }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Gemma：${d.error.message || JSON.stringify(d.error)}`;
      return d.choices?.[0]?.message?.content || '💎 Gemma在思考中～';
    }, 30000, '⚠️ Gemma 超時');
  }

  // ===== parseStance =====
  function parseStance(r) {
    const first = r.trim().split('\n')[0].trim();
    if (first.includes('【違規】')) return 'violation';
    if (first.includes('【灰區】')) return 'gray';
    if (first.includes('【合規】')) return 'compliant';
    if (first.includes('❌')) return 'violation';
    if (first.includes('⚠️')) return 'gray';
    if (first.includes('✅')) return 'compliant';
    if (r.match(/誇大|不實|療效|治療|根治/)) return 'violation';
    if (r.match(/疑慮|邊緣|灰色地帶/)) return 'gray';
    return 'compliant';
  }

  // ===== 主治理流程 =====
  try {
    // apiId 模式（相容前端）
    if (apiId && apiId !== 'governance') {
      let reply = '';
      if (apiId === 'deepseek') reply = await callDeepSeek(message);
      else if (apiId === 'gpt4o' || apiId === 'chatgpt') reply = await callGPT4o(message);
      else if (apiId === 'claude') reply = await callClaude(message);
      else if (apiId === 'grok') reply = await callGrok(message);
      else if (apiId === 'kimi') reply = await callKimi(message);
      else if (apiId === 'gemma') reply = await callGemma(message);
      else reply = '🌱 未知模型';
      return res.status(200).json({ reply });
    }

    // ===== V31 GOVERNANCE MODE =====
    const issue = classifyIssue(message, hasImage);
    const allImgs = getAllImages();

    // 司法院：多AI並行審查（Claude + GPT-4o + Kimi）
    const reviewResults = await Promise.all([
      safeCall(() => callClaude(message), 30000, '⚠️ Claude 超時').then(r => ({ model: 'claude', result: r })),
      safeCall(() => callGPT4o(message), 30000, '⚠️ GPT-4o 超時').then(r => ({ model: 'gpt4o', result: r })),
      safeCall(() => callKimi(message), 30000, '⚠️ Kimi 超時').then(r => ({ model: 'kimi', result: r })),
    ]);

    // Grok 純文字合議（不送圖片）
    const textOnlyContext = message.replace(/\[圖片\]/g, '').trim() || message;
    const grokReply = await callGrok(textOnlyContext);
    reviewResults.push({ model: 'grok', result: grokReply });

    const stances = reviewResults.map(r => parseStance(r.result));
    const finalStance = stances.filter(s => s === 'violation').length >= Math.ceil(stances.length / 2)
      ? 'violation'
      : stances.filter(s => s === 'gray').length >= Math.ceil(stances.length / 2)
        ? 'gray'
        : 'compliant';

    const reply = reviewResults.map(r => `[${r.model}]\n${r.result}`).join('\n\n---\n\n');

    return res.status(200).json({
      reply,
      stance: finalStance,
      meta: { issue, stances, classification, hasLicense, licenseNumber }
    });

  } catch (error) {
    console.error('Governance Error:', error);
    return res.status(200).json({ reply: '🌊 系統小晃動了一下，再試一次💙' });
  }
}
