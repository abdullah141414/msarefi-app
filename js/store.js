/* التخزين المحلي — كل البيانات تبقى على الجهاز */
const Store = (() => {
  const KEY_EXPENSES = 'masareefi.expenses';
  const KEY_CATEGORIES = 'masareefi.categories';
  const KEY_SMS_HASHES = 'masareefi.smsHashes';
  const KEY_RELAY = 'masareefi.relay';
  const KEY_CYCLE_START = 'masareefi.cycleStartDay';
  const KEY_LEARNED = 'masareefi.learnedMerchants';
  const KEY_BUDGETS = 'masareefi.budgets';
  const KEY_RECURRING = 'masareefi.recurring';
  const KEY_RECUR_DONE = 'masareefi.recurringDone';
  const KEY_SETTINGS = 'masareefi.settings';

  const DEFAULT_SETTINGS = {
    theme: 'teal',          // teal | royal | gold | night
    mode: 'auto',           // auto | light | dark
    arabicDigits: false,    // أرقام مشرقية ٠-٩
    hideAmounts: false,     // وضع التخفي
    savingsGoal: 0,         // هدف الادخار الشهري
    pinHash: null,          // قفل الخصوصية
    faceId: false,
    onboarded: false,
    dismissedSubs: [],      // اقتراحات اشتراكات مرفوضة
  };

  const DEFAULT_CATEGORIES = [
    { id: 'home',   name: 'بيت',      icon: '🏠', color: '#0ea5e9' },
    { id: 'car',    name: 'سيارة',    icon: '🚗', color: '#f59e0b' },
    { id: 'food',   name: 'أكل',      icon: '🍽️', color: '#ef4444' },
    { id: 'shop',   name: 'تسوق',     icon: '🛍️', color: '#a855f7' },
    { id: 'health', name: 'صحة',      icon: '💊', color: '#10b981' },
    { id: 'phone',  name: 'اتصالات',  icon: '📱', color: '#6366f1' },
    { id: 'other',  name: 'أخرى',     icon: '📦', color: '#64748b' },
  ];

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getCategories() {
    let cats = load(KEY_CATEGORIES, null);
    if (!cats || !cats.length) {
      cats = DEFAULT_CATEGORIES;
      save(KEY_CATEGORIES, cats);
    }
    return cats;
  }

  function setCategories(cats) { save(KEY_CATEGORIES, cats); }

  function getExpenses() { return load(KEY_EXPENSES, []); }

  function setExpenses(expenses) { save(KEY_EXPENSES, expenses); }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // بصمات رسائل البنك المسجلة — لمنع التكرار (نحتفظ بآخر 50)
  function hasSmsHash(hash) {
    return load(KEY_SMS_HASHES, []).includes(hash);
  }

  function addSmsHash(hash) {
    const hashes = load(KEY_SMS_HASHES, []);
    hashes.push(hash);
    save(KEY_SMS_HASHES, hashes.slice(-50));
  }

  // إعدادات صندوق البريد (Cloudflare) — { origin, key } أو null
  function getRelay() { return load(KEY_RELAY, null); }
  function setRelay(relay) { save(KEY_RELAY, relay); }

  // يوم بداية الدورة الشهرية (1–28) — الافتراضي 1 = الشهر الميلادي
  function getCycleStartDay() {
    const d = Number(load(KEY_CYCLE_START, 1));
    return Number.isInteger(d) && d >= 1 && d <= 28 ? d : 1;
  }
  function setCycleStartDay(day) {
    save(KEY_CYCLE_START, Math.min(28, Math.max(1, Math.round(day))));
  }

  // خريطة التعلّم: اسم متجر مُطبّع → معرّف الفئة
  function getLearnedMerchants() { return load(KEY_LEARNED, {}); }
  function learnMerchant(normname, categoryId) {
    if (!normname) return;
    const map = load(KEY_LEARNED, {});
    map[normname] = categoryId;
    save(KEY_LEARNED, map);
  }
  function forgetMerchant(normname) {
    const map = load(KEY_LEARNED, {});
    delete map[normname];
    save(KEY_LEARNED, map);
  }

  // الميزانيات: { categoryId: amount } — سقف شهري لكل دورة
  function getBudgets() { return load(KEY_BUDGETS, {}); }
  function setBudget(categoryId, amount) {
    const b = load(KEY_BUDGETS, {});
    if (amount > 0) b[categoryId] = amount;
    else delete b[categoryId];
    save(KEY_BUDGETS, b);
  }

  // المصاريف المتكررة: [{ id, amount, categoryId, note, dayOfMonth }]
  function getRecurring() { return load(KEY_RECURRING, []); }
  function setRecurring(list) { save(KEY_RECURRING, list); }
  // سجل ما تولّد فعلاً: مجموعة مفاتيح "templateId@cycleKey"
  function getRecurringDone() { return load(KEY_RECUR_DONE, []); }
  function markRecurringDone(list) { save(KEY_RECUR_DONE, list.slice(-400)); }

  // الإعدادات العامة — كائن واحد مدموج مع الافتراضيات
  function getSettings() {
    return { ...DEFAULT_SETTINGS, ...load(KEY_SETTINGS, {}) };
  }
  function setSettings(patch) {
    save(KEY_SETTINGS, { ...getSettings(), ...patch });
  }

  // ===== النسخ الاحتياطي =====
  function exportAll() {
    return {
      app: 'masareefi',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        expenses: getExpenses(),
        categories: getCategories(),
        cycleStartDay: getCycleStartDay(),
        learnedMerchants: getLearnedMerchants(),
        budgets: getBudgets(),
        recurring: getRecurring(),
        settings: getSettings(),
      },
    };
  }

  // يرجع true عند نجاح الاستيراد
  function importAll(obj) {
    if (!obj || obj.app !== 'masareefi' || !obj.data) return false;
    const d = obj.data;
    if (Array.isArray(d.expenses)) save(KEY_EXPENSES, d.expenses);
    if (Array.isArray(d.categories) && d.categories.length) save(KEY_CATEGORIES, d.categories);
    if (d.cycleStartDay) setCycleStartDay(Number(d.cycleStartDay));
    if (d.learnedMerchants && typeof d.learnedMerchants === 'object') save(KEY_LEARNED, d.learnedMerchants);
    if (d.budgets && typeof d.budgets === 'object') save(KEY_BUDGETS, d.budgets);
    if (Array.isArray(d.recurring)) save(KEY_RECURRING, d.recurring);
    if (d.settings && typeof d.settings === 'object') save(KEY_SETTINGS, d.settings);
    return true;
  }

  return {
    getCategories, setCategories, getExpenses, setExpenses, newId,
    hasSmsHash, addSmsHash, getRelay, setRelay,
    getCycleStartDay, setCycleStartDay,
    getLearnedMerchants, learnMerchant, forgetMerchant,
    getBudgets, setBudget,
    getRecurring, setRecurring, getRecurringDone, markRecurringDone,
    getSettings, setSettings,
    exportAll, importAll,
  };
})();
