require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');
const brain = require('./brain');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST","PUT","DELETE"] }
});

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || db.ai_config.bm_config.verify_token;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// L3 (OPTION B): KHONG co folder public -> comment static line, chi serve file cu the qua /dashboard
// app.use(express.static(path.join(__dirname, 'public')));
// Voi OPTION B file goc o root, can middleware forbidden de chan .env/database.js khi serve
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
  console.log(`[SOCKET] Client connected: ${socket.id}`);
  
  // Gui toan bo conversations khi moi connect
  socket.emit('init_data', {
    conversations: db.conversations.slice(0, 100),
    overview: db.overview,
    pages: db.pages.length
  });

  socket.on('disconnect', () => {
    console.log(`[SOCKET] Client disconnected: ${socket.id}`);
  });

  // Cho phep frontend request refresh
  socket.on('request_refresh', () => {
    socket.emit('conversations_updated', db.conversations.slice(0, 100));
  });
});

// Ham emit dung chung - L2: THONG NHAT chi 1 noi emit
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

// GIAO DIEN 800 PAGE
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'GIAO-DIEN-800-PAGE.html'));
});
// L3: Them route / cung tra HTML de nguoi dung vao thang localhost:3000 cung thay UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'GIAO-DIEN-800-PAGE.html'));
});

