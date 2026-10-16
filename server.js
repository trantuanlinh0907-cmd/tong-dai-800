require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const db = require('./database');
const brain = require('./brain');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// ===== ENV =====
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || (db.ai_config.bm_config && db.ai_config.bm_config.verify_token) || 'tong_dai_800_verify_2024';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN || '';
const FB_API_VERSION = process.env.FB_API_VERSION || 'v19.0';

console.log('[ENV] PORT=' + PORT);
console.log('[ENV] VERIFY_TOKEN=' + (VERIFY_TOKEN ? 'set' : 'EMPTY'));
console.log('[ENV] PAGE_ACCESS_TOKEN=' + (PAGE_ACCESS_TOKEN ? 'set (' + PAGE_ACCESS_TOKEN.slice(0, 6) + '...' + PAGE_ACCESS_TOKEN.slice(-4) + ', len=' + PAGE_ACCESS_TOKEN.length + ')' : 'NOT SET - Send-to-Facebook se bi loi 401'));
console.log('[ENV] FB_API_VERSION=' + FB_API_VERSION);

// ===== APP =====
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));

// Block sensitive files
app.use((req, res, next) => {
  const forbidden = ['.env', 'database.js', 'brain.js', 'server.js', 'package.json', 'package-lock.json', 'render.yaml', 'start.bat', 'start.sh', 'vercel.json'];
  const url = req.url.toLowerCase();
  if (forbidden.some(f => url.endsWith(f) || url.includes(f + '?') || url === '/' + f)) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// ===== SOCKET REALTIME =====
io.on('connection', (socket) => {
  console.log('[SOCKET] Client connected: ' + socket.id);
  socket.emit('init_data', {
    conversations: db.conversations.slice(0, 100),
    overview: db.overview,
    pages: db.pages.length
  });
  socket.on('disconnect', () => {
    console.log('[SOCKET] Client disconnected: ' + socket.id);
  });
  socket.on('request_refresh', () => {
    socket.emit('conversations_updated', db.conversations.slice(0, 100));
  });
});

// ===== EMIT HELPERS =====
function emitNewMessage(conv, newMsg) {
  io.emit('new_message', {
    conversationId: conv.id,
    message: newMsg,
    conversation: conv,
    timestamp: new Date().toISOString()
  });
  io.emit('conversations_updated', db.conversations.slice(0, 100));
  io.emit('overview_update', db.overview);
}

function emitConvUpdate(conv) {
  io.emit('conversation_update', conv);
  io.emit('conversations_updated', db.conversations.slice(0, 100));
}

// ===== FACEBOOK MESSENGER API =====

/**
 * Lay ten that cua khach tu Facebook Graph API: /{psid}?fields=first_name,last_name,name
 * Tra ve {ok, name, psid} - neu fail thi ok=false
 */
async function getFacebookUserProfile(psid, token) {
  const useToken = token || PAGE_ACCESS_TOKEN;
  if (!useToken) return { ok: false, error: 'PAGE_ACCESS_TOKEN khong duoc cau hinh' };
  const url = `https://graph.facebook.com/${FB_API_VERSION}/${encodeURIComponent(psid)}`;
  try {
    const r = await axios.get(url, {
      params: { fields: 'first_name,last_name,name,profile_pic', access_token: useToken },
      timeout: 8000
    });
    const data = r.data || {};
    const fullName = data.name || [data.first_name, data.last_name].filter(Boolean).join(' ').trim() || null;
    return { ok: true, name: fullName, profile_pic: data.profile_pic || null, raw: data };
  } catch (e) {
    const status = e.response ? e.response.status : 'NETWORK';
    const fbError = e.response && e.response.data && e.response.data.error ? e.response.data.error : null;
    const errMsg = fbError ? fbError.message : e.message;
    console.log(`[FB-PROFILE] Loi lay profile PSID=${psid} status=${status} error=${errMsg}`);
    return { ok: false, error: errMsg, status: status };
  }
}

/**
 * Gui tin nhan qua Facebook Messenger
 * POST https://graph.facebook.com/v19.0/me/messages
 * Body: { recipient: {id: psid}, message: {text: text}, messaging_type: 'RESPONSE' }
 * Tra ve {ok, message_id, response} hoac {ok:false, error, status}
 */
async function sendToFacebook(psid, text, opts = {}) {
  const useToken = opts.token || PAGE_ACCESS_TOKEN;
  const messagingType = opts.messagingType || 'RESPONSE';
  const url = `https://graph.facebook.com/${FB_API_VERSION}/me/messages`;

  if (!useToken) {
    const msg = '[FB-SEND] PAGE_ACCESS_TOKEN chua duoc set trong env - khong the gui qua Facebook';
    console.error(msg);
    return { ok: false, error: msg, status: 'NO_TOKEN' };
  }
  if (!psid) return { ok: false, error: 'psid required', status: 'BAD_REQUEST' };
  if (!text || !String(text).trim()) return { ok: false, error: 'text required', status: 'BAD_REQUEST' };

  const payload = {
    recipient: { id: String(psid) },
    message: { text: String(text).slice(0, 2000) }, // FB gioi han 2000 ky tu
    messaging_type: messagingType
  };

  console.log(`[FB-SEND] -> POST ${url} psid=${psid} text="${String(text).slice(0, 80)}${text.length > 80 ? '...' : ''}" type=${messagingType}`);

  try {
    const r = await axios.post(url, payload, {
      params: { access_token: useToken },
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: () => true // tra luon ca khi 4xx de minh tu log
    });
    if (r.status >= 200 && r.status < 300) {
      const data = r.data || {};
      console.log(`[FB-SEND] OK status=${r.status} message_id=${data.message_id || 'n/a'}`);
      return { ok: true, message_id: data.message_id, recipient_id: data.recipient_id, response: data };
    }
    const fbErr = r.data && r.data.error ? r.data.error : null;
    const errMsg = fbErr ? `${fbErr.message} (code=${fbErr.code}, type=${fbErr.type}, subcode=${fbErr.error_subcode || 'n/a'})` : `HTTP ${r.status}`;
    console.log(`[FB-SEND] FAIL status=${r.status} psid=${psid} error=${errMsg}`);
    if (r.data) console.log('[FB-SEND] Response body:', JSON.stringify(r.data).slice(0, 500));
    return { ok: false, error: errMsg, status: r.status, fb_error: fbErr, response: r.data };
  } catch (e) {
    const status = e.response ? e.response.status : 'NETWORK';
    const fbErr = e.response && e.response.data && e.response.data.error ? e.response.data.error : null;
    const errMsg = fbErr ? `${fbErr.message} (code=${fbErr.code})` : e.message;
    console.log(`[FB-SEND] EXCEPTION status=${status} psid=${psid} error=${errMsg}`);
    return { ok: false, error: errMsg, status: status, fb_error: fbErr, exception: e.message };
  }
}

// ===== UI =====
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'GIAO-DIEN-800-PAGE.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'GIAO-DIEN-800-PAGE.html'));
});

