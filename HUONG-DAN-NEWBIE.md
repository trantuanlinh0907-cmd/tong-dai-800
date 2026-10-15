
# HUONG DAN CHO NEWBIE - TONG DAI 800 PAGE - CHI CAN BAM DUP

Ban khong can biet code. Lam theo tung buoc nay.

## BUOC 0: Cai Node.js (1 lan duy nhat)

1. Vao https://nodejs.org -> Bam nut xanh "Download" -> Cai dat Next Next nhu cai Zalo
2. Xong cai, khoi dong lai may tinh

## BUOC 1: Tai bo code ve

Ban da co folder `tong-dai-800-brain` nay roi. Giai nen ra Desktop.

Ben trong co:
- GIAO-DIEN-800-PAGE.html -> Giao dien de ban xem (bam dup la mo)
- src/ -> Bo nao server
- start.bat + start.sh -> File bam dup de chay

## BUOC 2: Chay bo nao o may tinh (5 phut)

### Windows:
Bam dup file `start.bat` -> Cua so den hien len ghi "Tong Dai 800 Brain running at http://localhost:3000" la ok.

### Mac:
Bam chuot phai vao `start.sh` -> Open with Terminal -> Go `chmod +x start.sh` -> roi bam dup lai.

Neu thay loi "npm not found" -> Quay lai BUOC 0 cai lai Node.js.

## BUOC 3: Lay link https free de Facebook goi vao (ngrok)

Mo 1 cua so Terminal/CMD moi (giua nguyen cua so den dang chay o BUOC 2).

Go lenh nay:

```
npx ngrok http 3000
```

Hoac neu ngrok doi dang ky thi dung Cloudflare (khong can dang ky):

```
npx cloudflared tunnel --url http://localhost:3000
```

No se cho ban 1 link co dang:
`https://abcd-1234.ngrok-free.app`  <- Copy link nay

Link nay chinh la server free tam thoi cua ban.

## BUOC 4: Tao Facebook App + Lay token vinh vien (20 phut)

Day la buoc kho nhat, lam 1 lan thoi:

1. Vao https://developers.facebook.com -> Dang nhap bang nick Facebook dang quan ly BM TONG
2. Tao App: My Apps -> Create App -> Business -> Dat ten "Tong Dai 800"
3. Vao Dashboard App -> Them san pham "Webhooks" + "Messenger"
4. Vao Business Settings (business.facebook.com) -> System Users -> Tao System User -> Dat ten "800 Bot" -> Role Admin
5. Gan System User vao BM + 800 Page: Chon System User -> Assign Assets -> Chon 800 Page -> Full Control
6. Tao Token vinh vien: System User -> Generate Token -> Chon App "Tong Dai 800" -> Chon quyen: pages_messaging, pages_read_engagement, pages_manage_metadata, pages_show_list -> Generate -> Copy token dai dai bat dau bang EAA...
7. Dan token vao file `.env` trong folder: Mo file `.env.example` -> Doi ten thanh `.env` -> Dan token vao dong PAGE_ACCESS_TOKEN_SYSTEM_USER=

## BUOC 5: Noi Facebook voi bo nao cua ban

1. Quay lai developers.facebook.com -> Webhooks -> Edit Subscription -> 
   Callback URL: `https://abcd-1234.ngrok-free.app/webhook` (link ngrok o BUOC 3)
   Verify Token: `tong_dai_800_verify_2024`
   -> Bam Verify and Save

2. Chon fields: messages, messaging_postbacks -> Save

3. Vao Messenger -> Webhooks -> Chon Page dau tien de test -> Subscribe

4. Thu nhan tin vao Page do -> Nhin vao cua so den o BUOC 2, neu thay dong ` [page_001] Khach ...` la thanh cong!

## BUOC 6: Xem giao dien + Test AI dich

1. Bam dup file `GIAO-DIEN-800-PAGE.html` -> Giao dien Tong Dai 800 hien len y nhu anh ban gui
2. Chat test: Goi den Page, nhan tin tieng Anh "Hello do you have serum for sensitive skin?"
3. Bo nao se tu lay 1 o kich ban duy nhat tieng Viet, dich sang EN va tra loi

## BUOC 7: Deploy len free cloud de chay 24/7 (khi da test ok)

### Cach de nhat: Render.com (Free)

1. Tao tai khoan https://render.com (dang nhap bang Github)
2. Tao Github repo moi, up het folder nay len
3. Trong Render: New -> Web Service -> Connect repo
4. Build Command: `npm install`
5. Start Command: `node src/server.js`
6. Them Environment Variables: Copy het tu file .env
7. Deploy -> Lay link `https://tong-dai-800.onrender.com/webhook` -> Thay cho link ngrok o BUOC 5

Xong! Server free chay 24/7.

## GAP LOI?

- `npm not found`: Cai lai Node.js o BUOC 0
- `Token invalid`: Token het han, tao lai token vinh vien o BUOC 4
- `Webhook failed`: Link ngrok da tat, mo lai ngrok o BUOC 3, moi link thi phai update lai trong Facebook
- Khong hieu gi: Chup man hinh gui cho minh, minh chi tiep

## CAU TRUC FILE

- GIAO-DIEN-800-PAGE.html: Giao dien de xem
- src/server.js: Server chinh
- src/brain.js: Bo nao 1 o kich ban tu dich
- src/database.js: DB 800 Page + 1 Page=1 SP + Tag Pancake
- start.bat/start.sh: Bam dup de chay
- .env.example: Mau config

Chuc ban thanh cong!
