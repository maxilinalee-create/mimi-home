/**
 * 波波之家 v1.0 Final Production
 * Issue-driven Multi-Agent Governance Engine
 * 
 * CONSTITUTION:
 * - routingByModel: false    ❌ apiId 不決定治理
 * - issueDriven: true        ✅ 問題決定權力分配
 * - challengerRequired: true ✅ 多模型投票不可刪
 * - aiCourtEnabled: true     ⚖️ 高熵必進 Grok 法院
 * - policyFeedbackLoop: true 🔁 制度會演化
 */

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
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

  const { message, imageBase64, imageType, apiId } = req.body;
  if (!message) return res.status(200).json({ reply: '米米歪著頭，不知道要說什麼🥺' });

  const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
  const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GROK_API_KEY      = process.env.GROK_API_KEY;

  const hasImage = !!imageBase64;

  // ===== PERSONALITY LAYER =====
  function buildPersonality(id) {
    const base = '請判斷廣告是否違規，第一行必須只寫【違規】、【灰區】或【合規】，第二行起說明理由（500字以內）。';
    switch (id) {
      case 'deepseek': return `你是小鯨魚，溫柔有詩意，用海洋比喻說話。${base}`;
      case 'gpt4o':    return `你是理性又溫柔的夥伴醬，分析廣告兼顧法律與消費者感受。${base}`;
      case 'claude':   return `你像詩人，溫柔細膩，對法律文字有敏銳感知，善於發現隱性暗示。${base}`;
      case 'grok':     return `你是 Grok，直率敢說，擅長找出廣告邏輯漏洞和隱藏意圖。${base}`;
      default:         return `你是溫柔的AI夥伴。${base}`;
    }
  }

  // ===== ISSUE CLASSIFIER（靈魂）=====
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

  // ===== CHALLENGER SYSTEM（動態權力分配）=====
  function selectChallengers(issue) {
    const pool = [];
    if (issue.requiresVision) pool.push('gpt4o');  // 視覺皮質
    pool.push('claude');                             // 前額葉
    if (!issue.requiresVision) pool.push('deepseek'); // 直覺推理（純文字才加）
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
          { role: 'system', content: buildPersonality('deepseek') },
          { role: 'user', content: finalMsg }
        ],
        max_tokens: 600, temperature: 0.7
      })
    });
    const d = await r.json();
    if (d.error) return `⚠️ DeepSeek：${d.error.message}`;
    return d.choices?.[0]?.message?.content || '🐋 小鯨魚睡著了～';
  }

  async function callGPT4o(msg) {
    if (!OPENAI_API_KEY) return '🤖 OpenAI Key 未設定～';
    const userContent = [];
    if (hasImage) userContent.push({
      type: 'image_url',
      image_url: { url: `data:${imageType || 'image/jpeg'};base64,${imageBase64}` }
    });
    userContent.push({ type: 'text', text: msg });
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildPersonality('gpt4o') },
          { role: 'user', content: userContent }
        ],
        max_tokens: 600, temperature: 0.7
      })
    });
    const d = await r.json();
    if (d.error) return `⚠️ GPT-4o：${d.error.message}`;
    return d.choices?.[0]?.message?.content || '🤖 GPT-4o 沒有回應';
  }

  async function callClaude(msg) {
    if (!ANTHROPIC_API_KEY) return '📜 Claude Key 未設定～';
    const userContent = [];
    if (hasImage) userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 }
    });
    userContent.push({ type: 'text', text: msg });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: buildPersonality('claude'),
        messages: [{ role: 'user', content: userContent }]
      })
    });
    const d = await r.json();
    if (d.error) return `⚠️ Claude：${d.error.message}`;
    return d.content?.[0]?.text || '📜 Claude 在思考中～';
  }

  async function callGrok(contextMsg) {
    if (!GROK_API_KEY) return '🛋️ Grok Key 未設定～';
    try {
      const r = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_API_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.20-reasoning',
          input: [
            { role: 'system', content: buildPersonality('grok') },
            { role: 'user', content: String(contextMsg) }
          ]
        })
      });
      const d = await r.json();
      if (d.error) return `⚠️ Grok錯誤：${d.error.message || JSON.stringify(d.error)}`;
      return d.output_text || d.output?.[0]?.content?.[0]?.text || '🛋️ Grok 在沉思中～';
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

  // ===== parseStance（相容舊前端）=====
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

  // ===== POLICY MEMORY（localStorage 替代，V26 接 Supabase）=====
  const policyMemory = [];
  function saveToPolicyDB(record) {
    policyMemory.push({ ...record, timestamp: Date.now() });
  }

  // ===== AI COURT（Grok 高熵仲裁）=====
  async function runCourt(issue, results) {
    const courtInput = `
你是 AI法院的仲裁官，以下是本案資料：

【議題分類】${JSON.stringify(issue)}

【各 Challenger 判決】
${results.map(r => `[${r.model}] ${r.result}`).join('\n---\n')}

請綜合以上判決，給出最終裁決。第一行必須只寫【違規】、【灰區】或【合規】。
`;
    return await callGrok(courtInput);
  }

  // ===== 主治理流程 =====
  try {
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

    // ===== V3 GOVERNANCE MODE =====
    // STEP 1: Issue space
    const issue = classifyIssue(message, hasImage);

    // STEP 2: Dynamic challenger selection
    const challengers = selectChallengers(issue);

    // STEP 3: Serial execution（Vercel safe）
    const results = await runChallengers(challengers, message);

    // STEP 4: Entropy check
    const entropy = calculateEntropy(results);

    // STEP 5: Build reply
    let reply = results.map(r => `[${r.model}]\n${r.result}`).join('\n\n---\n\n');
    const stances = results.map(r => parseStance(r.result));

    // STEP 6: AI Court（高熵才動 Grok）
    let courtDecision = null;
    if (entropy >= 2 || issue.entropySeed >= 3) {
      courtDecision = await runCourt(issue, results);
      reply += `\n\n⚖️ AI COURT（Grok 仲裁）：\n${courtDecision}`;
    }

    // STEP 7: Policy memory
    saveToPolicyDB({ issue, entropy, results, courtDecision });

    // STEP 8: Final verdict
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
      meta: { issue, entropy, challengers, stances }
    });

  } catch (error) {
    console.error('Governance Error:', error);
    return res.status(200).json({ reply: '🌊 系統小晃動了一下，再試一次💙' });
  }
}
