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
  let selectedIcon = null;
  let selectedColor = null;

  const CATEGORY_ICONS = ['🏠','🚗','🍽️','🛍️','💊','📱','👕','🎓','✈️','⚽','🎮','☕','⛽','🧾','🎁','💇','🐈','🕌','💼','📦'];
  const CATEGORY_COLORS = ['#0ea5e9','#f59e0b','#ef4444','#a855f7','#10b981','#6366f1','#ec4899','#f97316','#14b8a6','#64748b'];

  // ===== أدوات =====
  const $ = (id) => document.getElementById(id);

  const fmtMoney = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });
  const fmtMonth = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
  const fmtDay = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtDayMonth = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' });
  const fmtMonthShort = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { month: 'short' });

  function money(n) { return `${fmtMoney.format(n)} ر.س`; }

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

  // ===== التنقل بين العروض =====
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      $(`view-${tab.dataset.view}`).classList.add('active');
      window.scrollTo(0, 0);
      renderAll();
    });
  });

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

  $('btn-sms-help').addEventListener('click', () => { renderRelayUi(); openSheet('smshelp-sheet'); });

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

  // ===== الرئيسية =====
  function renderHome() {
    const key = currentCycleKey();
    const cycleExpenses = expensesOfCycle(key);
    $('home-month-name').textContent = cycleLabel(key);
    $('home-total').textContent = money(sum(cycleExpenses));
    $('home-count').textContent = cycleExpenses.length
      ? `${fmtMoney.format(cycleExpenses.length)} ${cycleExpenses.length === 1 ? 'مصروف' : 'مصاريف'} هذا الشهر`
      : 'ما سجّلت شي هذا الشهر بعد';

    const grid = $('home-categories');
    grid.innerHTML = '';
    const hasAny = expenses.length > 0;
    $('home-empty').classList.toggle('hidden', hasAny);

    categories.forEach((cat) => {
      const total = sum(cycleExpenses.filter((e) => e.categoryId === cat.id));
      const card = document.createElement('button');
      card.className = 'category-card';
      card.style.setProperty('--cat-color', cat.color);
      card.innerHTML = `
        <span class="cat-icon">${cat.icon}</span>
        <span class="cat-name">${escapeHtml(cat.name)}</span>
        <span class="cat-total">${money(total)}</span>`;
      card.addEventListener('click', () => openExpenseSheet(null, cat.id));
      grid.appendChild(card);
    });
  }

  // ===== السجل =====
  function renderRecord() {
    $('record-month-name').textContent = cycleLabel(recordCycle);

    const cycleExpenses = expensesOfCycle(recordCycle)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));

    $('record-total').textContent = cycleExpenses.length ? `الإجمالي: ${money(sum(cycleExpenses))}` : '';
    $('record-empty').classList.toggle('hidden', cycleExpenses.length > 0);

    const list = $('record-list');
    list.innerHTML = '';

    // تجميع حسب اليوم
    const byDay = new Map();
    cycleExpenses.forEach((e) => {
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
        const cat = catById(e.categoryId);
        const row = document.createElement('button');
        row.className = 'expense-item';
        row.style.setProperty('--item-color', cat.color);
        row.innerHTML = `
          <span class="expense-icon">${cat.icon}</span>
          <span class="expense-info">
            <span class="expense-cat">${escapeHtml(cat.name)}</span>
            ${e.note ? `<span class="expense-note">${escapeHtml(e.note)}</span>` : ''}
          </span>
          <span class="expense-amount">${money(e.amount)}</span>`;
        row.addEventListener('click', () => openExpenseSheet(e.id));
        wrap.appendChild(row);
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

  // ===== الإحصائيات =====
  function renderStats() {
    $('stats-month-name').textContent = cycleLabel(statsCycle);
    const cycleExpenses = expensesOfCycle(statsCycle);
    const total = sum(cycleExpenses);

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
      const item = document.createElement('div');
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
      bd.appendChild(item);
    });

    // أعمدة آخر 6 دورات
    const series = [];
    let k = statsCycle;
    for (let i = 0; i < 6; i++) {
      const { start } = cycleBounds(k);
      series.unshift({
        label: fmtMonthShort.format(start),
        total: sum(expensesOfCycle(k)),
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
  });
  $('stats-next').addEventListener('click', () => {
    statsCycle = shiftCycle(statsCycle, 1);
    renderStats();
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
  function renderExpenseChips() {
    const row = $('expense-categories');
    row.innerHTML = '';
    categories.forEach((cat) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (cat.id === selectedCategoryId ? ' selected' : '');
      chip.style.setProperty('--chip-color', cat.color);
      chip.innerHTML = `${cat.icon} ${escapeHtml(cat.name)}`;
      chip.addEventListener('click', () => {
        selectedCategoryId = cat.id;
        renderExpenseChips();
      });
      row.appendChild(chip);
    });
  }

  function openExpenseSheet(expenseId = null, presetCategoryId = null) {
    editingExpenseId = expenseId;
    const expense = expenseId ? expenses.find((e) => e.id === expenseId) : null;

    $('expense-sheet-title').textContent = expense ? 'تعديل المصروف' : 'إضافة مصروف';
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
    // يقبل الأرقام العربية ٠-٩ ويحولها
    const raw = $('expense-amount').value
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/٫/g, '.')
      .replace(/,/g, '.');
    const amount = parseFloat(raw);
    if (!isFinite(amount) || amount <= 0) {
      toast('أدخل مبلغ صحيح');
      $('expense-amount').focus();
      return;
    }
    const data = {
      amount: Math.round(amount * 100) / 100,
      categoryId: selectedCategoryId,
      date: $('expense-date').value || todayISO(),
      note: $('expense-note').value.trim(),
    };
    if (editingExpenseId) {
      const i = expenses.findIndex((e) => e.id === editingExpenseId);
      const prev = expenses[i];
      // التعلّم من التصحيح: إذا غيّر المستخدم فئة عملية لها اسم متجر، نتذكر اختياره
      if (data.note && data.categoryId !== prev.categoryId) {
        Store.learnMerchant(SmsParser.normalizeMerchant(data.note), data.categoryId);
      }
      expenses[i] = { ...prev, ...data };
      toast('تم تعديل المصروف ✓');
    } else {
      expenses.push({ id: Store.newId(), ...data });
      toast('تم حفظ المصروف ✓');
    }
    Store.setExpenses(expenses);
    closeSheet('expense-sheet');
    recordCycle = cycleKeyOfISO(data.date);
    renderAll();
  });

  $('expense-delete').addEventListener('click', () => {
    askConfirm('متأكد تبي تحذف هذا المصروف؟', () => {
      expenses = expenses.filter((e) => e.id !== editingExpenseId);
      Store.setExpenses(expenses);
      closeSheet('expense-sheet');
      toast('تم الحذف');
      renderAll();
    });
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

    if (editingCategoryId) {
      const cat = categories.find((c) => c.id === editingCategoryId);
      cat.name = name;
      cat.icon = selectedIcon;
      cat.color = selectedColor;
      toast('تم تعديل الفئة ✓');
    } else {
      categories.push({ id: Store.newId(), name, icon: selectedIcon, color: selectedColor });
      toast('تمت إضافة الفئة ✓');
    }
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
    };
    expenses.push(expense);
    Store.setExpenses(expenses);
    Store.addSmsHash(fp);
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

  renderAll();
  handleSmsFromUrl();
  syncRelay();
})();
