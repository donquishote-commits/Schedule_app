(() => {
  'use strict';

  const SCHEDULE_KEY = 'schedule_app_classes_ar_v1';
  const STUDENTS_KEY = 'schedule_app_students_v1';
  const ATTENDANCE_KEY = 'schedule_app_attendance_v1';
  const HOLIDAYS_KEY = 'schedule_app_holidays_v1';

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
  let holidays = new Set(loadJSON(HOLIDAYS_KEY, []));

  function saveAttendance() {
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(attendance));
  }

  function saveHolidays() {
    localStorage.setItem(HOLIDAYS_KEY, JSON.stringify([...holidays]));
  }

  function isHoliday(dateISO) {
    return holidays.has(dateISO);
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

  // ---------- Draft attendance (not written to storage until "حفظ الغياب") ----------
  // Nothing is committed to the `attendance` store the moment a session
  // card renders or a button is clicked anymore — only an explicit press
  // of that session's save button writes anything, so a stray tap while
  // scrolling can never silently record the wrong status. Each session's
  // in-progress edits live here instead, seeded from whatever was already
  // committed (so reopening a saved session still shows its real status),
  // keyed by dateISO+sessionId so different dates never mix drafts.
  const draftBySession = new Map();
  // Session keys (same "dateISO::sessionId" shape) with edits pending save
  // — used to warn before a date change or page close would discard them.
  const dirtySessions = new Set();

  function draftMapKey(dateISO, classId) {
    return sessionKey(dateISO, classId);
  }

  function getOrCreateDraft(dateISO, classId, rosterNames) {
    const key = draftMapKey(dateISO, classId);
    if (!draftBySession.has(key)) {
      const committed = attendance[sessionKey(dateISO, classId)] || {};
      const draft = {};
      rosterNames.forEach(name => {
        const entry = committed[name] || {};
        draft[name] = {
          status: statusOf(entry) || 'present',
          participation: entry.participation || null,
          notebookMissing: entry.notebookMissing === true,
          behavior: entry.behavior || null,
        };
      });
      draftBySession.set(key, draft);
    }
    return draftBySession.get(key);
  }

  // A session counts as already saved for this date only once every
  // roster student has a committed entry — matches what the old
  // ensureRecorded() considered "recorded".
  function isSessionSaved(dateISO, classId, rosterNames) {
    const committed = attendance[sessionKey(dateISO, classId)];
    if (!committed) return false;
    return rosterNames.every(name => statusOf(committed[name]) !== undefined);
  }

  // Writes the whole in-progress draft for this session into the real,
  // persisted store in one shot — a student never touched by the teacher
  // still defaults to "حاضر", same convenience as before, just deferred
  // until this explicit save instead of happening the instant the card
  // rendered.
  function saveSessionDraft(dateISO, classId, rosterNames) {
    const draft = getOrCreateDraft(dateISO, classId, rosterNames);
    const sk = sessionKey(dateISO, classId);
    attendance[sk] = attendance[sk] || {};
    rosterNames.forEach(name => {
      const d = draft[name];
      attendance[sk][name] = {
        status: d.status || 'present',
        participation: d.participation || null,
        notebookMissing: d.notebookMissing ? true : null,
        behavior: d.behavior || null,
      };
    });
    saveAttendance();
    dirtySessions.delete(draftMapKey(dateISO, classId));
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
  const daySummaryEl = document.getElementById('daySummary');
  const holidayStateEl = document.getElementById('holidayState');
  const holidayToggleBtn = document.getElementById('holidayToggleBtn');

  function updateHolidayToggleLabel(dateISO) {
    if (!holidayToggleBtn) return;
    holidayToggleBtn.textContent = isHoliday(dateISO) ? '🗓 إلغاء علامة العطلة الرسمية' : '🗓 وضع علامة عطلة رسمية';
  }

  // Attendance percentages for the selected day, across every session
  // scheduled that day — separate from renderInner's full rebuild so a
  // single attendance click can refresh just this small block instead of
  // re-rendering (and scroll-jumping) the whole page.
  function computeDaySummary(dateISO) {
    const weekday = isoToDate(dateISO).getDay();
    const sessions = scheduleClasses.filter(c => c.day === weekday);
    let present = 0, late = 0, absent = 0;
    sessions.forEach(session => {
      const className = (session.room || '').trim();
      const roster = students[className];
      if (!roster || roster.length === 0) return;
      const entries = attendance[sessionKey(dateISO, session.id)] || {};
      roster.forEach(name => {
        const status = statusOf(entries[name]);
        if (status === 'present') present++;
        else if (status === 'late') late++;
        else if (status === 'absent') absent++;
      });
    });
    const total = present + late + absent;
    return { present, late, absent, total };
  }

  function renderDaySummary(dateISO) {
    if (!daySummaryEl) return;
    const s = computeDaySummary(dateISO);
    if (s.total === 0) {
      daySummaryEl.hidden = true;
      daySummaryEl.innerHTML = '';
      return;
    }
    daySummaryEl.hidden = false;

    const pct = (n) => Math.round((n / s.total) * 100);
    daySummaryEl.innerHTML = '';
    [
      { value: `${pct(s.present)}%`, label: `حضور (${s.present})` },
      { value: `${pct(s.late)}%`, label: `تأخر (${s.late})` },
      { value: `${pct(s.absent)}%`, label: `غياب (${s.absent})` },
    ].forEach(t => {
      const tile = document.createElement('div');
      tile.className = 'day-summary-stat';
      const value = document.createElement('span');
      value.className = 'day-summary-value';
      value.textContent = t.value;
      const label = document.createElement('span');
      label.className = 'day-summary-label';
      label.textContent = t.label;
      tile.appendChild(value);
      tile.appendChild(label);
      daySummaryEl.appendChild(tile);
    });
  }

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

  // The date currently on screen — kept in sync at the end of every
  // successful render so a cancelled date-navigation (unsaved changes,
  // teacher backs out of the warning) can restore the picker to it.
  let currentRenderedDate = todayISO();

  function renderInner() {
    const dateISO = datePicker.value || todayISO();
    const weekday = isoToDate(dateISO).getDay();
    const dayInfo = DAYS.find(d => d.key === weekday);
    dayLabel.textContent = dayInfo ? dayInfo.label : '';
    updateHolidayToggleLabel(dateISO);

    if (isHoliday(dateISO)) {
      daySummaryEl.hidden = true;
      sessionsContainer.innerHTML = '';
      noScheduleState.hidden = true;
      holidayStateEl.hidden = false;
      holidayStateEl.textContent = 'هذا اليوم عطلة رسمية — لا تُسجَّل فيه بيانات حضور. اضغط على زر "إلغاء علامة العطلة الرسمية" أعلاه إذا وُضعت العلامة بالخطأ.';
      currentRenderedDate = dateISO;
      return;
    }
    holidayStateEl.hidden = true;

    renderDaySummary(dateISO);
    sessionsContainer.innerHTML = '';

    if (!dayInfo) {
      noScheduleState.hidden = false;
      noScheduleState.textContent = 'لا توجد حصص في عطلة نهاية الأسبوع.';
      currentRenderedDate = dateISO;
      return;
    }

    const sessions = scheduleClasses
      .filter(c => c.day === weekday)
      .sort((a, b) => a.periodKey - b.periodKey);

    noScheduleState.hidden = sessions.length > 0;
    if (sessions.length === 0) {
      noScheduleState.textContent = 'لا توجد حصص مجدولة في هذا اليوم.';
      currentRenderedDate = dateISO;
      return;
    }

    sessions.forEach(session => {
      sessionsContainer.appendChild(renderSessionCard(session, dateISO));
    });

    currentRenderedDate = dateISO;
  }

  function renderSessionCard(session, dateISO) {
    const card = document.createElement('div');
    card.className = 'session-card';
    if (expandedSessions.has(session.id)) card.classList.add('open');

    const className = (session.room || '').trim();
    const roster = students[className];
    const draft = roster && roster.length > 0 ? getOrCreateDraft(dateISO, session.id, roster) : null;

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
        copyAbsentees(roster, draft, copyBtn);
      });
      header.appendChild(copyBtn);

      const toolsBtn = document.createElement('button');
      toolsBtn.type = 'button';
      toolsBtn.className = 'btn btn-ghost btn-small';
      toolsBtn.textContent = '🎲 أدوات الحصة';
      toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openToolsModal(session, roster, draft);
      });
      header.appendChild(toolsBtn);
    }
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'session-card-body';

    if (!roster || roster.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'no-roster-msg';
      msg.innerHTML = className
        ? `لا توجد قائمة طلاب لفصل "${escapeHTML(isolateLTR(className))}" بعد. أضفها من <a href="students.html">صفحة قوائم الفصول</a>.`
        : `لا يوجد اسم فصل محدد لهذه الحصة (حقل الغرفة فارغ). عدّلها من <a href="index.html">صفحة الجدول</a> لربطها بقائمة الطلاب.`;
      body.appendChild(msg);
    } else {
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
        tbody.appendChild(renderStudentRow(session.id, studentName, draft, () => setSessionDirty(true)));
      });
      table.appendChild(tbody);

      scrollWrap.appendChild(table);
      body.appendChild(scrollWrap);

      // Nothing above is written to storage until this is pressed — every
      // click just edited the in-memory draft, so a stray tap while
      // scrolling never silently records the wrong status.
      const saveRow = document.createElement('div');
      saveRow.className = 'attendance-save-row';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn-primary';
      const saveStatus = document.createElement('span');
      saveStatus.className = 'attendance-save-status';

      let dirty = !isSessionSaved(dateISO, session.id, roster);
      function setSessionDirty(value) {
        dirty = value;
        updateSaveUI();
      }
      function updateSaveUI() {
        const dmKey = draftMapKey(dateISO, session.id);
        if (dirty) {
          saveBtn.textContent = '💾 حفظ الغياب';
          saveBtn.disabled = false;
          saveStatus.textContent = 'لم يُحفظ بعد';
          saveStatus.className = 'attendance-save-status unsaved';
          dirtySessions.add(dmKey);
        } else {
          saveBtn.textContent = '✓ تم الحفظ';
          saveBtn.disabled = true;
          saveStatus.textContent = '';
          saveStatus.className = 'attendance-save-status';
          dirtySessions.delete(dmKey);
        }
      }
      updateSaveUI();

      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveSessionDraft(dateISO, session.id, roster);
        setSessionDirty(false);
        renderDaySummary(dateISO);
      });

      saveRow.appendChild(saveBtn);
      saveRow.appendChild(saveStatus);
      body.appendChild(saveRow);
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
  function renderStudentRow(classId, studentName, draft, onChange) {
    const entry = draft[studentName];

    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'period-label attendance-name-col';
    nameTd.textContent = studentName;
    tr.appendChild(nameTd);

    const statsTd = document.createElement('td');
    statsTd.className = 'attendance-stats-cell';
    function updateStats() {
      const presentN = countStatus(classId, studentName, 'present');
      const lateN = countStatus(classId, studentName, 'late');
      const absN = countStatus(classId, studentName, 'absent');
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
      const btn = pillBtn(label, entry.status === value, activeClass, () => {
        entry.status = value;
        attButtons.forEach(b => { b.btn.className = 'pill-btn' + (b.value === value ? ` ${b.activeClass}` : ''); });
        onChange();
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
    const PART_LEVELS = [['excellent', 'ممتاز'], ['normal', 'متوسط'], ['none', 'ضعيف']];
    const partButtons = PART_LEVELS.map(([value, label]) => {
      const btn = pillBtn(label, entry.participation === value, 'active-participation', () => {
        entry.participation = entry.participation === value ? null : value;
        partButtons.forEach(b => { b.btn.className = 'pill-btn' + (b.value === entry.participation ? ' active-participation' : ''); });
        onChange();
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
    const notebookBtn = pillBtn('لم يحضر الدفتر', entry.notebookMissing === true, 'active-absent', () => {
      entry.notebookMissing = !entry.notebookMissing;
      notebookBtn.className = 'pill-btn' + (entry.notebookMissing ? ' active-absent' : '');
      onChange();
    });
    notebookGroup.appendChild(notebookBtn);
    notebookTd.appendChild(notebookGroup);
    tr.appendChild(notebookTd);

    // Behavior (toggle: click the active one again to unset)
    const behaviorTd = document.createElement('td');
    const behaviorGroup = document.createElement('div');
    behaviorGroup.className = 'control-group';
    const BEHAVIOR_OPTIONS = [['positive', 'إيجابي', 'active-positive'], ['negative', 'سلبي', 'active-negative']];
    const behaviorButtons = BEHAVIOR_OPTIONS.map(([value, label, activeClass]) => {
      const btn = pillBtn(label, entry.behavior === value, activeClass, () => {
        entry.behavior = entry.behavior === value ? null : value;
        behaviorButtons.forEach(b => { b.btn.className = 'pill-btn' + (b.value === entry.behavior ? ` ${b.activeClass}` : ''); });
        onChange();
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
  // they can be pasted straight into the school's own absence form. Reads
  // the in-progress draft, not the committed store, so it reflects what's
  // on screen right now even before "حفظ الغياب" is pressed.
  async function copyAbsentees(roster, draft, btn) {
    const absentees = roster.filter(name => draft[name].status === 'absent');

    if (absentees.length === 0) {
      alert('لا يوجد طلاب غائبون في هذه الحصة اليوم.');
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

  // ---------- In-class tools (من الدور؟ / تقسيم مجموعات) ----------
  // Scoped to a single session/class every time it's opened, so there's
  // no way for one class's roster to leak into another's tool state.
  const toolsModal = document.getElementById('toolsModal');
  const toolsModalTitle = document.getElementById('toolsModalTitle');
  const toolsModalBody = document.getElementById('toolsModalBody');
  const closeToolsModalBtn = document.getElementById('closeToolsModalBtn');

  function shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ----- مؤقت نشاط -----
  // One shared timer for the whole page (a teacher only runs one activity
  // at a time), kept in module state rather than rebuilt per modal open so
  // it keeps counting down even if the teacher closes the panel to check
  // something else — only من الدور؟/تقسيم مجموعات reset on every open,
  // since those are meant to start a fresh round each time.
  const pageTitle = document.title;
  let timerSeconds = 5 * 60;
  let timerInterval = null;
  let timerRunning = false;
  let timerDisplayEl = null;
  let timerStatusEl = null;

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      osc.onended = () => ctx.close();
    } catch (e) { /* no audio support — visual/title change below still shows it's done */ }
  }

  function updateTimerDisplay() {
    if (timerDisplayEl) timerDisplayEl.textContent = formatTime(timerSeconds);
  }

  // Keeps the screen from auto-locking while the timer runs — a locked
  // screen freezes this page's JS just like switching away from it does,
  // so without this the countdown (and its alert sound) would silently
  // stall the moment the phone dims. Only covers the screen-lock case:
  // the browser force-releases this the instant the tab itself goes to
  // the background (switching apps/tabs), which needs a server-backed
  // push notification to work around — out of scope for this app.
  let wakeLock = null;
  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* not supported, or permission denied — timer still runs as long as the screen stays on */ }
  }
  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && timerRunning && !wakeLock) acquireWakeLock();
  });

  function timerDone() {
    timerRunning = false;
    clearInterval(timerInterval);
    releaseWakeLock();
    playBeep();
    if (timerDisplayEl) timerDisplayEl.classList.add('tools-timer-done');
    if (timerStatusEl) timerStatusEl.textContent = '⏰ انتهى الوقت!';
    if (document.hidden) {
      document.title = '⏰ انتهى الوقت! — ' + pageTitle;
      const restoreTitle = () => { document.title = pageTitle; window.removeEventListener('focus', restoreTitle); };
      window.addEventListener('focus', restoreTitle);
    }
  }

  function startTimer() {
    if (timerRunning || timerSeconds <= 0) return;
    timerRunning = true;
    if (timerStatusEl) timerStatusEl.textContent = '';
    acquireWakeLock();
    timerInterval = setInterval(() => {
      timerSeconds--;
      updateTimerDisplay();
      if (timerSeconds <= 0) timerDone();
    }, 1000);
  }

  function pauseTimer() {
    timerRunning = false;
    clearInterval(timerInterval);
    releaseWakeLock();
  }

  function resetTimer(minutes) {
    pauseTimer();
    timerSeconds = minutes * 60;
    if (timerDisplayEl) timerDisplayEl.classList.remove('tools-timer-done');
    if (timerStatusEl) timerStatusEl.textContent = '';
    updateTimerDisplay();
  }

  function renderTimerSection() {
    const timerSection = document.createElement('div');
    timerSection.className = 'tools-section';
    timerSection.innerHTML = '<h3>⏱ مؤقت نشاط</h3>';

    const display = document.createElement('div');
    display.className = 'tools-timer-display';
    if (timerSeconds <= 0 && !timerRunning) display.classList.add('tools-timer-done');
    display.textContent = formatTime(timerSeconds);
    timerSection.appendChild(display);
    timerDisplayEl = display;

    const status = document.createElement('p');
    status.className = 'tools-pick-hint';
    timerSection.appendChild(status);
    timerStatusEl = status;

    const presetRow = document.createElement('div');
    presetRow.className = 'tools-btn-row';
    [1, 3, 5, 10].forEach(min => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-small';
      btn.textContent = `${min} د`;
      btn.addEventListener('click', () => resetTimer(min));
      presetRow.appendChild(btn);
    });
    timerSection.appendChild(presetRow);

    const controlRow = document.createElement('div');
    controlRow.className = 'tools-btn-row';
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'btn btn-primary';
    startBtn.textContent = 'ابدأ';
    startBtn.addEventListener('click', startTimer);
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'btn btn-ghost';
    pauseBtn.textContent = 'إيقاف مؤقت';
    pauseBtn.addEventListener('click', pauseTimer);
    controlRow.appendChild(startBtn);
    controlRow.appendChild(pauseBtn);
    timerSection.appendChild(controlRow);

    const hint = document.createElement('p');
    hint.className = 'tools-timer-hint';
    hint.textContent = 'يمنع المؤقت قفل الشاشة تلقائيًا طالما كان يعمل أمامك. أما إذا انتقلت إلى تطبيق أو تبويب آخر، فسيبطئ المتصفح العدّ أو يوقفه، ولن تصلك رنة الانتهاء إلا عند عودتك إلى هذه الصفحة — لذا اترك الصفحة مفتوحة أمامك أثناء النشاط لأفضل دقة.';
    timerSection.appendChild(hint);

    toolsModalBody.appendChild(timerSection);
  }

  function closeToolsModal() {
    toolsModal.hidden = true;
    toolsModalBody.innerHTML = '';
    timerDisplayEl = null;
    timerStatusEl = null;
  }
  closeToolsModalBtn.addEventListener('click', closeToolsModal);
  // Clicking the backdrop no longer closes the modal — only the explicit
  // close button does, so a stray tap doesn't interrupt a running timer.

  function openToolsModal(session, roster, draft) {
    // Only students marked حاضر/متأخر today take part — absentees can't
    // be picked or grouped into an activity they're not in class for.
    // Reads the in-progress draft so it reflects what's on screen right
    // now, even before "حفظ الغياب" is pressed.
    const present = roster.filter(name => draft[name].status !== 'absent');

    toolsModalTitle.textContent = `أدوات الحصة — ${session.subject}`;
    toolsModalBody.innerHTML = '';

    renderTimerSection();

    if (present.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'hint-text';
      msg.textContent = 'لا يوجد طلاب حاضرون اليوم في هذه الحصة، لذلك لن يكون هناك طلاب لأداة "من الدور؟" أو تقسيم المجموعات. أما المؤقت أعلاه فيعمل بشكل طبيعي.';
      toolsModalBody.appendChild(msg);
      toolsModal.hidden = false;
      return;
    }

    // ----- من الدور؟ -----
    const pickSection = document.createElement('div');
    pickSection.className = 'tools-section';
    pickSection.innerHTML = '<h3>🎲 من الدور؟</h3>';

    const pickDisplay = document.createElement('div');
    pickDisplay.className = 'tools-pick-display';
    pickDisplay.textContent = 'اضغط "اختر طالب" للبدء';
    pickSection.appendChild(pickDisplay);

    const pickHint = document.createElement('p');
    pickHint.className = 'tools-pick-hint';
    pickSection.appendChild(pickHint);

    let pool = shuffled(present);
    function updatePickHint() {
      pickHint.textContent = pool.length > 0
        ? `تبقّى ${pool.length} من ${present.length} لم يُختاروا بعد`
        : 'تم اختيار الجميع! اضغط "إعادة تعيين" للبدء من جديد.';
    }
    updatePickHint();

    const pickBtnRow = document.createElement('div');
    pickBtnRow.className = 'tools-btn-row';
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'btn btn-primary';
    pickBtn.textContent = 'اختر طالب';
    pickBtn.addEventListener('click', () => {
      if (pool.length === 0) return;
      const idx = Math.floor(Math.random() * pool.length);
      const [name] = pool.splice(idx, 1);
      pickDisplay.textContent = name;
      updatePickHint();
    });
    const resetPickBtn = document.createElement('button');
    resetPickBtn.type = 'button';
    resetPickBtn.className = 'btn btn-ghost';
    resetPickBtn.textContent = 'إعادة تعيين';
    resetPickBtn.addEventListener('click', () => {
      pool = shuffled(present);
      pickDisplay.textContent = 'اضغط "اختر طالب" للبدء';
      updatePickHint();
    });
    pickBtnRow.appendChild(pickBtn);
    pickBtnRow.appendChild(resetPickBtn);
    pickSection.appendChild(pickBtnRow);

    toolsModalBody.appendChild(pickSection);

    // ----- تقسيم مجموعات عشوائي -----
    const groupsSection = document.createElement('div');
    groupsSection.className = 'tools-section';
    groupsSection.innerHTML = '<h3>👥 تقسيم مجموعات عشوائي</h3>';

    const groupsControlRow = document.createElement('div');
    groupsControlRow.className = 'tools-btn-row';
    const groupsLabel = document.createElement('label');
    groupsLabel.className = 'tools-groups-label';
    groupsLabel.append('عدد المجموعات:');
    const groupsInput = document.createElement('input');
    groupsInput.type = 'number';
    groupsInput.min = '2';
    groupsInput.max = String(Math.max(2, present.length));
    groupsInput.value = String(Math.min(4, Math.max(2, Math.round(present.length / 4) || 2)));
    groupsInput.className = 'tools-groups-input';
    groupsLabel.appendChild(groupsInput);
    const groupsBtn = document.createElement('button');
    groupsBtn.type = 'button';
    groupsBtn.className = 'btn btn-primary';
    groupsBtn.textContent = 'قسّم';
    groupsControlRow.appendChild(groupsLabel);
    groupsControlRow.appendChild(groupsBtn);
    groupsSection.appendChild(groupsControlRow);

    const groupsResult = document.createElement('div');
    groupsResult.className = 'tools-groups-result';
    groupsSection.appendChild(groupsResult);

    groupsBtn.addEventListener('click', () => {
      let n = parseInt(groupsInput.value, 10);
      if (!n || n < 2) n = 2;
      if (n > present.length) n = present.length;
      groupsInput.value = String(n);

      const shuffledStudents = shuffled(present);
      const groups = Array.from({ length: n }, () => []);
      shuffledStudents.forEach((name, i) => groups[i % n].push(name));

      groupsResult.innerHTML = '';
      groups.forEach((members, i) => {
        const box = document.createElement('div');
        box.className = 'tools-group-box';
        const title = document.createElement('strong');
        title.textContent = `مجموعة ${i + 1}`;
        box.appendChild(title);
        const ul = document.createElement('ul');
        members.forEach(name => {
          const li = document.createElement('li');
          li.textContent = name;
          ul.appendChild(li);
        });
        box.appendChild(ul);
        groupsResult.appendChild(box);
      });
    });

    toolsModalBody.appendChild(groupsSection);

    toolsModal.hidden = false;
  }

  // ---------- Holiday marking ----------
  if (holidayToggleBtn) {
    holidayToggleBtn.addEventListener('click', () => {
      const dateISO = datePicker.value || todayISO();
      if (isHoliday(dateISO)) {
        holidays.delete(dateISO);
        saveHolidays();
        render();
        return;
      }

      const prefix = `${dateISO}::`;
      const hasData = Object.keys(attendance).some(k => k.startsWith(prefix));
      const msg = hasData
        ? 'سيتم وضع علامة على هذا اليوم كعطلة رسمية، وسيُحذف كل ما سُجّل فيه من بيانات حضور (على الأرجح سُجّل خطأً لأن المدرسة لم تكن بها دوام). هل تريد المتابعة؟'
        : 'سيتم وضع علامة على هذا اليوم كعطلة رسمية، ولن تظهر فيه حصص لتسجيل الحضور. هل تريد المتابعة؟';
      if (!confirm(msg)) return;

      if (hasData) {
        Object.keys(attendance).filter(k => k.startsWith(prefix)).forEach(k => delete attendance[k]);
        saveAttendance();
      }
      holidays.add(dateISO);
      saveHolidays();
      draftBySession.clear();
      dirtySessions.clear();
      render();
    });
  }

  // ---------- Date controls ----------
  // Switching dates fully rebuilds sessionsContainer, which would silently
  // throw away any session's in-progress (unsaved) draft — so every
  // navigation path is guarded: warn first, and if the teacher backs out,
  // undo whatever already changed (the date picker's own value included).
  function navigateIfConfirmed(action) {
    if (dirtySessions.size > 0) {
      const proceed = confirm('لديك تعديلات على الغياب لم تُحفظ بعد. إذا تابعت الآن بدون الضغط على "حفظ الغياب"، ستُفقد هذه التعديلات. هل تريد المتابعة؟');
      if (!proceed) {
        datePicker.value = currentRenderedDate;
        return;
      }
    }
    draftBySession.clear();
    dirtySessions.clear();
    action();
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirtySessions.size === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });

  datePicker.value = todayISO();
  datePicker.addEventListener('change', () => navigateIfConfirmed(render));

  document.getElementById('todayBtn').addEventListener('click', () => {
    navigateIfConfirmed(() => {
      datePicker.value = todayISO();
      render();
    });
  });
  document.getElementById('prevDayBtn').addEventListener('click', () => {
    navigateIfConfirmed(() => {
      datePicker.value = addDays(currentRenderedDate, -1);
      render();
    });
  });
  document.getElementById('nextDayBtn').addEventListener('click', () => {
    navigateIfConfirmed(() => {
      datePicker.value = addDays(currentRenderedDate, 1);
      render();
    });
  });

  // ---------- More-options menu ----------
  // The rarely-used utility button (force update) used to sit as its own
  // topbar button — collapsed here behind one gear icon instead.
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
    document.addEventListener('click', (e) => {
      if (!moreMenu.hidden && !moreMenu.contains(e.target) && e.target !== moreMenuBtn) {
        moreMenu.hidden = true;
      }
    });
    window.addEventListener('resize', () => { moreMenu.hidden = true; });
  }

  // ---------- Init ----------
  render();

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.error('SW registration failed', e));
  }
})();