// ===== WEBHOOK FACEBOOK =====
// GET: Verify webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WEBHOOK] VERIFIED');
    res.status(200).send(challenge);
  } else {
    console.warn('[WEBHOOK] VERIFY FAILED mode=' + mode + ' token_match=' + (token === VERIFY_TOKEN));
    res.sendStatus(403);
  }
});

// POST: Nhan tin nhan tu Facebook - TRA 200 NGAY LAP TUC, xy ly ngam sau
app.post('/webhook', (req, res) => {
  // TRA 200 NGAY de Facebook khong retry/gui lap
  res.status(200).send('EVENT_RECEIVED');

  // Xy ly ngam phia sau - tranh bat FB doi
  setImmediate(() => {
    handleWebhookPayload(req.body).catch((err) => {
      console.error('[WEBHOOK] handleWebhookPayload exception:', err && err.stack ? err.stack : err);
    });
  });
});

/**
 * Xu ly payload webhook (chay ngam)
 */
async function handleWebhookPayload(body) {
  if (!body || body.object !== 'page') {
    console.warn('[WEBHOOK] Bo qua: object != page (got=' + (body && body.object) + ')');
    return;
  }

  for (const entry of (body.entry || [])) {
    const pageId = entry.id; // fb_page_id tu FB
    const page = db.pages.find(p => p.fb_page_id === pageId) || db.pages[0];
    if (!page) {
      console.error('[WEBHOOK] Khong tim thay page nao cho fb_page_id=' + pageId);
      continue;
    }
    const internalPageId = page.id;

    for (const event of (entry.messaging || [])) {
      // Bo qua delivery/echo
      if (!event.message || !event.message.text) {
        // Co the la read, delivery, reaction... bo qua im lang
        continue;
      }

      const customerId = event.sender && event.sender.id;
      if (!customerId) continue;
      const text = event.message.text;
      console.log(`[${internalPageId}] Khach ${customerId}: ${text}`);

      // Tim hoac tao conv
      let conv = db.conversations.find(c =>
        c.page_id === internalPageId &&
        (c.customer_id === customerId || c.psid === customerId)
      );

      if (!conv) {
        const now = new Date().toISOString();
        // Lay ten that + avatar neu co (uu tien: event.sender.name tu FB, fallback API profile)
        let realName = (event.sender && event.sender.name) || (event.message && event.message.name) || null;
        let realAvatar = null; // URL avatar that tu Facebook
        if (!realName) {
          // Goi Facebook User Profile API de lay ten that (best-effort, co try/catch de tranh crash webhook)
          try {
            const profile = await getFacebookUserProfile(customerId, page.page_access_token || PAGE_ACCESS_TOKEN);
            if (profile && profile.ok) {
              if (profile.name) realName = profile.name;
              if (profile.profile_pic) realAvatar = profile.profile_pic;
            }
          } catch (profileErr) {
            console.log(`[WEBHOOK] getFacebookUserProfile exception (bo qua, dung fallback): ${profileErr.message}`);
          }
        }
        const fallbackName = realName || `Khach ${customerId.slice(-6)}`;
        const safeInitials = (realName
          ? realName.split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase()
          : `K${customerId.slice(-2)}`) || 'KH';

        conv = {
          id: `conv_${internalPageId}_${customerId}`,
          page_id: internalPageId,
          fb_page_id: page.fb_page_id,
          page_name: page.name,
          via_id: page.via_id,
          customer_id: customerId,
          psid: customerId,
          customer_name: fallbackName,
          initials: safeInitials,
          // avatar: URL that tu FB neu co, neu khong thi placeholder 'KH' (UI se render initials)
          avatar: realAvatar || 'KH',
          messages: [],
          tags: [],
          primary_lang: brain.detectLanguage(text),
          status: 'chua-doc',
          last_message: text,
          unread: 0,
          created_at: now,
          updated_at: now
        };
        db.conversations.unshift(conv);
        io.emit('new_conversation', conv);
        console.log(`[WEBHOOK] Tao conv moi ${conv.id} ten=${conv.customer_name}`);
      }

      // Day tin nhan khach vao conv
      const customerMsg = { from: 'customer', text, lang: brain.detectLanguage(text), time: new Date().toLocaleTimeString() };
      conv.messages.push(customerMsg);
      conv.last_message = text;
      conv.updated_at = new Date().toISOString();
      conv.unread = (conv.unread || 0) + 1;
      emitNewMessage(conv, customerMsg);

      // Xu ly AI - USER YEU CAU: TAT TU DONG TRA LOI
      // Chi goi brain.processMessage de lay autoTags (neu co), KHONG push botMsg, KHONG goi sendToFacebook
      try {
        const result = await brain.processMessage(internalPageId, customerId, text, conv);

        if (result.transfer) {
          console.log(`[WEBHOOK] -> Chuyen cho nguoi: ${result.reason}`);
          conv.status = 'cho-xu-ly';
          conv.tags = [...new Set([...conv.tags, 'cho-xu-ly'])];
          conv.updated_at = new Date().toISOString();
          db.overview.can_xu_ly = (db.overview.can_xu_ly || 0) + 1;
          emitConvUpdate(conv);
        } else if (result.reply) {
          // === AI TU DONG TRA LOI - DA TAT THEO YEU CAU USER ===
          // Truoc day: push botMsg local + sendToFacebook.
          // Bay gio: chi log de debug, KHONG push, KHONG send FB.
          // Neu user muon bat lai, comment check nay va uncomment block ben duoi.
          console.log(`[WEBHOOK] AI reply SKIPPED (user da tat auto-reply) text="${(result.reply || '').slice(0, 80)}..."`);
          // === OPTIONAL: Bat lai AI auto-reply ===
          // const botMsg = {
          //   from: 'bot',
          //   text: result.reply,
          //   model: `BOT - ${db.ai_config.model || 'gpt-4o-mini'}`,
          //   lang: result.targetLang,
          //   time: new Date().toLocaleTimeString()
          // };
          // conv.messages.push(botMsg);
          // conv.status = 'dang-tu-van';
          // conv.last_message = result.reply;
          // conv.updated_at = new Date().toISOString();
          // if (result.autoTags && result.autoTags.length) {
          //   conv.tags = [...new Set([...conv.tags, ...result.autoTags])];
          // }
          // emitNewMessage(conv, botMsg);
          // const fbResult = await sendToFacebook(customerId, result.reply, {
          //   token: page.page_access_token || PAGE_ACCESS_TOKEN
          // });
          // if (!fbResult.ok) {
          //   console.warn(`[WEBHOOK] AI reply saved local nhung FB send FAIL: ${fbResult.error}`);
          //   conv.tags = [...new Set([...conv.tags, 'fb-send-failed'])];
          //   emitConvUpdate(conv);
          // }
        } else {
          // reply null (khong co OpenAI key that) -> skip hoan toan
          console.log(`[WEBHOOK] AI skip (reply=null, can OpenAI key that de bat)`);
        }
      } catch (e) {
        console.error(`[WEBHOOK] brain.processMessage loi:`, e && e.stack ? e.stack : e);
      }
    }
  }
}

