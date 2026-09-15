(() => {
  'use strict';

  const SCHEDULE_KEY = 'schedule_app_classes_ar_v1';
  const STUDENTS_KEY = 'schedule_app_students_v1';
  const ATTENDANCE_KEY = 'schedule_app_attendance_v1';

  const DAYS = [
    { key: 0, label: 'الأحد' },
    { key: 1, label: 'الإثنين' },
    { key: 2, label: 'الثلاثاء' },
    { key: 3, label: 'الأربعاء' },
    { key: 4, label: 'الخميس' },
  ];

  // Must match assets/app.js's PERIODS (24-hour start/end for display only here).
  const PERIODS = [
    { type: 'class', key: 1, label: 'الحصة الأولى', start: '07:55', end: '08:40' },
    { type: 'class', key: 2, label: 'الحصة الثانية', start: '08:45', end: '09:30' },
    { type: 'class', key: 3, label: 'الحصة الثالثة', start: '09:35', end: '10:20' },
    { type: 'class', key: 4, label: 'الحصة الرابعة', start: '10:35', end: '11:20' },
    { type: 'class', key: 5, label: 'الحصة الخامسة', start: '11:25', end: '12:10' },
    { type: 'class', key: 6, label: 'الحصة السادسة', start: '12:20', end: '13:05' },
    { type: 'class', key: 7, label: 'الحصة السابعة', start: '13:10', end: '13:55' },
  ];

  function isolateLTR(text) {
    return `‭${text}‬`;
  }

  function to12(t) {
    const [h, m] = t.split(':').map(Number);
    const h12 = h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')}`;
  }

  function periodLabelFor(periodKey) {
    const p = PERIODS.find(x => x.key === periodKey);
    if (!p) return '';
    return `${p.label} (${isolateLTR(`${to12(p.start)} - ${to12(p.end)}`)})`;
  }

  // ---------- Data loading ----------
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error(`Failed to load ${key}`, e);
      return fallback;
    }
  }

  let scheduleClasses = loadJSON(SCHEDULE_KEY, []);
  let students = loadJSON(STUDENTS_KEY, {});
  let attendance = loadJSON(ATTENDANCE_KEY, {});

  function saveAttendance() {
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(attendance));
  }

  // ---------- Date helpers ----------
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function isoToDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function dateToISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function addDays(iso, delta) {
    const d = isoToDate(iso);
    d.setDate(d.getDate() + delta);
    return dateToISO(d);
  }

  // ---------- Attendance data helpers ----------
  function sessionKey(dateISO, classId) {
    return `${dateISO}::${classId}`;
  }

  function getEntry(dateISO, classId, studentName) {
    const sk = sessionKey(dateISO, classId);
    return (attendance[sk] && attendance[sk][studentName]) || {};
  }

  function setEntry(dateISO, classId, studentName, patch) {
    const sk = sessionKey(dateISO, classId);
    attendance[sk] = attendance[sk] || {};
    attendance[sk][studentName] = Object.assign({}, attendance[sk][studentName], patch);
    saveAttendance();
  }

  // Reads an entry's attendance status, translating the old boolean
  // `present` field (from before "متأخر" existed) into the new
  // 'present' | 'absent' | 'late' scheme so earlier data isn't lost.
  function statusOf(entry) {
    if (!entry) return undefined;
    if (entry.status) return entry.status;
    if (entry.present === false) return 'absent';
    if (entry.present === true) return 'present';
    return undefined;
  }

  // Makes sure every roster student for this session has an explicit
  // attendance status, defaulting new ones to "حاضر". Only for
  // today-or-earlier: attendance can't be taken for a day that hasn't
  // happened, so future dates are left unrecorded until they arrive.
  function ensureRecorded(dateISO, classId, rosterNames) {
    if (dateISO > todayISO()) return;
    const sk = sessionKey(dateISO, classId);
    attendance[sk] = attendance[sk] || {};
    let changed = false;
    rosterNames.forEach(name => {
      const entry = attendance[sk][name];
      if (!statusOf(entry)) {
        attendance[sk][name] = Object.assign({}, entry, { status: 'present' });
        changed = true;
      }
    });
    if (changed) saveAttendance();
  }

  function countStatus(classId, studentName, status) {
    const suffix = `::${classId}`;
    let count = 0;
    Object.keys(attendance).forEach(sk => {
      if (!sk.endsWith(suffix)) return;
      const entry = attendance[sk][studentName];
      if (statusOf(entry) === status) count++;
    });
    return count;
  }

  // ---------- Rendering ----------
  const datePicker = document.getElementById('datePicker');
  const dayLabel = document.getElementById('dayLabel');
  const sessionsContainer = document.getElementById('sessionsContainer');
  const noScheduleState = document.getElementById('noScheduleState');

  // Which sessions are expanded, by schedule id — collapsed by default,
  // remembered across date navigation (so "الفلسفة" stays open/closed as
  // you flip between different Sundays, say).
  const expandedSessions = new Set();

  // Every interaction re-renders the whole day from scratch, which would
  // otherwise reset the page (and each session table's horizontal scroll)
  // back to the top/start. Save both before rebuilding and restore after.
  function render() {
    const pageScrollY = window.scrollY;
    const tableScrolls = {};
    sessionsContainer.querySelectorAll('.attendance-table-wrap').forEach(el => {
      tableScrolls[el.dataset.sessionId] = el.scrollLeft;
    });

    renderInner();

    const restoreScroll = () => {
      sessionsContainer.querySelectorAll('.attendance-table-wrap').forEach(el => {
        const saved = tableScrolls[el.dataset.sessionId];
        if (saved !== undefined) el.scrollLeft = saved;
      });
      window.scrollTo(0, pageScrollY);
    };
    restoreScroll();
    requestAnimationFrame(restoreScroll);
  }

  function renderInner() {
    const dateISO = datePicker.value || todayISO();
    const weekday = isoToDate(dateISO).getDay();
    const dayInfo = DAYS.find(d => d.key === weekday);
    dayLabel.textContent = dayInfo ? dayInfo.label : '';

    sessionsContainer.innerHTML = '';

    if (!dayInfo) {
      noScheduleState.hidden = false;
      noScheduleState.textContent = 'ما فيه حصص بعطلة نهاية الأسبوع.';
      return;
    }

    const sessions = scheduleClasses
      .filter(c => c.day === weekday)
      .sort((a, b) => a.periodKey - b.periodKey);

    noScheduleState.hidden = sessions.length > 0;
    if (sessions.length === 0) {
      noScheduleState.textContent = 'ما فيه حصص مجدولة بهذا اليوم.';
      return;
    }

    sessions.forEach(session => {
      sessionsContainer.appendChild(renderSessionCard(session, dateISO));
    });
  }

  function renderSessionCard(session, dateISO) {
    const card = document.createElement('div');
    card.className = 'session-card';
    if (expandedSessions.has(session.id)) card.classList.add('open');

    const className = (session.room || '').trim();
    const roster = students[className];

    const header = document.createElement('div');
    header.className = 'session-card-header';
    header.addEventListener('click', () => {
      if (expandedSessions.has(session.id)) expandedSessions.delete(session.id);
      else expandedSessions.add(session.id);
      card.classList.toggle('open');
    });

    const chevron = document.createElement('span');
    chevron.className = 'session-chevron';
    chevron.textContent = '◀';
    header.appendChild(chevron);

    header.insertAdjacentHTML('beforeend', `
      <span class="session-subject">${escapeHTML(session.subject)}</span>
      <span class="session-meta">${escapeHTML(isolateLTR(session.room || ''))}</span>
      <span class="session-meta">${escapeHTML(periodLabelFor(session.periodKey))}</span>
    `);
    if (roster && roster.length > 0) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-ghost btn-small copy-absentees-btn';
      copyBtn.textContent = 'نسخ أسماء الغياب';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyAbsentees(session, dateISO, roster, copyBtn);
      });
      header.appendChild(copyBtn);
    }
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'session-card-body';

    if (!roster || roster.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'no-roster-msg';
      msg.innerHTML = className
        ? `ما فيه قائمة طلاب لفصل "${escapeHTML(isolateLTR(className))}" بعد. أضفها من <a href="students.html">صفحة قوائم الفصول</a>.`
        : `هذي الحصة ما فيها اسم فصل محدد (حقل الغرفة فاضي). عدّلها من <a href="index.html">صفحة الجدول</a> حتى تربطها بقائمة الطلاب.`;
      body.appendChild(msg);
    } else {
      ensureRecorded(dateISO, session.id, roster);

      const scrollWrap = document.createElement('div');
      scrollWrap.className = 'schedule-wrap attendance-table-wrap';
      scrollWrap.dataset.sessionId = session.id;
      const table = document.createElement('table');
      table.className = 'grid attendance-table';

      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['اسم الطالب', 'الغياب', 'المشاركة', 'الدفتر', 'السلوك', 'إحصائية الحضور والغياب'].forEach((label, i) => {
        const th = document.createElement('th');
        th.textContent = label;
        if (i === 0) th.className = 'period-col-header attendance-name-col';
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      roster.forEach(studentName => {
        tbody.appendChild(renderStudentRow(session, dateISO, studentName));
      });
      table.appendChild(tbody);

      scrollWrap.appendChild(table);
      body.appendChild(scrollWrap);
    }

    card.appendChild(body);
    return card;
  }

  // Builds the row once, then every click updates only that button's
  // class (and the stats text) in place — the table/scroll container is
  // never touched again, so there's nothing for a click to "jump" or
  // reset. (An earlier version called the full render() on every click,
  // which rebuilt the whole table and reset horizontal scroll on some
  // devices even with scroll-position save/restore.)
  function renderStudentRow(session, dateISO, studentName) {
    const entry = getEntry(dateISO, session.id, studentName);

    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'period-label attendance-name-col';
    nameTd.textContent = studentName;
    tr.appendChild(nameTd);

    const statsTd = document.createElement('td');
    statsTd.className = 'attendance-stats-cell';
    function updateStats() {
      const presentN = countStatus(session.id, studentName, 'present');
      const lateN = countStatus(session.id, studentName, 'late');
      const absN = countStatus(session.id, studentName, 'absent');
      statsTd.textContent = `حضور: ${presentN} · تأخر: ${lateN} · غياب: ${absN}`;
    }

    // Attendance (single-select among 3 — always exactly one active)
    const attTd = document.createElement('td');
    const attGroup = document.createElement('div');
    attGroup.className = 'control-group';
    const ATT_STATUSES = [
      ['present', 'حاضر', 'active-present'],
      ['late', 'متأخر', 'active-late'],
      ['absent', 'غائب', 'active-absent'],
    ];
    const attButtons = ATT_STATUSES.map(([value, label, activeClass]) => {
      const btn = pillBtn(label, statusOf(entry) === value, activeClass, () => {
        setEntry(dateISO, session.id, studentName, { status: value, present: undefined });
        attButtons.forEach(b => { b.btn.className = 'pill-btn' + (b.value === value ? ` ${b.activeClass}` : ''); });
        updateStats();
      });
      attGroup.appendChild(btn);
      return { value, activeClass, btn };
    });
    attTd.appendChild(attGroup);
    tr.appendChild(attTd);

    // Participation (right-to-left: ممتاز، متوسط، ضعيف — toggle: click
    // the active one again to unset)
    const partTd = document.createElement('td');
    const partGroup = document.createElement('div');
    partGroup.className = 'control-group';
    let currentParticipation = entry.participation || null;
    const PART_LEVELS = [['excellent', 'ممتاز'], ['normal', 'متوسط'], ['none', 'ضعيف']];
    const partButtons = PART_LEVELS.map(([value, label]) => {
      const btn = pillBtn(label, currentParticipation === value, 'active-participation', () => {
        currentParticipation = currentParticipation === value ? null : value;
        setEntry(dateISO, session.id, studentName, { participation: currentParticipation });
        partButtons.forEach(b => { b.btn.className = 'pill-btn' + (b.value === currentParticipation ? ' active-participation' : ''); });
      });
      partGroup.appendChild(btn);
      return { value, btn };
    });
    partTd.appendChild(partGroup);
    tr.appendChild(partTd);

    // Notebook: default assumption is that the student has it — the
    // button only marks the exception (didn't bring it), same pattern
    // as attendance defaulting to حاضر.
    const notebookTd = document.createElement('td');
    const notebookGroup = document.createElement('div');
    notebookGroup.className = 'control-group';
    let notebookMissing = entry.notebookMissing === true;
    const notebookBtn = pillBtn('لم يحضر الدفتر', notebookMissing, 'active-absent', () => {
      notebookMissing = !notebookMissing;
      setEntry(dateISO, session.id, studentName, { notebookMissing: notebookMissing ? true : null });
      notebookBtn.className = 'pill-btn' + (notebookMissing ? ' active-absent' : '');
    });
    notebookGroup.appendChild(notebookBtn);
    notebookTd.appendChild(notebookGroup);
    tr.appendChild(notebookTd);

    // Behavior (toggle: click the active one again to unset)
    const behaviorTd = document.createElement('td');
    const behaviorGroup = document.createElement('div');
    behaviorGroup.className = 'control-group';
    let currentBehavior = entry.behavior || null;
    const BEHAVIOR_OPTIONS = [['positive', 'إيجابي', 'active-positive'], ['negative', 'سلبي', 'active-negative']];
    const behaviorButtons = BEHAVIOR_OPTIONS.map(([value, label, activeClass]) => {
      const btn = pillBtn(label, currentBehavior === value, activeClass, () => {
        currentBehavior = currentBehavior === value ? null : value;
        setEntry(dateISO, session.id, studentName, { behavior: currentBehavior });
        behaviorButtons.forEach(b => { b.btn.className = 'pill-btn' + (b.value === currentBehavior ? ` ${b.activeClass}` : ''); });
      });
      behaviorGroup.appendChild(btn);
      return { value, activeClass, btn };
    });
    behaviorTd.appendChild(behaviorGroup);
    tr.appendChild(behaviorTd);

    updateStats();
    tr.appendChild(statsTd);

    return tr;
  }

  // Copies the absent students' names (one per line) to the clipboard so
  // they can be pasted straight into the school's own absence form.
  async function copyAbsentees(session, dateISO, roster, btn) {
    const absentees = roster.filter(name => statusOf(getEntry(dateISO, session.id, name)) === 'absent');

    if (absentees.length === 0) {
      alert('ما فيه طلاب غايبين بهذي الحصة اليوم.');
      return;
    }

    const text = absentees.join('\n');
    const originalLabel = btn.textContent;

    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = `✓ نُسخ (${absentees.length})`;
    } catch (e) {
      prompt('تعذّر النسخ التلقائي — انسخ الأسماء يدويًا من هنا:', text);
      return;
    }
    setTimeout(() => { btn.textContent = originalLabel; }, 1800);
  }

  function pillBtn(label, active, activeClass, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill-btn' + (active ? ` ${activeClass}` : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- Date controls ----------
  datePicker.value = todayISO();
  datePicker.addEventListener('change', render);

  document.getElementById('todayBtn').addEventListener('click', () => {
    datePicker.value = todayISO();
    render();
  });
  document.getElementById('prevDayBtn').addEventListener('click', () => {
    datePicker.value = addDays(datePicker.value || todayISO(), -1);
    render();
  });
  document.getElementById('nextDayBtn').addEventListener('click', () => {
    datePicker.value = addDays(datePicker.value || todayISO(), 1);
    render();
  });

  // ---------- Init ----------
  render();

  // Clears only the cached app files (service worker + Cache Storage) so a
  // fresh version can take over — never touches localStorage, so the
  // schedule/roster/attendance/report data stays exactly as it was.
  const forceUpdateBtn = document.getElementById('forceUpdateBtn');
  if (forceUpdateBtn) {
    forceUpdateBtn.addEventListener('click', async () => {
      forceUpdateBtn.disabled = true;
      forceUpdateBtn.textContent = 'جاري التحديث...';
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.error('SW registration failed', e));
  }
})();
