
const axios = require('axios');
const db = require('./database');

function detectLanguage(text){
  if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text)) return 'VI';
  if (/[\u0600-\u06FF]/.test(text)) return 'AR';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'KO';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'ZH';
  return 'EN';
}

function shouldTransferToHuman(text, conversation, aiConfig){
  const lower = text.toLowerCase();
  const keywords = aiConfig.trigger_keywords.split(',').map(k=>k.trim().toLowerCase());
  for (let kw of keywords){
    if (kw && lower.includes(kw)) return { should: true, reason: `Tu khoa trigger: ${kw}` };
  }
  if (aiConfig.triggers.chui_tuc && /(dm|dmm|chui|khieu nai|lua dao)/i.test(lower)) {
    return { should: true, reason: 'Khach chui / ngon tu tieu cuc' };
  }
  if (aiConfig.triggers.hoi_gia_3_lan){
    const priceAsks = conversation.messages.filter(m=>m.from==='customer' && /gia|bao nhieu|how much|rm|price/i.test(m.text)).length;
    if (priceAsks >= 3) return { should: true, reason: 'Hoi gia qua 3 lan khong chot' };
  }
  if (aiConfig.triggers.yeu_cau_gap_nguoi && /(gap nguoi|nhan vien|human|support)/i.test(lower)){
    return { should: true, reason: 'Khach yeu cau gap nguoi' };
  }
  return { should: false };
}

function buildPrompt(product, conversation, customerMessage, aiConfig){
  const systemPrompt = aiConfig.system_prompt;
  const kichBanGoc = product.kich_ban_goc.replace('{{name}}', conversation.customer_name);
  const history = conversation.messages.slice(-5).map(m=> `${m.from}: ${m.text}`).join('\n');
  const primaryLang = conversation.primary_lang || 'VI';
  const detectedLang = detectLanguage(customerMessage);
  
  let targetLang = detectedLang;
  const isAddress = /(dia chi|address|\d+.*duong|\d+.*street)/i.test(customerMessage);
  if (isAddress && primaryLang !== detectedLang){
    targetLang = primaryLang;
  }

  return {
    targetLang,
    detectedLang,
    prompt: `${systemPrompt}

KICH BAN GOC CUA SAN PHAM (1 O DUY NHAT - CHUA INFO+GIA+CHOT):
${kichBanGoc}

LICH SU CHAT 5 TIN GAN NHAT:
${history}

TIN NHAN MOI CUA KHACH (ngon ngu khach: ${detectedLang}, ngon ngu chinh: ${primaryLang}):
${customerMessage}

YEU CAU:
1. Tra loi bang dung ngon ngu cua khach: ${targetLang}
2. Dung nguyen kich ban goc, chi dich sang ${targetLang}, khong bia them combo gia
3. Neu khach gui dia chi bang ngon ngu khac, giu nguyen ngon ngu chinh ${primaryLang}
4. Luon hoi SDT truoc khi chot don neu chua co
`
  };
}

async function callAI(promptData, aiConfig){
  const { prompt, targetLang } = promptData;
  const apiKey = aiConfig.api_keys.openai;
  
  if (!apiKey || apiKey.includes('...')){
    const langMap = {
      'EN': `[EN Auto-translated] Hello! I'm AI assistant of ${targetLang}... Serum Vitamin C 20%... Buy 1 Get 1 Free 70 RM + 2 gifts... What combo do you want?`,
      'MY': `[MY Auto-translated] Hai! Saya AI Serum Vitamin C 20%... Beli 1 Percuma 1 70 RM + 2 hadiah...`,
      'KO': `[KO Auto-translated] Annyeonghaseyo! Vitamin C serum 20% AI... 1+1 70 RM + gift 2...`,
      'VI': prompt.split('KICH BAN GOC')[1]?.slice(0,500) || 'Mock VI reply'
    };
    return langMap[targetLang] || langMap['EN'];
  }

  try {
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: aiConfig.model || 'gpt-4o-mini',
      temperature: (aiConfig.temperature / 10) || 0.7,
      top_p: (aiConfig.top_p / 10) || 0.9,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    return res.data.choices[0].message.content;
  } catch (e){
    console.error('AI call error', e.response?.data || e.message);
    return `Da em dang ban chut, chi de lai SDT em goi lai tu van ky hon a! (Loi AI: ${e.message})`;
  }
}

async function translateForStaff(text, targetLang='VI'){
  return `[Dich sang ${targetLang}] ${text}`;
}

async function processMessage(pageId, customerId, text, conversation){
  const productId = db.page_product_map[pageId];
  const product = db.products.find(p=>p.id===productId);
  const aiConfig = db.ai_config;

  if (!product) return { reply: 'Chua gan san pham cho Page nay (1 Page = 1 SP)', transfer: false };

  const detectedLang = detectLanguage(text);
  const transferCheck = shouldTransferToHuman(text, conversation, aiConfig);
  if (transferCheck.should){
    return { 
      reply: null, 
      transfer: true, 
      reason: transferCheck.reason,
      detectedLang
    };
  }

  const promptData = buildPrompt(product, conversation, text, aiConfig);
  const reply = await callAI(promptData, aiConfig);

  let autoTags = [];
  if (/gia|bao nhieu|price|rm/i.test(text)) autoTags.push('dang_tu_van');
  if (/chot|ok|lay|mua|order/i.test(text)) autoTags.push('chot_don');

  return {
    reply,
    transfer: false,
    detectedLang: promptData.detectedLang,
    targetLang: promptData.targetLang,
    autoTags
  };
}

module.exports = { processMessage, detectLanguage, translateForStaff, buildPrompt, shouldTransferToHuman };