// ===== API: PAGES / PRODUCTS / MAP =====
app.get('/api/pages', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let pages = db.pages;
  if (q) pages = pages.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  res.json({ total: db.pages.length, filtered: pages.length, pages: pages.slice(0, 50) });
});

app.get('/api/products', (req, res) => res.json(db.products));
app.get('/api/products/:id', (req, res) => {
  const p = db.products.find(x => x.id === req.params.id);
  res.json(p || {});
});
app.put('/api/products/:id', (req, res) => {
  const p = db.products.find(x => x.id === req.params.id);
  if (p) {
    p.kich_ban_goc = req.body.kich_ban_goc || p.kich_ban_goc;
    p.name = req.body.name || p.name;
    p.model_ai = req.body.model_ai || p.model_ai;
    res.json({ ok: true, product: p });
  } else res.status(404).json({ error: 'Not found' });
});

app.get('/api/page-product-map', (req, res) => res.json(db.page_product_map));
app.post('/api/page-product-map', (req, res) => {
  const { page_id, product_id } = req.body;
  if (db.page_product_map[page_id] && db.page_product_map[page_id] !== product_id) {
    console.log(`[MAP] Canh bao: Page ${page_id} da gan SP ${db.page_product_map[page_id]} -> ${product_id}`);
  }
  db.page_product_map[page_id] = product_id;
  res.json({ ok: true, map: db.page_product_map });
});

