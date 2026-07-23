#!/usr/bin/env node
// Bulk-populate the trivia game via the agent API.
// Usage: node scripts/agent-bulk-add.js [URL] [PASSWORD]
//   URL defaults to http://127.0.0.1:3000
//   PASSWORD defaults to env AGENT_PASSWORD, then 'admin'

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3000';
const PASSWORD = process.argv[3] || process.env.AGENT_PASSWORD || 'admin';

const questions = [
  // ── Geography (8) ───────────────────────────────────────────────────────
  { question: 'ما هي أكبر دولة في العالم من حيث المساحة؟', choices: [{text:'الصين',correct:false},{text:'الولايات المتحدة',correct:false},{text:'كندا',correct:false},{text:'روسيا',correct:true}], difficulty: 'easy', category: 'geography' },
  { question: 'ما هي أطول نهر في العالم؟', choices: [{text:'نهر الأمازون',correct:false},{text:'نهر النيل',correct:true},{text:'نهر المسيسيبي',correct:false},{text:'نهر اليانغتسي',correct:false}], difficulty: 'medium', category: 'geography' },
  { question: 'في أي قارة تقع دولة المغرب؟', choices: [{text:'آسيا',correct:false},{text:'أفريقيا',correct:true},{text:'أوروبا',correct:false},{text:'أمريكا الجنوبية',correct:false}], difficulty: 'easy', category: 'geography' },
  { question: 'ما هو أعلى جبل في العالم؟', choices: [{text:'جبل كليمنجارو',correct:false},{text:'جبل إيفرست',correct:true},{text:'جبل كي تو',correct:false},{text:'جبل أكونكاغوا',correct:false}], difficulty: 'medium', category: 'geography' },
  { question: 'كم عدد قارات العالم؟', choices: [{text:'5',correct:false},{text:'6',correct:false},{text:'7',correct:true},{text:'8',correct:false}], difficulty: 'easy', category: 'geography' },
  { question: 'ما هي أكبر صحراء في العالم؟', choices: [{text:'صحراء الربع الخالي',correct:false},{text:'الصحراء الكبرى',correct:false},{text:'صحراء أنتاركتيكا',correct:true},{text:'صحراء غوبي',correct:false}], difficulty: 'hard', category: 'geography' },
  { question: 'ما هي عاصمة اليابان؟', choices: [{text:'سيول',correct:false},{text:'بكين',correct:false},{text:'طوكيو',correct:true},{text:'بانكوك',correct:false}], difficulty: 'easy', category: 'geography' },
  { question: 'ما هو أعمق محيط في العالم؟', choices: [{text:'المحيط الأطلسي',correct:false},{text:'المحيط الهادئ',correct:true},{text:'المحيط الهندي',correct:false},{text:'المحيط المتجمد الشمالي',correct:false}], difficulty: 'medium', category: 'geography' },

  // ── Science (8) ────────────────────────────────────────────────────────
  { question: 'ما هو رمز عنصر الذهب في الجدول الدوري؟', choices: [{text:'Gd',correct:false},{text:'Go',correct:false},{text:'Au',correct:true},{text:'Ag',correct:false}], difficulty: 'medium', category: 'science' },
  { question: 'كم عدد الكواكب في المجموعة الشمسية؟', choices: [{text:'7',correct:false},{text:'8',correct:true},{text:'9',correct:false},{text:'10',correct:false}], difficulty: 'easy', category: 'science' },
  { question: 'ما هو أكبر عضو في جسم الإنسان؟', choices: [{text:'الدماغ',correct:false},{text:'الكبد',correct:true},{text:'القلب',correct:false},{text:'الرئتان',correct:false}], difficulty: 'medium', category: 'science' },
  { question: 'ما هي السرعة التقريبية للضوء في الفراغ؟', choices: [{text:'150,000 كم/ث',correct:false},{text:'300,000 كم/ث',correct:true},{text:'500,000 كم/ث',correct:false},{text:'1,000,000 كم/ث',correct:false}], difficulty: 'hard', category: 'science' },
  { question: 'ما هو الغاز الأكثر وفرة في الغلاف الجوي للأرض؟', choices: [{text:'الأكسجين',correct:false},{text:'ثاني أكسيد الكربون',correct:false},{text:'النيتروجين',correct:true},{text:'الهيدروجين',correct:false}], difficulty: 'medium', category: 'science' },
  { question: 'ما هو الحمض النووي DNA؟', choices: [{text:'بروتين',correct:false},{text:'مادة وراثية',correct:true},{text:'إنزيم',correct:false},{text:'فيتامين',correct:false}], difficulty: 'easy', category: 'science' },
  { question: 'كم عدد العظام في جسم الإنسان البالغ؟', choices: [{text:'180',correct:false},{text:'206',correct:true},{text:'250',correct:false},{text:'300',correct:false}], difficulty: 'hard', category: 'science' },
  { question: 'ما هو أصلب معدن طبيعي على الأرض؟', choices: [{text:'الحديد',correct:false},{text:'التيتانيوم',correct:false},{text:'الألماس',correct:true},{text:'الكوارتز',correct:false}], difficulty: 'medium', category: 'science' },

  // ── History (7) ────────────────────────────────────────────────────────
  { question: 'في أي عام تأسست جامعة القرويين في فاس، المغرب (أقدم جامعة في العالم)؟', choices: [{text:'737م',correct:false},{text:'859م',correct:true},{text:'1066م',correct:false},{text:'1200م',correct:false}], difficulty: 'hard', category: 'history' },
  { question: 'من هو القائد الذي فتح الأندلس عام 711م؟', choices: [{text:'موسى بن نصير',correct:false},{text:'طارق بن زياد',correct:true},{text:'عقبة بن نافع',correct:false},{text:'صلاح الدين الأيوبي',correct:false}], difficulty: 'medium', category: 'history' },
  { question: 'متى سقطت القسطنطينية بيد العثمانيين؟', choices: [{text:'1389م',correct:false},{text:'1453م',correct:true},{text:'1492م',correct:false},{text:'1517م',correct:false}], difficulty: 'hard', category: 'history' },
  { question: 'من هو مؤلف كتاب "مقدمة ابن خلدون"؟', choices: [{text:'ابن سينا',correct:false},{text:'ابن النفيس',correct:false},{text:'عبد الرحمن بن خلدون',correct:true},{text:'ابن رشد',correct:false}], difficulty: 'medium', category: 'history' },
  { question: 'متى بدأت الحرب العالمية الثانية؟', choices: [{text:'1914',correct:false},{text:'1938',correct:false},{text:'1939',correct:true},{text:'1941',correct:false}], difficulty: 'medium', category: 'history' },
  { question: 'من بنى الأهرامات الكبرى في مصر؟', choices: [{text:'الرومان',correct:false},{text:'الإغريق',correct:false},{text:'المصريون القدماء',correct:true},{text:'الفرس',correct:false}], difficulty: 'easy', category: 'history' },
  { question: 'متى وُلد النبي محمد ﷺ؟', choices: [{text:'570م',correct:true},{text:'610م',correct:false},{text:'632م',correct:false},{text:'700م',correct:false}], difficulty: 'medium', category: 'history' },

  // ── Islam & Arab culture (6) ──────────────────────────────────────────
  { question: 'كم عدد أركان الإسلام؟', choices: [{text:'أربعة',correct:false},{text:'خمسة',correct:true},{text:'ستة',correct:false},{text:'سبعة',correct:false}], difficulty: 'easy', category: 'islam' },
  { question: 'كم عدد سور القرآن الكريم؟', choices: [{text:'112',correct:false},{text:'114',correct:true},{text:'116',correct:false},{text:'120',correct:false}], difficulty: 'easy', category: 'islam' },
  { question: 'في أي مدينة نزل الوحي على النبي محمد ﷺ لأول مرة؟', choices: [{text:'مكة المكرمة',correct:false},{text:'المدينة المنورة',correct:false},{text:'غار حراء (مكة)',correct:true},{text:'الطائف',correct:false}], difficulty: 'medium', category: 'islam' },
  { question: 'ما هو الشهر الذي نزل فيه القرآن الكريم؟', choices: [{text:'محرم',correct:false},{text:'رجب',correct:false},{text:'رمضان',correct:true},{text:'ذو الحجة',correct:false}], difficulty: 'easy', category: 'islam' },
  { question: 'ما هي أطول سورة في القرآن الكريم؟', choices: [{text:'سورة آل عمران',correct:false},{text:'سورة النساء',correct:false},{text:'سورة البقرة',correct:true},{text:'سورة المائدة',correct:false}], difficulty: 'medium', category: 'islam' },
  { question: 'في أي ليلة من رمضان نزل القرآن الكريم؟', choices: [{text:'ليلة الإسراء والمعراج',correct:false},{text:'ليلة القدر',correct:true},{text:'ليلة النصف من شعبان',correct:false},{text:'ليلة عيد الفطر',correct:false}], difficulty: 'hard', category: 'islam' },

  // ── Math & Logic (5) ───────────────────────────────────────────────────
  { question: 'كم يساوي 15 × 15؟', choices: [{text:'200',correct:false},{text:'215',correct:false},{text:'225',correct:true},{text:'250',correct:false}], difficulty: 'easy', category: 'math' },
  { question: 'ما هو الجذر التربيعي للعدد 144؟', choices: [{text:'10',correct:false},{text:'11',correct:false},{text:'12',correct:true},{text:'14',correct:false}], difficulty: 'easy', category: 'math' },
  { question: 'كم عدد أضلاع المثلث؟', choices: [{text:'2',correct:false},{text:'3',correct:true},{text:'4',correct:false},{text:'5',correct:false}], difficulty: 'easy', category: 'math' },
  { question: 'ما هي قيمة باي (π) تقريباً إلى منزلتين عشريتين؟', choices: [{text:'3.12',correct:false},{text:'3.14',correct:true},{text:'3.16',correct:false},{text:'3.18',correct:false}], difficulty: 'medium', category: 'math' },
  { question: 'إذا كان لديك 3 تفاحات وأعطيت واحدة لصديقك، كم يتبقى؟', choices: [{text:'1',correct:false},{text:'2',correct:true},{text:'3',correct:false},{text:'4',correct:false}], difficulty: 'easy', category: 'math' },

  // ── Literature & Language (4) ──────────────────────────────────────────
  { question: 'من هو مؤلف رواية "موسم الهجرة إلى الشمال"؟', choices: [{text:'نجيب محفوظ',correct:false},{text:'الطيب صالح',correct:true},{text:'غسان كنفاني',correct:false},{text:'محمود درويش',correct:false}], difficulty: 'hard', category: 'literature' },
  { question: 'ما هو الشاعر الملقب بـ"أمير الشعراء"؟', choices: [{text:'أحمد شوقي',correct:true},{text:'نزار قباني',correct:false},{text:'محمود درويش',correct:false},{text:'بدر شاكر السياب',correct:false}], difficulty: 'medium', category: 'literature' },
  { question: 'كم عدد حروف اللغة العربية؟', choices: [{text:'26',correct:false},{text:'28',correct:true},{text:'30',correct:false},{text:'32',correct:false}], difficulty: 'medium', category: 'literature' },
  { question: 'من هو مؤلف كتاب "الأيام"؟', choices: [{text:'طه حسين',correct:true},{text:'نجيب محفوظ',correct:false},{text:'توفيق الحكيم',correct:false},{text:'عباس العقاد',correct:false}], difficulty: 'hard', category: 'literature' },

  // ── Sports (3) ──────────────────────────────────────────────────────────
  { question: 'في أي عام فاز المنتخب المصري لكرة القدم بأول كأس أمم أفريقية؟', choices: [{text:'1957',correct:true},{text:'1959',correct:false},{text:'1962',correct:false},{text:'1965',correct:false}], difficulty: 'hard', category: 'sports' },
  { question: 'كم عدد لاعبي فريق كرة القدم داخل أرض الملعب؟', choices: [{text:'9',correct:false},{text:'10',correct:false},{text:'11',correct:true},{text:'12',correct:false}], difficulty: 'easy', category: 'sports' },
  { question: 'أين أقيمت أول دورة ألعاب أولمبية حديثة؟', choices: [{text:'باريس',correct:false},{text:'لندن',correct:false},{text:'أثينا',correct:true},{text:'روما',correct:false}], difficulty: 'medium', category: 'sports' },

  // ── General knowledge (4) ──────────────────────────────────────────────
  { question: 'كم عدد أسنان الإنسان البالغ؟', choices: [{text:'28',correct:false},{text:'30',correct:false},{text:'32',correct:true},{text:'34',correct:false}], difficulty: 'medium', category: 'general' },
  { question: 'ما هي أكبر قارة من حيث المساحة؟', choices: [{text:'أفريقيا',correct:false},{text:'أمريكا الشمالية',correct:false},{text:'آسيا',correct:true},{text:'أوروبا',correct:false}], difficulty: 'easy', category: 'general' },
  { question: 'ما هو الحيوان الذي يُلقب بـ"سفينة الصحراء"؟', choices: [{text:'الحصان',correct:false},{text:'الجمل',correct:true},{text:'الحمار',correct:false},{text:'الثعلب',correct:false}], difficulty: 'easy', category: 'general' },
  { question: 'ما هو العنصر الأكثر وفرة في القشرة الأرضية؟', choices: [{text:'الحديد',correct:false},{text:'الأكسجين',correct:true},{text:'السيليكون',correct:false},{text:'الألمنيوم',correct:false}], difficulty: 'hard', category: 'general' },
];

