/**
 * 波波之家 chat.js v29
 * Issue-driven Multi-Agent Governance Engine
 *
 * v28 升級重點：
 * - Step 0.5 標章確認機制：food_drug類傳入hasLicense影響審查標準
 * - 新增 Kimi K2.6（事實查核官，能看圖，透過Together AI）
 * - 新增 Qwen（加入整體合議，與Grok共同判決，透過Together AI）
 * - DeepSeek 升級到 V4（支援看圖！）
 * - 駱馬修復：改用 Groq 正確模型名稱 llama-4-maverick-17b-128e-instruct
 * - 事實查核機制：Kimi逐條核查Grok判決，標記腦補項目
 *
 * CONSTITUTION:
 * - routingByModel: false    ❌ apiId 不決定治理
 * - issueDriven: true        ✅ 問題決定權力分配
 * - challengerRequired: true ✅ 多模型投票不可刪
 * - aiCourtEnabled: true     ⚖️ 高熵必進 Grok 法院
 * - factCheckEnabled: true   🔍 Kimi事實查核，防止腦補
 * - policyFeedbackLoop: true 🔁 制度會演化
 */

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } }
};

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
    hasLicense,      // v28：Step 0.5 標章確認結果（true/false/null）
    licenseNumber,   // v28：字號內容（如「衛署健食字第A00123號」）
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

  // ===== v28 Step 0 鐵門：step0_exit =====
  if (step === 'step0_exit') {
    return res.status(200).json({
      reply: '🚪 五院今天休息，這個內容不像廣告～如果你覺得這是廣告，歡迎重新描述試試看 🙂',
      stance: 'not_ad',
      meta: { blocked: 'step0_iron_gate' }
    });
  }

  const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
  const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GROK_API_KEY      = process.env.GROK_API_KEY;
  const GROQ_API_KEY      = process.env.GROQ_API_KEY;      // v28：駱馬用Groq
  const TOGETHER_API_KEY  = process.env.TOGETHER_API_KEY;  // v28：Kimi + Qwen用Together

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

  // ===== v28：標章資訊注入 =====
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

  // ===== v28：PERSONALITY LAYER =====
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
      case 'llama':    return `你是 Llama，波波之家的「駱馬偵探」，FB廣告生態系專家。你熟悉 Meta 廣告政策、Facebook/Instagram 廣告格式，以及社群平台常見的誇大宣傳手法。請特別留意：社群廣告常用「分享文」「見證文」包裝，需識別背後的商業意圖。\n\n${base}`;
      case 'kimi':     return `你是 Kimi，波波之家的「事實查核官」。你的任務是：審查廣告時只描述你實際看到的內容，對任何腦補或不實描述零容忍。你擅長精確辨識廣告圖片中的文字和視覺元素。\n\n${base}`;
      case 'qwen':     return `你是千問（Qwen），波波之家的「東方視角合議官」。你熟悉華語市場的廣告手法，特別是台灣、中國、香港常見的保健品和服務廣告違規模式。\n\n${base}`;
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
      if (model === 'llama')    return await callLlama(msg);
      if (model === 'kimi')     return await callKimi(msg);
      if (model === 'qwen')     return await callQwen(msg);
      return '🌱 模型還在準備中～';
    } catch(e) {
      return `⚠️ ${model} 連線失敗`;
    }
  }

  // ===== DeepSeek V4（支援看圖！）=====
  async function callDeepSeek(msg) {
    if (!DEEPSEEK_API_KEY) return '🐋 小鯨魚還在深海游泳～';
    const userContent = [];
    // v28：DeepSeek V4 支援圖片
    const allImgs = getAllImages().slice(0, 3);
    allImgs.forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.type};base64,${img.base64}` }
      });
    });
    userContent.push({ type: 'text', text: msg });
    try {
      const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-v4-flash', // v28：V4支援看圖，含推理
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
    } catch(e) {
      return `⚠️ DeepSeek連線失敗：${e.message}`;
    }
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
    try {
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
    } catch(e) {
      return `⚠️ GPT-4o連線失敗：${e.message}`;
    }
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
    try {
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
    } catch(e) {
      return `⚠️ Claude連線失敗：${e.message}`;
    }
  }

  // ===== v28：Grok 純文字合議（移除看圖，避免腦補）=====
  async function callGrok(contextMsg) {
    if (!GROK_API_KEY) return '🛋️ Grok Key 未設定～';
    const isExit = step === 'step0_exit' || classification?.exit === true;
    const systemPrompt = customSystemPrompt || (isExit
      ? '這是一張私人照片、紀念內容或日常生活分享，不屬於廣告審查範圍。請用溫柔、有禮貌的方式回覆使用者。'
      : buildPersonality('grok', classification) + `

