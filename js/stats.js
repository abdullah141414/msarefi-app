/* الإحصائيات — تجميعات ورسوم SVG يدوية (بدون مكتبات) */
const Stats = (() => {

  function sum(list) { return list.reduce((t, e) => t + e.amount, 0); }

  // توزيع الفئات تنازلياً مع النسبة — يتجاهل الفئات صفرية الصرف
  function categoryBreakdown(cycleExpenses, categories) {
    const total = sum(cycleExpenses);
    return categories
      .map((cat) => {
        const t = sum(cycleExpenses.filter((e) => e.categoryId === cat.id));
        return { cat, total: t, pct: total > 0 ? (t / total) * 100 : 0 };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);
  }

  // أعلى المتاجر حسب الملاحظة (اسم المتجر)
  function topMerchants(cycleExpenses, n = 5) {
    const map = new Map();
    cycleExpenses.forEach((e) => {
      const name = (e.note || '').trim();
      if (!name) return;
      map.set(name, (map.get(name) || 0) + e.amount);
    });
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, n);
  }

  // دائرة Donut — breakdown: [{cat,total,pct}]
  function donutSVG(breakdown) {
    const C = 2 * Math.PI * 48; // محيط الدائرة نصف قطرها 48
    const gap = breakdown.length > 1 ? 3.5 : 0; // فاصل بسيط بين القطاعات
    let acc = 0;
    let segments = '';
    breakdown.forEach((row) => {
      const frac = row.pct / 100;
      if (frac <= 0) return;
      const dash = Math.max(0.5, frac * C - gap);
      segments += `<circle cx="60" cy="60" r="48" fill="none" stroke="${row.cat.color}" stroke-width="18"
        stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}"
        stroke-dashoffset="${(-acc * C).toFixed(2)}"
        transform="rotate(-90 60 60)"></circle>`;
      acc += frac;
    });
    // إذا فئة واحدة تملأ الدائرة بالكامل
    if (!segments && breakdown.length === 1) {
      segments = `<circle cx="60" cy="60" r="48" fill="none" stroke="${breakdown[0].cat.color}" stroke-width="18"></circle>`;
    }
    return `<svg viewBox="0 0 120 120" class="donut-svg" role="img">
      <circle cx="60" cy="60" r="48" fill="none" stroke="var(--track)" stroke-width="18"></circle>
      ${segments}
    </svg>`;
  }

  // أعمدة مقارنة — series: [{label, total, current}]
  function barsSVG(series) {
    const max = Math.max(1, ...series.map((s) => s.total));
    const step = 46, barW = 26, top = 8, chartH = 96, gap = 6;
    const width = series.length * step;
    let bars = '';
    series.forEach((s, i) => {
      const h = Math.max(2, (s.total / max) * chartH);
      const x = i * step + (step - barW) / 2;
      const y = top + (chartH - h);
      const fill = s.current ? 'var(--primary)' : 'var(--bar-dim)';
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${fill}"></rect>
        <text x="${x + barW / 2}" y="${top + chartH + 16}" text-anchor="middle" class="bar-label">${s.label}</text>`;
    });
    const totalH = top + chartH + gap + 16;
    return `<svg viewBox="0 0 ${width} ${totalH}" class="bars-svg" role="img" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
  }

  return { categoryBreakdown, topMerchants, donutSVG, barsSVG };
})();