// ===== API: CONVERSATIONS =====
app.get('/api/conversations', (req, res) => {
  const { status, tag, q, via } = req.query;
  let convs = db.conversations;
  if (status && status !== 'tat_ca') convs = convs.filter(c => c.status === status);
  if (tag) convs = convs.filter(c => c.tags.includes(tag));
  if (via) convs = convs.filter(c => c.via_id === via);
  if (q) {
    const qq = q.toLowerCase();
    convs = convs.filter(c => c.customer_name.toLowerCase().includes(qq) || (c.last_message || '').toLowerCase().includes(qq));
  }
  res.json({ total: convs.length, conversations: convs });
});

/**
 * POST /api/conversations/:id/message
 * Nhan tin nhan tu UI (operator), luu local + push qua Facebook
 * Body: { text, from? }
 * Response: { ok, conversation, message, fb_send: {ok, message_id, error} }
 */
app.post('/api/conversations/:id/message', async (req, res) => {
  const conv = db.conversations.find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found conv: ' + req.params.id });

  const { text, from } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text required' });
  const cleanText = String(text).trim();
  const sender = (from === 'bot' || from === 'customer') ? from : 'human';

  // Luu local truoc (de UI thay ngay)
  const msg = { from: sender, text: cleanText, time: new Date().toLocaleTimeString() };
  conv.messages.push(msg);
  conv.last_message = cleanText;
  conv.updated_at = new Date().toISOString();
  if (sender === 'human') conv.unread = 0; // operator tra loi -> reset unread
  console.log(`[MSG] conv=${conv.id} from=${sender} text="${cleanText}"`);
  console.log(`[MSG] total messages in conv: ${conv.messages.length}`);
  emitNewMessage(conv, msg);

  // Push qua Facebook neu day la operator tra loi khach that (from=human hoac default)
  let fbResult = { ok: false, skipped: true, reason: 'sender != human' };
  if (sender === 'human' && conv.psid) {
    const page = db.pages.find(p => p.id === conv.page_id);
    const token = (page && page.page_access_token) || PAGE_ACCESS_TOKEN;
    fbResult = await sendToFacebook(conv.psid, cleanText, { token });
    if (!fbResult.ok) {
      // Danh dau tag de UI canh bao
      conv.tags = [...new Set([...conv.tags, 'fb-send-failed'])];
      emitConvUpdate(conv);
    } else {
      // Xoa tag loi neu co
      conv.tags = conv.tags.filter(t => t !== 'fb-send-failed');
    }
  }

  res.json({
    ok: true,
    conversation: conv,
    message: msg,
    fb_send: fbResult
  });
});

