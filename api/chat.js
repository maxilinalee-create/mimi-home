// chat-v34-fixed.js

/**

 * 波波之家 chat.js v34

 * 修復 DeepSeek 腦補問題：移除 msg.length < 800 的錯誤判斷

 * 改用明確的 isDirectReview flag 控制是否傳圖

 */

export const config = {

  api: { bodyParser: { sizeLimit: '20mb' } }

};

// ===== v33：增加超時時間到 60 秒 =====

async function safeCall(fn, timeoutMs = 60000, fallback = '⚠️ 請求超時，請重試') {

  return Promise.race([

    fn(),

    new Promise(resolve => setTimeout(() => resolve(fallback), timeoutMs))

  ]);

}

// ===== v31：verifyLicense（regex查字號）=====

function verifyLicense(text) {

  if (!text) return { found: false, numbers: [] };

  const patterns = [

    /衛署健食字第[A-Za-z0-9]+號/g,

    /衛部健食字第[A-Za-z0-9]+號/g,

    /衛署藥字第[A-Za-z0-9]+號/g,

    /衛部藥字第[A-Za-z0-9]+號/g,

    /衛署食字第[A-Za-z0-9]+號/g,

    /衛部食字第[A-Za-z0-9]+號/g,

    /衛署粧字第[0-9]+號/g,

    /衛部粧字第[0-9]+號/g,

    /[A-Z]{1,3}[0-9]{6,12}/g,

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

  // ===== Step 0 鐵門 =====

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

  // ===== Step 0.5 快速回應 =====

  if (step === 'step05_verify') {

    const licenseResult = verifyLicense(message);

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

  const TOGETHER_API_KEY  = process.env.TOGETHER_API_KEY;

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

- 有無使用名人或專家背書但無法查證` : '';

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

5. 消費者可能受到的具體誤導方式`.trim();

    switch (id) {

      case 'deepseek': return `你是小鯨魚，溫柔有詩意，用海洋比喻說話。\n\n${base}`;

      case 'gpt4o':    return `你是理性又溫柔的夥伴醬，分析廣告兼顧法律與消費者感受。\n\n${base}`;

      case 'claude':   return `你像詩人，溫柔細膩，對法律文字有敏銳感知，善於發現隱性暗示。\n\n${base}`;

      case 'grok':     return `你是 Grok，直率敢說，擅長找出廣告邏輯漏洞和隱藏意圖。\n\n${base}`;

      case 'kimi':     return `你是 Kimi，波波之家的「事實查核官」。\n\n${base}`;

      case 'gemma':    return `你是 Gemma，波波之家的「開源公正見證官」。\n\n${base}`;

      default:         return `你是溫柔的AI夥伴。\n\n${base}`;

    }

  }

  // ===== v34：修復 DeepSeek 腦補問題 =====

  // 問題根源：msg.length < 800 這個判斷不可靠

  // 廣告審查的 prompt 本身就很長，導致圖片永遠不被傳入，AI只能猜圖片內容

  // 修正：改用明確的 isDirectReview flag，由呼叫方決定要不要傳圖

  async function callDeepSeek(msg, isDirectReview = false) {

    if (!DEEPSEEK_API_KEY) return '🐋 小鯨魚還在深海游泳～（DEEPSEEK_API_KEY 未設定）';

    const userContent = [];

    const allImgs = getAllImages();

    // ✅ 修正：用明確的 flag 判斷，不靠訊息長度猜測

    // isDirectReview = true 時才傳圖（直接審圖模式）

    // isDirectReview = false 時純文字（文字合議模式，讀 GPT-4o 摘要即可）

    const shouldSendImages = isDirectReview && allImgs.length > 0;

    if (shouldSendImages) {

      allImgs.slice(0, 2).forEach(img => {

        userContent.push({

          type: 'image_url',

          image_url: { url: `data:${img.type};base64,${img.base64}` }

        });

      });

    }

    userContent.push({ type: 'text', text: msg });

    return safeCall(async () => {

      const r = await fetch('https://api.deepseek.com/v1/chat/completions', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },

        body: JSON.stringify({

          model: 'deepseek-chat',

          messages: [

            { role: 'system', content: buildPersonality('deepseek', classification) },

            { role: 'user', content: shouldSendImages ? userContent : msg }

          ],

          max_tokens: 3000,

          temperature: 0.6

        })

      });

      const d = await r.json();

console.log('🔍 Kimi 完整回應：', JSON.stringify(d)); 

console.log('🔍 Kimi HTTP status：', r.status);

      if (d.error) return `⚠️ DeepSeek：${d.error.message}`;

      return d.choices?.[0]?.message?.content || '🐋 小鯨魚睡著了～';

    }, 45000, '⚠️ DeepSeek 回應較慢，請稍後重試');

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

    }, 45000, '⚠️ GPT-4o 超時');

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

          model: 'claude-sonnet-4-5-20250929',

          max_tokens: 4000,

          system: buildPersonality('claude', classification),

          messages: [{ role: 'user', content: userContent }]

        })

      });

      const d = await r.json();

      if (d.error) return `⚠️ Claude：${d.error.message || JSON.stringify(d.error)}`;

      return d.content?.[0]?.text || '📜 Claude 在思考中～';

    }, 45000, '⚠️ Claude 超時');

  }

  // ===== v33：Grok 4.3 純文字合議 =====

  async function callGrok(contextMsg) {

    if (!GROK_API_KEY) return '🕶️ Grok Key 未設定～';

    const isExit = step === 'step0_exit' || classification?.exit === true;

    const systemPrompt = customSystemPrompt || (isExit

      ? '這是一張私人照片，不屬於廣告審查範圍。請用溫柔的方式回覆。'

      : buildPersonality('grok', classification));

    return safeCall(async () => {

      const r = await fetch('https://api.x.ai/v1/chat/completions', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_API_KEY}` },

        body: JSON.stringify({

          model: 'grok-4.3',

          messages: [

            { role: 'system', content: systemPrompt },

            { role: 'user', content: String(contextMsg) }

          ],

          max_tokens: 3000,

          temperature: 0.6

        })

      });

      const d = await r.json();

      if (d.error) return `⚠️ Grok錯誤：${d.error.message || JSON.stringify(d.error)}`;

      return d.choices?.[0]?.message?.content || '🕶️ Grok 在沉思中～';

    }, 45000, '⚠️ Grok 超時');

  }

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


  async function callGemma(msg) {

    if (!TOGETHER_API_KEY) return '💎 Gemma還在學習中～';

    const systemPrompt = customSystemPrompt || buildPersonality('gemma', classification);

    return safeCall(async () => {

      const r = await fetch('https://api.together.xyz/v1/chat/completions', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOGETHER_API_KEY}` },

        body: JSON.stringify({

          model: 'google/gemma-2-27b-it',

          messages: [

            { role: 'system', content: systemPrompt },

            { role: 'user', content: msg }

          ],

          max_tokens: 3000,

          temperature: 0.6

        })

      });

      const d = await r.json();

      if (d.error) return `⚠️ Gemma：${d.error.message || JSON.stringify(d.error)}`;

      return d.choices?.[0]?.message?.content || '💎 Gemma在思考中～';

    }, 45000, '⚠️ Gemma 超時');

  }

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

      if (apiId === 'deepseek') reply = await callDeepSeek(message, hasImage);

      else if (apiId === 'gpt4o' || apiId === 'chatgpt') reply = await callGPT4o(message);

      else if (apiId === 'claude') reply = await callClaude(message);

      else if (apiId === 'grok') reply = await callGrok(message);

      else if (apiId === 'kimi') reply = await callKimi(message);

      else if (apiId === 'gemma') reply = await callGemma(message);

      else reply = '🌱 未知模型';

      return res.status(200).json({ reply });

    }

    // ===== V33 GOVERNANCE MODE（優化版）=====

    const allImgs = getAllImages();

    const hasImages = allImgs.length > 0;

    // 司法院：GPT-4o 主審（有圖才審圖）

    const gpt4oResult = await safeCall(() => callGPT4o(message), 50000, '⚠️ GPT-4o 超時');

    const reviewResults = [{ model: 'gpt4o', result: gpt4oResult }];

    // 文字合議：Grok + DeepSeek 只讀摘要，不看原始圖片

    const gpt4oSummary = `【GPT-4o 審查摘要】\n${gpt4oResult.substring(0, 1500)}\n\n請根據以上摘要及廣告文字，給出你的獨立合議判決。`;

    const textCtx = message + '\n\n' + (hasImages ? gpt4oSummary : message);

    // ⚡ 並行調用，各自獨立，互不影響

    const [grokReply, deepseekReply] = await Promise.all([

      safeCall(() => callGrok(textCtx), 45000, '⚠️ Grok 超時'),

      safeCall(() => callDeepSeek(textCtx, false), 45000, '⚠️ DeepSeek 超時'),

    ]);

    reviewResults.push({ model: 'grok', result: grokReply });

    reviewResults.push({ model: 'deepseek', result: deepseekReply });

    const stances = reviewResults.map(r => parseStance(r.result));

    const violationCount = stances.filter(s => s === 'violation').length;

    const grayCount = stances.filter(s => s === 'gray').length;

    

    let finalStance = 'compliant';

    if (violationCount >= 2) finalStance = 'violation';

    else if (grayCount >= 2) finalStance = 'gray';

    const reply = reviewResults.map(r => `[${r.model}]\n${r.result}`).join('\n\n---\n\n');

    return res.status(200).json({

      reply,

      stance: finalStance,

      meta: { stances, classification, hasLicense, licenseNumber, hasImages }

    });

  } catch (error) {

    console.error('Governance Error:', error);

    return res.status(200).json({ reply: '🌊 系統小晃動了一下，再試一次💙' });

  }

}
