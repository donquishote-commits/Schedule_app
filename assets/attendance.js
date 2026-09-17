(() => {
  'use strict';

  const SCHEDULE_KEY = 'schedule_app_classes_ar_v1';
  const STUDENTS_KEY = 'schedule_app_students_v1';
  const ATTENDANCE_KEY = 'schedule_app_attendance_v1';
  const HOLIDAYS_KEY = 'schedule_app_holidays_v1';
  const TERMS_KEY = 'schedule_app_terms_v1';
  const TEMP_SESSIONS_KEY = 'schedule_app_temp_sessions_v1';
  const FORMS_URL_KEY = 'schedule_app_forms_url_v1';

  // Must match assets/app.js's SUBJECTS/ROOMS/SUBJECT_ROOMS — used by the
  // "إضافة حصة لهذا اليوم" (تغطية) form, which needs the same subject/room
  // pickers as the real schedule editor.
  const SUBJECTS = ['الفلسفة', 'علم النفس', 'الدستور', 'دولة الكويت', 'الصحة النفسية'];
  const ROOMS = [
    '10-1', '10-2', '10-3', '10-4', '10-5', '10-6', '10-7', '10-8', '10-9',
    '11 د 1', '11 د 2', '11 د 3',
    '11 ع 1', '11 ع 2', '11 ع 3', '11 ع 4', '11 ع 5', '11 ع 6', '11 ع 7', '11 ع 8',
    '12 د 1', '12 د 2',
    '12 ع 1', '12 ع 2', '12 ع 3', '12 ع 4', '12 ع 5', '12 ع 6', '12 ع 7', '12 ع 8',
  ];
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
  let terms = loadJSON(TERMS_KEY, { term1Start: '', term1End: '', term2Start: '', term2End: '' });
  // One-off sessions (تبديل/تغطية) — never part of the recurring weekly
  // schedule. type:'swap' entries also carry sourceClassId/sourceDate,
  // identifying the recurring class+date they replace for that one day.
  let tempSessions = loadJSON(TEMP_SESSIONS_KEY, []);
  // رابط نموذج تسجيل الغياب الذي توفره المدرسة (مثلًا Google Forms) —
  // يحدده المستخدم مرة واحدة من قائمة ⚙️، وزر بجانب كل حصة يفتحه مباشرة.
  let formsUrl = localStorage.getItem(FORMS_URL_KEY) || '';

  function saveFormsUrl() {
    localStorage.setItem(FORMS_URL_KEY, formsUrl);
  }

  function saveAttendance() {
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(attendance));
  }

  function saveHolidays() {
    localStorage.setItem(HOLIDAYS_KEY, JSON.stringify([...holidays]));
  }

  function saveTerms() {
    localStorage.setItem(TERMS_KEY, JSON.stringify(terms));
  }

  function saveTempSessions() {
    localStorage.setItem(TEMP_SESSIONS_KEY, JSON.stringify(tempSessions));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isHoliday(dateISO) {
    return holidays.has(dateISO);
  }

  // A day is "outside the term" if it falls before the first term starts,
  // in the mid-year gap between the two terms (only once both of those
  // boundaries are set), or after the second term ends. Any field left
  // blank simply doesn't restrict from that side — so this has no effect
  // at all until the teacher fills in at least one date.
  function isOutsideTerms(dateISO) {
    if (terms.term1Start && dateISO < terms.term1Start) return true;
    if (terms.term1End && terms.term2Start && dateISO > terms.term1End && dateISO < terms.term2Start) return true;
    if (terms.term2End && dateISO > terms.term2End) return true;
    return false;
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

  // Used by the ◀/▶ day-navigation buttons only — skips Friday/Saturday
  // (no classes those days) so one press from Thursday lands on the next
  // Sunday instead of a dead weekend day. Manually picking a weekend date
  // from the date input itself is untouched.
  function nextSchoolDay(iso, delta) {
    let d = addDays(iso, delta);
    while ([5, 6].includes(isoToDate(d).getDay())) {
      d = addDays(d, delta);
    }
    return d;
  }

  // ---------- Effective sessions for a date (recurring schedule + temp) ----------
  // A swapped-away class disappears only from its own source date — the
  // recurring class definition itself is never touched, so every other
  // week of that weekday still shows it normally.
  function effectiveSessionsForDate(dateISO) {
    const weekday = isoToDate(dateISO).getDay();
    const hiddenClassIds = new Set(
      tempSessions.filter(t => t.type === 'swap' && t.sourceDate === dateISO).map(t => t.sourceClassId)
    );
    const regular = scheduleClasses.filter(c => c.day === weekday && !hiddenClassIds.has(c.id));
    const temp = tempSessions.filter(t => t.date === dateISO);
    return [...regular, ...temp].sort((a, b) => a.periodKey - b.periodKey);
  }

  // Used when creating a swap/cover session, to block landing it on a
  // period that's already taken that date — by the recurring schedule or
  // by another temporary session.
  function periodTakenOnDate(dateISO, periodKey, excludeSessionId) {
    return effectiveSessionsForDate(dateISO).some(s => s.periodKey === periodKey && s.id !== excludeSessionId);
  }

  // Deleting a swap simply removes the temp session — since the recurring
  // class was never actually touched, it reappears on its normal date on
  // its own, with nothing left to "restore".
  function deleteTempSession(sessionId, dateISO) {
    const sk = sessionKey(dateISO, sessionId);
    const hasAttendance = !!attendance[sk];
    const msg = hasAttendance
      ? 'سيتم حذف هذه الحصة المؤقتة وكل ما سُجّل فيها من بيانات حضور. هل تريد المتابعة؟'
      : 'سيتم حذف هذه الحصة المؤقتة. هل تريد المتابعة؟';
    if (!confirm(msg)) return;

    tempSessions = tempSessions.filter(t => t.id !== sessionId);
    saveTempSessions();
    if (hasAttendance) {
      delete attendance[sk];
      saveAttendance();
    }
    draftBySession.delete(draftMapKey(dateISO, sessionId));
    dirtySessions.delete(draftMapKey(dateISO, sessionId));
    render();
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
  const termOutOfRangeStateEl = document.getElementById('termOutOfRangeState');
  const holidayToggleBtn = document.getElementById('holidayToggleBtn');
  const holidayToggleIcon = document.getElementById('holidayToggleIcon');
  const holidayToggleText = document.getElementById('holidayToggleText');

  // Two hand-drawn calendar icons (currentColor, so they match the app's
  // text color like the sort icon does) — a "+" mark to offer marking a
  // day as a holiday, an "×" mark once it's already marked, so the icon
  // itself signals which action the button will take.
  const HOLIDAY_ICON_MARK = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2"/>
      <line x1="8" y1="3" x2="8" y2="7"/>
      <line x1="16" y1="3" x2="16" y2="7"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <line x1="12" y1="13" x2="12" y2="18"/>
      <line x1="9.5" y1="15.5" x2="14.5" y2="15.5"/>
    </svg>`;
  const HOLIDAY_ICON_UNMARK = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2"/>
      <line x1="8" y1="3" x2="8" y2="7"/>
      <line x1="16" y1="3" x2="16" y2="7"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <line x1="9.5" y1="13.5" x2="14.5" y2="18"/>
      <line x1="14.5" y1="13.5" x2="9.5" y2="18"/>
    </svg>`;

  function updateHolidayToggleLabel(dateISO) {
    if (!holidayToggleBtn) return;
    const marked = isHoliday(dateISO);
    holidayToggleIcon.innerHTML = marked ? HOLIDAY_ICON_UNMARK : HOLIDAY_ICON_MARK;
    holidayToggleText.textContent = marked ? 'إلغاء العطلة' : 'عطلة رسمية';
    holidayToggleBtn.title = marked ? 'إلغاء علامة العطلة الرسمية عن هذا اليوم' : 'وضع علامة على هذا اليوم كعطلة رسمية';
  }

  // Attendance percentages for the selected day, across every session
  // scheduled that day — separate from renderInner's full rebuild so a
  // single attendance click can refresh just this small block instead of
  // re-rendering (and scroll-jumping) the whole page.
  function computeDaySummary(dateISO) {
    const sessions = effectiveSessionsForDate(dateISO);
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

  // Which single session (if any) is currently shown full-screen — opening
  // a session no longer expands it in place, it takes over the whole page
  // (page chrome hidden via the zoomed-session body class) so the roster
  // table gets the full screen width instead of squeezing into a narrow
  // accordion row. Only one at a time; resets to the compact list whenever
  // the date changes.
  let zoomedSessionId = null;

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
      zoomedSessionId = null;
      document.body.classList.remove('zoomed-session');
      daySummaryEl.hidden = true;
      sessionsContainer.innerHTML = '';
      noScheduleState.hidden = true;
      termOutOfRangeStateEl.hidden = true;
      holidayStateEl.hidden = false;
      holidayStateEl.textContent = 'هذا اليوم عطلة رسمية — لا تُسجَّل فيه بيانات حضور. اضغط على زر "إلغاء العطلة" أعلاه إذا وُضعت العلامة بالخطأ.';
      currentRenderedDate = dateISO;
      return;
    }
    holidayStateEl.hidden = true;

    if (isOutsideTerms(dateISO)) {
      zoomedSessionId = null;
      document.body.classList.remove('zoomed-session');
      daySummaryEl.hidden = true;
      sessionsContainer.innerHTML = '';
      noScheduleState.hidden = true;
      termOutOfRangeStateEl.hidden = false;
      termOutOfRangeStateEl.textContent = 'هذا اليوم خارج نطاق الفصلين الدراسيين المحدَّدَين — لا دوام فيه، ولن تُحتسب بياناته بمتوسط المشاركة. عدّل التواريخ من قائمة الخيارات ⚙️ إذا كانت خاطئة.';
      currentRenderedDate = dateISO;
      return;
    }
    termOutOfRangeStateEl.hidden = true;

    sessionsContainer.innerHTML = '';

    if (!dayInfo) {
      zoomedSessionId = null;
      document.body.classList.remove('zoomed-session');
      renderDaySummary(dateISO);
      noScheduleState.hidden = false;
      noScheduleState.textContent = 'لا توجد حصص في عطلة نهاية الأسبوع.';
      currentRenderedDate = dateISO;
      return;
    }

    const sessions = effectiveSessionsForDate(dateISO);

    if (sessions.length === 0) {
      zoomedSessionId = null;
      document.body.classList.remove('zoomed-session');
      renderDaySummary(dateISO);
      noScheduleState.hidden = false;
      noScheduleState.textContent = 'لا توجد حصص مجدولة في هذا اليوم.';
      currentRenderedDate = dateISO;
      return;
    }
    noScheduleState.hidden = true;

    const zoomIdx = zoomedSessionId ? sessions.findIndex(s => s.id === zoomedSessionId) : -1;

    if (zoomIdx !== -1) {
      document.body.classList.add('zoomed-session');
      sessionsContainer.appendChild(renderZoomedSession(sessions, zoomIdx, dateISO));
    } else {
      zoomedSessionId = null;
      document.body.classList.remove('zoomed-session');
      renderDaySummary(dateISO);
      sessions.forEach(session => {
        sessionsContainer.appendChild(renderCompactSessionRow(session, dateISO));
      });
    }

    currentRenderedDate = dateISO;
  }

  // Shared by the zoomed header — extracted out of the old single
  // renderSessionCard so the compact list rows (which no longer show any
  // actions of their own) and the zoomed view both stay in sync from one
  // definition instead of two copies drifting apart.
  function buildActionButtons(session, dateISO, roster, draft) {
    const buttons = [];

    if (!session.type) {
      const swapBtn = document.createElement('button');
      swapBtn.type = 'button';
      swapBtn.className = 'btn btn-ghost btn-small icon-btn-round';
      swapBtn.textContent = '🔁';
      swapBtn.title = 'تبديل الحصة — نقلها لمرة واحدة إلى تاريخ آخر';
      swapBtn.setAttribute('aria-label', 'تبديل الحصة');
      swapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSwapModal(session, dateISO);
      });
      buttons.push(swapBtn);
    } else {
      // Editing is cover-only — a swap always mirrors its source class's
      // subject/room/period exactly, so there's nothing on it to edit;
      // "cancel" is its only action.
      if (session.type === 'cover') {
        const editCoverBtn = document.createElement('button');
        editCoverBtn.type = 'button';
        editCoverBtn.className = 'btn btn-ghost btn-small icon-btn-round';
        editCoverBtn.textContent = '✏️';
        editCoverBtn.title = 'تعديل بيانات الحصة';
        editCoverBtn.setAttribute('aria-label', 'تعديل بيانات الحصة');
        editCoverBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openCoverModal(session);
        });
        buttons.push(editCoverBtn);
      }

      const deleteTempBtn = document.createElement('button');
      deleteTempBtn.type = 'button';
      const isCover = session.type === 'cover';
      deleteTempBtn.className = 'btn btn-ghost btn-small' + (isCover ? ' icon-btn-round' : '');
      deleteTempBtn.textContent = isCover ? '🗑' : '↩ إلغاء التبديل';
      deleteTempBtn.title = isCover
        ? 'حذف هذه الحصة المؤقتة'
        : 'إلغاء التبديل وإرجاع الحصة الأصلية إلى يومها';
      if (isCover) deleteTempBtn.setAttribute('aria-label', 'حذف هذه الحصة المؤقتة');
      deleteTempBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTempSession(session.id, dateISO);
      });
      buttons.push(deleteTempBtn);
    }

    if (roster && roster.length > 0) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-ghost btn-small icon-btn-round copy-absentees-btn';
      copyBtn.textContent = '📋';
      copyBtn.title = 'نسخ أسماء الغياب';
      copyBtn.setAttribute('aria-label', 'نسخ أسماء الغياب');
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyAbsentees(roster, draft, copyBtn);
      });
      buttons.push(copyBtn);

      const toolsBtn = document.createElement('button');
      toolsBtn.type = 'button';
      toolsBtn.className = 'btn btn-ghost btn-small icon-btn-round';
      toolsBtn.textContent = '🎲';
      toolsBtn.title = 'أدوات الحصة';
      toolsBtn.setAttribute('aria-label', 'أدوات الحصة');
      toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openToolsModal(session, roster, draft);
      });
      buttons.push(toolsBtn);

      const formsBtn = document.createElement('button');
      formsBtn.type = 'button';
      formsBtn.className = 'btn btn-ghost btn-small icon-btn-round';
      formsBtn.textContent = '🔗';
      formsBtn.title = 'فتح نموذج تسجيل الغياب';
      formsBtn.setAttribute('aria-label', 'فتح نموذج تسجيل الغياب');
      formsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFormsLink();
      });
      buttons.push(formsBtn);
    }

    return buttons;
  }

  // Builds the subject/room/period title row shared by the compact list
  // row and the zoomed header — a plain function instead of yet another
  // duplicated block, since both need the exact same content.
  function buildSessionTitleRow(session) {
    const titleRow = document.createElement('div');
    titleRow.className = 'session-card-title-row';

    if (session.type) {
      // Icon and label as separate flex-item spans, not one string with the
      // icon typed inline — the Unicode bidi algorithm placed a neutral
      // symbol like ➕ inconsistently mixed into Arabic text (backwards for
      // ➕, fine for 🔁); flex layout keeps either pinned to the right side
      // regardless, matching normal Arabic reading order.
      const badge = document.createElement('span');
      badge.className = 'temp-badge';
      const badgeIcon = document.createElement('span');
      badgeIcon.textContent = session.type === 'swap' ? '🔁' : '➕';
      const badgeText = document.createElement('span');
      badgeText.textContent = session.type === 'swap' ? 'تبديل' : 'احتياط';
      badge.appendChild(badgeIcon);
      badge.appendChild(badgeText);
      titleRow.appendChild(badge);
    }

    titleRow.insertAdjacentHTML('beforeend', `
      <span class="session-subject">${escapeHTML(session.subject)}</span>
      <span class="session-meta">${escapeHTML(isolateLTR(session.room || ''))}</span>
      <span class="session-meta">${escapeHTML(periodLabelFor(session.periodKey))}</span>
    `);

    if (session.type === 'swap' && session.sourceDate) {
      const fromSpan = document.createElement('span');
      fromSpan.className = 'session-meta';
      fromSpan.textContent = `(بدل حصة ${session.sourceDate})`;
      titleRow.appendChild(fromSpan);
    }

    return titleRow;
  }

  // The default day view: one tappable row per session, showing only
  // enough to tell them apart (subject/room/period, and the تبديل/احتياط
  // badge) — no roster, no actions. Tapping one opens it full-screen via
  // renderZoomedSession instead of expanding in place, so the roster table
  // never has to squeeze into a narrow accordion row.
  function renderCompactSessionRow(session, dateISO) {
    const row = document.createElement('div');
    row.className = 'session-card session-row';
    row.addEventListener('click', () => {
      zoomedSessionId = session.id;
      render();
    });

    const chevron = document.createElement('span');
    chevron.className = 'session-chevron';
    chevron.textContent = '◀';
    row.appendChild(chevron);
    row.appendChild(buildSessionTitleRow(session));

    return row;
  }

  // Full-screen focused view for exactly one session — the page's normal
  // chrome (date bar, day summary, etc.) is hidden via the zoomed-session
  // body class while this is showing, so the roster table gets the full
  // screen width instead of competing with everything else for space.
  // prevBtn/nextBtn step through that day's other sessions without ever
  // leaving this view — safe to do with no "unsaved changes" check, since
  // every session's draft lives in draftBySession independently of which
  // one is currently on screen.
  function renderZoomedSession(sessions, idx, dateISO) {
    const session = sessions[idx];
    const view = document.createElement('div');
    view.className = 'zoomed-session-view';

    const header = document.createElement('div');
    header.className = 'zoomed-header';

    const navRow = document.createElement('div');
    navRow.className = 'zoomed-header-nav';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn btn-ghost btn-small icon-btn-round';
    backBtn.textContent = '✕';
    backBtn.title = 'رجوع لقائمة الحصص';
    backBtn.setAttribute('aria-label', 'رجوع لقائمة الحصص');
    backBtn.addEventListener('click', () => {
      zoomedSessionId = null;
      render();
    });
    navRow.appendChild(backBtn);

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    navRow.appendChild(spacer);

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn btn-ghost btn-small icon-btn-round';
    prevBtn.textContent = '▶';
    prevBtn.title = 'الحصة السابقة';
    prevBtn.setAttribute('aria-label', 'الحصة السابقة');
    prevBtn.disabled = idx === 0;
    prevBtn.addEventListener('click', () => {
      zoomedSessionId = sessions[idx - 1].id;
      render();
    });
    navRow.appendChild(prevBtn);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn btn-ghost btn-small icon-btn-round';
    nextBtn.textContent = '◀';
    nextBtn.title = 'الحصة التالية';
    nextBtn.setAttribute('aria-label', 'الحصة التالية');
    nextBtn.disabled = idx === sessions.length - 1;
    nextBtn.addEventListener('click', () => {
      zoomedSessionId = sessions[idx + 1].id;
      render();
    });
    navRow.appendChild(nextBtn);

    header.appendChild(navRow);
    header.appendChild(buildSessionTitleRow(session));

    const className = (session.room || '').trim();
    const roster = students[className];
    const draft = roster && roster.length > 0 ? getOrCreateDraft(dateISO, session.id, roster) : null;

    const actionsRow = document.createElement('div');
    actionsRow.className = 'session-card-actions-row';
    buildActionButtons(session, dateISO, roster, draft).forEach(btn => actionsRow.appendChild(btn));
    header.appendChild(actionsRow);

    view.appendChild(header);

    const body = document.createElement('div');
    body.className = 'zoomed-body';

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
      ['#', 'اسم الطالب', 'الغياب', 'المشاركة', 'الدفتر', 'السلوك', 'إحصائية الحضور والغياب'].forEach((label, i) => {
        const th = document.createElement('th');
        th.textContent = label;
        if (i === 0) th.className = 'attendance-number-col';
        if (i === 1) th.className = 'period-col-header attendance-name-col';
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      // Once the teacher is done recording (حاضر/غائب, المشاركة, الدفتر,
      // السلوك), those columns are rarely touched again — this folds them
      // away, keeping just the name and the quick-glance stats column, so
      // more of the roster fits without side-scrolling. Always starts
      // unfolded (every render of a freshly-opened session needs the
      // recording controls first), and never persists — same reasoning as
      // زووم نفسه: today's state shouldn't carry into tomorrow's session.
      const foldRow = document.createElement('div');
      foldRow.className = 'column-fold-row';
      const foldBtn = document.createElement('button');
      foldBtn.type = 'button';
      foldBtn.className = 'btn btn-ghost btn-small';
      let folded = false;
      function updateFoldBtn() {
        foldBtn.textContent = folded ? '🔼 إظهار كل الأعمدة' : '🔽 طيّ أعمدة التسجيل';
      }
      updateFoldBtn();
      foldBtn.addEventListener('click', () => {
        folded = !folded;
        table.classList.toggle('columns-folded', folded);
        updateFoldBtn();
      });
      foldRow.appendChild(foldBtn);
      body.appendChild(foldRow);

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

      // "dirty" is purely the visual reminder that this session hasn't
      // been fully saved yet (shown on every render, even one where the
      // teacher hasn't touched anything) — it must NOT feed dirtySessions,
      // or just opening a fresh day would falsely warn about "unsaved
      // edits" on leaving it. dirtySessions only gets a session added via
      // markEdited() below, which fires from an actual pill click.
      let dirty = !isSessionSaved(dateISO, session.id, roster);
      function setSessionDirty(value) {
        dirty = value;
        updateSaveUI();
      }
      function updateSaveUI() {
        if (dirty) {
          saveBtn.textContent = '💾 حفظ الغياب';
          saveBtn.disabled = false;
          saveStatus.textContent = 'لم يُحفظ بعد';
          saveStatus.className = 'attendance-save-status unsaved';
        } else {
          saveBtn.textContent = '✓ تم الحفظ';
          saveBtn.disabled = true;
          saveStatus.textContent = '';
          saveStatus.className = 'attendance-save-status';
        }
      }
      updateSaveUI();

      function markEdited() {
        dirtySessions.add(draftMapKey(dateISO, session.id));
        setSessionDirty(true);
      }

      const tbody = document.createElement('tbody');
      roster.forEach((studentName, i) => {
        tbody.appendChild(renderStudentRow(session.id, studentName, draft, markEdited, i));
      });
      table.appendChild(tbody);

      scrollWrap.appendChild(table);
      body.appendChild(scrollWrap);

      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveSessionDraft(dateISO, session.id, roster);
        dirtySessions.delete(draftMapKey(dateISO, session.id));
        setSessionDirty(false);
        renderDaySummary(dateISO);
      });

      saveRow.appendChild(saveBtn);
      saveRow.appendChild(saveStatus);
      body.appendChild(saveRow);
    }

    view.appendChild(body);
    return view;
  }

  // Builds the row once, then every click updates only that button's
  // class (and the stats text) in place — the table/scroll container is
  // never touched again, so there's nothing for a click to "jump" or
  // reset. (An earlier version called the full render() on every click,
  // which rebuilt the whole table and reset horizontal scroll on some
  // devices even with scroll-position save/restore.)
  function renderStudentRow(classId, studentName, draft, onChange, index) {
    const entry = draft[studentName];

    const tr = document.createElement('tr');

    // Same idea as the numbering added to قوائم الفصول — reflects the
    // student's position in the roster, not tied to their name, so
    // reordering them there (▲/▼) is reflected here too.
    const numberTd = document.createElement('td');
    numberTd.className = 'attendance-number-col';
    numberTd.textContent = String(index + 1);
    tr.appendChild(numberTd);

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
      datePicker.value = nextSchoolDay(currentRenderedDate, -1);
      render();
    });
  });
  document.getElementById('nextDayBtn').addEventListener('click', () => {
    navigateIfConfirmed(() => {
      datePicker.value = nextSchoolDay(currentRenderedDate, 1);
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

  // ---------- Term date ranges ----------
  const termsBtn = document.getElementById('termsBtn');
  const termsModal = document.getElementById('termsModal');
  const termsForm = document.getElementById('termsForm');
  const term1StartInput = document.getElementById('term1Start');
  const term1EndInput = document.getElementById('term1End');
  const term2StartInput = document.getElementById('term2Start');
  const term2EndInput = document.getElementById('term2End');
  const closeTermsModalBtn = document.getElementById('closeTermsModalBtn');
  const cancelTermsBtn = document.getElementById('cancelTermsBtn');

  let termsOpenedSnapshot = '';
  function termsFormSnapshot() {
    return [term1StartInput.value, term1EndInput.value, term2StartInput.value, term2EndInput.value].join('|');
  }

  function openTermsModal() {
    term1StartInput.value = terms.term1Start || '';
    term1EndInput.value = terms.term1End || '';
    term2StartInput.value = terms.term2Start || '';
    term2EndInput.value = terms.term2End || '';
    termsModal.hidden = false;
    termsOpenedSnapshot = termsFormSnapshot();
  }

  function closeTermsModal() {
    termsModal.hidden = true;
  }

  // Same "discard" guard as the other modals — checks for unsaved edits
  // before throwing them away; a successful save calls closeTermsModal()
  // directly since its change is already committed.
  function closeTermsModalIfConfirmed() {
    if (termsFormSnapshot() !== termsOpenedSnapshot) {
      if (!confirm('لديك تعديلات على تواريخ الفصلين لم تُحفظ. إذا أغلقت الآن، ستُفقد هذه التعديلات. هل تريد المتابعة؟')) return;
    }
    closeTermsModal();
  }

  if (termsBtn) termsBtn.addEventListener('click', openTermsModal);
  if (closeTermsModalBtn) closeTermsModalBtn.addEventListener('click', closeTermsModalIfConfirmed);
  if (cancelTermsBtn) cancelTermsBtn.addEventListener('click', closeTermsModalIfConfirmed);

  if (termsForm) {
    termsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const t1s = term1StartInput.value || '';
      const t1e = term1EndInput.value || '';
      const t2s = term2StartInput.value || '';
      const t2e = term2EndInput.value || '';
      if (t1s && t1e && t1s > t1e) {
        alert('تاريخ نهاية الفصل الأول قبل تاريخ بدايته — راجع التواريخ.');
        return;
      }
      if (t2s && t2e && t2s > t2e) {
        alert('تاريخ نهاية الفصل الثاني قبل تاريخ بدايته — راجع التواريخ.');
        return;
      }
      terms = { term1Start: t1s, term1End: t1e, term2Start: t2s, term2End: t2e };
      saveTerms();
      closeTermsModal();
      render();
    });
  }

  // ---------- Forms link (رابط نموذج تسجيل الغياب) ----------
  function openFormsLink() {
    if (!formsUrl) {
      alert('لم تُحدّد رابط نموذج تسجيل الغياب بعد — حدده من قائمة ⚙️ أولًا.');
      return;
    }
    window.open(formsUrl, '_blank', 'noopener');
  }

  const formsLinkBtn = document.getElementById('formsLinkBtn');
  const formsLinkModal = document.getElementById('formsLinkModal');
  const formsLinkForm = document.getElementById('formsLinkForm');
  const formsLinkInput = document.getElementById('formsLinkInput');
  const closeFormsLinkModalBtn = document.getElementById('closeFormsLinkModalBtn');
  const cancelFormsLinkBtn = document.getElementById('cancelFormsLinkBtn');

  let formsLinkOpenedSnapshot = '';

  function openFormsLinkModal() {
    formsLinkInput.value = formsUrl;
    formsLinkModal.hidden = false;
    formsLinkOpenedSnapshot = formsLinkInput.value;
  }

  function closeFormsLinkModal() {
    formsLinkModal.hidden = true;
  }

  function closeFormsLinkModalIfConfirmed() {
    if (formsLinkInput.value !== formsLinkOpenedSnapshot) {
      if (!confirm('لديك تعديل على رابط النموذج لم يُحفظ. إذا أغلقت الآن، سيُفقد هذا التعديل. هل تريد المتابعة؟')) return;
    }
    closeFormsLinkModal();
  }

  if (formsLinkBtn) formsLinkBtn.addEventListener('click', openFormsLinkModal);
  if (closeFormsLinkModalBtn) closeFormsLinkModalBtn.addEventListener('click', closeFormsLinkModalIfConfirmed);
  if (cancelFormsLinkBtn) cancelFormsLinkBtn.addEventListener('click', closeFormsLinkModalIfConfirmed);

  if (formsLinkForm) {
    formsLinkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      formsUrl = formsLinkInput.value.trim();
      saveFormsUrl();
      closeFormsLinkModal();
    });
  }

  // ---------- Custom dropdown (used only by إضافة حصة لهذا اليوم below) ----------
  // Same widget as assets/app.js's class editor — a plain <select>'s open
  // option list is native OS chrome on mobile and ignores the page's RTL
  // direction internally, which no CSS can reach into and fix.
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

    let entries = [];
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

    root.setEntries = function (newEntries, currentValue) {
      entries = newEntries;
      internalValue = currentValue !== undefined && currentValue !== null
        ? String(currentValue)
        : (entries[0] ? entries[0].value : '');
      updateTriggerLabel();
      renderOptions();
    };

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
  window.addEventListener('resize', () => {
    document.querySelectorAll('.custom-select.open').forEach(el => el._closeCustomSelect());
  });

  // ---------- Swap a session to a different date (تبديل) ----------
  const swapModal = document.getElementById('swapModal');
  const swapForm = document.getElementById('swapForm');
  const swapDateInput = document.getElementById('swapDateInput');
  const swapHintText = document.getElementById('swapHintText');
  const closeSwapModalBtn = document.getElementById('closeSwapModalBtn');
  const cancelSwapBtn = document.getElementById('cancelSwapBtn');
  let swapSource = null; // { id, subject, room, periodKey, sourceDate }
  let swapOpenedSnapshot = '';

  function swapFormSnapshot() {
    return swapDateInput.value;
  }

  function openSwapModal(session, dateISO) {
    swapSource = {
      id: session.id, subject: session.subject, room: session.room,
      periodKey: session.periodKey, sourceDate: dateISO,
    };
    swapHintText.textContent = `ستُنقل حصة "${session.subject}"${session.room ? ` (${isolateLTR(session.room)})` : ''} من هذا اليوم إلى تاريخ آخر — بنفس المادة والصف والحصة. تختفي من ${dateISO} فقط؛ باقي أسابيعها المعتادة لا تتأثر.`;
    swapDateInput.value = '';
    swapDateInput.min = todayISO();
    swapModal.hidden = false;
    swapOpenedSnapshot = swapFormSnapshot();
  }

  function closeSwapModal() {
    swapModal.hidden = true;
    swapForm.reset();
    swapSource = null;
  }

  function closeSwapModalIfConfirmed() {
    if (swapFormSnapshot() !== swapOpenedSnapshot) {
      if (!confirm('لديك تاريخ مُدخل لم يُحفظ. إذا أغلقت الآن، ستُفقد هذه العملية. هل تريد المتابعة؟')) return;
    }
    closeSwapModal();
  }

  closeSwapModalBtn.addEventListener('click', closeSwapModalIfConfirmed);
  cancelSwapBtn.addEventListener('click', closeSwapModalIfConfirmed);

  swapForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!swapSource) return;
    const targetDate = swapDateInput.value;
    if (!targetDate) {
      alert('اختر التاريخ الجديد أولًا.');
      return;
    }
    if (targetDate === swapSource.sourceDate) {
      alert('اخترت نفس تاريخ الحصة الأصلية — اختر تاريخًا مختلفًا.');
      return;
    }
    const targetWeekday = isoToDate(targetDate).getDay();
    if (!DAYS.some(d => d.key === targetWeekday)) {
      alert('لا يمكن جدولة حصة في يوم عطلة نهاية الأسبوع (الجمعة أو السبت).');
      return;
    }
    if (periodTakenOnDate(targetDate, swapSource.periodKey, null)) {
      alert('هناك حصة أخرى في هذا الوقت بذلك التاريخ. اختر تاريخًا آخر.');
      return;
    }
    tempSessions.push({
      id: uid(),
      type: 'swap',
      date: targetDate,
      periodKey: swapSource.periodKey,
      subject: swapSource.subject,
      room: swapSource.room,
      sourceClassId: swapSource.id,
      sourceDate: swapSource.sourceDate,
    });
    saveTempSessions();
    closeSwapModal();
    render();
  });

  // ---------- Add a one-off cover session (تغطية) ----------
  const coverModal = document.getElementById('coverModal');
  const coverForm = document.getElementById('coverForm');
  const addCoverBtn = document.getElementById('addCoverBtn');
  const closeCoverModalBtn = document.getElementById('closeCoverModalBtn');
  const cancelCoverBtn = document.getElementById('cancelCoverBtn');
  const coverSubjectSelect = makeCustomSelect('coverSubject');
  const coverRoomSelect = makeCustomSelect('coverRoom');
  const coverPeriodSelect = makeCustomSelect('coverPeriod');
  const coverTeacherInput = document.getElementById('coverTeacherInput');

  coverPeriodSelect.setEntries(PERIODS.map(p => ({
    value: String(p.key),
    label: `${p.label} (${isolateLTR(`${to12(p.start)} - ${to12(p.end)}`)})`,
    shortLabel: p.label,
  })));

  coverSubjectSelect.addEventListener('change', () => {
    const validRooms = roomsForSubject(coverSubjectSelect.value);
    const roomToKeep = validRooms.includes(coverRoomSelect.value) ? coverRoomSelect.value : '';
    coverRoomSelect.populate(validRooms, roomToKeep, '— غير معيّن —', false, true);
  });

  const coverModalTitle = document.getElementById('coverModalTitle');
  const coverSubmitBtn = document.getElementById('coverSubmitBtn');

  let coverOpenedSnapshot = '';
  function coverFormSnapshot() {
    return [coverSubjectSelect.value, coverRoomSelect.value, coverPeriodSelect.value, coverTeacherInput.value].join('|');
  }

  // The session being edited, or null when adding a new one — set fresh
  // on every open so a stale id can never leak into the next submit.
  let editingCoverId = null;

  // existingSession is omitted for "add new"; passed in (from the ✏️
  // button on a cover session's card) to edit that session's fields.
  function openCoverModal(existingSession) {
    editingCoverId = existingSession ? existingSession.id : null;
    coverModalTitle.textContent = existingSession ? 'تعديل حصة احتياط' : 'إضافة حصة احتياط';
    coverSubmitBtn.textContent = existingSession ? 'حفظ' : 'إضافة';
    const subject = existingSession ? existingSession.subject : '';
    coverSubjectSelect.populate(SUBJECTS, subject, 'اختر المادة', true);
    coverRoomSelect.populate(roomsForSubject(subject), existingSession ? existingSession.room : '', '— غير معيّن —', false, true);
    coverPeriodSelect.value = String(existingSession ? existingSession.periodKey : PERIODS[0].key);
    coverTeacherInput.value = existingSession ? (existingSession.teacherName || '') : '';
    coverModal.hidden = false;
    coverOpenedSnapshot = coverFormSnapshot();
  }

  function closeCoverModal() {
    coverModal.hidden = true;
    coverForm.reset();
    editingCoverId = null;
  }

  function closeCoverModalIfConfirmed() {
    if (coverFormSnapshot() !== coverOpenedSnapshot) {
      if (!confirm('لديك بيانات مدخلة لم تُحفظ. إذا أغلقت الآن، ستُفقد. هل تريد المتابعة؟')) return;
    }
    closeCoverModal();
  }

  if (addCoverBtn) addCoverBtn.addEventListener('click', () => openCoverModal());
  closeCoverModalBtn.addEventListener('click', closeCoverModalIfConfirmed);
  cancelCoverBtn.addEventListener('click', closeCoverModalIfConfirmed);

  coverForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const subject = coverSubjectSelect.value.trim();
    const room = coverRoomSelect.value.trim();
    const periodKey = Number(coverPeriodSelect.value);
    const teacherName = coverTeacherInput.value.trim() || null;
    if (!subject) {
      alert('اختر المادة أولًا.');
      return;
    }
    const dateISO = datePicker.value || todayISO();
    if (periodTakenOnDate(dateISO, periodKey, editingCoverId)) {
      alert('هناك حصة أخرى في هذا الوقت بهذا اليوم. اختر حصة أخرى أو عدّل الحصة الموجودة.');
      return;
    }
    if (editingCoverId) {
      const existing = tempSessions.find(t => t.id === editingCoverId);
      if (existing) Object.assign(existing, { subject, room, periodKey, teacherName });
    } else {
      tempSessions.push({
        id: uid(),
        type: 'cover',
        date: dateISO,
        periodKey,
        subject, room,
        sourceClassId: null,
        sourceDate: null,
        teacherName,
      });
    }
    saveTempSessions();
    closeCoverModal();
    render();
  });

  // ---------- Init ----------
  // A grid badge on the schedule page (index.html) links straight to that
  // temp session's exact date instead of leaving the teacher to find it.
  const dateParam = new URLSearchParams(location.search).get('date');
  if (dateParam) datePicker.value = dateParam;
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