/**
 * POST /api/test-message - Tao conv + trigger AI (debug)
 */
app.post('/api/test-message', async (req, res) => {
  const { page_id, customer_id, text, customer_name } = req.body || {};
  const pid = page_id || 'page_001';
  const page = db.pages.find(p => p.id === pid) || db.pages[0];
  const internalPageId = page.id;
  const cid = customer_id || `test_${Date.now()}`;
  const txt = text || 'Test message tu /api/test-message';
  console.log(`[TEST-MSG] ${internalPageId} / ${cid}: ${txt}`);

  let conv = db.conversations.find(c =>
    c.page_id === internalPageId && (c.customer_id === cid || c.psid === cid)
  );
  let isNewConv = false;
  if (!conv) {
    isNewConv = true;
    const now = new Date().toISOString();
    conv = {
      id: `conv_${internalPageId}_${cid}`,
      page_id: internalPageId,
      fb_page_id: page.fb_page_id,
      page_name: page.name,
      via_id: page.via_id,
      customer_id: cid,
      psid: cid,
      customer_name: customer_name || `Khach ${cid.slice(-4)}`,
      initials: `K${cid.slice(-2)}`,
      avatar: 'KH',
      messages: [],
      tags: [],
      primary_lang: brain.detectLanguage(txt),
      status: 'chua-doc',
      last_message: txt,
      unread: 0,
      created_at: now,
      updated_at: now
    };
    db.conversations.unshift(conv);
    io.emit('new_conversation', conv);
  }

  const customerMsg = { from: 'customer', text: txt, lang: brain.detectLanguage(txt), time: new Date().toLocaleTimeString() };
  conv.messages.push(customerMsg);
  conv.last_message = txt;
  conv.updated_at = new Date().toISOString();
  conv.unread = (conv.unread || 0) + 1;
  emitNewMessage(conv, customerMsg);

  try {
    // USER YEU CAU: TAT AI TU DONG - chi goi processMessage de biet co can transfer khong, KHONG push botMsg
    const result = await brain.processMessage(internalPageId, cid, txt, conv);
    if (result.transfer) {
      conv.status = 'cho-xu-ly';
      conv.tags = [...new Set([...conv.tags, 'cho-xu-ly'])];
      conv.updated_at = new Date().toISOString();
    } else if (result.reply) {
      // === AI TU DONG TRA LOI - DA TAT THEO YEU CAU USER (test endpoint cung tat) ===
      console.log(`[TEST-MSG] AI reply SKIPPED (user da tat auto-reply) text="${(result.reply || '').slice(0, 80)}..."`);
      // === OPTIONAL: bat lai ===
      // const botMsg = {
      //   from: 'bot', text: result.reply, model: `BOT - ${db.ai_config.model || 'gpt-4o-mini'}`,
      //   lang: result.targetLang, time: new Date().toLocaleTimeString()
      // };
      // conv.messages.push(botMsg);
      // conv.status = 'dang-tu-van';
      // conv.last_message = result.reply;
      // if (result.autoTags) conv.tags = [...new Set([...conv.tags, ...result.autoTags])];
      // emitNewMessage(conv, botMsg);
    }
  } catch (e) {
    console.error('[TEST-MSG] brain loi:', e && e.stack ? e.stack : e);
  }
  io.emit('overview_update', db.overview);
  res.json({ ok: true, isNewConv, conversation: conv });
});

