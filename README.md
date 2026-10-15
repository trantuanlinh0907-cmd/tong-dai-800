# TONG DAI 800 PAGE - BO NAO SERVER
Khop 100% voi giao dien da duyet.

## Nguyen ly loi: 1 Page = 1 SP, 1 o kich ban duy nhat

Flow nao:
1. Webhook FB -> page_id
2. page_product_map[page_id] -> product_id -> lay kich_ban_goc (1 o duy nhat chua info+gia+chot)
3. Detect language khach + khoa primary_lang
4. Check trigger chuyen nguoi
5. Neu AI: Build prompt = System Prompt chung + kich_ban_goc + lich su chat + tin nhan moi
6. Goi Model AI voi temperature/top_p tu Cau hinh AI
7. Tra ve + update Tong quan + Tag

Chay:
npm install
cp .env.example .env
npm run dev
Webhook: https://your-domain.com/webhook

API cho frontend artifact da co san trong src/server.js
