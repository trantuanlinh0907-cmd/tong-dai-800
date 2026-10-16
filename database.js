
const { v4: uuidv4 } = require('uuid');

let db = {
  pages: Array.from({length: 800}, (_, i) => ({
    id: `page_${String(i+1).padStart(3,'0')}`,
    fb_page_id: `fb_${100000000000000 + i}`,
    name: i % 3 === 0 ? `Serum Glow - Official #${i+1}` : i % 3 === 1 ? `My pham Han #${i+1}` : `Thoi trang nu #${i+1}`,
    via_id: `via_${Math.floor(i/200)+1}`,
    via_name: `Via ${Math.floor(i/200)+1} - 200 Page`,
    status: Math.random() > 0.1 ? 'online' : 'offline',
    token: `token_page_${i+1}`,
    primary_lang: 'VI'
  })),
  products: [
    {
      id: 'prod_serum_vitc',
      name: 'Serum Vitamin C 20% - 320K',
      image: 'serum.png',
      stock: 142,
      kich_ban_goc: `Chao {{name}}! Minh la tro ly AI cua Serum Vitamin C 20% ben minh a

Cong dung: Sang da sau 7 ngay, mo tham, deu mau, phu hop da nhay cam (lanh tinh, khong con, khong huong lieu)

COMBO:
- Buy 1 Get 1 Free 70 RM + 2 qua (toner + mask)
- Buy 2 Get 2 Free 89 RM + 3 qua + freeship
- Buy 3 Get 3 Free 120 RM + full qua VIP

Bao hanh doi tra 30 ngay. Ban quan tam combo nao a?`,
      model_ai: 'gpt-4o-mini'
    },
    {
      id: 'prod_combo_glow',
      name: 'Combo Glow x2 - 320K',
      image: 'combo.png',
      stock: 89,
      kich_ban_goc: `Chao {{name}}! Combo Glow x2 giup da cang bong ngay sau 1 dem a. Gia: 320K con 142 bo, freeship tu 2 SP. Chot don cho em xin SDT nha chi!`,
      model_ai: 'gpt-4o-mini'
    }
  ],
  page_product_map: {
    'page_142': 'prod_serum_vitc',
    'page_089': 'prod_combo_glow'
  },
  conversations: [],
  tags: [
    { id: 'chua_doc', name: 'Chua doc', color: 'pink', count: 15 },
    { id: 'dang_tu_van', name: 'Dang tu van', color: 'yellow', count: 42 },
    { id: 'cho_xu_ly', name: 'Cho xu ly', color: 'orange', count: 38 },
    { id: 'chot_don', name: 'Chot don', color: 'green', count: 324 },
    { id: 'bom_hang', name: 'Bom hang', color: 'purple', count: 12 },
    { id: 'can_goi_lai', name: 'Can goi lai', color: 'blue', count: 18 },
    { id: 'khach_vip', name: 'Khach VIP', color: 'lightpink', count: 56 }
  ],
  team: [
    { id: 'user_1', email: 'admin@tongdai800.com', name: 'Admin Tong', role: 'admin', via_ids: ['via_1','via_2','via_3','via_4'], page_ids: [], status: 'online', handling: 0 },
    { id: 'user_2', email: 'sale1@tongdai800.com', name: 'Sale Via 1', role: 'sale', via_ids: ['via_1'], page_ids: ['page_142'], status: 'online', handling: 12 }
  ],
  ai_config: {
    api_keys: {
      openai: 'sk-proj-...',
      claude: 'sk-ant-...',
      gemini: 'AIza...',
      groq: 'gsk_...'
    },
    model: 'gpt-4o-mini',
    temperature: 8.7,
    top_p: 8.9,
    system_prompt: `Ban la nhan vien CSKH than thien, chuyen nghiep cua shop my pham. Luon xung em va goi khach la anh/chi. Tra loi ngan gon, co emoji vua phai. Muc tieu chinh la chot don. Neu khach phan nan hoac yeu cau gap nguoi, hay chuyen cho nhan vien.

Quy tac:
- Khong hua hen ngoai kich ban san pham
- Luon hoi SDT truoc khi chot don`,
    trigger_keywords: 'gap nguoi, khieu nai, chui, lua dao, bom hang, hoan tien, hoi gia qua 3 lan',
    triggers: {
      chui_tuc: true,
      hoi_gia_3_lan: true,
      yeu_cau_gap_nguoi: true,
      ai_khong_chac: false
    },
    auto_translate: true,
    fallback_lang: 'EN',
    bm_config: {
      bm_id: 'BM_TONG_123456',
      system_user_id: 'system_user_789',
      app_id: 'fb_app_123',
      verify_token: 'tong_dai_800_verify_2024'
    }
  },
  knowledge_base: {
    guidelines: `QUY ĐỊNH CHUNG:
- Luôn chào khách bằng tên nếu có
- Không nói xấu đối thủ
- Luôn đề cập freeship từ 2sp
- Khi khách hỏi giá quá 3 lần mà chưa chốt → chuyển người
- Mẫu chốt đơn: "Dạ chị cho em xin SĐT + địa chỉ để em lên đơn nhé ạ"`,
    files: [
      { id: 'file_1', name: 'quy-dinh-doi-tra.pdf', size: '2.4MB', date: '12/12/2024', type: 'pdf' },
      { id: 'file_2', name: 'mau-cau-tra-loi-chung.docx', size: '1.1MB', date: '10/12/2024', type: 'docx' },
      { id: 'file_3', name: 'huong-dan-chot-don.txt', size: '45KB', date: '08/12/2024', type: 'txt' }
    ],
    quick_replies: [
      { id: 'qr_1', text: 'Dạ chị cho em xin SĐT để em lên đơn ạ' },
      { id: 'qr_2', text: 'Bên em freeship từ 2 sản phẩm ạ' },
      { id: 'qr_3', text: 'Chị check tin nhắn chờ giúp em nha' },
      { id: 'qr_4', text: 'Dạ sản phẩm có bảo hành chính hãng 12 tháng ạ' },
      { id: 'qr_5', text: 'Em gửi bảng size cho chị tham khảo ạ' },
      { id: 'qr_6', text: 'Dạ em cảm ơn chị nhiều ạ ❤️' }
    ]
  },
  overview: {
    today_conversations: 1248,
    ai_auto_rate: 86.4,
    ai_handled: 1078,
    chot_don: 324,
    can_xu_ly: 38,
    via_performance: [
      { via: 'Via 1 - 200 Page', count: 310 },
      { via: 'Via 2 - 200 Page', count: 286 },
      { via: 'Via 3 - 200 Page', count: 262 },
      { via: 'Via 4 - 200 Page', count: 238 }
    ],
    top_pages: [
      { id: 'page_142', name: 'Page #142 - My pham Han', chats: 24, avatar: 'LA' },
      { id: 'page_089', name: 'Page #089 - Do gia dung', chats: 57, avatar: 'MH' }
    ]
  }
};

for (let i=1; i<=800; i++){
  let pid = `page_${String(i).padStart(3,'0')}`;
  if (!db.page_product_map[pid]){
    db.page_product_map[pid] = i % 2 === 0 ? 'prod_serum_vitc' : 'prod_combo_glow';
  }
}

module.exports = db;