/**
 * POST /api/conversations/:id/fetch-profile (optional)
 * Lay ten that tu Facebook Profile API va cap nhat conv
 */
app.post('/api/conversations/:id/fetch-profile', async (req, res) => {
  const conv = db.conversations.find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  if (!conv.psid) return res.status(400).json({ error: 'conv.psid khong co' });
  const page = db.pages.find(p => p.id === conv.page_id);
  const token = (page && page.page_access_token) || PAGE_ACCESS_TOKEN;
  try {
    const profile = await getFacebookUserProfile(conv.psid, token);
    if (profile.ok && profile.name) {
      conv.customer_name = profile.name;
      conv.initials = profile.name.split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || 'KH';
      if (profile.profile_pic) conv.avatar = profile.profile_pic;
      conv.updated_at = new Date().toISOString();
      emitConvUpdate(conv);
      res.json({ ok: true, name: profile.name, profile_pic: profile.profile_pic });
    } else {
      // Fallback: giu ten cu, tra ve loi de UI biet
      const fallback = `Khach ${conv.psid.slice(-6)}`;
      console.log(`[FETCH-PROFILE] FAIL conv=${conv.id} reason=${profile.error} -> keep name='${conv.customer_name}' or fallback='${fallback}'`);
      res.status(200).json({ ok: false, error: profile.error, status: profile.status, fallback_name: fallback, current_name: conv.customer_name });
    }
  } catch (e) {
    console.error(`[FETCH-PROFILE] exception conv=${conv.id}:`, e.message);
    res.status(500).json({ ok: false, error: e.message, fallback_name: `Khach ${conv.psid.slice(-6)}` });
  }
});

/**
 * POST /api/conversations/:id/tags
 */
app.post('/api/conversations/:id/tags', (req, res) => {
  const conv = db.conversations.find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  const { tag, action } = req.body || {};
  if (action === 'remove') conv.tags = conv.tags.filter(t => t !== tag);
  else if (tag && !conv.tags.includes(tag)) conv.tags.push(tag);
  io.emit('conversation_update', conv);
  res.json({ ok: true, tags: conv.tags });
});

/**
 * POST /api/conversations/:id/translate
 */
app.post('/api/conversations/:id/translate', async (req, res) => {
  const { text } = req.body || {};
  const translated = await brain.translateForStaff(text || '', 'VI');
  res.json({ translated });
});

