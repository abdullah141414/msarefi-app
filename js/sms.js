/* محلل رسائل البنوك — يستخرج المبلغ والمتجر ويخمّن الفئة */
const SmsParser = (() => {

  // تحويل الأرقام العربية إلى لاتينية وتوحيد الفواصل وإزالة العلامات الخفية
  function normalizeDigits(s) {
    return s
      .replace(/[‎‏؜​]/g, '')
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/٫/g, '.');
  }

  // رسائل ليست عمليات شراء — تُتجاهل
  const IGNORE_PATTERNS = [
    /رمز التحقق|رمز التفعيل|كلمة المرور|OTP|verification code|do not share|لا تشاركه/i,
    /راتب|إيداع|ايداع|وديعة|deposit|salary/i,
    /حوالة واردة|تحويل وارد|وصلتك حوالة|incoming transfer|received transfer/i,
    /استرداد|refund|عكس عملية|reversal/i,
    /رصيدك الحالي هو|استعلام رصيد|balance inquiry/i,
  ];

  // سطور الرصيد والرسوم — تُستبعد قبل البحث عن مبلغ الشراء
  const NON_AMOUNT_LINES = /رصيد|متبقي|رسوم|مستحق|إجمالي|اجمالي|balance|fee|total due/i;

  // أنماط استخراج المبلغ — الأكثر تحديداً أولاً
  const AMOUNT_PATTERNS = [
    /(?:مبلغ|بمبلغ|قيمة|بقيمة)\s*:?\s*(?:SAR|SR|ر\.?س\.?)?\s*([\d,]+(?:\.\d+)?)/i,
    /(?:SAR|SR)\s*([\d,]+(?:\.\d+)?)/i,
    /([\d,]+(?:\.\d+)?)\s*(?:SAR|SR|ر\.?س\.?|ريال)/i,
    /(?:Amount|POS)\s*:?\s*(?:SAR|SR)?\s*([\d,]+(?:\.\d+)?)/i,
  ];

  // أنماط استخراج اسم المتجر — أول السطر
  const MERCHANT_PATTERNS = [
    /^\s*(?:لدى|لدي)\s*:?\s*(.+?)\s*$/m,
    /^\s*من\s*:\s*(.+?)\s*$/m,               // من: المتجر
    /^\s*من\s+(?!خلال)(.+?)\s*$/m,           // من المتجر
    /^\s*من([A-Za-z0-9].*?)\s*$/m,           // منSalma — ملتصقة بحروف لاتينية فقط
    /^\s*عند\s*:?\s*(.+?)\s*$/m,
    /^\s*(?:At|Merchant)\s*:?\s*(.+?)\s*$/im,
  ];

  // أنماط التاريخ داخل الرسالة
  const DATE_PATTERNS = [
    /(\d{4})-(\d{1,2})-(\d{1,2})/,                    // 2026-07-06
    /(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/,            // 06/07/2026
    /(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})(?!\d)/,      // 04/07/26 أو 5-7-26 (يوم-شهر-سنة)
  ];

  // كلمات مفتاحية ← معرّف الفئة الافتراضية (قاموس متاجر سعودي موسّع)
  const CATEGORY_KEYWORDS = [
    { id: 'car',    words: ['بنزين', 'محطة', 'وقود', 'بترول', 'petromin', 'sasco', 'naft', 'aldrees', 'الدريس', 'ساسكو', 'نفط', 'بترومين', 'ساسكو', 'اراك', 'arak', 'كايان', 'kayan', 'وقودي', 'غيار', 'إطارات', 'اطارات', 'car wash', 'مغسلة', 'قطع غيار', 'كماليات', 'ورشة', 'تأمين سيارة', 'نجم', 'najm', 'ساهر', 'موقف', 'parking', 'تشليح', 'زيت', 'اويل', ' صبغ سيارة'] },
    { id: 'food',   words: ['مطعم', 'مطاعم', 'كافيه', 'كوفي', 'قهوة', 'بوفيه', 'بقالة', 'تموينات', 'سوبر ماركت', 'سوبرماركت', 'هايبر', 'أسواق', 'اسواق', 'مخبز', 'مخبوزات', 'حلويات', 'شاورما', 'بروست', 'مندي', 'مشويات', 'برجر', 'burger', 'pizza', 'بيتزا', 'restaurant', 'cafe', 'coffee', 'bakery', 'sweets', 'starbucks', 'ستاربكس', 'mcdonald', 'ماكدونالدز', 'kfc', 'كنتاكي', 'hardee', 'هارديز', 'herfy', 'هرفي', 'البيك', 'albaik', 'دانكن', 'dunkin', 'كودو', 'kudu', 'شيك شاك', 'shake shack', 'الرومانسية', 'الطازج', 'دجاج', 'بيك', 'subway', 'صب واي', 'دومينوز', 'domino', 'papa john', 'باسكن', 'baskin', 'كريسبي', 'krispy', 'تكا', 'برجر كنق', 'burger king', 'panda', 'بنده', 'تميمي', 'tamimi', 'العثيم', 'othaim', 'الدانوب', 'danube', 'لولو', 'lulu', 'كارفور', 'carrefour', 'نستو', 'nesto', 'بن داود', 'bindawood', 'المزرعة', 'كبريت', 'هنقرستيشن', 'hungerstation', 'jahez', 'جاهز', 'مرسول', 'mrsool', 'toyou', 'تويو', 'كيتا', 'keeta', 'ninja', 'نينجا', 'the chefz', 'شيفز', 'ubereats', 'careem now', 'عصير', 'juice', 'مياه', 'ماء صحي'] },
    { id: 'health', words: ['صيدلية', 'صيدليه', 'مستشفى', 'مستوصف', 'عيادة', 'عيادات', 'مجمع طبي', 'مختبر', 'طبي', 'اسنان', 'أسنان', 'نظارات', 'بصريات', 'النهدي', 'nahdi', 'الدواء', 'dawaa', 'whites', 'وايتس', 'صيدليات', 'pharmacy', 'clinic', 'hospital', 'medical', 'lab', 'مغربي', 'magrabi', 'بوبا', 'bupa', 'تداوي', 'حكيم', 'مختبرات', 'اشعة'] },
    { id: 'home',   words: ['كهرباء', 'المياه', 'الماء', 'غاز', 'إيجار', 'ايجار', 'عقار', 'أثاث', 'اثاث', 'ikea', 'ايكيا', 'ساكو', 'saco', 'homebox', 'هوم بوكس', 'home centre', 'هوم سنتر', 'دبليو', 'west elm', 'ارابيسك', 'electricity', 'water', 'gas', 'سباكة', 'كهربائي', 'صيانة', 'مكيف', 'تكييف', 'ادوات منزلية', 'مفروشات', 'ستائر', 'نجارة', 'دهانات', 'جبس', 'بلاط', 'عمالة', 'خادمة', 'مصبغة', 'غسيل'] },
    { id: 'phone',  words: ['stc', 'اس تي سي', 'موبايلي', 'mobily', 'زين', 'zain', 'سلام', 'salam', 'انترنت', 'إنترنت', 'اتصالات', 'شحن رصيد', 'sawa', 'سوا', 'باقة', 'فوري', 'quickpay', 'جوي', 'jawwy', 'redbull mobile', 'ابل', 'apple.com', 'google', 'جوجل', 'netflix', 'نتفلكس', 'shahid', 'شاهد', 'osn', 'يوتيوب', 'youtube', 'spotify', 'اشتراك'] },
    { id: 'shop',   words: ['أمازون', 'امازون', 'amazon', 'نون', 'noon', 'شي إن', 'شي ان', 'shein', 'زارا', 'zara', 'اتش اند ام', 'h&m', 'ملابس', 'أحذية', 'احذية', 'عطور', 'عطر', 'مول', 'mall', 'مكتبة جرير', 'جرير', 'jarir', 'اكسترا', 'extra', 'العروض', 'متجر', 'ماركة', 'سنتربوينت', 'centrepoint', 'ماكس', ' max ', 'namshi', 'نمشي', 'ازياء', 'اكسسوارات', 'ساعات', 'مجوهرات', 'ذهب', 'لعب', 'العاب', 'toys', 'هدايا', 'ورد', 'زهور', 'باث', 'bath', 'the body shop', 'sephora', 'سيفورا', 'نايس', 'ريد تاغ', 'redtag', 'sc store', 'حلاق', 'صالون', 'حلاقة', 'باربر', 'barber', 'تجميل'] },
  ];

  function parseAmount(text) {
    // نستبعد سطور الرصيد والرسوم حتى لا تُقرأ كمبلغ الشراء
    const searchable = text
      .split('\n')
      .filter((line) => !NON_AMOUNT_LINES.test(line))
      .join('\n');
    for (const re of AMOUNT_PATTERNS) {
      const m = searchable.match(re);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (isFinite(val) && val > 0) return Math.round(val * 100) / 100;
      }
    }
    return null;
  }

  function parseMerchant(text) {
    for (const re of MERCHANT_PATTERNS) {
      const m = text.match(re);
      if (m) {
        const name = m[1].trim().replace(/[*_#]+/g, '').slice(0, 60);
        if (name) return name;
      }
    }
    return '';
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // تُرجع التاريخ فقط إذا كان منطقياً (ليس مستقبلياً ولا أقدم من سنة)
  function validDate(y, mo, d) {
    y = Number(y); mo = Number(mo); d = Number(d);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, mo - 1, d);
    const now = Date.now();
    if (date.getTime() > now + 86400000) return null;
    if (date.getTime() < now - 365 * 86400000) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }

  function parseDate(text) {
    let m = text.match(DATE_PATTERNS[0]);
    if (m) return validDate(m[1], m[2], m[3]);
    m = text.match(DATE_PATTERNS[1]);
    if (m) return validDate(m[3], m[2], m[1]);
    m = text.match(DATE_PATTERNS[2]);
    if (m) {
      // يوم-شهر-سنة مختصرة، وإذا طلع الشهر غير منطقي نجرب العكس
      return validDate(2000 + Number(m[3]), m[2], m[1]) || validDate(2000 + Number(m[3]), m[1], m[2]);
    }
    return null;
  }

  // آخر 4 أرقام من البطاقة: «بطاقة:4886»، «X6755»، «**8079»، «5280*»
  const CARD_PATTERNS = [
    /(?:بطاقة|البطاقة|card)\s*:?\s*\*{0,2}(\d{4})/i,
    /[X×]\s?(\d{4})/,
    /\*{2}(\d{4})/,
    /(\d{4})\*/,
  ];

  function parseCard(text) {
    for (const re of CARD_PATTERNS) {
      const m = text.match(re);
      if (m) return m[1];
    }
    return '';
  }

  function parse(rawText) {
    const text = normalizeDigits(String(rawText || '')).trim();
    if (!text) return { ok: false, reason: 'empty' };

    for (const re of IGNORE_PATTERNS) {
      if (re.test(text)) return { ok: false, reason: 'not-purchase' };
    }

    const amount = parseAmount(text);
    const merchant = parseMerchant(text);
    const date = parseDate(text);
    const card = parseCard(text);

    if (amount === null) return { ok: false, reason: 'no-amount', merchant, text };
    return { ok: true, amount, merchant, date, card };
  }

  // تطبيع اسم المتجر لمطابقة ثابتة (يزيل رموز/أرقام الفرع والبطاقة)
  function normalizeMerchant(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[*#_]/g, ' ')
      .replace(/[-–]/g, ' ')
      .replace(/\b[a-z]?\d[\d]*\b/g, ' ')   // إزالة أرقام الفرع/الرمز
      .replace(/\s+/g, ' ')
      .trim();
  }

  // تخمين الفئة: التعلّم من تصحيحات المستخدم أولاً، ثم القاموس، ثم «أخرى»
  function guessCategory(merchant, text, categories) {
    // 1) خريطة التعلّم تطغى على كل شيء
    try {
      const learned = (typeof Store !== 'undefined' && Store.getLearnedMerchants) ? Store.getLearnedMerchants() : {};
      const norm = normalizeMerchant(merchant);
      if (norm && learned[norm] && categories.some((c) => c.id === learned[norm])) {
        return learned[norm];
      }
    } catch { /* تجاهل */ }

    // 2) قاموس الكلمات المفتاحية
    const haystack = `${merchant} ${text}`.toLowerCase();
    for (const group of CATEGORY_KEYWORDS) {
      if (!categories.some((c) => c.id === group.id)) continue;
      if (group.words.some((w) => haystack.includes(w.toLowerCase()))) return group.id;
    }
    return categories.some((c) => c.id === 'other') ? 'other' : categories[0].id;
  }

  // بصمة بسيطة لنص الرسالة لمنع التسجيل المكرر
  function fingerprint(rawText) {
    const s = String(rawText || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return 'h' + (h >>> 0).toString(36);
  }

  return { parse, guessCategory, fingerprint, normalizeMerchant };
})();
