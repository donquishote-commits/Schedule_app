(() => {
  'use strict';

  const STORAGE_KEY = 'schedule_app_classes_ar_v1';
  const TEMP_SESSIONS_KEY = 'schedule_app_temp_sessions_v1';
  const TERMS_KEY = 'schedule_app_terms_v1';
  const TEACHER_NAME_KEY = 'schedule_app_teacher_name_v1';
  const TEACHER_DEPARTMENT_KEY = 'schedule_app_teacher_department_v1';

  // Exact wording from the school's own Microsoft Forms القسم dropdown —
  // pre-fill only works with a byte-for-byte match, so these are copied
  // from a real screenshot of the form's option list, not typed freehand.
  const DEPARTMENTS = [
    'التربية الاسلامية',
    'اللغة العربية',
    'اللغة الانجليزية',
    'اللغة الفرنسية',
    'علم النفس و الفلسفة',
    'تاريخ و جغرافيا',
    'الرياضيات',
    'الكيمياء و الفيزياء',
    'الأحياء و الجيولوجيا',
    'الحاسوب',
    'التربية البدنية',
    'التربية الفنية',
    'التربية الموسيقية',
    'اخرى',
  ];

  const DAYS = [
    { key: 0, label: 'الأحد' },
    { key: 1, label: 'الإثنين' },
    { key: 2, label: 'الثلاثاء' },
    { key: 3, label: 'الأربعاء' },
    { key: 4, label: 'الخميس' },
  ];

  // Fixed daily timetable: class periods and recesses, in order.
  // start/end are stored in 24-hour time so they can be used for real
  // date arithmetic (e.g. the calendar export); display uses to12().
  const PERIODS = [
    { type: 'class', key: 1, label: 'الحصة الأولى', start: '07:55', end: '08:40' },
    { type: 'class', key: 2, label: 'الحصة الثانية', start: '08:45', end: '09:30' },
    { type: 'class', key: 3, label: 'الحصة الثالثة', start: '09:35', end: '10:20' },
    { type: 'break', key: 'b1', label: 'الفرصة الأولى', start: '10:20', end: '10:35' },
    { type: 'class', key: 4, label: 'الحصة الرابعة', start: '10:35', end: '11:20' },
    { type: 'class', key: 5, label: 'الحصة الخامسة', start: '11:25', end: '12:10' },
    { type: 'break', key: 'b2', label: 'الفرصة الثانية', start: '12:10', end: '12:20' },
    { type: 'class', key: 6, label: 'الحصة السادسة', start: '12:20', end: '13:05' },
    { type: 'class', key: 7, label: 'الحصة السابعة', start: '13:10', end: '13:55' },
  ];

  const CLASS_PERIODS = PERIODS.filter(p => p.type === 'class');

  // المواد مجمّعة حسب القسم العلمي — الأساس اللي راح تُبنى عليه لاحقًا
  // تصفية خانة المادة بإضافة حصة حسب قسم المعلم المختار بالإعدادات.
  // كل المواد الحالية تخص قسم الفلسفة وعلم النفس مبدئيًا؛ أقسام ومواد
  // ثانية تُضاف هنا لاحقًا.
  const SUBJECTS_BY_DEPARTMENT = {
    'علم النفس و الفلسفة': ['الفلسفة', 'علم النفس', 'الدستور', 'دولة الكويت', 'الصحة النفسية'],
  };
  const SUBJECTS = Object.values(SUBJECTS_BY_DEPARTMENT).flat();

  const ROOMS = [
    '10-1', '10-2', '10-3', '10-4', '10-5', '10-6', '10-7', '10-8', '10-9',
    '11 د 1', '11 د 2', '11 د 3',
    '11 ع 1', '11 ع 2', '11 ع 3', '11 ع 4', '11 ع 5', '11 ع 6', '11 ع 7', '11 ع 8',
    '12 د 1', '12 د 2',
    '12 ع 1', '12 ع 2', '12 ع 3', '12 ع 4', '12 ع 5', '12 ع 6', '12 ع 7', '12 ع 8',
  ];

  // Which صفوف each subject can be taught in. A subject not listed here
  // (an older free-text entry, e.g. "اجتماع القسم الأسبوعي") isn't tied to
  // any grade, so it's offered the full room list.
  const SUBJECT_ROOMS = {
    'دولة الكويت': ROOMS.filter(r => r.startsWith('10-')),
    'الصحة النفسية': ROOMS.filter(r => r.startsWith('11 ') || r.startsWith('12 ')),
    'الفلسفة': ROOMS.filter(r => r.startsWith('12 د')),
    'علم النفس': ROOMS.filter(r => r.startsWith('11 د')),
    'الدستور': ROOMS.filter(r => r.startsWith('12 ')),
  };

  function roomsForSubject(subject) {
    return SUBJECT_ROOMS[subject] || ROOMS;
  }

  // A soft, muted pastel color per subject — same subject always gets the
  // same color, so no manual color-picking is needed and colors stay
  // consistent everywhere that subject appears.
  const DEFAULT_COLOR = '#ced3e0'; // entries with no subject

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  // Hand-picked hues (not an even 72° split) — an even split puts the last
  // and first colors right next to each other on the wheel, which made
  // "الصحة النفسية" and "الفلسفة" look too similar in practice. Any other
  // subject (an older free-text entry, e.g. "اجتماع القسم الأسبوعي") falls
  // back to a hash-derived hue so it's still consistent, just not
  // guaranteed distinct from this fixed palette.
  const SUBJECT_HUES = [15, 95, 155, 215, 265];
  const SUBJECT_HUE_MAP = Object.fromEntries(
    SUBJECTS.map((s, i) => [s, SUBJECT_HUES[i]])
  );

  // Chalk-on-paper style: a soft tinted fill, a dashed border in a deeper
  // shade of the same hue, and matching text — instead of one flat pastel.
  function colorsForSubject(subject) {
    const key = (subject || '').trim();
    if (!key) return { bg: DEFAULT_COLOR, border: '#9aa0af', text: 'var(--text)' };
    const hue = key in SUBJECT_HUE_MAP ? SUBJECT_HUE_MAP[key] : hashString(key) % 360;
    return {
      bg: hslToHex(hue, 38, 91),
      border: hslToHex(hue, 45, 55),
      text: hslToHex(hue, 48, 28),
    };
  }

  // Converts a 24-hour "HH:MM" period time to the informal 12-hour form
  // the school actually uses (no AM/PM marker, e.g. "13:05" -> "1:05").
  function to12(t) {
    const [h, m] = t.split(':').map(Number);
    const h12 = h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')}`;
  }

  const ICS_DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const SCHOOL_UTC_OFFSET_HOURS = 3; // Arabian Standard Time (Saudi/Kuwait/Qatar/Bahrain), no DST

  // Seeds the schedule the first time the app runs on a browser with no
  // saved data yet — empty so a colleague opening the link for the first
  // time starts with a blank grid instead of the original owner's classes.
  // Anyone with data already saved on their device is unaffected either
  // way, since loadClasses() below only falls back to this when there's
  // nothing saved yet.
  const DEFAULT_CLASSES = [];

  // Forces strict left-to-right character order so the RTL bidi algorithm
  // doesn't reorder digit runs around Arabic letters — e.g. "12د1" (a
  // room/class code) rendering as "1د12". A plain isolate (LRI/PDI) isn't
  // enough here: per bidi rule W2, a digit run right after an Arabic
  // letter gets reclassified as an Arabic number and still reorders even
  // inside an isolate, so this uses a full LTR override instead.
  function isolateLTR(text) {
    return `‭${text}‬`;
  }

  function formatRange(start, end) {
    return isolateLTR(`${start} - ${end}`);
  }

  // ---------- State ----------
  let classes = loadClasses();
  let editingId = null;
  // Which week's Sunday the grid is currently showing — always resets to
  // the real current week on every fresh page load/open, same as صفحة
  // المتابعة اليومية always opening on today; navigated away from with
  // the week-nav buttons only for the current session. (startOfWeek/
  // todayISO are function declarations further down, hoisted, so calling
  // them here at module init time is safe.)
  let viewedWeekStart = startOfWeek(todayISO());

  // ---------- Persistence ----------
  function loadClasses() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      return DEFAULT_CLASSES.map(c => ({ ...c, notes: [...c.notes] }));
    } catch (e) {
      console.error('Failed to load schedule from storage', e);
      return [];
    }
  }

  function saveClasses() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(classes));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function findClass(day, periodKey) {
    return classes.find(c => c.day === day && c.periodKey === periodKey);
  }

  // ---------- Temporary sessions (تبديل / تغطية), read-only here ----------
  // Created and managed from صفحة المتابعة اليومية — this page only shows
  // whichever one is coming up soonest in each day×period cell, as a
  // heads-up, and links through to manage it.
  function loadTempSessions() {
    try {
      const raw = localStorage.getItem(TEMP_SESSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to load temporary sessions from storage', e);
      return [];
    }
  }
  const tempSessions = loadTempSessions();

  // Read-only here too — term dates are set from صفحة المتابعة اليومية,
  // this page just uses them to number the weeks (see weekLabelFor).
  function loadTerms() {
    try {
      const raw = localStorage.getItem(TERMS_KEY);
      return raw ? JSON.parse(raw) : { term1Start: '', term1End: '', term2Start: '', term2End: '' };
    } catch (e) {
      console.error('Failed to load term dates from storage', e);
      return { term1Start: '', term1End: '', term2Start: '', term2End: '' };
    }
  }
  const terms = loadTerms();

  function dateToISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function todayISO() {
    return dateToISO(new Date());
  }

  function isoToDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(iso, delta) {
    const d = isoToDate(iso);
    d.setDate(d.getDate() + delta);
    return dateToISO(d);
  }

  // The Sunday (0 = Sunday) of the week containing this date — every
  // viewed week is anchored to start on Sunday, matching the grid's own
  // column order, regardless of which weekday a term's start date falls on.
  function startOfWeek(iso) {
    const d = isoToDate(iso);
    d.setDate(d.getDate() - d.getDay());
    return dateToISO(d);
  }

  // No weekday name here — the grid cell's own column already shows
  // that; this only needs to disambiguate which occurrence of it.
  const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function formatArabicDateShort(iso) {
    const d = isoToDate(iso);
    return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]}`;
  }

  // Ordinal week words, matching the app's existing convention of
  // spelling out ordinals (see PERIODS' "الحصة الأولى/الثانية/..." above)
  // instead of digits — generous enough for any real school term; a term
  // improbably longer than this just falls back to a plain number.
  const ORDINAL_WEEKS = [
    '', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
    'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر',
    'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون',
  ];
  function ordinalWeekWord(n) {
    return (n >= 1 && n < ORDINAL_WEEKS.length) ? ORDINAL_WEEKS[n] : String(n);
  }

  // Labels the viewed week by its number within whichever فصل دراسي it
  // falls in — matching how the الخطة الدراسية itself counts weeks
  // ("الأسبوع الأول/الثاني/...") — since that's what actually tells a
  // teacher when in the term a given تغطية/تبديل happened. Falls back to
  // a plain date range for a week outside any configured term (or before
  // term dates are set up at all, from صفحة المتابعة اليومية ← ⚙️).
  function weekLabelFor(weekStartISO) {
    if (terms.term1Start) {
      const t1Start = startOfWeek(terms.term1Start);
      if (weekStartISO >= t1Start && (!terms.term1End || weekStartISO <= terms.term1End)) {
        const n = Math.round((isoToDate(weekStartISO) - isoToDate(t1Start)) / (7 * 24 * 60 * 60 * 1000)) + 1;
        return `الفصل الأول — الأسبوع ${ordinalWeekWord(n)}`;
      }
    }
    if (terms.term2Start) {
      const t2Start = startOfWeek(terms.term2Start);
      if (weekStartISO >= t2Start && (!terms.term2End || weekStartISO <= terms.term2End)) {
        const n = Math.round((isoToDate(weekStartISO) - isoToDate(t2Start)) / (7 * 24 * 60 * 60 * 1000)) + 1;
        return `الفصل الثاني — الأسبوع ${ordinalWeekWord(n)}`;
      }
    }
    return `${formatArabicDateShort(weekStartISO)} – ${formatArabicDateShort(addDays(weekStartISO, 4))}`;
  }

  // Exact date + period match — the grid now shows one real calendar date
  // per cell (based on the currently viewed week), so this no longer
  // needs the old "nearest upcoming" heuristic: a swap/cover only ever
  // shows once its own week is the one being viewed.
  function tempSessionForDate(dateISO, periodKey) {
    return tempSessions.find(t => t.periodKey === periodKey && t.date === dateISO) || null;
  }

  // True if the recurring class's occurrence on this exact date has been
  // swapped away to another date — so the grid doesn't show it both in
  // its normal cell and in the swap's target cell at the same time.
  function isClassSwappedAwayOnDate(classId, dateISO) {
    return tempSessions.some(t => t.type === 'swap' && t.sourceClassId === classId && t.sourceDate === dateISO);
  }

  // ---------- Grid rendering ----------
  const gridEl = document.getElementById('grid');
  const weekLabelEl = document.getElementById('weekLabel');

  function renderGrid() {
    gridEl.innerHTML = '';
    if (weekLabelEl) weekLabelEl.textContent = weekLabelFor(viewedWeekStart);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const cornerHeader = document.createElement('th');
    cornerHeader.className = 'period-col-header';
    cornerHeader.textContent = 'الحصة';
    headRow.appendChild(cornerHeader);

    DAYS.forEach(day => {
      const th = document.createElement('th');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = day.label;
      const dateSpan = document.createElement('span');
      dateSpan.className = 'day-date';
      dateSpan.textContent = formatArabicDateShort(addDays(viewedWeekStart, day.key));
      th.appendChild(nameSpan);
      th.appendChild(dateSpan);
      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    gridEl.appendChild(thead);

    const tbody = document.createElement('tbody');

    PERIODS.forEach(period => {
      const tr = document.createElement('tr');

      if (period.type === 'break') {
        tr.className = 'break-row';
        const td = document.createElement('td');
        td.colSpan = DAYS.length + 1;
        // The label sits in its own absolutely-positioned span, kept
        // horizontally centered on the visible viewport by JS (see
        // centerBreakLabels) — the <td> itself still spans the full
        // scrollable width behind it.
        const label = document.createElement('span');
        label.className = 'break-label';
        label.textContent = `${period.label} (${formatRange(to12(period.start), to12(period.end))})`;
        td.appendChild(label);
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      const labelTd = document.createElement('td');
      labelTd.className = 'period-label';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'period-name';
      nameSpan.textContent = period.label;
      const timeSpan = document.createElement('span');
      timeSpan.className = 'period-time';
      timeSpan.textContent = formatRange(to12(period.start), to12(period.end));
      labelTd.appendChild(nameSpan);
      labelTd.appendChild(timeSpan);
      tr.appendChild(labelTd);

      DAYS.forEach(day => {
        const td = document.createElement('td');
        td.className = 'class-cell';
        const cellDate = addDays(viewedWeekStart, day.key);
        const tempMatch = tempSessionForDate(cellDate, period.key);
        const existing = findClass(day.key, period.key);

        if (tempMatch) {
          td.appendChild(renderTempBlock(tempMatch));
        } else if (existing) {
          const swappedAway = isClassSwappedAwayOnDate(existing.id, cellDate);
          td.appendChild(renderClassBlock(existing, { swappedAway }));
        } else {
          td.addEventListener('click', () => openCellTypeModal(day.key, period.key, cellDate));
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    gridEl.appendChild(tbody);
    centerBreakLabels();
  }

  // Keeps each break-row label centered on the part of the table that's
  // actually visible, not the full scrollable width — recomputed on every
  // scroll/resize since the visible window keeps moving underneath it.
  const scheduleWrapEl = document.querySelector('.schedule-wrap');
  function centerBreakLabels() {
    if (!scheduleWrapEl) return;
    const clientWidth = scheduleWrapEl.clientWidth;
    const scrolled = Math.abs(scheduleWrapEl.scrollLeft);
    scheduleWrapEl.querySelectorAll('.break-label').forEach(label => {
      const offset = (clientWidth - label.offsetWidth) / 2 + scrolled;
      label.style.right = `${Math.max(0, offset)}px`;
    });
  }
  if (scheduleWrapEl) {
    scheduleWrapEl.addEventListener('scroll', centerBreakLabels, { passive: true });
    window.addEventListener('resize', centerBreakLabels);
  }

  // ---------- Week navigation ----------
  const prevWeekBtn = document.getElementById('prevWeekBtn');
  const nextWeekBtn = document.getElementById('nextWeekBtn');
  const thisWeekBtn = document.getElementById('thisWeekBtn');
  function goToWeek(newWeekStart) {
    viewedWeekStart = newWeekStart;
    renderGrid();
  }
  if (prevWeekBtn) prevWeekBtn.addEventListener('click', () => goToWeek(addDays(viewedWeekStart, -7)));
  if (nextWeekBtn) nextWeekBtn.addEventListener('click', () => goToWeek(addDays(viewedWeekStart, 7)));
  if (thisWeekBtn) thisWeekBtn.addEventListener('click', () => goToWeek(startOfWeek(todayISO())));

  // Builds the subject line as an icon span + text span (a flex row),
  // instead of one string with the icon typed inline — mixing a symbol
  // like ➕ into the same Arabic text run left its on-screen position up
  // to the Unicode bidi algorithm, which placed 🔁 correctly but ➕
  // backwards. Flex layout in the RTL container keeps the icon pinned to
  // the line's leading edge regardless, for every icon.
  function buildSubjectLine(text, icon) {
    const subject = document.createElement('span');
    subject.className = 'subject';
    if (icon) {
      const iconSpan = document.createElement('span');
      iconSpan.className = 'subject-icon';
      iconSpan.textContent = icon;
      subject.appendChild(iconSpan);
    }
    const textSpan = document.createElement('span');
    textSpan.className = 'subject-text';
    textSpan.textContent = text;
    subject.appendChild(textSpan);
    return subject;
  }

  // opts.swappedAway marks that this week's upcoming occurrence has been
  // moved elsewhere via تبديل — still shown (it's the fixed weekly
  // schedule, unaffected week to week) but faded with a 🔁 marker instead
  // of duplicating the class in two cells at once.
  function renderClassBlock(c, opts) {
    const swappedAway = !!(opts && opts.swappedAway);
    const block = document.createElement('div');
    block.className = 'class-block';
    if (swappedAway) {
      block.classList.add('class-block-swapped-away');
      block.title = 'حصتك بهذا الأسبوع بُدِّلت إلى تاريخ آخر — لا تزال جزءًا من جدولك الثابت، وتظهر بشكل طبيعي في أي أسبوع لا يوجد فيه تبديل عليها.';
    }
    // Always computed live from the subject, never read from storage —
    // so retuning the palette or fixing an old entry's subject instantly
    // shows the right color everywhere, with nothing to go stale.
    const colors = colorsForSubject(c.subject);
    block.style.background = colors.bg;
    block.style.borderColor = colors.border;
    block.style.color = colors.text;

    block.appendChild(buildSubjectLine(c.subject, swappedAway ? '🔁' : null));

    if (c.room) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = isolateLTR(c.room);
      block.appendChild(meta);
    }

    if (c.notes && c.notes.length > 0) {
      const dot = document.createElement('span');
      dot.className = 'note-dot';
      block.appendChild(dot);
    }

    block.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(c.id);
    });
    return block;
  }

  // Managed from صفحة المتابعة اليومية only — clicking this opens a
  // read-only details popup first (see openTempDetailsModal below), with
  // a link through to that exact date there for anything that needs
  // changing. Kept to the same two-line shape as renderClassBlock
  // (subject, meta) so it fits the grid's fixed row height instead of
  // stretching it.
  function renderTempBlock(t) {
    const block = document.createElement('div');
    block.className = 'swap-block';

    block.appendChild(buildSubjectLine(t.subject, t.type === 'swap' ? '🔁' : '➕'));

    // No date here — the day column's own date sub-label (see renderGrid)
    // already says which day this is, and the badge is too small to
    // repeat it without crowding the room.
    if (t.room) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = isolateLTR(t.room);
      block.appendChild(meta);
    }

    block.addEventListener('click', (e) => {
      e.stopPropagation();
      openTempDetailsModal(t);
    });
    return block;
  }

  function periodLabelFor(periodKey) {
    const p = CLASS_PERIODS.find(x => x.key === periodKey);
    if (!p) return '';
    return `${p.label} (${formatRange(to12(p.start), to12(p.end))})`;
  }

  // Weekday name + short date, e.g. "الخميس، 17 سبتمبر" — used in the
  // details popup where formatArabicDateShort's day-less form (fine for a
  // grid cell whose own column already names the day) would be ambiguous.
  function formatArabicFullDate(iso) {
    const d = isoToDate(iso);
    const dayInfo = DAYS.find(x => x.key === d.getDay());
    return `${dayInfo ? dayInfo.label + '، ' : ''}${formatArabicDateShort(iso)}`;
  }

  // ---------- Temp session details popup ----------
  const tempDetailsModal = document.getElementById('tempDetailsModal');
  const tempDetailsTitle = document.getElementById('tempDetailsTitle');
  const tempDetailsBody = document.getElementById('tempDetailsBody');
  const tempDetailsManageLink = document.getElementById('tempDetailsManageLink');
  const closeTempDetailsModalBtn = document.getElementById('closeTempDetailsModalBtn');

  function addDetailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'profile-row';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'profile-row-label';
    labelSpan.textContent = label;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'profile-row-value';
    valueSpan.textContent = value;
    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    tempDetailsBody.appendChild(row);
  }

  function openTempDetailsModal(t) {
    tempDetailsTitle.textContent = t.type === 'swap' ? 'تفاصيل حصة مبدّلة' : 'تفاصيل حصة احتياط';
    tempDetailsBody.innerHTML = '';
    addDetailRow('النوع', t.type === 'swap' ? '🔁 تبديل' : '➕ احتياط');
    addDetailRow('المادة', t.subject);
    addDetailRow('الصف', t.room ? isolateLTR(t.room) : '— غير معيّن —');
    addDetailRow('الحصة', periodLabelFor(t.periodKey));
    addDetailRow('التاريخ', formatArabicFullDate(t.date));
    if (t.type === 'swap' && t.sourceDate) {
      addDetailRow('استُبدلت من', formatArabicFullDate(t.sourceDate));
    }
    if (t.type === 'cover' && t.teacherName) {
      addDetailRow('الأستاذ', t.teacherName);
    }
    tempDetailsManageLink.href = `attendance.html?date=${encodeURIComponent(t.date)}`;
    tempDetailsModal.hidden = false;
  }

  function closeTempDetailsModal() {
    tempDetailsModal.hidden = true;
  }

  if (closeTempDetailsModalBtn) closeTempDetailsModalBtn.addEventListener('click', closeTempDetailsModal);
  // Clicking the backdrop doesn't close it — same convention as every
  // other modal in the app.

  // ---------- Empty-cell type chooser (حصة أساسية / حصة تغطية) ----------
  const cellTypeModal = document.getElementById('cellTypeModal');
  const cellTypeRegularBtn = document.getElementById('cellTypeRegularBtn');
  const cellTypeCoverBtn = document.getElementById('cellTypeCoverBtn');
  const closeCellTypeModalBtn = document.getElementById('closeCellTypeModalBtn');

  let pendingCell = null; // { dayKey, periodKey, dateISO }

  function openCellTypeModal(dayKey, periodKey, dateISO) {
    pendingCell = { dayKey, periodKey, dateISO };
    cellTypeModal.hidden = false;
  }

  function closeCellTypeModal() {
    cellTypeModal.hidden = true;
    pendingCell = null;
  }

  if (closeCellTypeModalBtn) closeCellTypeModalBtn.addEventListener('click', closeCellTypeModal);

  cellTypeRegularBtn.addEventListener('click', () => {
    const cell = pendingCell;
    closeCellTypeModal();
    if (cell) openAddModal(cell.dayKey, cell.periodKey);
  });

  cellTypeCoverBtn.addEventListener('click', () => {
    const cell = pendingCell;
    closeCellTypeModal();
    if (cell) openCoverModal(cell.dateISO, cell.periodKey);
  });

  // ---------- Cover session for an empty cell (حصة تغطية) ----------
  // Same idea as "إضافة حصة لهذا اليوم" بصفحة المتابعة اليومية، لكن
  // التاريخ والحصة محددين مسبقًا من الخلية المضغوطة، فما يحتاج المستخدم
  // يختارهم من جديد — فقط المادة والصف واسم الأستاذ الاختياري.
  const coverModal = document.getElementById('coverModal');
  const coverForm = document.getElementById('coverForm');
  const coverHintText = document.getElementById('coverHintText');
  const coverSubjectSelect = document.getElementById('coverSubject');
  const coverRoomSelect = document.getElementById('coverRoom');
  const coverTeacherInput = document.getElementById('coverTeacherInput');
  const closeCoverModalBtn = document.getElementById('closeCoverModalBtn');
  const cancelCoverBtn = document.getElementById('cancelCoverBtn');

  let coverTarget = null; // { dateISO, periodKey }
  let coverOpenedSnapshot = '';

  function coverFormSnapshot() {
    return [coverSubjectSelect.value, coverRoomSelect.value, coverTeacherInput.value].join('|');
  }

  function openCoverModal(dateISO, periodKey) {
    coverTarget = { dateISO, periodKey };
    coverForm.reset();
    coverSubjectSelect.populate(SUBJECTS, '', 'اختر المادة', true);
    coverRoomSelect.populate(roomsForSubject(''), '', '— غير معيّن —', false, true);
    coverTeacherInput.value = '';
    coverHintText.textContent = `إضافة حصة احتياط ليوم ${formatArabicFullDate(dateISO)} — ${periodLabelFor(periodKey)}`;
    coverModal.hidden = false;
    coverOpenedSnapshot = coverFormSnapshot();
  }

  function closeCoverModal() {
    coverModal.hidden = true;
    coverTarget = null;
  }

  function closeCoverModalIfConfirmed() {
    if (coverFormSnapshot() !== coverOpenedSnapshot) {
      if (!confirm('لديك تعديلات على الحصة لم تُحفظ. إذا أغلقت الآن، ستُفقد هذه التعديلات. هل تريد المتابعة؟')) return;
    }
    closeCoverModal();
  }

  if (closeCoverModalBtn) closeCoverModalBtn.addEventListener('click', closeCoverModalIfConfirmed);
  if (cancelCoverBtn) cancelCoverBtn.addEventListener('click', closeCoverModalIfConfirmed);

  function saveTempSessions() {
    localStorage.setItem(TEMP_SESSIONS_KEY, JSON.stringify(tempSessions));
  }

  makeCustomSelect('coverSubject');
  makeCustomSelect('coverRoom');

  coverSubjectSelect.addEventListener('change', () => {
    const validRooms = roomsForSubject(coverSubjectSelect.value);
    const roomToKeep = validRooms.includes(coverRoomSelect.value) ? coverRoomSelect.value : '';
    coverRoomSelect.populate(validRooms, roomToKeep, '— غير معيّن —', false, true);
  });

  if (coverForm) {
    coverForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!coverTarget) return;
      if (!coverSubjectSelect.value) {
        alert('اختر المادة أولًا.');
        return;
      }
      tempSessions.push({
        id: uid(),
        type: 'cover',
        date: coverTarget.dateISO,
        periodKey: coverTarget.periodKey,
        subject: coverSubjectSelect.value,
        room: coverRoomSelect.value || '',
        teacherName: coverTeacherInput.value.trim() || null,
      });
      saveTempSessions();
      closeCoverModal();
      renderGrid();
    });
  }

  // ---------- Modal ----------
  const modal = document.getElementById('classModal');
  const modalTitle = document.getElementById('modalTitle');
  const classForm = document.getElementById('classForm');
  const daySelect = document.getElementById('day');
  const periodSelect = document.getElementById('period');
  const subjectSelect = document.getElementById('subject');
  const roomSelect = document.getElementById('room');
  const deleteBtn = document.getElementById('deleteBtn');
  const quickLinks = document.getElementById('quickLinks');
  const quickLinkStudents = document.getElementById('quickLinkStudents');
  const quickLinkReports = document.getElementById('quickLinkReports');
  const notesSection = document.getElementById('notesSection');
  const notesList = document.getElementById('notesList');
  const noteForm = document.getElementById('noteForm');
  const noteText = document.getElementById('noteText');

  // ---------- Custom dropdown (replaces native <select>) ----------
  // A plain <select>'s open option list is drawn entirely by the OS on
  // mobile (Android in particular), and that native popup ignores the
  // page's RTL direction for its own internal layout — the label ends up
  // on the left and the radio indicator on the right, backwards from how
  // Arabic reads, with no CSS able to reach inside and fix it. Building
  // the list ourselves as plain DOM is the only way to actually control
  // that layout. Turns a container element into a select-like widget:
  // `.value` get/set, a real 'change' event, `.setEntries()` for explicit
  // {value,label} pairs, and `.populate()` mirroring the old
  // populateSelect() helper this replaces (fixed list + placeholder + an
  // older free-text value preserved as an extra option).
  function makeCustomSelect(id) {
    const root = document.getElementById(id);
    root.classList.add('custom-select');
    root.innerHTML = '';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    const valueSpan = document.createElement('span');
    valueSpan.className = 'custom-select-value';
    const arrow = document.createElement('span');
    arrow.className = 'custom-select-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    trigger.appendChild(valueSpan);
    trigger.appendChild(arrow);
    root.appendChild(trigger);

    const optionsList = document.createElement('div');
    optionsList.className = 'custom-select-options';
    optionsList.hidden = true;
    root.appendChild(optionsList);

    let entries = []; // [{ value, label, disabled }]
    let internalValue = '';

    function renderOptions() {
      optionsList.innerHTML = '';
      entries.forEach(entry => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'custom-select-option';
        if (entry.disabled) opt.classList.add('placeholder-option');
        if (entry.value === internalValue) opt.classList.add('active');
        opt.disabled = !!entry.disabled;

        const label = document.createElement('span');
        label.className = 'custom-select-option-label';
        label.textContent = entry.label;
        const radio = document.createElement('span');
        radio.className = 'custom-select-option-radio';
        opt.appendChild(label);
        opt.appendChild(radio);

        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          setValue(entry.value);
          closeList();
        });
        optionsList.appendChild(opt);
      });
    }

    // shortLabel (falling back to the full label when absent) is what the
    // closed box shows — for الحصة, that's the period name without its
    // time range, so the box never wraps to two lines on a narrow phone
    // regardless of exact pixel width. The open list below always shows
    // the full label, where each option gets its own row to spread into.
    function updateTriggerLabel() {
      const entry = entries.find(e => e.value === internalValue);
      valueSpan.textContent = entry ? (entry.shortLabel || entry.label) : '';
      valueSpan.classList.toggle('placeholder', !entry || !!entry.disabled);
    }

    function setValue(v, opts) {
      internalValue = String(v);
      updateTriggerLabel();
      renderOptions();
      if (!opts || !opts.silent) root.dispatchEvent(new Event('change'));
    }

    function closeList() {
      optionsList.hidden = true;
      root.classList.remove('open');
    }
    root._closeCustomSelect = closeList;

    function openList() {
      document.querySelectorAll('.custom-select.open').forEach(el => {
        if (el !== root) el._closeCustomSelect();
      });
      // Positioned relative to the viewport (not the trigger) so the
      // modal's own overflow:auto scrolling can never clip the popup —
      // the room list alone can run past 20 options.
      const rect = trigger.getBoundingClientRect();
      optionsList.style.top = `${rect.bottom + 4}px`;
      optionsList.style.left = `${rect.left}px`;
      optionsList.style.width = `${rect.width}px`;
      const available = window.innerHeight - rect.bottom - 16;
      optionsList.style.maxHeight = `${Math.max(120, Math.min(260, available))}px`;
      optionsList.hidden = false;
      root.classList.add('open');
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (optionsList.hidden) openList(); else closeList();
    });

    Object.defineProperty(root, 'value', {
      get() { return internalValue; },
      set(v) { setValue(v, { silent: true }); },
    });

    // Generic {value,label} form — used for day/period, whose label text
    // differs from the stored value.
    root.setEntries = function (newEntries, currentValue) {
      entries = newEntries;
      internalValue = currentValue !== undefined && currentValue !== null
        ? String(currentValue)
        : (entries[0] ? entries[0].value : '');
      updateTriggerLabel();
      renderOptions();
    };

    // Mirrors the old populateSelect(): a flat list of values doubling as
    // their own labels, plus a leading placeholder. wrapBidi should only
    // be true for values mixing digits with Arabic letters (room codes
    // like "12 ع 4") — applying the LTR override to plain Arabic text
    // (subject names) scrambles their letter order.
    root.populate = function (options, currentValue, placeholderLabel, placeholderDisabled, wrapBidi) {
      const values = [...options];
      if (currentValue && !values.includes(currentValue)) values.unshift(currentValue);
      const optionEntries = values.map(v => ({ value: v, label: wrapBidi ? isolateLTR(v) : v, disabled: false }));
      const placeholderEntry = { value: '', label: placeholderLabel, disabled: !!placeholderDisabled };
      root.setEntries([placeholderEntry, ...optionEntries], currentValue || '');
    };

    return root;
  }

  document.addEventListener('click', (e) => {
    document.querySelectorAll('.custom-select.open').forEach(el => {
      if (!el.contains(e.target)) el._closeCustomSelect();
    });
  });
  // A stale-positioned popup left open through a scroll/resize would no
  // longer line up with its trigger — simplest correct fix is to close it,
  // same as most native pickers do when the page moves under them.
  window.addEventListener('resize', () => {
    document.querySelectorAll('.custom-select.open').forEach(el => el._closeCustomSelect());
  });
  // Capture phase is needed so this also sees the modal's own body
  // scrolling (the trigger moving under a now-stale fixed popup) — but
  // that also means it sees an open list's OWN internal overflow-y:auto
  // scroll (touch-dragging through a long room list), since 'scroll'
  // doesn't bubble but capture still reaches descendants either way.
  // Closing on that would slam the list shut on every scroll gesture, so
  // scrolling inside a list's own options must not count.
  modal.addEventListener('scroll', (e) => {
    if (e.target.closest && e.target.closest('.custom-select-options')) return;
    document.querySelectorAll('.custom-select.open').forEach(el => el._closeCustomSelect());
  }, true);

  makeCustomSelect('subject');
  makeCustomSelect('room');
  makeCustomSelect('day');
  makeCustomSelect('period');

  daySelect.setEntries(DAYS.map(d => ({ value: String(d.key), label: d.label })));
  periodSelect.setEntries(CLASS_PERIODS.map(p => ({
    value: String(p.key),
    label: `${p.label} (${formatRange(to12(p.start), to12(p.end))})`,
    shortLabel: p.label,
  })));

  // Re-filters the room list whenever the subject changes, so only صفوف
  // valid for that subject are offered. Keeps the current room selected
  // if it's still valid for the new subject; clears it otherwise.
  subjectSelect.addEventListener('change', () => {
    const validRooms = roomsForSubject(subjectSelect.value);
    const roomToKeep = validRooms.includes(roomSelect.value) ? roomSelect.value : '';
    roomSelect.populate(validRooms, roomToKeep, '— غير معيّن —', false, true);
  });

  let openedSnapshot = '';
  function formSnapshot() {
    return [subjectSelect.value, roomSelect.value, daySelect.value, periodSelect.value].join('|');
  }

  function openModal() {
    modal.hidden = false;
    openedSnapshot = formSnapshot();
  }

  function closeModal() {
    modal.hidden = true;
    classForm.reset();
    editingId = null;
  }

  // Used by the "discard" paths (X, cancel, backdrop click) — unlike a
  // successful save or delete, these throw away whatever's in the form,
  // so they check for unsaved edits first. Submit/delete call closeModal()
  // directly since their change is already committed.
  function closeModalIfConfirmed() {
    if (formSnapshot() !== openedSnapshot) {
      if (!confirm('لديك تعديلات على الحصة لم تُحفظ. إذا أغلقت الآن، ستُفقد هذه التعديلات. هل تريد المتابعة؟')) return;
    }
    closeModal();
  }

  function openAddModal(dayKey, periodKey) {
    editingId = null;
    modalTitle.textContent = 'إضافة حصة';
    deleteBtn.hidden = true;
    quickLinks.hidden = true;
    notesSection.hidden = true;
    classForm.reset();
    document.getElementById('classId').value = '';
    subjectSelect.populate(SUBJECTS, '', 'اختر المادة', true);
    roomSelect.populate(roomsForSubject(''), '', '— غير معيّن —', false, true);
    daySelect.value = dayKey;
    periodSelect.value = periodKey;
    openModal();
  }

  function openEditModal(id) {
    const c = classes.find(x => x.id === id);
    if (!c) return;
    editingId = id;
    modalTitle.textContent = 'تعديل الحصة';
    deleteBtn.hidden = false;
    notesSection.hidden = false;

    // Roster/report pages key everything off this exact room string, but
    // that link is invisible in the UI otherwise — these jump straight to
    // this class's roster/report instead of making the teacher navigate
    // and find it manually. Only meaningful once a room is actually set.
    const room = (c.room || '').trim();
    if (room) {
      quickLinks.hidden = false;
      const encoded = encodeURIComponent(room);
      quickLinkStudents.href = `students.html?class=${encoded}`;
      quickLinkReports.href = `reports.html?class=${encoded}`;
    } else {
      quickLinks.hidden = true;
    }

    document.getElementById('classId').value = c.id;
    subjectSelect.populate(SUBJECTS, c.subject, 'اختر المادة', true);
    roomSelect.populate(roomsForSubject(c.subject), c.room || '', '— غير معيّن —', false, true);
    daySelect.value = c.day;
    periodSelect.value = c.periodKey;

    renderNotes(c);
    openModal();
  }

  function renderNotes(c) {
    notesList.innerHTML = '';
    (c.notes || []).forEach(note => {
      const li = document.createElement('li');
      if (note.done) li.classList.add('done');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!note.done;
      checkbox.addEventListener('change', () => {
        note.done = checkbox.checked;
        saveClasses();
        li.classList.toggle('done', note.done);
      });

      const text = document.createElement('span');
      text.className = 'note-text';
      text.textContent = note.text;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'note-remove';
      remove.innerHTML = '&times;';
      remove.addEventListener('click', () => {
        c.notes = c.notes.filter(n => n.id !== note.id);
        saveClasses();
        renderNotes(c);
        renderGrid();
      });

      li.appendChild(checkbox);
      li.appendChild(text);
      li.appendChild(remove);
      notesList.appendChild(li);
    });
  }

  // ---------- Form handlers ----------
  document.getElementById('addClassBtn').addEventListener('click', () => {
    openAddModal(DAYS[0].key, CLASS_PERIODS[0].key);
  });
  document.getElementById('closeModalBtn').addEventListener('click', closeModalIfConfirmed);
  document.getElementById('cancelBtn').addEventListener('click', closeModalIfConfirmed);
  // Clicking the backdrop no longer closes the modal — only the explicit
  // close/cancel buttons do, so a stray tap outside can't discard a class.

  classForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const subject = subjectSelect.value.trim();
    const room = roomSelect.value.trim();
    const day = Number(daySelect.value);
    const periodKey = isNaN(Number(periodSelect.value)) ? periodSelect.value : Number(periodSelect.value);

    // The subject dropdown used to be a native <select required>, which
    // blocked submission on its own — now that it's a plain div, this
    // replaces that check explicitly.
    if (!subject) {
      alert('اختر المادة أولًا.');
      return;
    }

    const conflict = findClass(day, periodKey);
    if (conflict && conflict.id !== editingId) {
      alert('هناك حصة أخرى في هذا الوقت. عدّل تلك الحصة أو اختر وقتًا آخر.');
      return;
    }

    if (editingId) {
      const c = classes.find(x => x.id === editingId);
      Object.assign(c, { subject, room, day, periodKey });
    } else {
      classes.push({
        id: uid(),
        subject, room, day, periodKey,
        notes: [],
      });
    }

    saveClasses();
    renderGrid();
    closeModal();
  });

  deleteBtn.addEventListener('click', () => {
    if (!editingId) return;
    if (!confirm('حذف هذه الحصة؟ سيتم حذف ملاحظاتها أيضًا.')) return;
    classes = classes.filter(c => c.id !== editingId);
    saveClasses();
    renderGrid();
    closeModal();
  });

  noteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!editingId) return;
    const c = classes.find(x => x.id === editingId);
    if (!c) return;
    const text = noteText.value.trim();
    if (!text) return;
    c.notes = c.notes || [];
    c.notes.push({ id: uid(), text, done: false });
    saveClasses();
    renderNotes(c);
    renderGrid();
    noteText.value = '';
  });

  // ---------- Export / Import ----------
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(classes, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `schedule-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('Invalid format');
        if (classes.length > 0 && !confirm('سيؤدي الاستيراد إلى استبدال الجدول الحالي. هل تريد المتابعة؟')) {
          importFile.value = '';
          return;
        }
        classes = data;
        saveClasses();
        renderGrid();
      } catch (err) {
        alert('تعذّرت قراءة هذا الملف — تأكد من أنه نسخة احتياطية صادرة من هذا التطبيق.');
      } finally {
        importFile.value = '';
      }
    };
    reader.readAsText(file);
  });

  // ---------- Full backup (schedule + rosters + attendance + reports) ----------
  // The schedule/roster export above only ever covered their own page's
  // data — attendance and reports had no backup at all, so a lost or
  // reset device meant losing them for good. This bundles all four
  // localStorage stores into one file.
  const FULL_BACKUP_KEYS = {
    schedule: STORAGE_KEY,
    students: 'schedule_app_students_v1',
    attendance: 'schedule_app_attendance_v1',
    reports: 'schedule_app_reports_v1',
  };

  document.getElementById('fullBackupExportBtn').addEventListener('click', () => {
    const bundle = { exportedAt: new Date().toISOString(), version: 1, data: {} };
    Object.entries(FULL_BACKUP_KEYS).forEach(([name, key]) => {
      const raw = localStorage.getItem(key);
      bundle.data[name] = raw ? JSON.parse(raw) : null;
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `نسخة-شاملة-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const fullBackupImportFile = document.getElementById('fullBackupImportFile');
  document.getElementById('fullBackupImportBtn').addEventListener('click', () => fullBackupImportFile.click());
  fullBackupImportFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bundle = JSON.parse(reader.result);
        if (!bundle || typeof bundle.data !== 'object') throw new Error('Invalid format');

        const hasExistingData = Object.values(FULL_BACKUP_KEYS).some(key => localStorage.getItem(key));
        if (hasExistingData && !confirm(
          'سيؤدي الاستيراد إلى استبدال كل البيانات الحالية — الجدول، قوائم الفصول، الحضور، والتقارير. هل تريد المتابعة؟'
        )) {
          fullBackupImportFile.value = '';
          return;
        }

        Object.entries(FULL_BACKUP_KEYS).forEach(([name, key]) => {
          if (bundle.data[name] !== undefined && bundle.data[name] !== null) {
            localStorage.setItem(key, JSON.stringify(bundle.data[name]));
          }
        });

        alert('تم استعادة النسخة الشاملة بنجاح. سيُعاد تحميل الصفحة الآن.');
        location.reload();
      } catch (err) {
        alert('تعذّرت قراءة هذا الملف — تأكد من أنه نسخة احتياطية شاملة صادرة من هذا التطبيق.');
      } finally {
        fullBackupImportFile.value = '';
      }
    };
    reader.readAsText(file);
  });

  // ---------- Export to Google Calendar (.ics) ----------
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function escapeICS(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function formatICSDate(date) {
    return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
      `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
  }

  // Next calendar date (today or later) that falls on the given weekday
  // (0 = Sunday, matching Date#getDay and our DAYS keys).
  function nextDateForWeekday(targetDay) {
    const today = new Date();
    const diff = (targetDay - today.getDay() + 7) % 7;
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
  }

  // Combines a calendar date with a "H:MM" local school time and returns
  // the equivalent UTC instant.
  function icsDateTime(anchorDate, timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return new Date(Date.UTC(
      anchorDate.getFullYear(),
      anchorDate.getMonth(),
      anchorDate.getDate(),
      h - SCHOOL_UTC_OFFSET_HOURS,
      m
    ));
  }

  function buildICS() {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Schedule App//AR', 'CALSCALE:GREGORIAN'];
    const stamp = formatICSDate(new Date());

    classes.forEach(c => {
      const period = CLASS_PERIODS.find(p => p.key === c.periodKey);
      if (!period) return;

      const anchor = nextDateForWeekday(c.day);
      const start = icsDateTime(anchor, period.start);
      const end = icsDateTime(anchor, period.end);
      const notes = (c.notes || []).map(n => `${n.done ? '✓' : '-'} ${n.text}`).join('\n');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${c.id}@schedule-app`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART:${formatICSDate(start)}`);
      lines.push(`DTEND:${formatICSDate(end)}`);
      lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAY_CODES[c.day]}`);
      lines.push(`SUMMARY:${escapeICS(c.subject)}`);
      if (c.room) lines.push(`LOCATION:${escapeICS(c.room)}`);
      if (notes) lines.push(`DESCRIPTION:${escapeICS(notes)}`);
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeICS(c.subject)} بعد 10 دقائق`);
      lines.push('TRIGGER:-PT10M');
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  document.getElementById('exportCalendarBtn').addEventListener('click', () => {
    if (classes.length === 0) {
      alert('لا توجد حصص مضافة بعد.');
      return;
    }
    const blob = new Blob([buildICS()], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'دفتري.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    alert('تم تنزيل ملف التقويم. افتح تطبيق Google Calendar من الحاسوب ← الإعدادات (أيقونة الترس) ← استيراد وتصدير ← استيراد، ثم اختر هذا الملف.\n\nملاحظة: هذا تصدير لمرة واحدة فقط — أي تعديل لاحق على الجدول يتطلب تصديرًا واستيرادًا من جديد.');
  });

  // ---------- Init ----------
  saveClasses(); // persist seed data on first run so it's there on next load too
  renderGrid();

  // Test-drive button (feature 3, not yet wired to the schedule): fires
  // one sample notification immediately so you can see/feel what it looks
  // like on your actual phone before we decide whether to build the real
  // "10 minutes before each class" version. IMPORTANT limitation to judge
  // it against: this only works while the app is open (a tab, or — on
  // iOS specifically — opened from the Home Screen icon, not a Safari
  // tab); there's no free background server to wake a fully-closed app.
  const testNotifBtn = document.getElementById('testNotifBtn');
  if (testNotifBtn && 'Notification' in window) {
    testNotifBtn.addEventListener('click', async () => {
      if (Notification.permission === 'denied') {
        alert('الإشعارات محظورة من إعدادات المتصفح لهذا الموقع. يجب السماح بها يدويًا من إعدادات المتصفح أولًا.');
        return;
      }
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }
      if (permission !== 'granted') {
        alert('لم توافق على الإشعارات. جرّب الزر مرة أخرى ووافق من نافذة المتصفح.');
        return;
      }
      const options = {
        body: 'تبدأ بعد 10 دقائق — 12 د 1',
        icon: 'assets/icons/icon-192.png',
      };
      try {
        // On mobile (and any page controlled by a service worker), the
        // plain `new Notification()` constructor is disallowed and throws
        // silently — it has to go through the service worker registration
        // instead. This works on both desktop and mobile.
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification('الفلسفة', options);
        } else {
          new Notification('الفلسفة', options);
        }
      } catch (err) {
        console.error('Notification failed', err);
        alert('تعذّر عرض الإشعار على هذا الجهاز أو المتصفح. تأكد من فتح التطبيق من أيقونته على الشاشة الرئيسية إذا كنت تستخدم آيفون.');
      }
    });
  } else if (testNotifBtn) {
    testNotifBtn.title = 'الإشعارات غير مدعومة في هذا المتصفح';
    testNotifBtn.disabled = true;
  }

  // ---------- More-options menu ----------
  // The rarely-used utility buttons (backup/restore, calendar export,
  // force update, test notification) used to crowd the topbar as
  // individual buttons — collapsed here behind one gear icon instead.
  const moreMenuBtn = document.getElementById('moreMenuBtn');
  const moreMenu = document.getElementById('moreMenu');
  if (moreMenuBtn && moreMenu) {
    // The topbar wraps onto several lines depending on screen width, so
    // the gear button can land anywhere in the row — position is computed
    // here and clamped to the viewport instead of assumed from a fixed
    // corner in CSS.
    function openMoreMenu() {
      const btnRect = moreMenuBtn.getBoundingClientRect();
      moreMenu.style.top = `${btnRect.bottom + 6}px`;
      moreMenu.style.left = `${btnRect.right}px`;
      moreMenu.hidden = false;
      const menuWidth = moreMenu.offsetWidth;
      const maxLeft = window.innerWidth - 8 - menuWidth;
      const left = Math.max(8, Math.min(btnRect.right - menuWidth, maxLeft));
      moreMenu.style.left = `${left}px`;
    }
    moreMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (moreMenu.hidden) openMoreMenu();
      else moreMenu.hidden = true;
    });
    moreMenu.addEventListener('click', (e) => {
      if (e.target.closest('button')) moreMenu.hidden = true;
    });
    // Capture phase + stop/prevent so a click outside the menu ONLY closes
    // it — without this, the click still reaches (and activates) whatever
    // page element sits underneath, since bubble-phase listeners fire
    // after the target's own handlers already ran.
    document.addEventListener('click', (e) => {
      if (e.isTrusted && !moreMenu.hidden && !moreMenu.contains(e.target) && e.target !== moreMenuBtn) {
        moreMenu.hidden = true;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
    window.addEventListener('resize', () => { moreMenu.hidden = true; });
  }

  // Clears only the cached app files (service worker + Cache Storage) so a
  // fresh version can take over — never touches localStorage, so the
  // schedule/roster/attendance/report data stays exactly as it was.
  const forceUpdateBtn = document.getElementById('forceUpdateBtn');
  if (forceUpdateBtn) {
    forceUpdateBtn.addEventListener('click', async () => {
      forceUpdateBtn.disabled = true;
      forceUpdateBtn.textContent = 'جارٍ التحديث…';
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        // Clearing the service worker's own Cache Storage above isn't
        // enough by itself — the browser's plain HTTP cache can still
        // consider assets/app.js etc. "fresh" and serve them straight
        // from disk on reload without even asking the network. Force a
        // real network fetch for every script/stylesheet this page
        // loads so the HTTP cache holds the current bytes before reload.
        const assetUrls = Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'))
          .map(el => el.src || el.href)
          .filter(Boolean);
        await Promise.all(assetUrls.map(url => fetch(url, { cache: 'reload' }).catch(() => {})));
      } finally {
        location.reload();
      }
    });
  }

  // ---------- Teacher settings (اسم المعلم وقسمه العلمي) ----------
  const teacherSettingsBtn = document.getElementById('teacherSettingsBtn');
  const teacherSettingsModal = document.getElementById('teacherSettingsModal');
  const teacherSettingsForm = document.getElementById('teacherSettingsForm');
  const teacherNameInput = document.getElementById('teacherNameInput');
  const closeTeacherSettingsModalBtn = document.getElementById('closeTeacherSettingsModalBtn');
  const cancelTeacherSettingsBtn = document.getElementById('cancelTeacherSettingsBtn');
  const teacherDepartmentSelect = makeCustomSelect('teacherDepartment');

  let teacherSettingsOpenedSnapshot = null;

  function openTeacherSettingsModal() {
    teacherNameInput.value = localStorage.getItem(TEACHER_NAME_KEY) || '';
    teacherDepartmentSelect.populate(DEPARTMENTS, localStorage.getItem(TEACHER_DEPARTMENT_KEY) || '', 'اختر القسم', true, false);
    teacherSettingsModal.hidden = false;
    teacherSettingsOpenedSnapshot = `${teacherNameInput.value} ${teacherDepartmentSelect.value}`;
  }

  function closeTeacherSettingsModal() {
    teacherSettingsModal.hidden = true;
  }

  function closeTeacherSettingsModalIfConfirmed() {
    const current = `${teacherNameInput.value} ${teacherDepartmentSelect.value}`;
    if (current !== teacherSettingsOpenedSnapshot) {
      if (!confirm('لديك تعديل لم يُحفظ. إذا أغلقت الآن، سيُفقد هذا التعديل. هل تريد المتابعة؟')) return;
    }
    closeTeacherSettingsModal();
  }

  if (teacherSettingsBtn) teacherSettingsBtn.addEventListener('click', openTeacherSettingsModal);
  if (closeTeacherSettingsModalBtn) closeTeacherSettingsModalBtn.addEventListener('click', closeTeacherSettingsModalIfConfirmed);
  if (cancelTeacherSettingsBtn) cancelTeacherSettingsBtn.addEventListener('click', closeTeacherSettingsModalIfConfirmed);

  if (teacherSettingsForm) {
    teacherSettingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      localStorage.setItem(TEACHER_NAME_KEY, teacherNameInput.value.trim());
      localStorage.setItem(TEACHER_DEPARTMENT_KEY, teacherDepartmentSelect.value);
      closeTeacherSettingsModal();
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.error('SW registration failed', e));
  }
})();
