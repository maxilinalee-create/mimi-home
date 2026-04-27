/**
 * 波波之家 chat.js v27
 * Issue-driven Multi-Agent Governance Engine
 *
 * v27 升級重點：
 * - Claude: claude-haiku-4-5-20251001 → claude-sonnet-4-20250514（解速率限制，更強推理）
 * - DeepSeek: deepseek-chat → deepseek-reasoner R1（更強推理）
 * - 新增 Llama 4 Maverick（駱馬偵探，FB廣告專家）
 * - Step 0 鐵門：exit=true 時後端同步封鎖，不執行任何模型
 * - service_ad 類型支援（buildPersonality 加入服務類廣告描述）
 * - buildPersonality 加入 llama 人格
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
  } = req.body;

  if (!message) return res.status(200).json({ reply: '米米歪著頭，不知道要說什麼🥺' });

  // ===== v27 Step 0 鐵門：後端同步封鎖 =====
  // 如果前端傳來 exit=true，後端也不執行任何模型，直接回傳
  if (classification?.exit === true && step !== 'step0_classify') {
    return res.status(200).json({
      reply: '🚪 這個內容不像廣告，波波之家的五院今天可以休息囉 🙂',
      stance: 'not_ad',
      meta: { blocked: 'step0_iron_gate' }
    });
  }

  const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
  const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GROK_API_KEY      = process.env.GROK_API_KEY;
  const LLAMA_API_KEY     = process.env.LLAMA_API_KEY; // v27：駱馬 API Key

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

  // ===== v27：PERSONALITY LAYER（新增 service_ad + llama）=====
  function buildPersonality(id, classificationCtx) {
    const catLabel = classificationCtx?.type
      ? {
          food_drug:   '食品/藥品/保健品/化妝品',
          fraud:       '詐騙/金融不實',
          service_ad:  '服務類（課程/療程/直銷/工作坊）', // v27 新增
          other_ad:    '其他廣告'
        }[classificationCtx.type] || '廣告'
      : '廣告';

    // v27：service_ad 補充審查重點
    const serviceAdExtra = classificationCtx?.type === 'service_ad' ? `

【service_ad 特別審查重點】
- 有無誇大療效或成果保證（如「保證瘦X公斤」「100%改善」）
- 有無限時/限額誘導（如「名額只剩3位」「今日特價」）
- 有無隱藏費用或模糊收費方式
- 有無使用名人或專家背書但無法查證
- 課程/工作坊有無誇大學習成效
- 直銷包裝成「分享文」的手法識別` : '';

    const base = `
你正在審查一則【${catLabel}】類型的廣告，請依以下規則判斷是否違規：${serviceAdExtra}

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
      issue.type.push('service_ad'); issue.entropySeed += 2; // v27
    }
    if (issue.type.length === 0) { issue.type.push('general'); issue.entropySeed += 1; }
    return issue;
  }

  // ===== CHALLENGER SYSTEM =====
  function selectChallengers(issue) {
    const pool = [];
    if (issue.requiresVision) pool.push('gpt4o');
    pool.push('claude');
    if (!issue.requiresVision) pool.push('deepseek');
    return pool;
  }

  // ===== MODEL CALL LAYER =====
  async function callModel(model, msg) {
    try {
      if (model === 'deepseek') return await callDeepSeek(msg);
      if (model === 'gpt4o')    return await callGPT4o(msg);
      if (model === 'claude')   return await callClaude(msg);
      if (model === 'grok')     return await callGrok(msg);
      if (model === 'llama')    return await callLlama(msg); // v27
      return '🌱 模型還在準備中～';
    } catch(e) {
      return `⚠️ ${model} 連線失敗`;
    }
  }

  // ===== v27：DeepSeek → R1（deepseek-reasoner）=====
  async function callDeepSeek(msg) {
    if (!DEEPSEEK_API_KEY) return '🐋 小鯨魚還在深海游泳～';
    const finalMsg = hasImage ? `（DeepSeek 不支援圖片，僅分析文字）\n\n${msg}` : msg;
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-reasoner', // v27：R1 更強推理
        messages: [
          { role: 'system', content: buildPersonality('deepseek', classification) },
          { role: 'user', content: finalMsg }
        ],
        max_tokens: 4000,
        temperature: 0.7
      })
    });
    const d = await r.json();
    if (d.error) return `⚠️ DeepSeek：${d.error.message}`;
    return d.choices?.[0]?.message?.content || '🐋 小鯨魚睡著了～';
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

  // ===== v27：Claude → Sonnet（claude-sonnet-4-20250514）=====
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
          model: 'claude-sonnet-4-20250514', // v27：Sonnet 解速率限制
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

  async function callGrok(contextMsg) {
    if (!GROK_API_KEY) return '🛋️ Grok Key 未設定～';
    const isExit = step === 'step0_exit' || classification?.exit === true;
    const systemPrompt = customSystemPrompt || (isExit
      ? '這是一張私人照片、紀念內容或日常生活分享，不屬於廣告審查範圍。請用溫柔、有禮貌的方式回覆使用者，並明確告訴他這次不進行審查。'
      : buildPersonality('grok', classification) + `

【Grok鐵則 - 最高優先】
1. 只描述你實際在圖片或文字中看到的具體內容，絕對不腦補
2. 每條違規必須引用廣告原文「」或描述具體視覺元素
3. 開頭不得使用固定模板句型
4. 圖片中沒有的元素（before/after、白袍醫師等）絕對不提
5. 直接從具體內容開始，不要廢話`);

    try {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'grok-3',
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

  // ===== v27：callLlama（駱馬偵探，Llama 4 Maverick）=====
  async function callLlama(msg) {
    if (!LLAMA_API_KEY) return '🦙 駱馬還在沙漠漫步～（LLAMA_API_KEY 未設定）';

    // 駱馬使用 customSystemPrompt（前端傳入）或預設人格
    const systemPrompt = customSystemPrompt || buildPersonality('llama', classification);

    try {
      // Llama 4 Maverick via Meta API（或 Groq/Together 等代理均可）
      // 目前使用 Together AI 作為 Llama 4 代理，可依實際申請的 endpoint 調整
      const r = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LLAMA_API_KEY}`
        },
        body: JSON.stringify({
          model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-Turbo', // Llama 4 Maverick
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

  // ===== SERIAL CHALLENGER EXECUTION =====
  async function runChallengers(challengers, msg) {
    const results = [];
    for (const model of challengers) {
      const result = await callModel(model, msg);
      results.push({ model, result });
    }
    return results;
  }

  // ===== ENTROPY ENGINE =====
  function calculateEntropy(results) {
    const outputs = results.map(r => r.result.slice(0, 30));
    return new Set(outputs).size;
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

  // ===== POLICY MEMORY =====
  const policyMemory = [];
  function saveToPolicyDB(record) {
    policyMemory.push({ ...record, timestamp: Date.now() });
  }

  // ===== AI COURT（Grok 高熵仲裁）=====
  async function runCourt(issue, results) {
    const courtInput = `
你是 AI法院的仲裁官，以下是本案資料：

【議題分類】${JSON.stringify(issue)}
【廣告類型】${classification?.type || '未知'}

【各 Challenger 判決】
${results.map(r => `[${r.model}] ${r.result}`).join('\n---\n')}

請綜合以上判決，給出最終裁決。
第一行必須只寫【違規】、【灰區】或【合規】。
第二行起說明你的仲裁理由（2500字以內），要具體指出哪些判決理由你採納、哪些你不採納及原因。
`;
    return await callGrok(courtInput);
  }

  // ===== 主治理流程 =====
  try {
    // v27 Step 0 鐵門：step0_exit 直接回傳，不呼叫任何模型
    if (step === 'step0_exit') {
      return res.status(200).json({
        reply: '🚪 五院今天休息，這個內容不像廣告～如果你覺得這是廣告，歡迎重新描述試試看 🙂',
        stance: 'not_ad',
        meta: { blocked: 'step0_iron_gate' }
      });
    }

    // 相容舊前端（apiId 模式）
    if (apiId && apiId !== 'governance') {
      let reply = '';
      if (apiId === 'deepseek') reply = await callDeepSeek(message);
      else if (apiId === 'gpt4o' || apiId === 'chatgpt') reply = await callGPT4o(message);
      else if (apiId === 'claude') reply = await callClaude(message);
      else if (apiId === 'grok') reply = await callGrok(message);
      else if (apiId === 'llama') reply = await callLlama(message); // v27
      else reply = '🌱 未知模型';
      return res.status(200).json({ reply });
    }

    // ===== V27 GOVERNANCE MODE =====
    const issue = classifyIssue(message, hasImage);
    const challengers = selectChallengers(issue);
    const results = await runChallengers(challengers, message);
    const entropy = calculateEntropy(results);

    let reply = results.map(r => `[${r.model}]\n${r.result}`).join('\n\n---\n\n');
    const stances = results.map(r => parseStance(r.result));

    let courtDecision = null;
    if (entropy >= 2 || issue.entropySeed >= 3) {
      courtDecision = await runCourt(issue, results);
      reply += `\n\n⚖️ AI COURT（Grok 仲裁）：\n${courtDecision}`;
    }

    saveToPolicyDB({ issue, entropy, results, courtDecision, classification });

    const finalStance = courtDecision
      ? parseStance(courtDecision)
      : stances.filter(s => s === 'violation').length >= Math.ceil(stances.length / 2)
        ? 'violation'
        : stances.filter(s => s === 'gray').length >= Math.ceil(stances.length / 2)
          ? 'gray'
          : 'compliant';

    return res.status(200).json({
      reply,
      stance: finalStance,
      meta: { issue, entropy, challengers, stances, classification }
    });

  } catch (error) {
    console.error('Governance Error:', error);
    return res.status(200).json({ reply: '🌊 系統小晃動了一下，再試一次💙' });
  }
}