let cookieJar = '';

function request(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (cookieJar) headers.Cookie = cookieJar;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: opts.method || 'GET', headers,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        // Capture set-cookie (might be multiple, comma-separated)
        if (res.headers['set-cookie']) {
          for (const sc of res.headers['set-cookie']) {
            const pair = sc.split(';')[0];
            if (pair.startsWith('admin_session=')) cookieJar = pair;
          }
        }
        const ct = res.headers['content-type'] || '';
        if (ct.includes('json')) {
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
          catch (e) { resolve({ status: res.statusCode, body }); }
        } else resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

(async () => {
  console.log(`Target: ${BASE}`);
  console.log(`Password: ${PASSWORD === 'admin' ? '(default)' : '(provided)'}`);

  // Login
  const login = await request('/admin/api/login', { method: 'POST', body: { password: PASSWORD } });
  if (login.status !== 200) {
    console.error('✗ login failed:', login.status, login.body);
    process.exit(1);
  }
  console.log('✓ logged in');

  // Stats before
  const before = await request('/admin/api/stats');
  console.log(`  before: ${before.body.total} questions`);

  // Bulk insert
  const res = await request('/admin/api/questions/bulk', { method: 'POST', body: { questions } });
  if (res.status !== 201) {
    console.error('✗ bulk insert failed:', res.status, res.body);
    process.exit(1);
  }
  console.log(`✓ inserted ${res.body.inserted} questions (ids ${res.body.ids[0]}..${res.body.ids.at(-1)})`);

  // Stats after
  const after = await request('/admin/api/stats');
  console.log(`  after:  ${after.body.total} questions`);
  console.log('  by category:', after.body.byCategory.map(c => `${c.category}=${c.n}`).join(', '));
  console.log('  by difficulty:', after.body.byDifficulty.map(d => `${d.difficulty}=${d.n}`).join(', '));
})();
