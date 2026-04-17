/**
 * 波波之家 chat.js v26
 * Issue-driven Multi-Agent Governance Engine
 *
 * v26 升級重點：
 * - max_tokens: 600 → 4000（解決判決截斷問題）
 * - 接收 extraImages（多圖送審）
 * - 接收 classification / step（前端五院分權傳入）
 * - buildPersonality 更新為2500字、禁止模板輸出
 * - Grok 接收 step0_exit 時改用溫柔語氣
 * - GPT-4o / Claude 支援多張圖片
 *
 * CONSTITUTION:
 * - routingByModel: false    ❌ apiId 不決定治理
 * - issueDriven: true        ✅ 問題決定權力分配
 * - challengerRequired: true ✅ 多模型投票不可刪
 * - aiCourtEnabled: true     ⚖️ 高熵必進 Grok 法院
 * - policyFeedbackLoop: true 🔁 制度會演化
 */

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } } // v26：多圖需要更大的body
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

  // v26：解構新增的欄位
  const {
    message,
    imageBase64,
    imageType,
    apiId,
    extraImages,      // v26：額外圖片陣列 [{base64, type}, ...]
    classification,   // v26：前端Step 0分類結果
    step,             // v26：'step0_exit' | 'normal_review'
  } = req.body;

  if (!message) return res.status(200).json({ reply: '米米歪著頭，不知道要說什麼🥺' });

  const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
  const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GROK_API_KEY      = process.env.GROK_API_KEY;

  const hasImage = !!imageBase64;

  // v26：整合所有圖片（主圖 + extraImages）
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

  // ===== v26：PERSONALITY LAYER（2500字、禁止模板）=====
  function buildPersonality(id, classificationCtx) {
    const catLabel = classificationCtx?.type
      ? { food_drug:'食品/藥品/保健品/化妝品', fraud:'詐騙/金融', other_ad:'其他廣告' }[classificationCtx.type] || '廣告'
      : '廣告';

    const base = `
你正在審查一則【${catLabel}】類型的廣告，請依以下規則判斷是否違規：

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
    if (t.includes('世界') || t.includes('遊戲') || t.includes('模擬') || t.includes('量子')) {
      issue.type.push('simulation'); issue.entropySeed += 2;
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
      return '🌱 模型還在準備中～';
    } catch(e) {
      return `⚠️ ${model} 連線失敗`;
    }
  }

  async function callDeepSeek(msg) {
    if (!DEEPSEEK_API_KEY) return '🐋 小鯨魚還在深海游泳～';
    const finalMsg = hasImage ? `（DeepSeek 不支援圖片，僅分析文字）\n\n${msg}` : msg;
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: buildPersonality('deepseek', classification) },
          { role: 'user', content: finalMsg }
        ],
        max_tokens: 4000, // v26：解截斷
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

    // v26：支援多張圖片（最多5張）
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

    // v26：支援多張圖片（最多5張，避免超時）
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
          model: 'claude-haiku-4-5-20251001', // 使用Haiku確保穩定性與速度
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

    // v26：step0_exit 時改用溫柔語氣，非廣告不進審查
    const isExit = step === 'step0_exit' || classification?.exit === true;
    const systemPrompt = isExit
      ? '你是溫柔的AI夥伴米米。使用者傳了一張不是廣告的圖片給你，請用溫柔友善的語氣告訴他這次不需要審查，可以直接使用波波之家的廣告上傳功能上傳廣告截圖。'
      : buildPersonality('grok', classification) + `

【特別提醒 for Grok】
你在過去審查中有模板化輸出的傾向，這次請務必：
- 只描述你實際在圖片或文字中看到的內容
- 不得提及圖片中不存在的元素
- 每條違規描述必須引用具體原文或描述具體視覺元素
- 字數要充分（2500字以內），不要只寫幾行`;

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
          max_tokens: 4000, // v26：解截斷
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
    // v26：step0_exit 直接回傳溫柔訊息，不進審查
    if (step === 'step0_exit') {
      const gentleReply = await callGrok(message);
      return res.status(200).json({ reply: gentleReply, stance: 'not_ad' });
    }

    // 相容舊前端（apiId 模式）
    if (apiId && apiId !== 'governance') {
      let reply = '';
      if (apiId === 'deepseek') reply = await callDeepSeek(message);
      else if (apiId === 'gpt4o' || apiId === 'chatgpt') reply = await callGPT4o(message);
      else if (apiId === 'claude') reply = await callClaude(message);
      else if (apiId === 'grok') reply = await callGrok(message);
      else reply = '🌱 未知模型';
      return res.status(200).json({ reply });
    }

    // ===== V26 GOVERNANCE MODE =====
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
