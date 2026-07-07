/* منطق التطبيق */
(() => {
  // ===== الحالة =====
  let categories = Store.getCategories();
  let expenses = Store.getExpenses();
  let recordCycle;                            // الدورة المعروضة في السجل (يُضبط بعد تعريف الدوال)
  let statsCycle;                             // الدورة المعروضة في الإحصائيات
  let editingExpenseId = null;
  let editingCategoryId = null;
  let selectedCategoryId = null;              // داخل نافذة المصروف
  let selectedKind = 'expense';               // مصروف أو دخل
  let selectedIcon = null;
  let selectedColor = null;
  let recurringCategoryId = null;             // داخل نافذة المتكررة
  let recordQuery = '';                       // نص البحث في السجل
  let homeSpendTotal = 0;                     // لعدّاد الرئيسية
  let statsTotal = 0;                         // لعدّاد الإحصائيات
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ترتيب التبويبات كما تظهر بالشريط — يُستخدم لتحديد اتجاه الانتقال (تبويب أو سحب)
  const TAB_ORDER = ['home', 'stats', 'record', 'categories'];
  let activeView = 'home';

  const CATEGORY_ICONS = ['🏠','🚗','🍽️','🛍️','💊','📱','👕','🎓','✈️','⚽','🎮','☕','⛽','🧾','🎁','💇','🐈','🕌','💼','📦'];
  const CATEGORY_COLORS = ['#0ea5e9','#f59e0b','#ef4444','#a855f7','#10b981','#6366f1','#ec4899','#f97316','#14b8a6','#64748b'];

  // ===== أدوات =====
  const $ = (id) => document.getElementById(id);

  // ===== الإعدادات والمظهر =====
  let settings = Store.getSettings();

  let fmtMoney, fmtMonth, fmtDay, fmtDayMonth, fmtMonthShort;
  function buildFormatters() {
    const nu = settings.arabicDigits ? 'arab' : 'latn';
    fmtMoney = new Intl.NumberFormat(`ar-SA-u-nu-${nu}`, { maximumFractionDigits: 2 });
    fmtMonth = new Intl.DateTimeFormat(`ar-u-ca-gregory-nu-${nu}`, { month: 'long', year: 'numeric' });
    fmtDay = new Intl.DateTimeFormat(`ar-u-ca-gregory-nu-${nu}`, { weekday: 'long', day: 'numeric', month: 'long' });
    fmtDayMonth = new Intl.DateTimeFormat(`ar-u-ca-gregory-nu-${nu}`, { day: 'numeric', month: 'long' });
    fmtMonthShort = new Intl.DateTimeFormat(`ar-u-ca-gregory-nu-${nu}`, { month: 'short' });
  }
  buildFormatters();

  function digitChars() { return settings.arabicDigits ? [...'٠١٢٣٤٥٦٧٨٩'] : [...'0123456789']; }

  function money(n) {
    if (settings.hideAmounts) return '••••';
    return `${fmtMoney.format(n)} ر.س`;
  }

  function applyAppearance() {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.mode = settings.mode;
  }
  applyAppearance();

  function pad(n) { return String(n).padStart(2, '0'); }

  function isoOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function todayISO() { return isoOf(new Date()); }

  // ===== الدورة الشهرية (تتبع يوم بداية يحدده المستخدم) =====
  function cycleStartDay() { return Store.getCycleStartDay(); }

  // بداية الدورة التي يقع فيها تاريخ معيّن (كائن Date)
  function cycleStartOf(date) {
    const s = cycleStartDay();
    const y = date.getFullYear(), m = date.getMonth();
    return date.getDate() >= s ? new Date(y, m, s) : new Date(y, m - 1, s);
  }

  // مُعرّف الدورة = ISO لبدايتها "YYYY-MM-DD"
  function cycleKeyOf(date) { return isoOf(cycleStartOf(date)); }
  function cycleKeyOfISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return cycleKeyOf(new Date(y, m - 1, d));
  }
  function currentCycleKey() { return cycleKeyOf(new Date()); }

  // حدود الدورة: البداية والبداية التالية (نهاية غير شاملة)
  function cycleBounds(key) {
    const [y, m, d] = key.split('-').map(Number);
    return { start: new Date(y, m - 1, d), next: new Date(y, m, d) };
  }

  function expensesOfCycle(key) {
    const { start, next } = cycleBounds(key);
    const s = isoOf(start), n = isoOf(next);
    return expenses.filter((e) => e.date >= s && e.date < n);
  }

  function shiftCycle(key, delta) {
    const { start } = cycleBounds(key);
    return cycleKeyOf(new Date(start.getFullYear(), start.getMonth() + delta, start.getDate()));
  }

  function cycleLabel(key) {
    const { start, next } = cycleBounds(key);
    if (cycleStartDay() === 1) return fmtMonth.format(start);
    const end = new Date(next); end.setDate(end.getDate() - 1);
    return `${fmtDayMonth.format(start)} – ${fmtDayMonth.format(end)}`;
  }

  function catById(id) {
    return categories.find((c) => c.id === id) || categories.find((c) => c.id === 'other') || categories[0];
  }

  function sum(list) { return list.reduce((t, e) => t + e.amount, 0); }

  // فصل المصاريف عن الدخل
  function isIncome(e) { return e.kind === 'income'; }
  function onlyExpenses(list) { return list.filter((e) => !isIncome(e)); }
  function onlyIncome(list) { return list.filter(isIncome); }

  // تحويل نص مبلغ (يقبل الأرقام العربية) إلى رقم أو NaN
  function parseAmountInput(str) {
    const raw = String(str || '')
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/٫/g, '.')
      .replace(/,/g, '.');
    return parseFloat(raw);
  }

  // ===== حركات الدخول =====
  // عدّاد أسطواني (Odometer): كل خانة تلف بسلاسة من 0 وتستقر على رقمها.
  // الحركة كلها CSS transform — ناعمة تماماً وبدون أي اهتزاز نصي.
  function countUp(el, to) {
    if (!el) return;
    if (reduceMotion || to <= 0 || settings.hideAmounts) { el.textContent = money(to); return; }

    const digits = digitChars();
    const finalStr = fmtMoney.format(to);
    el.innerHTML = '';
    const wrap = document.createElement('span');
    wrap.className = 'odo';
    const strips = [];

    for (const ch of finalStr) {
      const dv = digits.indexOf(ch);
      if (dv >= 0) {
        const col = document.createElement('span');
        col.className = 'odo-col';
        const strip = document.createElement('span');
        strip.className = 'odo-strip';
        let cells = '';
        // دورتان من 0-9 حتى تلف كل خانة لفة كاملة قبل ما تستقر
        for (let r = 0; r < 2; r++) {
          for (let d = 0; d <= 9; d++) cells += `<span class="odo-cell">${digits[d]}</span>`;
        }
        strip.innerHTML = cells;
        col.appendChild(strip);
        wrap.appendChild(col);
        strips.push({ strip, digit: dv });
      } else {
        const sep = document.createElement('span');
        sep.textContent = ch;
        wrap.appendChild(sep);
      }
    }

    el.appendChild(wrap);
    el.appendChild(document.createTextNode(' ر.س'));

    // إطاران حتى يرسم المتصفح وضعية الصفر ثم تبدأ اللفة
    requestAnimationFrame(() => requestAnimationFrame(() => {
      strips.forEach((s, i) => {
        s.strip.style.transitionDuration = `${(0.9 + i * 0.13).toFixed(2)}s`;
        s.strip.style.transform = `translateY(${-(10 + s.digit)}em)`;
      });
    }));
  }

  // يعيد تشغيل حركات دخول العرض النشط
  // full=true: الحركة الكاملة (تتابع البطاقات، الدائرة، اللمعة) — لأول تحميل ولتصفّح الدورات
  // full=false: عدّاد الأرقام فقط — للتنقل العادي بين التبويبات (تفادياً لتراكم حركات يبين كرمشة)
  let entranceTimer;
  function playEntrance(viewName, full = true) {
    if (reduceMotion) return;
    if (viewName === 'home') countUp($('home-total'), homeSpendTotal);
    else if (viewName === 'stats' && statsTotal > 0) countUp($('donut-total'), statsTotal);
    if (!full) return;
    const view = $(`view-${viewName}`);
    if (!view) return;
    view.classList.remove('animate-in');
    void view.offsetWidth; // إعادة تدفّق لإعادة تشغيل الحركات
    view.classList.add('animate-in');
    // نشيل الصنف بعد انتهاء الحركات حتى ما تتكرر عند إعادة الرسم
    clearTimeout(entranceTimer);
    entranceTimer = setTimeout(() => view.classList.remove('animate-in'), 1600);
  }

  recordCycle = currentCycleKey();
  statsCycle = currentCycleKey();

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  // توست مع زر تراجع (يبقى أطول)
  function toastUndo(msg, onUndo) {
    const el = $('toast');
    el.innerHTML = `${escapeHtml(msg)} <button class="toast-action">تراجع</button>`;
    el.classList.remove('hidden');
    el.querySelector('.toast-action').addEventListener('click', () => {
      clearTimeout(toastTimer);
      el.classList.add('hidden');
      onUndo();
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 5000);
  }

  // ===== التنقل بين العروض (تبويب أو سحب) =====
  // انتقال واحد خفيف واتجاهي — بلا تراكم حركات وبلا رمشة
  let navInTimer;
  function goToView(viewName) {
    if (!TAB_ORDER.includes(viewName) || viewName === activeView) return;
    const forward = TAB_ORDER.indexOf(viewName) > TAB_ORDER.indexOf(activeView);
    activeView = viewName;

    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === viewName));
    document.querySelectorAll('.view').forEach((v) => { v.classList.remove('active', 'nav-in'); v.style.transform = ''; v.style.transition = ''; });
    const view = $(`view-${viewName}`);
    view.classList.add('active');
    window.scrollTo(0, 0);
    renderAll();

    if (!reduceMotion) {
      void view.offsetWidth; // إعادة تدفّق لإعادة تشغيل الحركة
      view.style.setProperty('--nav-dir', forward ? '1' : '-1');
      view.classList.add('nav-in');
      // شبكة أمان: نضمن زوال الصنف والخاصية حتى لو انقطعت الحركة لأي سبب
      clearTimeout(navInTimer);
      navInTimer = setTimeout(() => {
        view.classList.remove('nav-in');
        view.style.removeProperty('--nav-dir');
      }, 320);
    }
    playEntrance(viewName, false);
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => goToView(tab.dataset.view));
  });

  // ===== السحب بين الصفحات (يعمل جنباً إلى جنب مع أيقونات التبويب) =====
  (function swipeNav() {
    const IGNORE = '.sheet, .sheet-backdrop, .onboarding, .lock-screen, .swipe-wrap, .insights-row, .bars-wrap, .smshelp-url, input, textarea, select';
    let sx = 0, sy = 0, tracking = false, horizontal = null, dragging = false, dragView = null, curDx = 0;

    function overlayOpen() {
      return document.querySelector('.sheet:not(.hidden)')
        || !$('lock-screen').classList.contains('hidden')
        || !$('onboarding').classList.contains('hidden');
    }

    document.addEventListener('touchstart', (ev) => {
      if (ev.touches.length !== 1 || overlayOpen() || ev.target.closest(IGNORE)) { tracking = false; return; }
      const t = ev.touches[0];
      sx = t.clientX; sy = t.clientY;
      tracking = true; horizontal = null; dragging = false; curDx = 0;
    }, { passive: true });

    document.addEventListener('touchmove', (ev) => {
      if (!tracking) return;
      const t = ev.touches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (horizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
        if (!horizontal) { tracking = false; return; }
      }
      if (!horizontal) return;
      if (!dragging) {
        dragging = true;
        dragView = $(`view-${activeView}`);
        dragView.style.transition = 'none';
      }
      curDx = dx;
      const idx = TAB_ORDER.indexOf(activeView);
      // مقاومة عند طرفي القائمة (ما فيه صفحة أبعد بهذا الاتجاه)
      const atEdge = (dx < 0 && idx === TAB_ORDER.length - 1) || (dx > 0 && idx === 0);
      const eff = atEdge ? dx * 0.25 : dx;
      dragView.style.transform = `translateX(${Math.max(-130, Math.min(130, eff))}px)`;
    }, { passive: true });

    function endDrag() {
      if (!dragging) { tracking = false; return; }
      const idx = TAB_ORDER.indexOf(activeView);
      const goNext = curDx <= -55 && idx < TAB_ORDER.length - 1;
      const goPrev = curDx >= 55 && idx > 0;
      const view = dragView;
      tracking = false; dragging = false; dragView = null;

      if (reduceMotion) {
        view.style.transition = ''; view.style.transform = '';
        if (goNext) goToView(TAB_ORDER[idx + 1]);
        else if (goPrev) goToView(TAB_ORDER[idx - 1]);
        return;
      }

      view.style.transition = 'transform .22s cubic-bezier(.22,1,.36,1)';
      if (goNext || goPrev) {
        view.style.transform = `translateX(${goNext ? -130 : 130}px)`;
        const target = goNext ? TAB_ORDER[idx + 1] : TAB_ORDER[idx - 1];
        setTimeout(() => {
          view.style.transition = '';
          view.style.transform = '';
          goToView(target);
        }, 190);
      } else {
        view.style.transform = 'translateX(0)';
        setTimeout(() => { view.style.transition = ''; view.style.transform = ''; }, 220);
      }
    }

    document.addEventListener('touchend', endDrag);
    document.addEventListener('touchcancel', endDrag);
  })();

  // ===== النوافذ المنبثقة =====
  function openSheet(sheetId) {
    $(sheetId).classList.remove('hidden', 'closing');
    $(sheetId.replace('-sheet', '-backdrop')).classList.remove('hidden', 'closing');
  }

  function closeSheet(sheetId) {
    const sheet = $(sheetId);
    const backdrop = $(sheetId.replace('-sheet', '-backdrop'));
    sheet.classList.add('closing');
    backdrop.classList.add('closing');
    setTimeout(() => {
      sheet.classList.add('hidden');
      backdrop.classList.add('hidden');
      sheet.classList.remove('closing');
      backdrop.classList.remove('closing');
    }, 220);
  }

  $('expense-backdrop').addEventListener('click', () => closeSheet('expense-sheet'));
  $('category-backdrop').addEventListener('click', () => closeSheet('category-sheet'));
  $('smshelp-backdrop').addEventListener('click', () => closeSheet('smshelp-sheet'));

  // ===== شرح الإدخال التلقائي وإعداد الصندوق =====
  function relayInUrl(relay) {
    return `${relay.origin}/in?key=${encodeURIComponent(relay.key)}`;
  }

  function renderRelayUi() {
    const relay = Store.getRelay();
    $('relay-configured').classList.toggle('hidden', !relay);
    if (relay) {
      $('relay-url-input').value = `${relay.origin}/?key=${relay.key}`;
      $('smshelp-url').textContent = relayInUrl(relay);
      $('relay-status').textContent = '✓ الصندوق مربوط';
    } else {
      $('relay-status').textContent = 'بعد ما نجهز صندوقك، الصق رابطه هنا واحفظه';
    }
  }

  $('btn-sms-help').addEventListener('click', () => { renderRelayUi(); syncPushUi(); openSheet('smshelp-sheet'); });

  $('relay-save').addEventListener('click', () => {
    const raw = $('relay-url-input').value.trim();
    if (!raw) { toast('الصق رابط الصندوق أولاً'); return; }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      toast('الرابط غير صحيح — انسخه كاملاً');
      return;
    }
    const key = parsed.searchParams.get('key');
    if (!key) { toast('الرابط ناقص المفتاح السري (key)'); return; }
    Store.setRelay({ origin: parsed.origin, key });
    renderRelayUi();
    toast('تم ربط الصندوق ✓');
    syncRelay();
  });

  $('smshelp-copy').addEventListener('click', async () => {
    const relay = Store.getRelay();
    if (!relay) return;
    try {
      await navigator.clipboard.writeText(relayInUrl(relay));
      toast('تم نسخ رابط الأتمتة ✓');
    } catch {
      toast('ما قدرت أنسخ — انسخه يدوياً');
    }
  });

  $('relay-sync-now').addEventListener('click', async () => {
    toast('جاري المزامنة...');
    const saved = await syncRelay();
    if (saved === null) toast('ما قدرت أوصل للصندوق — تأكد من الإنترنت والرابط');
    else if (saved === 0) toast('ما في رسائل جديدة بالصندوق');
    // إذا فيه عمليات جديدة، syncRelay عرض الإشعار بنفسه
  });

  // ===== إشعارات وصول العمليات (Web Push) =====
  const VAPID_PUBLIC = 'BNKrvdNNT-GuHgz1OYzx0swCsXTKQi-TZEKvV-a6YbVxlkddVgpDLWpPFwVIWHX7q_2W2Sj8soT44zV_2mVHcyA';

  function urlB64ToUint8(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  }

  function syncPushUi() {
    const supported = 'PushManager' in window && 'Notification' in window;
    const relay = Store.getRelay();
    $('btn-push').classList.toggle('hidden', !supported || !relay);
    $('push-note').classList.toggle('hidden', !supported || !relay);
    if (supported && relay) {
      $('btn-push').textContent = settings.pushEnabled
        ? '🔕 إيقاف إشعار العمليات'
        : '🔔 نبّهني عند وصول عملية جديدة';
    }
  }

  $('btn-push').addEventListener('click', async () => {
    const relay = Store.getRelay();
    if (!relay) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (settings.pushEnabled) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch(`${relay.origin}/push-sub?key=${encodeURIComponent(relay.key)}&endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
          await sub.unsubscribe();
        }
        settings.pushEnabled = false;
        Store.setSettings({ pushEnabled: false });
        toast('تم إيقاف الإشعارات');
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { toast('ما سمحت بالإشعارات'); return; }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(VAPID_PUBLIC),
        });
        const res = await fetch(`${relay.origin}/push-sub?key=${encodeURIComponent(relay.key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        });
        if (!res.ok) throw new Error('sub-failed');
        settings.pushEnabled = true;
        Store.setSettings({ pushEnabled: true });
        toast('تم تفعيل الإشعارات ✓');
      }
    } catch {
      toast('تعذّر تفعيل الإشعارات — تأكد أن التطبيق مثبّت على الشاشة الرئيسية وأن الصندوق محدّث');
    }
    syncPushUi();
  });

  // ===== نافذة التأكيد =====
  let confirmCallback = null;
  function askConfirm(text, onYes) {
    $('confirm-text').textContent = text;
    confirmCallback = onYes;
    $('confirm-box').classList.remove('hidden');
    $('confirm-backdrop').classList.remove('hidden');
  }
  function hideConfirm() {
    $('confirm-box').classList.add('hidden');
    $('confirm-backdrop').classList.add('hidden');
    confirmCallback = null;
  }
  $('confirm-yes').addEventListener('click', () => { const cb = confirmCallback; hideConfirm(); if (cb) cb(); });
  $('confirm-no').addEventListener('click', hideConfirm);
  $('confirm-backdrop').addEventListener('click', hideConfirm);

  // ===== طبقة الذكاء =====
  function median(nums) {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  // معلومات الدورة الحالية: كم مضى وكم المجموع
  function cycleProgress(key) {
    const { start, next } = cycleBounds(key);
    const now = new Date();
    const totalDays = daysBetween(start, next);
    const elapsed = Math.min(totalDays, Math.max(1, daysBetween(start, now) + 1));
    return { start, next, totalDays, elapsed };
  }

  // متوسط صرف فئة في الدورات الثلاث السابقة
  function categoryAverage(catId, fromCycle) {
    const totals = [];
    let k = shiftCycle(fromCycle, -1);
    for (let i = 0; i < 3; i++) {
      const spend = sum(onlyExpenses(expensesOfCycle(k)).filter((e) => e.categoryId === catId));
      if (spend > 0) totals.push(spend);
      k = shiftCycle(k, -1);
    }
    return totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  }

  // الرؤى الذكية — ترجع حتى 4 بطاقات
  function computeInsights() {
    const key = currentCycleKey();
    const spendList = onlyExpenses(expensesOfCycle(key));
    const spend = sum(spendList);
    const { totalDays, elapsed } = cycleProgress(key);
    const cards = [];

    if (spend > 0 && elapsed >= 3) {
      // توقع نهاية الشهر
      const projected = (spend / elapsed) * totalDays;
      const incomeTotal = sum(onlyIncome(expensesOfCycle(key)));
      const over = incomeTotal > 0 && projected > incomeTotal;
      cards.push({
        icon: over ? '⚠️' : '🔮',
        warn: over,
        text: `متوقع نهاية الشهر: <b>${money(projected)}</b>${over ? ' — أعلى من دخلك!' : ''}`,
      });
      // متوسط الصرف اليومي
      cards.push({ icon: '📅', text: `متوسط صرفك اليومي: <b>${money(spend / elapsed)}</b>` });
    }

    // أعلى فئة مقارنة بمتوسطها
    if (spendList.length >= 3) {
      const byCat = new Map();
      spendList.forEach((e) => byCat.set(e.categoryId, (byCat.get(e.categoryId) || 0) + e.amount));
      const [topId, topSpend] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
      const avg = categoryAverage(topId, key);
      const cat = catById(topId);
      if (avg > 0 && Math.abs(topSpend - avg) / avg >= 0.15) {
        const pct = Math.round(Math.abs(topSpend - avg) / avg * 100);
        const up = topSpend > avg;
        cards.push({
          icon: cat.icon,
          warn: up,
          text: `صرفك على «${escapeHtml(cat.name)}» ${up ? 'أعلى' : 'أقل'} <b>${fmtMoney.format(pct)}٪</b> من متوسطك`,
        });
      }
    }

    // أكبر عملية هذا الشهر
    if (spendList.length >= 2) {
      const biggest = spendList.reduce((a, b) => (b.amount > a.amount ? b : a));
      cards.push({
        icon: '💸',
        text: `أكبر عملية: <b>${money(biggest.amount)}</b>${biggest.note ? ` عند ${escapeHtml(biggest.note)}` : ''}`,
      });
    }

    // أكثر يوم بالأسبوع تصرف فيه (على كامل التاريخ)
    const allSpend = onlyExpenses(expenses);
    if (allSpend.length >= 20) {
      const byDow = [0, 0, 0, 0, 0, 0, 0];
      allSpend.forEach((e) => {
        const [y, m, d] = e.date.split('-').map(Number);
        byDow[new Date(y, m - 1, d).getDay()] += e.amount;
      });
      const top = byDow.indexOf(Math.max(...byDow));
      const names = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      cards.push({ icon: '📈', text: `أكثر يوم تصرف فيه: <b>${names[top]}</b>` });
    }

    return cards.slice(0, 4);
  }

  function renderInsights() {
    const wrap = $('home-insights');
    const cards = settings.hideAmounts ? [] : computeInsights();
    wrap.classList.toggle('hidden', !cards.length);
    wrap.innerHTML = cards
      .map((c) => `<div class="insight-card${c.warn ? ' warn' : ''}"><span class="insight-icon">${c.icon}</span><p>${c.text}</p></div>`)
      .join('');
  }

  // كشف الاشتراكات: نفس المتجر بمبلغ متقارب في 3+ دورات مختلفة
  function detectSubscription() {
    const groups = new Map();
    onlyExpenses(expenses).forEach((e) => {
      if (!e.note || e.recurring) return;
      const norm = SmsParser.normalizeMerchant(e.note);
      if (!norm) return;
      if (!groups.has(norm)) groups.set(norm, []);
      groups.get(norm).push(e);
    });

    const templates = Store.getRecurring().map((r) => SmsParser.normalizeMerchant(r.note));
    const dismissed = settings.dismissedSubs || [];

    for (const [norm, list] of groups) {
      if (templates.includes(norm) || dismissed.includes(norm)) continue;
      const cycles = new Set(list.map((e) => cycleKeyOfISO(e.date)));
      if (cycles.size < 3) continue;
      const med = median(list.map((e) => e.amount));
      const consistent = list.filter((e) => Math.abs(e.amount - med) / med <= 0.15);
      if (consistent.length < 3) continue;
      const days = consistent.map((e) => Number(e.date.slice(8)));
      return {
        norm,
        name: consistent[consistent.length - 1].note,
        amount: med,
        categoryId: consistent[consistent.length - 1].categoryId,
        day: Math.min(28, Math.round(median(days))),
      };
    }
    return null;
  }

  function renderSubscriptionSuggestion() {
    const box = $('home-subscription');
    const sub = detectSubscription();
    box.classList.toggle('hidden', !sub);
    if (!sub) return;
    box.innerHTML = `
      <span class="insight-icon">🔁</span>
      <p>يبدو أن <b>${escapeHtml(sub.name)}</b> اشتراك شهري (~${money(sub.amount)}) — أضيفه للمتكررة؟</p>
      <span class="sub-actions">
        <button class="sub-add">أضف</button>
        <button class="sub-dismiss">تجاهل</button>
      </span>`;
    box.querySelector('.sub-add').addEventListener('click', () => {
      const list = Store.getRecurring();
      list.push({
        id: Store.newId(), amount: Math.round(sub.amount * 100) / 100,
        categoryId: sub.categoryId, note: sub.name,
        dayOfMonth: sub.day, freq: 'monthly', since: shiftCycle(currentCycleKey(), 1),
      });
      Store.setRecurring(list);
      toast('أُضيف للمصاريف المتكررة ✓ يبدأ من الدورة الجاية');
      renderSubscriptionSuggestion();
    });
    box.querySelector('.sub-dismiss').addEventListener('click', () => {
      settings.dismissedSubs = [...(settings.dismissedSubs || []), sub.norm];
      Store.setSettings({ dismissedSubs: settings.dismissedSubs });
      renderSubscriptionSuggestion();
    });
  }

  // تنبيه العمليات الشاذة — بعد الحفظ بلحظة حتى ما يطمس توست الحفظ
  function checkAnomaly(expense) {
    if (!expense.note || isIncome(expense)) return;
    const norm = SmsParser.normalizeMerchant(expense.note);
    const history = onlyExpenses(expenses).filter(
      (e) => e.id !== expense.id && SmsParser.normalizeMerchant(e.note || '') === norm
    );
    if (history.length < 3) return;
    const med = median(history.map((e) => e.amount));
    if (med > 0 && expense.amount > med * 3 && expense.amount - med > 50) {
      setTimeout(() => toast(`⚠️ هذي العملية أعلى من معتادك عند ${expense.note} (~${money(med)})`), 2100);
    }
  }

  // ===== الرئيسية =====
  function renderHome() {
    const key = currentCycleKey();
    const all = expensesOfCycle(key);
    const spendList = onlyExpenses(all);
    const incomeList = onlyIncome(all);
    const spendTotal = sum(spendList);
    const incomeTotal = sum(incomeList);

    homeSpendTotal = spendTotal;
    $('home-month-name').textContent = cycleLabel(key);
    $('home-total').textContent = money(spendTotal);
    $('home-count').textContent = spendList.length
      ? `${fmtMoney.format(spendList.length)} ${spendList.length === 1 ? 'مصروف' : 'مصاريف'} هذا الشهر`
      : 'ما سجّلت شي هذا الشهر بعد';

    // الدخل والصافي (يظهر فقط إذا فيه دخل مسجّل)
    const hasIncome = incomeList.length > 0;
    $('home-net').classList.toggle('hidden', !hasIncome);
    if (hasIncome) {
      $('home-income').textContent = money(incomeTotal);
      const net = incomeTotal - spendTotal;
      const netEl = $('home-netval');
      netEl.textContent = money(net);
      netEl.classList.toggle('net-negative', net < 0);
    }

    // مقارنة بنفس الفترة من الدورة الماضية
    const cmp = $('home-compare');
    const { start, elapsed } = cycleProgress(key);
    const prevKey = shiftCycle(key, -1);
    const prevStart = cycleBounds(prevKey).start;
    const prevCut = new Date(prevStart); prevCut.setDate(prevCut.getDate() + elapsed);
    const prevSpend = sum(onlyExpenses(expensesOfCycle(prevKey)).filter((e) => e.date < isoOf(prevCut)));
    if (!settings.hideAmounts && prevSpend > 0 && elapsed >= 2 && spendTotal > 0) {
      const diff = Math.round(((spendTotal - prevSpend) / prevSpend) * 100);
      const up = diff > 0;
      const label = Math.abs(diff) > 200
        ? (up ? 'أعلى بكثير' : 'أقل بكثير')
        : `${up ? 'أعلى' : 'أقل'} ${fmtMoney.format(Math.abs(diff))}٪`;
      cmp.classList.remove('hidden');
      cmp.innerHTML = `<span class="${up ? 'cmp-up' : 'cmp-down'}">${up ? '▲' : '▼'} ${label} من نفس الفترة الشهر الماضي</span>`;
    } else {
      cmp.classList.add('hidden');
    }

    // هدف الادخار
    const goalBox = $('home-goal');
    if (settings.savingsGoal > 0 && hasIncome && !settings.hideAmounts) {
      const saved = Math.max(0, incomeTotal - spendTotal);
      const pct = Math.min(100, (saved / settings.savingsGoal) * 100);
      const reached = saved >= settings.savingsGoal;
      goalBox.classList.remove('hidden');
      goalBox.innerHTML = `
        <div class="goal-top"><span>🎯 هدف الادخار</span><b>${money(saved)} من ${money(settings.savingsGoal)}</b></div>
        <div class="goal-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
        ${reached ? '<p class="goal-done">حققت هدفك! 🎉</p>' : ''}`;
    } else {
      goalBox.classList.add('hidden');
    }

    renderInsights();
    renderSubscriptionSuggestion();

    const grid = $('home-categories');
    grid.innerHTML = '';
    $('home-empty').classList.toggle('hidden', expenses.length > 0);

    const budgets = Store.getBudgets();
    categories.forEach((cat) => {
      const total = sum(spendList.filter((e) => e.categoryId === cat.id));
      const budget = budgets[cat.id];
      const card = document.createElement('button');
      card.className = 'category-card';
      card.style.setProperty('--cat-color', cat.color);
      // حلقة تقدم الميزانية حول الأيقونة
      let iconHtml = `<span class="cat-icon">${cat.icon}</span>`;
      let budgetText = '';
      if (budget) {
        const pct = Math.min(1, total / budget);
        const over = total > budget;
        const C = 2 * Math.PI * 26;
        iconHtml = `
          <span class="cat-icon-ring">
            <svg viewBox="0 0 60 60">
              <circle cx="30" cy="30" r="26" fill="none" stroke="var(--track)" stroke-width="4"></circle>
              <circle cx="30" cy="30" r="26" fill="none" stroke="${over ? 'var(--danger)' : cat.color}" stroke-width="4"
                stroke-linecap="round" stroke-dasharray="${(pct * C).toFixed(1)} ${C.toFixed(1)}"
                transform="rotate(-90 30 30)"></circle>
            </svg>
            <span class="cat-icon">${cat.icon}</span>
          </span>`;
        budgetText = `<span class="cat-budget-text${over ? ' over' : ''}">${over ? 'تجاوزت' : 'من'} ${money(budget)}</span>`;
      }
      card.innerHTML = `
        ${iconHtml}
        <span class="cat-name">${escapeHtml(cat.name)}</span>
        <span class="cat-total">${money(total)}</span>
        ${budgetText}`;
      card.addEventListener('click', () => openExpenseSheet(null, cat.id));
      grid.appendChild(card);
    });
  }

  // ===== السجل =====
  let recordCatFilter = null; // فلتر فئة قادم من الإحصائيات

  function matchesQuery(e) {
    if (recordCatFilter && e.categoryId !== recordCatFilter) return false;
    if (!recordQuery) return true;
    const q = recordQuery;
    const cat = e.categoryId ? catById(e.categoryId).name : 'دخل';
    return (e.note || '').toLowerCase().includes(q)
      || cat.toLowerCase().includes(q)
      || (e.card || '').includes(q);
  }

  function renderRecordFilter() {
    const box = $('record-filter');
    box.classList.toggle('hidden', !recordCatFilter);
    if (recordCatFilter) {
      const cat = catById(recordCatFilter);
      box.innerHTML = `<span class="filter-chip" style="--chip-color:${cat.color}">${cat.icon} ${escapeHtml(cat.name)} <b>✕</b></span>`;
      box.querySelector('.filter-chip').addEventListener('click', () => {
        recordCatFilter = null;
        renderRecord();
      });
    }
  }

  // سحب أفقي على الصف يكشف زر الحذف (مع تمييز نية السحب عن التمرير)
  let openSwipeRow = null;
  function attachSwipe(swipeWrap, row, expenseId) {
    let startX = 0, startY = 0, dx = 0, dragging = false, horizontal = null;
    row.addEventListener('touchstart', (ev) => {
      if (openSwipeRow && openSwipeRow !== row) {
        openSwipeRow.style.transform = '';
        openSwipeRow = null;
      }
      const t = ev.touches[0];
      startX = t.clientX; startY = t.clientY;
      dragging = true; horizontal = null;
      row.style.transition = 'none';
    }, { passive: true });
    row.addEventListener('touchmove', (ev) => {
      if (!dragging) return;
      const t = ev.touches[0];
      const mx = t.clientX - startX, my = t.clientY - startY;
      if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
        horizontal = Math.abs(mx) > Math.abs(my);
      }
      if (!horizontal) { dragging = false; row.style.transform = ''; return; }
      dx = Math.min(0, mx); // في RTL: السحب لليسار يكشف الحذف
      row.style.transform = `translateX(${Math.max(dx, -90)}px)`;
    }, { passive: true });
    row.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      row.style.transition = 'transform .25s cubic-bezier(.22,1,.36,1)';
      if (dx < -45) {
        row.style.transform = 'translateX(-78px)';
        openSwipeRow = row;
      } else {
        row.style.transform = '';
        if (openSwipeRow === row) openSwipeRow = null;
      }
      dx = 0;
    });
  }

  function renderRecord() {
    $('record-month-name').textContent = cycleLabel(recordCycle);
    renderRecordFilter();

    const cycleItems = expensesOfCycle(recordCycle)
      .filter(matchesQuery)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));

    const spendTotal = sum(onlyExpenses(cycleItems));
    $('record-total').textContent = cycleItems.length ? `المصاريف: ${money(spendTotal)}` : '';
    $('record-empty').classList.toggle('hidden', cycleItems.length > 0);

    const list = $('record-list');
    list.innerHTML = '';
    openSwipeRow = null;

    // تجميع حسب اليوم
    const byDay = new Map();
    cycleItems.forEach((e) => {
      if (!byDay.has(e.date)) byDay.set(e.date, []);
      byDay.get(e.date).push(e);
    });

    byDay.forEach((items, date) => {
      const group = document.createElement('div');
      group.className = 'day-group';
      const [y, m, d] = date.split('-').map(Number);
      const title = document.createElement('p');
      title.className = 'day-title';
      title.textContent = fmtDay.format(new Date(y, m - 1, d));
      group.appendChild(title);

      const wrap = document.createElement('div');
      wrap.className = 'day-items';
      items.forEach((e) => {
        const income = isIncome(e);
        const swipeWrap = document.createElement('div');
        swipeWrap.className = 'swipe-wrap';

        const delBtn = document.createElement('button');
        delBtn.className = 'swipe-del';
        delBtn.textContent = 'حذف';
        delBtn.addEventListener('click', () => deleteExpenseWithUndo(e.id));

        const row = document.createElement('button');
        row.className = 'expense-item' + (income ? ' income-item' : '');
        const cardChip = e.card ? `<span class="card-chip">💳 ${e.card}</span>` : '';
        if (income) {
          row.innerHTML = `
            <span class="expense-icon income-icon">＋</span>
            <span class="expense-info">
              <span class="expense-cat">دخل</span>
              ${e.note ? `<span class="expense-note">${escapeHtml(e.note)}</span>` : ''}
            </span>
            ${cardChip}
            <span class="expense-amount income-amount">+${money(e.amount)}</span>`;
        } else {
          const cat = catById(e.categoryId);
          row.style.setProperty('--item-color', cat.color);
          row.innerHTML = `
            <span class="expense-icon">${cat.icon}</span>
            <span class="expense-info">
              <span class="expense-cat">${escapeHtml(cat.name)}</span>
              ${e.note ? `<span class="expense-note">${escapeHtml(e.note)}</span>` : ''}
            </span>
            ${cardChip}
            <span class="expense-amount">${money(e.amount)}</span>`;
        }
        row.addEventListener('click', () => {
          if (openSwipeRow === row) { row.style.transform = ''; openSwipeRow = null; return; }
          openExpenseSheet(e.id);
        });
        attachSwipe(swipeWrap, row, e.id);

        swipeWrap.appendChild(delBtn);
        swipeWrap.appendChild(row);
        wrap.appendChild(swipeWrap);
      });
      group.appendChild(wrap);
      list.appendChild(group);
    });
  }

  $('month-prev').addEventListener('click', () => {
    recordCycle = shiftCycle(recordCycle, -1);
    renderRecord();
  });
  $('month-next').addEventListener('click', () => {
    recordCycle = shiftCycle(recordCycle, 1);
    renderRecord();
  });
  $('record-search').addEventListener('input', (ev) => {
    recordQuery = ev.target.value.trim().toLowerCase();
    renderRecord();
  });

  // ===== الإحصائيات =====
  function renderStats() {
    $('stats-month-name').textContent = cycleLabel(statsCycle);
    const cycleExpenses = onlyExpenses(expensesOfCycle(statsCycle));
    const total = sum(cycleExpenses);
    statsTotal = total;

    const hasData = cycleExpenses.length > 0;
    $('stats-content').classList.toggle('hidden', !hasData);
    $('stats-empty').classList.toggle('hidden', hasData);
    if (!hasData) return;

    // الدائرة والإجمالي
    const breakdown = Stats.categoryBreakdown(cycleExpenses, categories);
    $('stats-donut').innerHTML = Stats.donutSVG(breakdown);
    $('donut-total').textContent = money(total);

    // قائمة الفئات المرتبة
    const bd = $('stats-breakdown');
    bd.innerHTML = '';
    breakdown.forEach((row) => {
      const item = document.createElement('button');
      item.className = 'breakdown-row';
      item.innerHTML = `
        <span class="bd-icon" style="--item-color:${row.cat.color}">${row.cat.icon}</span>
        <div class="bd-main">
          <div class="bd-top">
            <span class="bd-name">${escapeHtml(row.cat.name)}</span>
            <span class="bd-amount">${money(row.total)}</span>
          </div>
          <div class="bd-bar"><span style="width:${row.pct.toFixed(1)}%;background:${row.cat.color}"></span></div>
        </div>
        <span class="bd-pct">${fmtMoney.format(Math.round(row.pct))}٪</span>`;
      // الضغط يفتح سجل هذي الفئة
      item.addEventListener('click', () => {
        recordCatFilter = row.cat.id;
        recordCycle = statsCycle;
        goToView('record');
      });
      bd.appendChild(item);
    });

    // أعمدة آخر 6 دورات
    const series = [];
    let k = statsCycle;
    for (let i = 0; i < 6; i++) {
      const { start } = cycleBounds(k);
      series.unshift({
        label: fmtMonthShort.format(start),
        total: sum(onlyExpenses(expensesOfCycle(k))),
        current: k === statsCycle,
      });
      k = shiftCycle(k, -1);
    }
    $('stats-bars').innerHTML = Stats.barsSVG(series);

    // أعلى المتاجر
    const merchants = Stats.topMerchants(cycleExpenses, 5);
    const ml = $('stats-merchants');
    ml.innerHTML = '';
    if (!merchants.length) {
      ml.innerHTML = '<p class="merchants-empty">ما فيه أسماء متاجر في مصاريف هذا الشهر</p>';
    } else {
      merchants.forEach((m, i) => {
        const row = document.createElement('div');
        row.className = 'merchant-row';
        row.innerHTML = `
          <span class="merchant-rank">${fmtMoney.format(i + 1)}</span>
          <span class="merchant-name">${escapeHtml(m.name)}</span>
          <span class="merchant-amount">${money(m.total)}</span>`;
        ml.appendChild(row);
      });
    }
  }

  $('stats-prev').addEventListener('click', () => {
    statsCycle = shiftCycle(statsCycle, -1);
    renderStats();
    playEntrance('stats');
  });
  $('stats-next').addEventListener('click', () => {
    statsCycle = shiftCycle(statsCycle, 1);
    renderStats();
    playEntrance('stats');
  });

  // ===== إعداد بداية الشهر (دورة الراتب) =====
  (function initCycleSetting() {
    const sel = $('cycle-start-select');
    for (let d = 1; d <= 28; d++) {
      const opt = document.createElement('option');
      opt.value = String(d);
      opt.textContent = d === 1 ? 'يوم 1 (الشهر الميلادي)' : `يوم ${fmtMoney.format(d)}`;
      sel.appendChild(opt);
    }
    sel.value = String(Store.getCycleStartDay());
    sel.addEventListener('change', () => {
      Store.setCycleStartDay(Number(sel.value));
      recordCycle = currentCycleKey();
      statsCycle = currentCycleKey();
      renderAll();
      toast('تم تحديث بداية الشهر ✓');
    });
  })();

  // ===== نافذة المصروف =====
  let manualCatPick = false; // هل اختار المستخدم الفئة بنفسه؟ (يوقف الاقتراح الحي)

  // الفئات مرتبة بالأكثر استخداماً عندك
  function categoriesByUsage() {
    const counts = new Map();
    expenses.forEach((e) => counts.set(e.categoryId, (counts.get(e.categoryId) || 0) + 1));
    return [...categories].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
  }

  function renderExpenseChips() {
    const row = $('expense-categories');
    row.innerHTML = '';
    categoriesByUsage().forEach((cat) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (cat.id === selectedCategoryId ? ' selected' : '');
      chip.style.setProperty('--chip-color', cat.color);
      chip.innerHTML = `${cat.icon} ${escapeHtml(cat.name)}`;
      chip.addEventListener('click', () => {
        selectedCategoryId = cat.id;
        manualCatPick = true;
        renderExpenseChips();
      });
      row.appendChild(chip);
    });
  }

  // اقتراح الفئة تلقائياً وأنت تكتب الملاحظة
  $('expense-note').addEventListener('input', (ev) => {
    if (selectedKind === 'income' || manualCatPick || editingExpenseId) return;
    const text = ev.target.value.trim();
    if (text.length < 3) return;
    const guess = SmsParser.guessCategory(text, text, categories);
    if (guess !== 'other' && guess !== selectedCategoryId) {
      selectedCategoryId = guess;
      renderExpenseChips();
    }
  });

  // تبديل نوع العملية (مصروف / دخل)
  function setKind(kind) {
    selectedKind = kind;
    document.querySelectorAll('#kind-toggle .kind-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.kind === kind));
    const income = kind === 'income';
    $('expense-cat-label').classList.toggle('hidden', income);
    $('expense-categories').classList.toggle('hidden', income);
    $('expense-note').placeholder = income ? 'مثال: راتب، مكافأة' : 'مثال: فاتورة الكهرباء';
  }
  document.querySelectorAll('#kind-toggle .kind-btn').forEach((b) =>
    b.addEventListener('click', () => setKind(b.dataset.kind)));

  function openExpenseSheet(expenseId = null, presetCategoryId = null) {
    editingExpenseId = expenseId;
    manualCatPick = !!presetCategoryId;
    const expense = expenseId ? expenses.find((e) => e.id === expenseId) : null;

    const income = expense ? isIncome(expense) : false;
    setKind(income ? 'income' : 'expense');
    $('expense-installments').value = '1';
    $('installments-row').classList.toggle('hidden', !!expense);
    $('expense-sheet-title').textContent = expense
      ? (income ? 'تعديل الدخل' : 'تعديل المصروف')
      : 'إضافة عملية';
    $('expense-amount').value = expense ? String(expense.amount) : '';
    $('expense-date').value = expense ? expense.date : todayISO();
    $('expense-note').value = expense ? (expense.note || '') : '';
    $('expense-delete').classList.toggle('hidden', !expense);
    selectedCategoryId = expense ? expense.categoryId : (presetCategoryId || categories[0].id);

    renderExpenseChips();
    openSheet('expense-sheet');
    if (!expense) setTimeout(() => $('expense-amount').focus(), 350);
  }

  $('btn-add-expense').addEventListener('click', () => openExpenseSheet());

  $('expense-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const amount = parseAmountInput($('expense-amount').value);
    if (!isFinite(amount) || amount <= 0) {
      toast('أدخل مبلغ صحيح');
      $('expense-amount').focus();
      return;
    }
    const income = selectedKind === 'income';
    const data = {
      amount: Math.round(amount * 100) / 100,
      kind: selectedKind,
      categoryId: income ? null : selectedCategoryId,
      date: $('expense-date').value || todayISO(),
      note: $('expense-note').value.trim(),
    };
    if (editingExpenseId) {
      const i = expenses.findIndex((e) => e.id === editingExpenseId);
      const prev = expenses[i];
      // التعلّم من التصحيح: إذا غيّر المستخدم فئة عملية لها اسم متجر، نتذكر اختياره
      if (!income && data.note && data.categoryId !== prev.categoryId) {
        Store.learnMerchant(SmsParser.normalizeMerchant(data.note), data.categoryId);
      }
      expenses[i] = { ...prev, ...data };
      toast(income ? 'تم تعديل الدخل ✓' : 'تم تعديل المصروف ✓');
      checkAnomaly(expenses[i]);
    } else {
      const parts = income ? 1 : Math.max(1, Number($('expense-installments').value) || 1);
      if (parts > 1) {
        // تقسيط: نوزع المبلغ على أشهر متتالية من تاريخ الشراء
        const per = Math.floor((data.amount / parts) * 100) / 100;
        const last = Math.round((data.amount - per * (parts - 1)) * 100) / 100;
        const groupId = Store.newId();
        const [y, m, d] = data.date.split('-').map(Number);
        for (let i = 0; i < parts; i++) {
          const due = new Date(y, m - 1 + i, Math.min(d, 28));
          expenses.push({
            id: Store.newId(),
            amount: i === parts - 1 ? last : per,
            kind: 'expense',
            categoryId: data.categoryId,
            date: isoOf(due),
            note: `${data.note || 'تقسيط'} (${fmtMoney.format(i + 1)}/${fmtMoney.format(parts)})`,
            installmentGroup: groupId,
          });
        }
        toast(`تم تقسيمها على ${fmtMoney.format(parts)} أشهر ✓`);
      } else {
        const entry = { id: Store.newId(), ...data };
        expenses.push(entry);
        toast(income ? 'تم حفظ الدخل ✓' : 'تم حفظ المصروف ✓');
        checkAnomaly(entry);
      }
    }
    Store.setExpenses(expenses);
    closeSheet('expense-sheet');
    recordCycle = cycleKeyOfISO(data.date);
    renderAll();
  });

  // حذف مع إمكانية التراجع
  function deleteExpenseWithUndo(expenseId) {
    const removed = expenses.find((e) => e.id === expenseId);
    if (!removed) return;
    expenses = expenses.filter((e) => e.id !== expenseId);
    Store.setExpenses(expenses);
    renderAll();
    toastUndo('تم الحذف', () => {
      expenses.push(removed);
      Store.setExpenses(expenses);
      renderAll();
      toast('رجّعناها ✓');
    });
  }

  $('expense-delete').addEventListener('click', () => {
    const id = editingExpenseId;
    closeSheet('expense-sheet');
    deleteExpenseWithUndo(id);
  });

  // ===== الفئات =====
  function renderCategories() {
    const list = $('categories-list');
    list.innerHTML = '';
    categories.forEach((cat) => {
      const count = expenses.filter((e) => e.categoryId === cat.id).length;
      const row = document.createElement('button');
      row.className = 'category-row';
      row.style.setProperty('--item-color', cat.color);
      row.innerHTML = `
        <span class="expense-icon" style="--item-color:${cat.color}">${cat.icon}</span>
        <span class="row-name">${escapeHtml(cat.name)}</span>
        <span class="row-count">${count ? `${fmtMoney.format(count)} مصروف` : ''}</span>
        <span class="row-chevron">‹</span>`;
      row.addEventListener('click', () => openCategorySheet(cat.id));
      list.appendChild(row);
    });
  }

  function renderIconPicker() {
    const row = $('category-icons');
    row.innerHTML = '';
    CATEGORY_ICONS.forEach((icon) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-option' + (icon === selectedIcon ? ' selected' : '');
      btn.textContent = icon;
      btn.addEventListener('click', () => { selectedIcon = icon; renderIconPicker(); });
      row.appendChild(btn);
    });
  }

  function renderColorPicker() {
    const row = $('category-colors');
    row.innerHTML = '';
    CATEGORY_COLORS.forEach((color) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-option' + (color === selectedColor ? ' selected' : '');
      btn.style.background = color;
      btn.setAttribute('aria-label', color);
      btn.addEventListener('click', () => { selectedColor = color; renderColorPicker(); });
      row.appendChild(btn);
    });
  }

  function openCategorySheet(categoryId = null) {
    editingCategoryId = categoryId;
    const cat = categoryId ? categories.find((c) => c.id === categoryId) : null;

    $('category-sheet-title').textContent = cat ? 'تعديل الفئة' : 'فئة جديدة';
    $('category-name').value = cat ? cat.name : '';
    selectedIcon = cat ? cat.icon : CATEGORY_ICONS[0];
    selectedColor = cat ? cat.color : CATEGORY_COLORS[0];
    const budget = cat ? Store.getBudgets()[cat.id] : null;
    $('category-budget').value = budget ? String(budget) : '';

    // اقتراح ميزانية من متوسط صرفك الفعلي
    const hint = $('budget-hint');
    const avg = cat ? categoryAverage(cat.id, currentCycleKey()) : 0;
    hint.classList.toggle('hidden', !avg);
    if (avg) {
      const suggested = Math.ceil(avg / 50) * 50; // تقريب لأقرب 50
      hint.innerHTML = `متوسط صرفك: ${money(avg)} — <button type="button" class="hint-use">اقترح ${money(suggested)}</button>`;
      hint.querySelector('.hint-use').addEventListener('click', () => {
        $('category-budget').value = String(suggested);
      });
    }
    // فئة «أخرى» ما تنحذف لأنها الوجهة الاحتياطية
    $('category-delete').classList.toggle('hidden', !cat || cat.id === 'other');

    renderIconPicker();
    renderColorPicker();
    openSheet('category-sheet');
  }

  $('btn-add-category').addEventListener('click', () => openCategorySheet());

  $('category-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('category-name').value.trim();
    if (!name) return;

    let targetId;
    if (editingCategoryId) {
      const cat = categories.find((c) => c.id === editingCategoryId);
      cat.name = name;
      cat.icon = selectedIcon;
      cat.color = selectedColor;
      targetId = cat.id;
      toast('تم تعديل الفئة ✓');
    } else {
      targetId = Store.newId();
      categories.push({ id: targetId, name, icon: selectedIcon, color: selectedColor });
      toast('تمت إضافة الفئة ✓');
    }
    // الميزانية
    const budgetVal = parseAmountInput($('category-budget').value);
    Store.setBudget(targetId, isFinite(budgetVal) && budgetVal > 0 ? Math.round(budgetVal * 100) / 100 : 0);
    Store.setCategories(categories);
    closeSheet('category-sheet');
    renderAll();
  });

  $('category-delete').addEventListener('click', () => {
    const cat = categories.find((c) => c.id === editingCategoryId);
    const affected = expenses.filter((e) => e.categoryId === cat.id).length;
    const msg = affected
      ? `حذف فئة «${cat.name}»؟ عندك ${affected} مصروف فيها بينتقلون إلى «أخرى»`
      : `متأكد تبي تحذف فئة «${cat.name}»؟`;
    askConfirm(msg, () => {
      expenses.forEach((e) => { if (e.categoryId === cat.id) e.categoryId = 'other'; });
      categories = categories.filter((c) => c.id !== cat.id);
      Store.setExpenses(expenses);
      Store.setCategories(categories);
      closeSheet('category-sheet');
      toast('تم حذف الفئة');
      renderAll();
    });
  });

  // ===== عام =====
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function renderAll() {
    renderHome();
    renderStats();
    renderRecord();
    renderCategories();
  }

  // ===== الإدخال التلقائي من رسائل البنك =====
  // استيراد نص رسالة: يحفظ المصروف إذا كانت عملية شراء ويرجع الحالة
  function importSmsText(raw) {
    if (!raw || !raw.trim()) return { status: 'empty' };

    const fp = SmsParser.fingerprint(raw);
    if (Store.hasSmsHash(fp)) return { status: 'duplicate' };

    const result = SmsParser.parse(raw);
    if (!result.ok) {
      // نسجل بصمة غير المشتريات حتى ما نعيد فحصها كل مرة
      if (result.reason === 'not-purchase') Store.addSmsHash(fp);
      return { status: result.reason, merchant: result.merchant, raw };
    }

    const categoryId = SmsParser.guessCategory(result.merchant, raw, categories);
    const expense = {
      id: Store.newId(),
      amount: result.amount,
      categoryId,
      date: result.date || todayISO(),
      note: result.merchant,
      card: result.card || '',
    };
    expenses.push(expense);
    Store.setExpenses(expenses);
    Store.addSmsHash(fp);
    checkAnomaly(expense);
    return { status: 'saved', expense };
  }

  // المدخل المباشر: فتح التطبيق برابط فيه نص الرسالة (#sms=)
  function handleSmsFromUrl() {
    const hash = window.location.hash;
    const marker = '#sms=';
    if (!hash.startsWith(marker)) return;

    let raw = '';
    try {
      raw = decodeURIComponent(hash.slice(marker.length));
    } catch {
      raw = hash.slice(marker.length);
    }
    // تنظيف العنوان حتى لا يُعاد التسجيل عند التحديث
    history.replaceState(null, '', window.location.pathname + window.location.search);

    const r = importSmsText(raw);
    if (r.status === 'saved') {
      recordCycle = cycleKeyOfISO(r.expense.date);
      renderAll();
      const cat = catById(r.expense.categoryId);
      toast(`✓ تم تسجيل ${money(r.expense.amount)}${r.expense.note ? ` من ${r.expense.note}` : ''} في «${cat.name}»`);
    } else if (r.status === 'duplicate') {
      toast('هذي الرسالة مسجلة من قبل');
    } else if (r.status === 'not-purchase') {
      toast('الرسالة ليست عملية شراء — ما انحفظ شي');
    } else if (r.status === 'no-amount') {
      toast('ما قدرت أقرأ المبلغ — أكمل البيانات');
      openExpenseSheet();
      $('expense-note').value = (r.merchant || r.raw).slice(0, 60);
    }
  }

  // ===== المزامنة مع صندوق البريد (Cloudflare) =====
  let syncing = false;
  // ترجع عدد العمليات المسجلة، أو null إذا تعذر الوصول للصندوق
  async function syncRelay() {
    const relay = Store.getRelay();
    if (!relay || syncing) return 0;
    syncing = true;
    try {
      const res = await fetch(`${relay.origin}/pull?key=${encodeURIComponent(relay.key)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const msgs = data.messages || [];
      if (!msgs.length) return 0;

      let saved = 0, needInput = null;
      for (const m of msgs) {
        const r = importSmsText(m.text);
        if (r.status === 'saved') saved++;
        else if (r.status === 'no-amount') needInput = r;
      }
      if (saved > 0) {
        renderAll();
        toast(`✓ تم تسجيل ${fmtMoney.format(saved)} ${saved === 1 ? 'عملية جديدة' : 'عمليات جديدة'} من رسائل البنك`);
      }
      if (needInput && saved === 0) {
        toast('وصلت رسالة ما قدرت أقرأ مبلغها — أكمل البيانات');
        openExpenseSheet();
        $('expense-note').value = (needInput.merchant || needInput.raw).slice(0, 60);
      }
      return saved;
    } catch {
      // ما في اتصال أو الصندوق غير متاح — نحاول في الفتحة الجاية بصمت
      return null;
    } finally {
      syncing = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncRelay();
  });

  // ===== النسخ الاحتياطي (تصدير/استيراد) =====
  $('btn-export').addEventListener('click', () => {
    const data = JSON.stringify(Store.exportAll(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = todayISO();
    a.href = url;
    a.download = `مصاريفي-نسخة-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('تم تصدير نسختك الاحتياطية ✓');
  });

  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try { obj = JSON.parse(reader.result); }
      catch { toast('الملف غير صالح'); return; }
      askConfirm('استيراد هذي النسخة بيستبدل كل بياناتك الحالية. متأكد؟', () => {
        if (Store.importAll(obj)) {
          categories = Store.getCategories();
          expenses = Store.getExpenses();
          recordCycle = currentCycleKey();
          statsCycle = currentCycleKey();
          $('cycle-start-select').value = String(Store.getCycleStartDay());
          closeSheet('smshelp-sheet');
          renderAll();
          toast('تم استيراد نسختك ✓');
        } else {
          toast('الملف مو نسخة مصاريفي صحيحة');
        }
      });
    };
    reader.readAsText(file);
    ev.target.value = '';
  });

  // ===== المتاجر المحفوظة (التعلّم) =====
  $('learned-backdrop').addEventListener('click', () => closeSheet('learned-sheet'));
  function renderLearned() {
    const map = Store.getLearnedMerchants();
    const names = Object.keys(map);
    const list = $('learned-list');
    list.innerHTML = '';
    if (!names.length) {
      list.innerHTML = '<p class="merchants-empty">ما فيه متاجر محفوظة بعد. غيّر فئة أي عملية جاية من متجر وبيتعلّمها.</p>';
      return;
    }
    names.forEach((name) => {
      const cat = catById(map[name]);
      const row = document.createElement('div');
      row.className = 'learned-row';
      row.innerHTML = `
        <span class="learned-name">${escapeHtml(name)}</span>
        <span class="learned-cat" style="--item-color:${cat.color}">${cat.icon} ${escapeHtml(cat.name)}</span>
        <button class="learned-del" aria-label="حذف">✕</button>`;
      row.querySelector('.learned-del').addEventListener('click', () => {
        Store.forgetMerchant(name);
        renderLearned();
        toast('تم حذف القاعدة');
      });
      list.appendChild(row);
    });
  }
  $('btn-learned').addEventListener('click', () => { renderLearned(); openSheet('learned-sheet'); });

  // ===== المصاريف المتكررة =====
  $('recurring-backdrop').addEventListener('click', () => closeSheet('recurring-sheet'));

  function renderRecurringChips() {
    const row = $('recurring-categories');
    row.innerHTML = '';
    categories.forEach((cat) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (cat.id === recurringCategoryId ? ' selected' : '');
      chip.style.setProperty('--chip-color', cat.color);
      chip.innerHTML = `${cat.icon} ${escapeHtml(cat.name)}`;
      chip.addEventListener('click', () => { recurringCategoryId = cat.id; renderRecurringChips(); });
      row.appendChild(chip);
    });
  }

  const WEEKDAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function recurringLabel(r) {
    if (r.freq === 'weekly') return `كل ${WEEKDAY_NAMES[r.weekday || 0]}`;
    if (r.freq === 'yearly') {
      const [, m, d] = (r.startDate || todayISO()).split('-').map(Number);
      return `سنوياً في ${fmtDayMonth.format(new Date(2026, m - 1, d))}`;
    }
    return `شهرياً يوم ${fmtMoney.format(r.dayOfMonth)}`;
  }

  function renderRecurringList() {
    const list = $('recurring-list');
    const items = Store.getRecurring();
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p class="merchants-empty">ما فيه مصاريف متكررة بعد.</p>';
      return;
    }
    items.forEach((r) => {
      const cat = catById(r.categoryId);
      const row = document.createElement('div');
      row.className = 'learned-row';
      row.innerHTML = `
        <span class="learned-cat" style="--item-color:${cat.color}">${cat.icon}</span>
        <span class="recurring-info">
          <b>${escapeHtml(r.note || cat.name)}</b>
          <small>${money(r.amount)} · ${recurringLabel(r)}</small>
        </span>
        <button class="learned-del" aria-label="حذف">✕</button>`;
      row.querySelector('.learned-del').addEventListener('click', () => {
        Store.setRecurring(Store.getRecurring().filter((x) => x.id !== r.id));
        renderRecurringList();
        toast('تم الحذف');
      });
      list.appendChild(row);
    });
  }

  // إظهار عناصر التحكم المناسبة لنوع التكرار
  function syncRecurringFreqUi() {
    const freq = $('recurring-freq').value;
    $('recurring-day-row').classList.toggle('hidden', freq !== 'monthly');
    $('recurring-weekday-row').classList.toggle('hidden', freq !== 'weekly');
    $('recurring-date-row').classList.toggle('hidden', freq !== 'yearly');
  }

  function openRecurringSheet() {
    recurringCategoryId = categories[0].id;
    $('recurring-amount').value = '';
    $('recurring-note').value = '';
    const daySel = $('recurring-day');
    if (!daySel.options.length) {
      for (let d = 1; d <= 28; d++) {
        const opt = document.createElement('option');
        opt.value = String(d);
        opt.textContent = `يوم ${fmtMoney.format(d)}`;
        daySel.appendChild(opt);
      }
    }
    const wdSel = $('recurring-weekday');
    if (!wdSel.options.length) {
      WEEKDAY_NAMES.forEach((name, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = name;
        wdSel.appendChild(opt);
      });
    }
    daySel.value = '1';
    $('recurring-freq').value = 'monthly';
    $('recurring-date').value = todayISO();
    syncRecurringFreqUi();
    renderRecurringChips();
    renderRecurringList();
    openSheet('recurring-sheet');
  }
  $('btn-recurring').addEventListener('click', openRecurringSheet);
  $('recurring-freq').addEventListener('change', syncRecurringFreqUi);

  $('recurring-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const amount = parseAmountInput($('recurring-amount').value);
    if (!isFinite(amount) || amount <= 0) { toast('أدخل مبلغ صحيح'); return; }
    const freq = $('recurring-freq').value;
    const item = {
      id: Store.newId(),
      amount: Math.round(amount * 100) / 100,
      categoryId: recurringCategoryId,
      note: $('recurring-note').value.trim(),
      freq,
      dayOfMonth: Number($('recurring-day').value),
      weekday: Number($('recurring-weekday').value || 0),
      startDate: $('recurring-date').value || todayISO(),
      since: currentCycleKey(),   // يبدأ من الآن — لا يعبّي الماضي
      createdAt: todayISO(),
    };
    const list = Store.getRecurring();
    list.push(item);
    Store.setRecurring(list);
    generateRecurring();
    $('recurring-amount').value = '';
    $('recurring-note').value = '';
    renderRecurringList();
    renderAll();
    toast('تمت إضافة المصروف المتكرر ✓');
  });

  // يولّد المصاريف المتكررة المستحقة (شهري/أسبوعي/سنوي) بدون تكرار وبدون تعبئة الماضي
  function generateRecurring() {
    const templates = Store.getRecurring();
    if (!templates.length) return;
    const doneSet = new Set(Store.getRecurringDone());
    const today = new Date();
    let added = false;

    function emit(t, due, marker) {
      if (doneSet.has(marker) || due > today) return;
      expenses.push({
        id: Store.newId(),
        amount: t.amount,
        kind: 'expense',
        categoryId: t.categoryId,
        date: isoOf(due),
        note: t.note || catById(t.categoryId).name,
        recurring: true,
      });
      doneSet.add(marker);
      added = true;
    }

    templates.forEach((t) => {
      const freq = t.freq || 'monthly';
      const floorISO = t.createdAt || (t.since ? isoOf(cycleBounds(t.since).start) : todayISO());

      if (freq === 'monthly') {
        const floor = t.since || currentCycleKey();
        let k = currentCycleKey();
        const cycles = [];
        for (let i = 0; i < 12; i++) { cycles.push(k); k = shiftCycle(k, -1); }
        cycles.forEach((cycleK) => {
          if (cycleK < floor) return;
          const { start, next } = cycleBounds(cycleK);
          const due = new Date(start.getFullYear(), start.getMonth(), t.dayOfMonth);
          if (due < start) due.setMonth(due.getMonth() + 1);
          if (due >= next) return;
          emit(t, due, `${t.id}@${cycleK}`);
        });
      } else if (freq === 'weekly') {
        // كل أسبوع في يومه — نعوّض آخر 12 أسبوع كحد أقصى
        const from = new Date(Math.max(new Date(floorISO), new Date(today - 84 * 86400000)));
        const d = new Date(from);
        d.setDate(d.getDate() + ((t.weekday - d.getDay() + 7) % 7));
        while (d <= today) {
          emit(t, new Date(d), `${t.id}@${isoOf(d)}`);
          d.setDate(d.getDate() + 7);
        }
      } else if (freq === 'yearly') {
        const [, sm, sd] = (t.startDate || floorISO).split('-').map(Number);
        const startYear = Number((t.startDate || floorISO).slice(0, 4));
        for (let y = startYear; y <= today.getFullYear(); y++) {
          const due = new Date(y, sm - 1, sd);
          if (isoOf(due) < floorISO.slice(0, 10) && y === startYear) continue;
          emit(t, due, `${t.id}@y${y}`);
        }
      }
    });

    if (added) {
      Store.setExpenses(expenses);
      Store.markRecurringDone([...doneSet]);
    }
  }

  // ===== وضع التخفي (إخفاء المبالغ) =====
  function syncEyeButton() {
    $('btn-hide-amounts').textContent = settings.hideAmounts ? '🙈' : '👁';
  }
  $('btn-hide-amounts').addEventListener('click', () => {
    settings.hideAmounts = !settings.hideAmounts;
    Store.setSettings({ hideAmounts: settings.hideAmounts });
    syncEyeButton();
    renderAll();
  });
  syncEyeButton();

  // ===== الثيمات والمظهر =====
  document.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.theme === settings.theme);
    btn.addEventListener('click', () => {
      settings.theme = btn.dataset.theme;
      Store.setSettings({ theme: settings.theme });
      applyAppearance();
      document.querySelectorAll('.theme-swatch').forEach((b) =>
        b.classList.toggle('selected', b === btn));
      renderAll(); // إعادة رسم الرسوم بألوان الثيم
    });
  });

  document.querySelectorAll('#mode-toggle .kind-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.modeval === settings.mode);
    btn.addEventListener('click', () => {
      settings.mode = btn.dataset.modeval;
      Store.setSettings({ mode: settings.mode });
      applyAppearance();
      document.querySelectorAll('#mode-toggle .kind-btn').forEach((b) =>
        b.classList.toggle('active', b === btn));
    });
  });

  $('arabic-digits-toggle').checked = settings.arabicDigits;
  $('arabic-digits-toggle').addEventListener('change', (ev) => {
    settings.arabicDigits = ev.target.checked;
    Store.setSettings({ arabicDigits: settings.arabicDigits });
    buildFormatters();
    renderAll();
  });

  // ===== هدف الادخار =====
  $('savings-goal-input').value = settings.savingsGoal > 0 ? String(settings.savingsGoal) : '';
  $('savings-goal-input').addEventListener('change', (ev) => {
    const v = parseAmountInput(ev.target.value);
    settings.savingsGoal = isFinite(v) && v > 0 ? Math.round(v) : 0;
    Store.setSettings({ savingsGoal: settings.savingsGoal });
    renderHome();
    toast(settings.savingsGoal ? 'تم ضبط هدف الادخار ✓' : 'أُلغي هدف الادخار');
  });

  // ===== تصدير CSV =====
  $('btn-export-csv').addEventListener('click', () => {
    const rows = [['التاريخ', 'النوع', 'الفئة', 'المبلغ', 'الملاحظة', 'البطاقة']];
    [...expenses].sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
      rows.push([
        e.date,
        isIncome(e) ? 'دخل' : 'مصروف',
        isIncome(e) ? '' : catById(e.categoryId).name,
        String(e.amount),
        (e.note || '').replace(/"/g, '""'),
        e.card || '',
      ]);
    });
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `مصاريفي-${todayISO()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('تم تصدير ملف CSV ✓');
  });

  // ===== تقرير الشهر للمشاركة =====
  $('btn-report').addEventListener('click', async () => {
    const key = statsCycle;
    const spendList = onlyExpenses(expensesOfCycle(key));
    if (!spendList.length) { toast('ما فيه بيانات بهذا الشهر'); return; }
    const total = sum(spendList);
    const breakdown = Stats.categoryBreakdown(spendList, categories).slice(0, 4);

    const cv = document.createElement('canvas');
    cv.width = 1080; cv.height = 1350;
    const ctx = cv.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 1080, 1350);
    grad.addColorStop(0, '#12b3a0'); grad.addColorStop(1, '#0a5f57');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(540, -180, 500, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.font = '600 44px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(`مصاريف ${cycleLabel(key)}`, 540, 170);
    ctx.font = '800 130px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(`${fmtMoney.format(total)} ر.س`, 540, 330);

    let y = 520;
    ctx.font = '600 40px "IBM Plex Sans Arabic", sans-serif';
    breakdown.forEach((row) => {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.fillText(`${row.cat.icon} ${row.cat.name}`, 980, y);
      ctx.textAlign = 'left';
      ctx.fillText(`${fmtMoney.format(row.total)} ر.س`, 100, y);
      // شريط
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath(); ctx.roundRect(100, y + 24, 880, 18, 9); ctx.fill();
      ctx.fillStyle = row.cat.color;
      ctx.beginPath(); ctx.roundRect(980 - 880 * (row.pct / 100), y + 24, 880 * (row.pct / 100), 18, 9); ctx.fill();
      y += 140;
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = '500 36px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText('💰 مصاريفي', 540, 1270);

    cv.toBlob(async (blob) => {
      const file = new File([blob], `مصاريفي-${key}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch { /* ألغى المشاركة */ }
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast('تم حفظ صورة التقرير ✓');
      }
    }, 'image/png');
  });

  // ===== السحب لأسفل للتحديث =====
  (function pullToRefresh() {
    let startY = 0, pulling = false;
    const ptr = $('ptr-indicator');
    document.addEventListener('touchstart', (ev) => {
      if (window.scrollY <= 0 && !document.querySelector('.sheet:not(.hidden)')) {
        startY = ev.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });
    document.addEventListener('touchmove', (ev) => {
      if (!pulling) return;
      const dy = ev.touches[0].clientY - startY;
      if (dy > 20 && window.scrollY <= 0) {
        ptr.classList.remove('hidden');
        ptr.style.opacity = Math.min(1, (dy - 20) / 60);
        ptr.classList.toggle('ready', dy > 80);
      }
    }, { passive: true });
    document.addEventListener('touchend', async (ev) => {
      if (!pulling) return;
      pulling = false;
      const dy = (ev.changedTouches[0].clientY - startY);
      if (dy > 80 && window.scrollY <= 0) {
        ptr.classList.add('spinning');
        const saved = await syncRelay();
        ptr.classList.remove('spinning', 'ready');
        ptr.classList.add('hidden');
        if (saved === 0) toast('ما فيه جديد بالصندوق');
        else if (saved === null && Store.getRelay()) toast('ما قدرت أوصل للصندوق');
      } else {
        ptr.classList.add('hidden');
        ptr.classList.remove('ready');
      }
    });
  })();

  // ===== الجولة الترحيبية =====
  function maybeShowOnboarding() {
    if (settings.onboarded || expenses.length > 0) {
      if (!settings.onboarded) Store.setSettings({ onboarded: true });
      return;
    }
    const ob = $('onboarding');
    ob.classList.remove('hidden');
    let slide = 0;
    const slides = ob.querySelectorAll('.ob-slide');
    const dots = ob.querySelectorAll('.ob-dot');
    function show(i) {
      slide = i;
      slides.forEach((s, j) => s.classList.toggle('active', j === i));
      dots.forEach((d, j) => d.classList.toggle('active', j === i));
      ob.querySelector('.ob-next').textContent = i === slides.length - 1 ? 'ابدأ 🚀' : 'التالي';
    }
    ob.querySelector('.ob-next').addEventListener('click', () => {
      if (slide < slides.length - 1) show(slide + 1);
      else { ob.classList.add('hidden'); settings.onboarded = true; Store.setSettings({ onboarded: true }); }
    });
    ob.querySelector('.ob-skip').addEventListener('click', () => {
      ob.classList.add('hidden');
      settings.onboarded = true;
      Store.setSettings({ onboarded: true });
    });
    show(0);
  }

  // ===== قفل الخصوصية (PIN + بصمة/وجه) =====
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const lockEl = $('lock-screen');
  let pinBuffer = '';
  let pinMode = 'unlock'; // unlock | set | confirm | disable
  let pinFirst = '';

  function lockDots() {
    lockEl.querySelectorAll('.lock-dot').forEach((d, i) =>
      d.classList.toggle('filled', i < pinBuffer.length));
  }

  function showLock(mode) {
    pinMode = mode;
    pinBuffer = '';
    pinFirst = '';
    lockDots();
    $('lock-title').textContent =
      mode === 'set' ? 'اختر رمزاً من 4 أرقام'
      : mode === 'disable' ? 'أدخل رمزك لإلغاء القفل'
      : 'أدخل رمز القفل';
    $('lock-faceid').classList.toggle('hidden', !(mode === 'unlock' && settings.faceIdCred));
    lockEl.classList.remove('hidden');
  }
  function hideLock() { lockEl.classList.add('hidden'); }

  async function submitPin() {
    const pin = pinBuffer;
    pinBuffer = '';
    if (pinMode === 'set') {
      pinFirst = pin;
      pinMode = 'confirm';
      $('lock-title').textContent = 'أعد إدخال الرمز للتأكيد';
      lockDots();
      return;
    }
    if (pinMode === 'confirm') {
      if (pin === pinFirst) {
        settings.pinHash = await sha256(pin);
        Store.setSettings({ pinHash: settings.pinHash });
        hideLock();
        syncLockUi();
        toast('تم تفعيل قفل الخصوصية ✓');
      } else {
        $('lock-title').textContent = 'ما تطابقا — اختر رمزاً من جديد';
        pinMode = 'set';
        lockDots();
      }
      return;
    }
    // unlock أو disable
    const ok = (await sha256(pin)) === settings.pinHash;
    if (!ok) {
      $('lock-title').textContent = 'رمز خاطئ — حاول مرة ثانية';
      lockEl.classList.add('shake');
      setTimeout(() => lockEl.classList.remove('shake'), 400);
      lockDots();
      return;
    }
    if (pinMode === 'disable') {
      settings.pinHash = null;
      settings.faceIdCred = null;
      Store.setSettings({ pinHash: null, faceIdCred: null });
      syncLockUi();
      toast('أُلغي قفل الخصوصية');
    }
    hideLock();
  }

  lockEl.querySelectorAll('.lock-key').forEach((key) => {
    key.addEventListener('click', () => {
      const k = key.dataset.key;
      if (k === 'del') pinBuffer = pinBuffer.slice(0, -1);
      else if (pinBuffer.length < 4) pinBuffer += k;
      lockDots();
      if (pinBuffer.length === 4) setTimeout(submitPin, 120);
    });
  });

  // فتح بالوجه/البصمة عبر WebAuthn
  $('lock-faceid').addEventListener('click', async () => {
    try {
      const credId = Uint8Array.from(atob(settings.faceIdCred), (c) => c.charCodeAt(0));
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(16)),
          allowCredentials: [{ id: credId, type: 'public-key' }],
          userVerification: 'required',
          timeout: 30000,
        },
      });
      hideLock();
    } catch { /* فشل أو أُلغي — يبقى PIN */ }
  });

  function syncLockUi() {
    $('btn-lock').textContent = settings.pinHash ? '🔓 إلغاء قفل الخصوصية' : '🔒 قفل الخصوصية (رمز PIN)';
    $('faceid-row').classList.toggle('hidden', !settings.pinHash || !window.PublicKeyCredential);
    $('faceid-toggle').checked = !!settings.faceIdCred;
  }

  $('btn-lock').addEventListener('click', () => {
    showLock(settings.pinHash ? 'disable' : 'set');
  });

  $('faceid-toggle').addEventListener('change', async (ev) => {
    if (!ev.target.checked) {
      settings.faceIdCred = null;
      Store.setSettings({ faceIdCred: null });
      return;
    }
    try {
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(16)),
          rp: { name: 'مصاريفي', id: location.hostname },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: 'masareefi-user',
            displayName: 'مستخدم مصاريفي',
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
          timeout: 30000,
        },
      });
      settings.faceIdCred = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      Store.setSettings({ faceIdCred: settings.faceIdCred });
      toast('تم تفعيل الفتح بالوجه/البصمة ✓');
    } catch {
      ev.target.checked = false;
      toast('ما قدرت أفعّل البصمة — يبقى رمز PIN');
    }
  });
  syncLockUi();

  // قفل تلقائي عند مغادرة التطبيق
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && settings.pinHash) showLock('unlock');
  });

  // ===== تحديث التطبيق (عامل الخدمة) =====
  function setupUpdatePrompt(reg) {
    if (!reg) return;
    function watch(worker) {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          $('update-banner').classList.remove('hidden');
        }
      });
    }
    if (reg.waiting && navigator.serviceWorker.controller) {
      $('update-banner').classList.remove('hidden');
    }
    reg.addEventListener('updatefound', () => watch(reg.installing));
    $('update-now').addEventListener('click', () => {
      const w = reg.waiting || reg.installing;
      if (w) w.postMessage({ type: 'SKIP_WAITING' });
      $('update-banner').classList.add('hidden');
    });
  }
  // نعيد التحميل فقط عند تفعيل تحديث (مو عند أول تثبيت)
  const hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    window.location.reload();
  });
  window.__setupUpdatePrompt = setupUpdatePrompt;

  if (settings.pinHash) showLock('unlock');
  generateRecurring();
  renderAll();
  playEntrance('home');
  maybeShowOnboarding();
  handleSmsFromUrl();
  syncRelay();
})();