// WEBHOOK FACEBOOK - 800 Page dung 1 URL
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN){
    console.log('WEBHOOK VERIFIED - 800 Page');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page'){
    for (let entry of body.entry){
      const pageId = entry.id;
      const page = db.pages.find(p=>p.fb_page_id===pageId) || db.pages[0];
      const internalPageId = page.id;
      
      for (let event of entry.messaging){
        if (event.message && event.message.text){
          const customerId = event.sender.id;
          const text = event.message.text;
          console.log(`[${internalPageId}] Khach ${customerId}: ${text}`);

          // FIX 1: Tim conv theo CẢ page_id + customer_id (PSID) de cac via khac nhau
          // nhan cung 1 Page van tao rieng hoi thoai, khong bi gop chung
          let conv = db.conversations.find(c=>
            c.page_id===internalPageId &&
            (c.customer_id===customerId || c.psid===customerId)
          );
          let isNewConv = false;
          if (!conv){
            isNewConv = true;
            const now = new Date().toISOString();
            // FIX 2: Tao conv moi phai luu DU: customer_id, psid, fb_page_id,
            // via_id, last_message, unread, created_at, updated_at, initials
            conv = {
              id: `conv_${internalPageId}_${customerId}`,
              page_id: internalPageId,
              fb_page_id: page.fb_page_id,
              page_name: page.name,
              via_id: page.via_id,
              customer_id: customerId,
              psid: customerId,
              customer_name: `Khach ${customerId.slice(-4)}`,
              initials: `K${customerId.slice(-2)}`,
              avatar: 'KH',
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
            // Emit new conversation ngay lap tuc
            io.emit('new_conversation', conv);
          }

          const customerMsg = { from: 'customer', text, lang: brain.detectLanguage(text), time: new Date().toLocaleTimeString() };
          conv.messages.push(customerMsg);
          // FIX 4: Cap nhat last_message, updated_at, tang unread
          conv.last_message = text;
          conv.updated_at = new Date().toISOString();
          conv.unread = (conv.unread || 0) + 1;
          // L2: emit dung chung qua emitNewMessage, KHONG emit rieng o day
          emitNewMessage(conv, customerMsg);

          const result = await brain.processMessage(internalPageId, customerId, text, conv);

          if (result.transfer){
            console.log(`-> Chuyen cho nguoi: ${result.reason}`);
            conv.status = 'cho-xu-ly';
            conv.tags = [...new Set([...conv.tags, 'cho-xu-ly'])];
            conv.updated_at = new Date().toISOString();
            db.overview.can_xu_ly += 1;
          } else {
            const botMsg = {
              from: 'bot',
              text: result.reply,
              model: `BOT - ${db.ai_config.model}`,
              lang: result.targetLang,
              time: new Date().toLocaleTimeString()
            };
            conv.messages.push(botMsg);
            conv.status = 'dang-tu-van';
            conv.last_message = result.reply;
            conv.updated_at = new Date().toISOString();
            if (result.autoTags){
              conv.tags = [...new Set([...conv.tags, ...result.autoTags])];
            }
            emitNewMessage(conv, botMsg);
          }
          // Cap nhat overview
          io.emit('overview_update', db.overview);
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// API CHO GIAO DIEN FRONTEND ARTIFACT
app.get('/api/pages', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let pages = db.pages;
  if (q){
    pages = pages.filter(p=> p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }
  res.json({ total: db.pages.length, filtered: pages.length, pages: pages.slice(0,50) });
});

app.get('/api/products', (req,res)=>{
  res.json(db.products);
});
app.get('/api/products/:id', (req,res)=>{
  const p = db.products.find(x=>x.id===req.params.id);
  res.json(p || {});
});
app.put('/api/products/:id', (req,res)=>{
  const p = db.products.find(x=>x.id===req.params.id);
  if (p){
    p.kich_ban_goc = req.body.kich_ban_goc || p.kich_ban_goc;
    p.name = req.body.name || p.name;
    p.model_ai = req.body.model_ai || p.model_ai;
    res.json({ ok: true, product: p });
  } else res.status(404).json({ error: 'Not found' });
});

app.get('/api/page-product-map', (req,res)=> res.json(db.page_product_map));
app.post('/api/page-product-map', (req,res)=>{
  const { page_id, product_id } = req.body;
  if (db.page_product_map[page_id] && db.page_product_map[page_id] !== product_id){
    console.log(`Canh bao: Page ${page_id} da gan SP ${db.page_product_map[page_id]}, gio chuyen sang ${product_id}`);
  }
  db.page_product_map[page_id] = product_id;
  res.json({ ok: true, map: db.page_product_map });
});

app.get('/api/conversations', (req,res)=>{
  const { status, tag, q, via } = req.query;
  let convs = db.conversations;
  if (status && status !== 'tat_ca') convs = convs.filter(c=>c.status===status);
  if (tag) convs = convs.filter(c=>c.tags.includes(tag));
  if (via) convs = convs.filter(c=>c.via_id===via);
  if (q) {
    const qq = q.toLowerCase();
    convs = convs.filter(c=> c.customer_name.toLowerCase().includes(qq) || c.last_message?.toLowerCase().includes(qq));
  }
  res.json({ total: convs.length, conversations: convs });
});
app.post('/api/conversations/:id/message', async (req,res)=>{
  const conv = db.conversations.find(c=>c.id===req.params.id);
  if (!conv) return res.status(404).json({error:'Not found'});
  const { text, from } = req.body;
  const msg = { from: from||'human', text, time: new Date().toLocaleTimeString() };
  conv.messages.push(msg);
  conv.last_message = text;
  emitNewMessage(conv, msg);
  res.json({ ok: true, conversation: conv });
});
// L7: Endpoint test nhanh - khong can webhook that
app.post('/api/test-message', async (req, res) => {
  const { page_id, customer_id, text, customer_name } = req.body;
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

  // goi brain tra loi
  const result = await brain.processMessage(internalPageId, cid, txt, conv);
  if (result.transfer) {
    conv.status = 'cho-xu-ly';
    conv.tags = [...new Set([...conv.tags, 'cho-xu-ly'])];
    conv.updated_at = new Date().toISOString();
  } else {
    const botMsg = {
      from: 'bot', text: result.reply, model: `BOT - ${db.ai_config.model}`,
      lang: result.targetLang, time: new Date().toLocaleTimeString()
    };
    conv.messages.push(botMsg);
    conv.status = 'dang-tu-van';
    conv.last_message = result.reply;
    if (result.autoTags) conv.tags = [...new Set([...conv.tags, ...result.autoTags])];
    emitNewMessage(conv, botMsg);
  }
  io.emit('overview_update', db.overview);
  res.json({ ok: true, isNewConv, conversation: conv });
});
app.post('/api/conversations/:id/tags', (req,res)=>{
  const conv = db.conversations.find(c=>c.id===req.params.id);
  if (!conv) return res.status(404).json({error:'Not found'});
  const { tag, action } = req.body;
  if (action==='remove'){
    conv.tags = conv.tags.filter(t=>t!==tag);
  } else {
    if (!conv.tags.includes(tag)) conv.tags.push(tag);
  }
  io.emit('conversation_update', conv);
  res.json({ ok: true, tags: conv.tags });
});
app.post('/api/conversations/:id/translate', async (req,res)=>{
  const { text } = req.body;
  const translated = await brain.translateForStaff(text, 'VI');
  res.json({ translated });
});

app.get('/api/tags', (req,res)=> res.json(db.tags));
app.post('/api/tags', (req,res)=>{
  const { name, color } = req.body;
  const newTag = { id: name.toLowerCase().replace(/\s+/g,'_'), name, color, count: 0 };
  db.tags.push(newTag);
  res.json(newTag);
});

app.get('/api/team', (req,res)=> res.json(db.team));
app.post('/api/team', (req,res)=>{
  const { email, name, role, via_ids, page_ids } = req.body;
  const newUser = { id: `user_${Date.now()}`, email, name, role, via_ids, page_ids, status: 'online', handling: 0 };
  db.team.push(newUser);
  res.json(newUser);
});

app.get('/api/ai-config', (req,res)=> res.json(db.ai_config));
app.put('/api/ai-config', (req,res)=>{
  Object.assign(db.ai_config, req.body);
  res.json({ ok: true, config: db.ai_config });
});


// API KHO KIEN THUC CHUNG - DONG BO VOI GIAO DIEN MOI
app.get('/api/knowledge', (req,res)=> res.json(db.knowledge_base));
app.put('/api/knowledge/guidelines', (req,res)=>{
  db.knowledge_base.guidelines = req.body.guidelines || db.knowledge_base.guidelines;
  res.json({ ok: true, guidelines: db.knowledge_base.guidelines });
});
app.get('/api/knowledge/files', (req,res)=> res.json(db.knowledge_base.files));
app.post('/api/knowledge/files', (req,res)=>{
  const { name, size, type } = req.body;
  const newFile = { id: `file_${Date.now()}`, name, size: size||'1MB', date: new Date().toLocaleDateString('vi-VN'), type: type||'pdf' };
  db.knowledge_base.files.push(newFile);
  res.json(newFile);
});
app.delete('/api/knowledge/files/:id', (req,res)=>{
  db.knowledge_base.files = db.knowledge_base.files.filter(f=>f.id!==req.params.id);
  res.json({ ok: true });
});
app.get('/api/knowledge/quick-replies', (req,res)=> res.json(db.knowledge_base.quick_replies));
app.post('/api/knowledge/quick-replies', (req,res)=>{
  const { text } = req.body;
  const newQR = { id: `qr_${Date.now()}`, text };
  db.knowledge_base.quick_replies.push(newQR);
  res.json(newQR);
});
app.put('/api/knowledge/quick-replies/:id', (req,res)=>{
  const qr = db.knowledge_base.quick_replies.find(x=>x.id===req.params.id);
  if (qr){ qr.text = req.body.text || qr.text; res.json({ ok: true, qr }); }
  else res.status(404).json({ error: 'Not found' });
});
app.delete('/api/knowledge/quick-replies/:id', (req,res)=>{
  db.knowledge_base.quick_replies = db.knowledge_base.quick_replies.filter(x=>x.id!==req.params.id);
  res.json({ ok: true });
});

app.get('/api/overview', (req,res)=> res.json(db.overview));

// L3: status JSON doi sang /api-status, vi / da dung cho UI HTML roi
app.get('/api/status', (req,res)=> res.json({ status: 'Tong Dai 800 Brain running + Socket.IO', pages: db.pages.length, products: db.products.length, conversations: db.conversations.length, socket: 'enabled' }));

// QUAN TRONG: Dung server.listen thay vi app.listen
server.listen(PORT, ()=> console.log(`Tong Dai 800 Brain + REALTIME running at http://localhost:${PORT} - Webhook: http://localhost:${PORT}/webhook - Verify token: ${VERIFY_TOKEN} - Socket.IO: enabled`));