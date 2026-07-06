/* منطق التطبيق */
(() => {
  // ===== الحالة =====
  let categories = Store.getCategories();
  let expenses = Store.getExpenses();
  let recordMonth = monthKey(new Date());     // الشهر المعروض في السجل "YYYY-MM"
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

  function money(n) { return `${fmtMoney.format(n)} ر.س`; }

  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function monthKeyToDate(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }

  function catById(id) {
    return categories.find((c) => c.id === id) || categories.find((c) => c.id === 'other') || categories[0];
  }

  function expensesOfMonth(key) {
    return expenses.filter((e) => e.date.startsWith(key));
  }

  function sum(list) { return list.reduce((t, e) => t + e.amount, 0); }

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

  // ===== شرح الإدخال التلقائي =====
  const APP_URL = 'https://abdullah141414.github.io/msarefi-app/';
  $('smshelp-url').textContent = `${APP_URL}#sms=`;
  $('btn-sms-help').addEventListener('click', () => openSheet('smshelp-sheet'));
  $('smshelp-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${APP_URL}#sms=`);
      toast('تم نسخ الرابط ✓');
    } catch {
      toast('ما قدرت أنسخ — انسخه يدوياً');
    }
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
    const key = monthKey(new Date());
    const monthExpenses = expensesOfMonth(key);
    $('home-month-name').textContent = fmtMonth.format(new Date());
    $('home-total').textContent = money(sum(monthExpenses));
    $('home-count').textContent = monthExpenses.length
      ? `${fmtMoney.format(monthExpenses.length)} ${monthExpenses.length === 1 ? 'مصروف' : 'مصاريف'} هذا الشهر`
      : 'ما سجّلت شي هذا الشهر بعد';

    const grid = $('home-categories');
    grid.innerHTML = '';
    const hasAny = expenses.length > 0;
    $('home-empty').classList.toggle('hidden', hasAny);

    categories.forEach((cat) => {
      const total = sum(monthExpenses.filter((e) => e.categoryId === cat.id));
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
    const monthDate = monthKeyToDate(recordMonth);
    $('record-month-name').textContent = fmtMonth.format(monthDate);

    const monthExpenses = expensesOfMonth(recordMonth)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));

    $('record-total').textContent = monthExpenses.length ? `الإجمالي: ${money(sum(monthExpenses))}` : '';
    $('record-empty').classList.toggle('hidden', monthExpenses.length > 0);

    const list = $('record-list');
    list.innerHTML = '';

    // تجميع حسب اليوم
    const byDay = new Map();
    monthExpenses.forEach((e) => {
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
    const d = monthKeyToDate(recordMonth);
    d.setMonth(d.getMonth() - 1);
    recordMonth = monthKey(d);
    renderRecord();
  });
  $('month-next').addEventListener('click', () => {
    const d = monthKeyToDate(recordMonth);
    d.setMonth(d.getMonth() + 1);
    recordMonth = monthKey(d);
    renderRecord();
  });

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
      expenses[i] = { ...expenses[i], ...data };
      toast('تم تعديل المصروف ✓');
    } else {
      expenses.push({ id: Store.newId(), ...data });
      toast('تم حفظ المصروف ✓');
    }
    Store.setExpenses(expenses);
    closeSheet('expense-sheet');
    recordMonth = data.date.slice(0, 7);
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
    renderRecord();
    renderCategories();
  }

  // ===== الإدخال التلقائي من رسائل البنك (عبر أتمتة الاختصارات) =====
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
    if (!raw.trim()) return;

    const fp = SmsParser.fingerprint(raw);
    if (Store.hasSmsHash(fp)) {
      toast('هذي الرسالة مسجلة من قبل');
      return;
    }

    const result = SmsParser.parse(raw);

    if (!result.ok) {
      if (result.reason === 'not-purchase') {
        toast('الرسالة ليست عملية شراء — ما انحفظ شي');
      } else if (result.reason === 'no-amount') {
        // ما قدرنا نستخرج المبلغ — نفتح النافذة والمستخدم يكمل
        toast('ما قدرت أقرأ المبلغ — أكمل البيانات');
        openExpenseSheet();
        $('expense-note').value = (result.merchant || raw).slice(0, 60);
      }
      return;
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
    recordMonth = expense.date.slice(0, 7);
    renderAll();

    const cat = catById(categoryId);
    toast(`✓ تم تسجيل ${money(expense.amount)}${expense.note ? ` من ${expense.note}` : ''} في «${cat.name}»`);
  }

  renderAll();
  handleSmsFromUrl();
})();