// ===== API: TAGS / TEAM / AI CONFIG / KNOWLEDGE =====
app.get('/api/tags', (req, res) => res.json(db.tags));
app.post('/api/tags', (req, res) => {
  const { name, color } = req.body || {};
  const newTag = { id: name.toLowerCase().replace(/\s+/g, '_'), name, color, count: 0 };
  db.tags.push(newTag);
  res.json(newTag);
});

app.get('/api/team', (req, res) => res.json(db.team));
app.post('/api/team', (req, res) => {
  const { email, name, role, via_ids, page_ids } = req.body || {};
  const newUser = { id: `user_${Date.now()}`, email, name, role, via_ids, page_ids, status: 'online', handling: 0 };
  db.team.push(newUser);
  res.json(newUser);
});

app.get('/api/ai-config', (req, res) => res.json(db.ai_config));
app.put('/api/ai-config', (req, res) => {
  Object.assign(db.ai_config, req.body || {});
  res.json({ ok: true, config: db.ai_config });
});

app.get('/api/knowledge', (req, res) => res.json(db.knowledge_base));
app.put('/api/knowledge/guidelines', (req, res) => {
  db.knowledge_base.guidelines = (req.body || {}).guidelines || db.knowledge_base.guidelines;
  res.json({ ok: true, guidelines: db.knowledge_base.guidelines });
});
app.get('/api/knowledge/files', (req, res) => res.json(db.knowledge_base.files));
app.post('/api/knowledge/files', (req, res) => {
  const { name, size, type } = req.body || {};
  const newFile = { id: `file_${Date.now()}`, name, size: size || '1MB', date: new Date().toLocaleDateString('vi-VN'), type: type || 'pdf' };
  db.knowledge_base.files.push(newFile);
  res.json(newFile);
});
app.delete('/api/knowledge/files/:id', (req, res) => {
  db.knowledge_base.files = db.knowledge_base.files.filter(f => f.id !== req.params.id);
  res.json({ ok: true });
});
app.get('/api/knowledge/quick-replies', (req, res) => res.json(db.knowledge_base.quick_replies));
app.post('/api/knowledge/quick-replies', (req, res) => {
  const { text } = req.body || {};
  const newQR = { id: `qr_${Date.now()}`, text };
  db.knowledge_base.quick_replies.push(newQR);
  res.json(newQR);
});
app.put('/api/knowledge/quick-replies/:id', (req, res) => {
  const qr = db.knowledge_base.quick_replies.find(x => x.id === req.params.id);
  if (qr) { qr.text = (req.body || {}).text || qr.text; res.json({ ok: true, qr }); }
  else res.status(404).json({ error: 'Not found' });
});
app.delete('/api/knowledge/quick-replies/:id', (req, res) => {
  db.knowledge_base.quick_replies = db.knowledge_base.quick_replies.filter(x => x.id !== req.params.id);
  res.json({ ok: true });
});

app.get('/api/overview', (req, res) => res.json(db.overview));

app.get('/api/status', (req, res) => res.json({
  status: 'Tong Dai 800 Brain running + Socket.IO',
  pages: db.pages.length,
  products: db.products.length,
  conversations: db.conversations.length,
  socket: 'enabled',
  env: {
    port: PORT,
    verify_token: VERIFY_TOKEN ? 'set' : 'EMPTY',
    page_access_token: PAGE_ACCESS_TOKEN ? 'set' : 'NOT SET',
    fb_api_version: FB_API_VERSION
  }
}));

// ===== START =====
server.listen(PORT, () => {
  console.log(`Tong Dai 800 Brain + REALTIME running at http://localhost:${PORT}`);
  console.log(`  Webhook: http://localhost:${PORT}/webhook`);
  console.log(`  Verify token: ${VERIFY_TOKEN}`);
  console.log(`  PAGE_ACCESS_TOKEN: ${PAGE_ACCESS_TOKEN ? 'SET (len=' + PAGE_ACCESS_TOKEN.length + ')' : 'NOT SET - send to FB will fail'}`);
  console.log(`  FB API: ${FB_API_VERSION}`);
  console.log(`  Socket.IO: enabled`);
});
