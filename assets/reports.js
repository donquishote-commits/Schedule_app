(() => {
  'use strict';

  const SCHEDULE_KEY = 'schedule_app_classes_ar_v1';
  const STUDENTS_KEY = 'schedule_app_students_v1';
  const ATTENDANCE_KEY = 'schedule_app_attendance_v1';
  const REPORTS_KEY = 'schedule_app_reports_v1';

  const PARTICIPATION_SCALE = { excellent: 1, normal: 2, none: 3 };
  const PARTICIPATION_LABELS = { 1: 'ممتاز', 2: 'متوسط', 3: 'ضعيف' };
  const PARTICIPATION_DEFAULT = 2; // متوسط — used for days the student attended but wasn't rated
  const PARTICIPATION_START_DATE = '2026-12-20'; // only count participation from this date on

  function isolateLTR(text) {
    return `‭${text}‬`;
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error(`Failed to load ${key}`, e);
      return fallback;
    }
  }

  const scheduleClasses = loadJSON(SCHEDULE_KEY, []);
  const students = loadJSON(STUDENTS_KEY, {});
  const attendance = loadJSON(ATTENDANCE_KEY, {});
  let reports = loadJSON(REPORTS_KEY, {});

  function saveReports() {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
  }

  function getReportEntry(className, studentName) {
    return (reports[className] && reports[className][studentName]) || {};
  }

  function setReportEntry(className, studentName, patch) {
    reports[className] = reports[className] || {};
    reports[className][studentName] = Object.assign({}, reports[className][studentName], patch);
    saveReports();
  }

  // Same back-compat translation as assets/attendance.js.
  function statusOf(entry) {
    if (!entry) return undefined;
    if (entry.status) return entry.status;
    if (entry.present === false) return 'absent';
    if (entry.present === true) return 'present';
    return undefined;
  }

  function classIdsForRoom(className) {
    return scheduleClasses.filter(c => (c.room || '').trim() === className).map(c => c.id);
  }

  function aggregateForStudent(className, studentName) {
    const ids = classIdsForRoom(className);
    let present = 0, late = 0, absent = 0;
    let participationSum = 0, participationCount = 0;

    Object.keys(attendance).forEach(sk => {
      const [date, idPart] = sk.split('::');
      if (!ids.includes(idPart)) return;
      const entry = attendance[sk][studentName];
      if (!entry) return;

      const status = statusOf(entry);
      if (status === 'present') present++;
      else if (status === 'late') late++;
      else if (status === 'absent') absent++;

      // Participation only counts from PARTICIPATION_START_DATE on, and
      // only for days the student actually attended. A day they attended
      // but wasn't explicitly rated counts as متوسط by default.
      if (date >= PARTICIPATION_START_DATE && (status === 'present' || status === 'late')) {
        const rated = entry.participation && PARTICIPATION_SCALE[entry.participation] !== undefined;
        participationSum += rated ? PARTICIPATION_SCALE[entry.participation] : PARTICIPATION_DEFAULT;
        participationCount++;
      }
    });

    const participationAvg = participationCount ? participationSum / participationCount : null;
    return { present, late, absent, participationAvg };
  }

  // ---------- Rendering ----------
  const container = document.getElementById('reportsContainer');
  const emptyState = document.getElementById('emptyState');

  function render() {
    container.innerHTML = '';
    const classNames = Object.keys(students).sort((a, b) => a.localeCompare(b, 'ar'));
    emptyState.hidden = classNames.length > 0;
    classNames.forEach(className => {
      container.appendChild(renderClassReport(className));
    });
  }

  function renderClassReport(className) {
    const wrap = document.createElement('div');
    wrap.className = 'class-card open report-card';

    const header = document.createElement('div');
    header.className = 'class-card-header';
    header.style.cursor = 'default';
    const nameEl = document.createElement('span');
    nameEl.className = 'class-name';
    nameEl.textContent = isolateLTR(className);
    header.appendChild(nameEl);
    const countEl = document.createElement('span');
    countEl.className = 'student-count';
    countEl.textContent = `${(students[className] || []).length} طالب`;
    header.appendChild(countEl);
    wrap.appendChild(header);

    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'schedule-wrap report-table-wrap';

    const table = document.createElement('table');
    table.className = 'grid report-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['اسم الطالب', 'حضور / تأخر / غياب', 'درجة الاختبار', 'الأعمال', 'المجموع', 'المشاركة', 'الدفتر', 'السلوك', 'ملاحظات'].forEach((label, i) => {
      const th = document.createElement('th');
      th.textContent = label;
      if (i === 0) th.className = 'period-col-header report-name-col';
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    (students[className] || []).forEach(studentName => {
      tbody.appendChild(renderStudentReportRow(className, studentName));
    });
    table.appendChild(tbody);

    scrollWrap.appendChild(table);
    wrap.appendChild(scrollWrap);
    return wrap;
  }

  function renderStudentReportRow(className, studentName) {
    const tr = document.createElement('tr');
    const agg = aggregateForStudent(className, studentName);
    const report = getReportEntry(className, studentName);

    const nameTd = document.createElement('td');
    nameTd.className = 'period-label report-name-col';
    nameTd.textContent = studentName;
    tr.appendChild(nameTd);

    const attTd = document.createElement('td');
    attTd.className = 'report-readonly';
    // No isolateLTR here on purpose: this is pure digits/slashes with no
    // Arabic letters, so the bidi algorithm already orders it correctly
    // to match the RTL header (حضور / تأخر / غياب) — forcing it LTR (as
    // an earlier version did) actually broke that alignment.
    attTd.textContent = `${agg.present} / ${agg.late} / ${agg.absent}`;
    tr.appendChild(attTd);

    const totalTd = document.createElement('td');
    totalTd.className = 'report-readonly';
    function updateTotal() {
      const test = report.testScore !== undefined && report.testScore !== null ? report.testScore : null;
      const coursework = report.courseworkScore !== undefined && report.courseworkScore !== null ? report.courseworkScore : null;
      totalTd.textContent = (test === null && coursework === null) ? '—' : (test || 0) + (coursework || 0);
    }

    const scoreTd = document.createElement('td');
    const scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    scoreInput.className = 'report-input report-score-input';
    scoreInput.placeholder = '—';
    scoreInput.value = report.testScore !== undefined && report.testScore !== null ? report.testScore : '';
    scoreInput.addEventListener('input', () => {
      report.testScore = scoreInput.value === '' ? null : Number(scoreInput.value);
      setReportEntry(className, studentName, { testScore: report.testScore });
      updateTotal();
    });
    scoreTd.appendChild(scoreInput);
    tr.appendChild(scoreTd);

    const courseworkTd = document.createElement('td');
    const courseworkInput = document.createElement('input');
    courseworkInput.type = 'number';
    courseworkInput.className = 'report-input report-score-input';
    courseworkInput.placeholder = '—';
    courseworkInput.value = report.courseworkScore !== undefined && report.courseworkScore !== null ? report.courseworkScore : '';
    courseworkInput.addEventListener('input', () => {
      report.courseworkScore = courseworkInput.value === '' ? null : Number(courseworkInput.value);
      setReportEntry(className, studentName, { courseworkScore: report.courseworkScore });
      updateTotal();
    });
    courseworkTd.appendChild(courseworkInput);
    tr.appendChild(courseworkTd);

    updateTotal();
    tr.appendChild(totalTd);

    const partTd = document.createElement('td');
    partTd.className = 'report-readonly';
    if (agg.participationAvg === null) {
      partTd.textContent = '—';
    } else {
      const rounded = Math.round(agg.participationAvg);
      partTd.textContent = `${PARTICIPATION_LABELS[rounded]} (${agg.participationAvg.toFixed(1)})`;
    }
    tr.appendChild(partTd);

    tr.appendChild(textInputCell(className, studentName, 'notebookReport', report.notebookReport));
    tr.appendChild(textInputCell(className, studentName, 'behaviorReport', report.behaviorReport));
    tr.appendChild(textInputCell(className, studentName, 'notes', report.notes));

    return tr;
  }

  function textInputCell(className, studentName, field, value) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'report-input';
    input.value = value || '';
    input.addEventListener('input', () => {
      setReportEntry(className, studentName, { [field]: input.value });
    });
    td.appendChild(input);
    return td;
  }

  // ---------- Init ----------
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.error('SW registration failed', e));
  }
})();
