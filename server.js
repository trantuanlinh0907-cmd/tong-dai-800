
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');
const brain = require('./brain');

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || db.ai_config.bm_config.verify_token;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

          let conv = db.conversations.find(c=>c.page_id===internalPageId);
          if (!conv){
            conv = {
              id: `conv_${Date.now()}`,
              page_id: internalPageId,
              page_name: page.name,
              via_id: page.via_id,
              customer_name: `Khach ${customerId.slice(-4)}`,
              avatar: 'KH',
              messages: [],
              tags: [],
              primary_lang: brain.detectLanguage(text),
              status: 'chua_doc'
            };
            db.conversations.unshift(conv);
          }

          conv.messages.push({ from: 'customer', text, lang: brain.detectLanguage(text), time: new Date().toLocaleTimeString() });

          const result = await brain.processMessage(internalPageId, customerId, text, conv);

          if (result.transfer){
            console.log(`-> Chuyen cho nguoi: ${result.reason}`);
            conv.status = 'cho_xu_ly';
            conv.tags = [...new Set([...conv.tags, 'cho_xu_ly'])];
            db.overview.can_xu_ly += 1;
          } else {
            conv.messages.push({ 
              from: 'bot', 
              text: result.reply, 
              model: `BOT - ${db.ai_config.model}`,
              lang: result.targetLang,
              time: new Date().toLocaleTimeString()
            });
            conv.status = 'dang_tu_van';
            if (result.autoTags){
              conv.tags = [...new Set([...conv.tags, ...result.autoTags])];
            }
          }
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
  conv.messages.push({ from: from||'human', text, time: new Date().toLocaleTimeString() });
  res.json({ ok: true, conversation: conv });
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

app.get('/api/overview', (req,res)=> res.json(db.overview));

app.get('/', (req,res)=> res.json({ status: 'Tong Dai 800 Brain running', pages: db.pages.length, products: db.products.length, conversations: db.conversations.length }));

app.listen(PORT, ()=> console.log(`Tong Dai 800 Brain running at http://localhost:${PORT} - Webhook: http://localhost:${PORT}/webhook - Verify token: ${VERIFY_TOKEN}`));