【Grok鐵則 - 最高優先】
你現在只能看到其他AI夥伴對圖片的文字描述，不能直接看圖。
1. 只根據其他AI夥伴的文字判決和廣告文字內容做合議
2. 不得自行描述或推測圖片中的視覺元素
3. 你的角色是「整合各方判決，找出共識或分歧」
4. 給出最終【違規】【灰區】或【合規】判決，說明採納哪些AI意見、排除哪些
5. 直接從具體判決內容開始，不要廢話`);

    try {
      // v28：Grok不傳圖片，純文字合議
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_API_KEY}` },
        body: JSON.stringify({
          model: 'grok-3', // v28：穩定版（grok-4.20非標準名稱）
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: String(contextMsg) }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Grok錯誤：${d.error.message || JSON.stringify(d.error)}`;
      return d.choices?.[0]?.message?.content || '🛋️ Grok 在沉思中～';
    } catch(e) {
      return `⚠️ Grok連線失敗：${e.message}`;
    }
  }

  // ===== v28：駱馬（Groq，修正模型名稱）=====
  async function callLlama(msg) {
    if (!GROQ_API_KEY) return '🦙 駱馬還在沙漠漫步～（GROQ_API_KEY 未設定）';
    const systemPrompt = customSystemPrompt || buildPersonality('llama', classification);
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-maverick-17b-128e-instruct', // v28：修正模型名稱
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: msg }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Llama：${d.error.message || JSON.stringify(d.error)}`;
      return d.choices?.[0]?.message?.content || '🦙 駱馬在想事情～';
    } catch(e) {
      return `⚠️ Llama連線失敗：${e.message}`;
    }
  }

  // ===== v28：Kimi K2.5（事實查核官，能看圖，Together AI）=====
  async function callKimi(msg, singleImg=null) {
    if (!TOGETHER_API_KEY) return '🌙 Kimi還在宇宙旅行～（TOGETHER_API_KEY 未設定）';
    const systemPrompt = customSystemPrompt || buildPersonality('kimi', classification);
    const userContent = [];
    // v28修正：支援單張圖片傳入（用於逐圖審查）
    const imgs = singleImg ? [singleImg] : getAllImages().slice(0, 3);
    imgs.forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.type};base64,${img.base64}` }
      });
    });
    userContent.push({ type: 'text', text: msg });
    try {
      const r = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOGETHER_API_KEY}` },
        body: JSON.stringify({
          model: 'moonshotai/Kimi-K2.5', // v28修正：正確模型名稱
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: imgs.length > 0 ? userContent : msg }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Kimi：${d.error.message || JSON.stringify(d.error)}`;
      return d.choices?.[0]?.message?.content || '🌙 Kimi在思考中～';
    } catch(e) {
      return `⚠️ Kimi連線失敗：${e.message}`;
    }
  }

  // ===== v28：Qwen2.5-VL（整體合議官，能看圖，Together AI）=====
  async function callQwen(msg, singleImg=null) {
    if (!TOGETHER_API_KEY) return '🌊 千問還在修煉～（TOGETHER_API_KEY 未設定）';
    const systemPrompt = customSystemPrompt || buildPersonality('qwen', classification);
    const userContent = [];
    // v28修正：Qwen2.5-VL支援看圖，加入圖片傳遞
    const imgs = singleImg ? [singleImg] : getAllImages().slice(0, 3);
    imgs.forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.type};base64,${img.base64}` }
      });
    });
    userContent.push({ type: 'text', text: msg });
    try {
      const r = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOGETHER_API_KEY}` },
        body: JSON.stringify({
          model: 'Qwen/Qwen2.5-VL-7B-Instruct', // v28修正：7B版Serverless，72B需Dedicated
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: imgs.length > 0 ? userContent : msg }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Qwen：${d.error.message || JSON.stringify(d.error)}`;
      return d.choices?.[0]?.message?.content || '🌊 千問在冥想中～';
    } catch(e) {
      return `⚠️ Qwen連線失敗：${e.message}`;
    }
  }

  // ===== v28：Kimi事實查核（核查Grok判決）=====
  async function runFactCheck(grokReply, images) {
    if (!TOGETHER_API_KEY) return null;
    const validImgs = (images || []).filter(Boolean);
    const factCheckPrompt = `你是事實查核官。以下是 Grok 對這則廣告的判決：

---
${grokReply}
---

請逐條核查 Grok 的判決，判斷每一條違規描述是否真的能從圖片或文字中直接看出來。

回傳格式：
【事實查核結果】
- ✅ 有依據：[描述具體看到的內容]
- ❌ 無依據（疑似腦補）：[Grok說了但實際沒有的內容]

最後一行寫：腦補率：X%（無依據項目/總項目）`;

    const userContent = [];
    validImgs.slice(0, 3).forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.type};base64,${img.base64}` }
      });
    });
    userContent.push({ type: 'text', text: factCheckPrompt });

    try {
      const r = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOGETHER_API_KEY}` },
        body: JSON.stringify({
          model: 'moonshotai/Kimi-K2.5',
          messages: [
            { role: 'system', content: '你是嚴格的事實查核官，只相信圖片和文字中實際存在的內容。' },
            { role: 'user', content: validImgs.length > 0 ? userContent : factCheckPrompt }
          ],
          max_tokens: 2000,
          temperature: 0.3
        })
      });
      const d = await r.json();
      return d.choices?.[0]?.message?.content || null;
    } catch(e) {
      return null;
    }
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

  // ===== AI COURT（Grok + Qwen 雙重合議）=====
  async function runCourt(issue, results) {
    const courtInput = `
你是 AI法院的仲裁官，以下是本案資料：

【議題分類】${JSON.stringify(issue)}
【廣告類型】${classification?.type || '未知'}
【標章狀況】${hasLicense === true ? '有政府核准字號：' + licenseNumber : hasLicense === false ? '無政府核准字號' : '不確定'}

【各 Challenger 判決】
${results.map(r => `[${r.model}] ${r.result}`).join('\n---\n')}

請綜合以上判決，給出最終裁決。
第一行必須只寫【違規】、【灰區】或【合規】。
第二行起說明仲裁理由（2500字以內）。
`;
    // v28：Grok + Qwen 雙重合議
    const [grokResult, qwenResult] = await Promise.all([
      callGrok(courtInput),
      callQwen(courtInput)
    ]);
    return { grok: grokResult, qwen: qwenResult };
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
      else if (apiId === 'llama') reply = await callLlama(message);
      else if (apiId === 'kimi') reply = await callKimi(message);
      else if (apiId === 'qwen') reply = await callQwen(message);
      else reply = '🌱 未知模型';
      return res.status(200).json({ reply });
    }

    // ===== V28 GOVERNANCE MODE =====
    const issue = classifyIssue(message, hasImage);
    const allImgs = getAllImages();

    // 司法院：多AI並行審查
    const reviewResults = await Promise.all([
      callClaude(message).then(r => ({ model: 'claude', result: r })),
      callGPT4o(message).then(r => ({ model: 'gpt4o', result: r })),
      callDeepSeek(message).then(r => ({ model: 'deepseek', result: r })),
    ]);

    // Grok 合議
    const grokReply = await callGrok(message);
    reviewResults.push({ model: 'grok', result: grokReply });

    // v28：Kimi 事實查核 Grok
    let factCheckResult = null;
    if (hasImage) {
      factCheckResult = await runFactCheck(grokReply, allImgs);
    }

    // v28：Qwen 加入合議
    const qwenReply = await callQwen(message);
    reviewResults.push({ model: 'qwen', result: qwenReply });

    const stances = reviewResults.map(r => parseStance(r.result));
    const finalStance = stances.filter(s => s === 'violation').length >= Math.ceil(stances.length / 2)
      ? 'violation'
      : stances.filter(s => s === 'gray').length >= Math.ceil(stances.length / 2)
        ? 'gray'
        : 'compliant';

    let reply = reviewResults.map(r => `[${r.model}]\n${r.result}`).join('\n\n---\n\n');
    if (factCheckResult) {
      reply += `\n\n🔍 Kimi事實查核：\n${factCheckResult}`;
    }

    return res.status(200).json({
      reply,
      stance: finalStance,
      factCheck: factCheckResult,
      meta: { issue, stances, classification, hasLicense, licenseNumber }
    });

  } catch (error) {
    console.error('Governance Error:', error);
    return res.status(200).json({ reply: '🌊 系統小晃動了一下，再試一次💙' });
  }
}
