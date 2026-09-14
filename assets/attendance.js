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

  function render() {
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

    const header = document.createElement('div');
    header.className = 'session-card-header';
    header.innerHTML = `
      <span class="session-subject">${escapeHTML(session.subject)}</span>
      <span class="session-meta">${escapeHTML(isolateLTR(session.room || ''))}</span>
      <span class="session-meta">${escapeHTML(periodLabelFor(session.periodKey))}</span>
    `;
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'session-card-body';

    const className = (session.room || '').trim();
    const roster = students[className];

    if (!roster || roster.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'no-roster-msg';
      msg.innerHTML = className
        ? `ما فيه قائمة طلاب لفصل "${escapeHTML(isolateLTR(className))}" بعد. أضفها من <a href="students.html">صفحة قوائم الفصول</a>.`
        : `هذي الحصة ما فيها اسم فصل محدد (حقل الغرفة فاضي). عدّلها من <a href="index.html">صفحة الجدول</a> حتى تربطها بقائمة الطلاب.`;
      body.appendChild(msg);
    } else {
      ensureRecorded(dateISO, session.id, roster);
      roster.forEach(studentName => {
        body.appendChild(renderStudentRow(session, dateISO, studentName));
      });
    }

    card.appendChild(body);
    return card;
  }

  function renderStudentRow(session, dateISO, studentName) {
    const entry = getEntry(dateISO, session.id, studentName);
    const status = statusOf(entry);

    const row = document.createElement('div');
    row.className = 'student-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'student-row-name';
    nameEl.textContent = studentName;
    row.appendChild(nameEl);

    // Attendance
    const attGroup = document.createElement('div');
    attGroup.className = 'control-group';
    const ATT_STATUSES = [
      ['present', 'حاضر', 'active-present'],
      ['late', 'متأخر', 'active-late'],
      ['absent', 'غائب', 'active-absent'],
    ];
    ATT_STATUSES.forEach(([value, label, activeClass]) => {
      attGroup.appendChild(pillBtn(label, status === value, activeClass, () => {
        setEntry(dateISO, session.id, studentName, { status: value, present: undefined });
        render();
      }));
    });
    row.appendChild(attGroup);

    // Participation (right-to-left: ممتاز، متوسط، ضعيف)
    const partGroup = document.createElement('div');
    partGroup.className = 'control-group';
    const PART_LEVELS = [['excellent', 'ممتاز'], ['normal', 'متوسط'], ['none', 'ضعيف']];
    PART_LEVELS.forEach(([value, label]) => {
      partGroup.appendChild(pillBtn(label, entry.participation === value, 'active-participation', () => {
        const next = entry.participation === value ? null : value;
        setEntry(dateISO, session.id, studentName, { participation: next });
        render();
      }));
    });
    row.appendChild(partGroup);

    // Notebook: default assumption is that the student has it — the
    // button only marks the exception (didn't bring it), same pattern
    // as attendance defaulting to حاضر.
    const notebookGroup = document.createElement('div');
    notebookGroup.className = 'control-group';
    notebookGroup.appendChild(pillBtn('لم يحضر الدفتر', entry.notebookMissing === true, 'active-absent', () => {
      setEntry(dateISO, session.id, studentName, { notebookMissing: entry.notebookMissing === true ? null : true });
      render();
    }));
    row.appendChild(notebookGroup);

    // Behavior
    const behaviorGroup = document.createElement('div');
    behaviorGroup.className = 'control-group';
    behaviorGroup.appendChild(pillBtn('إيجابي', entry.behavior === 'positive', 'active-positive', () => {
      setEntry(dateISO, session.id, studentName, { behavior: entry.behavior === 'positive' ? null : 'positive' });
      render();
    }));
    behaviorGroup.appendChild(pillBtn('سلبي', entry.behavior === 'negative', 'active-negative', () => {
      setEntry(dateISO, session.id, studentName, { behavior: entry.behavior === 'negative' ? null : 'negative' });
      render();
    }));
    row.appendChild(behaviorGroup);

    const absBadge = document.createElement('span');
    absBadge.className = 'absence-badge';
    const presentN = countStatus(session.id, studentName, 'present');
    const lateN = countStatus(session.id, studentName, 'late');
    const absN = countStatus(session.id, studentName, 'absent');
    absBadge.textContent = `حضور: ${presentN} · تأخر: ${lateN} · غياب: ${absN}`;
    row.appendChild(absBadge);

    return row;
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.error('SW registration failed', e));
  }
})();
