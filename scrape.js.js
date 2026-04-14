// api/scrape.js
// 波波之家廣告爬蟲模組 v1
// 不需要 puppeteer，純 fetch 抓取公開廣告資料

export default async function handler(req, res) {
  // ===== CORS =====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { mode, keyword, url } = req.body || req.query;

  // ===== 模式1：關鍵字搜尋FB廣告資料庫 =====
  if (mode === 'fb_search' && keyword) {
    try {
      // Facebook Ad Library 公開搜尋
      const fbUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TW&q=${encodeURIComponent(keyword)}&search_type=keyword_unordered`;

      const response = await fetch(fbUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
        }
      });

      const html = await response.text();

      // 從HTML抓取廣告文字（基本解析）
      const adTexts = extractAdTexts(html);

      return res.status(200).json({
        success: true,
        mode: 'fb_search',
        keyword,
        count: adTexts.length,
        ads: adTexts,
        note: adTexts.length === 0
          ? 'FB廣告資料庫需要登入才能看完整內容，請使用手動模式'
          : '成功抓取廣告文字'
      });

    } catch (error) {
      return res.status(200).json({
        success: false,
        mode: 'fb_search',
        error: error.message,
        fallback: true,
        ads: generateMockAds(keyword)
      });
    }
  }

  // ===== 模式2：手動貼上URL，我們抓取頁面標題和描述 =====
  if (mode === 'url_fetch' && url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-TW,zh;q=0.9',
        },
        signal: AbortSignal.timeout(8000) // 8秒超時
      });

      const html = await response.text();

      // 抓取關鍵資訊
      const title = extractMeta(html, 'og:title') ||
                    extractTag(html, 'title') || '無標題';
      const description = extractMeta(html, 'og:description') ||
                          extractMeta(html, 'description') || '無描述';
      const image = extractMeta(html, 'og:image') || '';

      // 組合廣告文字
      const adText = `${title} ${description}`.trim();

      return res.status(200).json({
        success: true,
        mode: 'url_fetch',
        url,
        adText,
        title,
        description,
        image,
        note: '成功抓取頁面資訊'
      });

    } catch (error) {
      return res.status(200).json({
        success: false,
        mode: 'url_fetch',
        error: error.message,
        note: '無法抓取此網址，可能需要登入或有防護機制'
      });
    }
  }

  // ===== 模式3：模擬廣告資料（測試用） =====
  if (mode === 'mock' || !mode) {
    const mockAds = [
      {
        id: 'mock_001',
        platform: 'Facebook',
        advertiser: '某健康食品公司',
        text: '7天淡斑美白！醫師推薦！保證有效！限量搶購！',
        category: '美容保養',
        date: new Date().toLocaleDateString('zh-TW')
      },
      {
        id: 'mock_002',
        platform: 'Facebook',
        advertiser: '某減肥產品',
        text: '30天瘦20公斤！不節食不運動！100%純天然！',
        category: '健康減重',
        date: new Date().toLocaleDateString('zh-TW')
      },
      {
        id: 'mock_003',
        platform: 'Facebook',
        advertiser: '某保健品牌',
        text: '根治糖尿病！逆轉三高！中醫秘方千年驗證！',
        category: '醫療保健',
        date: new Date().toLocaleDateString('zh-TW')
      },
      {
        id: 'mock_004',
        platform: 'Shopee',
        advertiser: '蝦皮某賣家',
        text: '買一送一！限時特價！治療失眠只需3天！保證退款！',
        category: '睡眠保健',
        date: new Date().toLocaleDateString('zh-TW')
      },
      {
        id: 'mock_005',
        platform: 'Facebook',
        advertiser: '某化妝品牌',
        text: '使用後皮膚年輕20歲！消除所有皺紋！皮膚科醫師強力推薦！',
        category: '美容保養',
        date: new Date().toLocaleDateString('zh-TW')
      }
    ];

    return res.status(200).json({
      success: true,
      mode: 'mock',
      count: mockAds.length,
      ads: mockAds,
      note: '模擬廣告資料（真實爬蟲需要後端伺服器）'
    });
  }

  return res.status(200).json({
    success: false,
    note: '請提供 mode 參數：fb_search / url_fetch / mock'
  });
}

// ===== 工具函數 =====

function extractAdTexts(html) {
  const texts = [];
  // 嘗試抓取JSON-LD結構化資料
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  if (jsonLdMatch) {
    jsonLdMatch.forEach(script => {
      try {
        const data = JSON.parse(script.replace(/<script type="application\/ld\+json">/, '').replace('</script>', ''));
        if (data.description) texts.push(data.description);
        if (data.name) texts.push(data.name);
      } catch (e) {}
    });
  }

  // 嘗試抓取meta description
  const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
  if (metaDesc) texts.push(metaDesc[1]);

  return texts.filter(t => t.length > 10);
}

function extractMeta(html, property) {
  // og: 標籤
  const ogMatch = html.match(
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i')
  ) || html.match(
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, 'i')
  );
  if (ogMatch) return ogMatch[1];

  // name 標籤
  const nameMatch = html.match(
    new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i')
  );
  if (nameMatch) return nameMatch[1];

  return null;
}

function extractTag(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function generateMockAds(keyword) {
  return [{
    id: 'fallback_001',
    platform: 'Facebook',
    text: `${keyword}相關廣告（模擬）- 保證有效！醫師推薦！限時特價！`,
    note: 'FB需要登入才能抓取，這是備援模擬資料'
  }];
}
