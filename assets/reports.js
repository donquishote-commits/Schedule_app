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

  // ---------- Export (Excel / PDF) ----------
  const EXPORT_HEADER = ['اسم الطالب', 'حضور', 'تأخر', 'غياب', 'درجة الاختبار', 'الأعمال', 'المجموع', 'المشاركة', 'الدفتر', 'السلوك', 'ملاحظات'];

  function buildExportRows(className) {
    const rows = [EXPORT_HEADER];
    (students[className] || []).forEach(studentName => {
      const agg = aggregateForStudent(className, studentName);
      const report = getReportEntry(className, studentName);
      const test = report.testScore !== undefined && report.testScore !== null ? report.testScore : null;
      const coursework = report.courseworkScore !== undefined && report.courseworkScore !== null ? report.courseworkScore : null;
      const total = (test === null && coursework === null) ? '' : (test || 0) + (coursework || 0);
      const participationText = agg.participationAvg === null
        ? ''
        : `${PARTICIPATION_LABELS[Math.round(agg.participationAvg)]} (${agg.participationAvg.toFixed(1)})`;

      rows.push([
        studentName,
        agg.present,
        agg.late,
        agg.absent,
        test === null ? '' : test,
        coursework === null ? '' : coursework,
        total,
        participationText,
        report.notebookReport || '',
        report.behaviorReport || '',
        report.notes || '',
      ]);
    });
    return rows;
  }

  // Class names can contain characters Excel forbids in a sheet name
  // (: \ / ? * [ ]) and are capped at 31 chars.
  function safeSheetName(className) {
    return (className || 'تقرير').replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'تقرير';
  }

  function safeFileName(className) {
    return (className || 'تقرير').replace(/[\\/:*?"<>|]/g, '-');
  }

  function exportClassExcel(className) {
    const rows = buildExportRows(className);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = EXPORT_HEADER.map((_, i) => ({ wch: i === 0 ? 20 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(className));
    XLSX.writeFile(wb, `${safeFileName(className)}.xlsx`);
  }

  const printArea = document.getElementById('printArea');

  function exportClassPDF(className) {
    const rows = buildExportRows(className);
    const title = document.createElement('h2');
    title.textContent = className;

    const table = document.createElement('table');
    table.className = 'print-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    rows[0].forEach(label => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.slice(1).forEach(rowData => {
      const tr = document.createElement('tr');
      rowData.forEach(cell => {
        const td = document.createElement('td');
        td.textContent = cell === '' || cell === null || cell === undefined ? '—' : cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    printArea.innerHTML = '';
    printArea.appendChild(title);
    printArea.appendChild(table);

    document.body.classList.add('printing');
    window.print();
  }

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing');
  });

  // ---------- Rendering ----------
  const container = document.getElementById('reportsContainer');
  const emptyState = document.getElementById('emptyState');
  let openClasses = new Set(); // which class report cards are expanded — collapsed by default

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
    wrap.className = 'class-card report-card';
    if (openClasses.has(className)) wrap.classList.add('open');

    const header = document.createElement('div');
    header.className = 'class-card-header';

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '◀';
    header.appendChild(chevron);

    const nameEl = document.createElement('span');
    nameEl.className = 'class-name';
    nameEl.textContent = isolateLTR(className);
    header.appendChild(nameEl);
    const countEl = document.createElement('span');
    countEl.className = 'student-count';
    countEl.textContent = `${(students[className] || []).length} طالب`;
    header.appendChild(countEl);

    const exportBtns = document.createElement('div');
    exportBtns.className = 'report-export-btns';

    const excelBtn = document.createElement('button');
    excelBtn.type = 'button';
    excelBtn.className = 'btn btn-ghost btn-small';
    excelBtn.textContent = 'تصدير Excel';
    excelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportClassExcel(className);
    });
    exportBtns.appendChild(excelBtn);

    const pdfBtn = document.createElement('button');
    pdfBtn.type = 'button';
    pdfBtn.className = 'btn btn-ghost btn-small';
    pdfBtn.textContent = 'تصدير PDF';
    pdfBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportClassPDF(className);
    });
    exportBtns.appendChild(pdfBtn);

    header.appendChild(exportBtns);

    header.addEventListener('click', () => {
      if (openClasses.has(className)) openClasses.delete(className);
      else openClasses.add(className);
      render();
    });

    wrap.appendChild(header);

    if (openClasses.has(className)) {
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
    }

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

    tr.appendChild(textInputCell(className, studentName, 'notebookReport', report.notebookReport, 'تقرير الدفتر'));
    tr.appendChild(textInputCell(className, studentName, 'behaviorReport', report.behaviorReport, 'تقرير السلوك'));
    tr.appendChild(textInputCell(className, studentName, 'notes', report.notes, 'ملاحظات'));

    return tr;
  }

  // A plain text input truncates and can't be read back once a paragraph
  // gets long, so these cells are a button showing a one-line preview;
  // clicking opens a modal with a full-size textarea to actually read/edit.
  function textInputCell(className, studentName, field, value, label) {
    const td = document.createElement('td');
    td.className = 'report-text-cell';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'report-text-preview';
    if (!value) btn.classList.add('empty');
    btn.textContent = value || '—';
    btn.addEventListener('click', () => openNoteModal(className, studentName, field, label, btn));
    td.appendChild(btn);
    return td;
  }

  // ---------- Note edit modal ----------
  const noteModal = document.getElementById('noteModal');
  const noteModalTitle = document.getElementById('noteModalTitle');
  const noteModalTextarea = document.getElementById('noteModalTextarea');
  const noteModalForm = document.getElementById('noteModalForm');
  let activeNote = null;

  function openNoteModal(className, studentName, field, label, btn) {
    activeNote = { className, studentName, field, btn };
    noteModalTitle.textContent = `${label} — ${studentName}`;
    noteModalTextarea.value = getReportEntry(className, studentName)[field] || '';
    noteModal.hidden = false;
    noteModalTextarea.focus();
  }

  function closeNoteModal() {
    noteModal.hidden = true;
    activeNote = null;
  }

  noteModalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!activeNote) return;
    const { className, studentName, field, btn } = activeNote;
    const value = noteModalTextarea.value;
    setReportEntry(className, studentName, { [field]: value });
    btn.textContent = value || '—';
    btn.classList.toggle('empty', !value);
    closeNoteModal();
  });

  document.getElementById('cancelNoteBtn').addEventListener('click', closeNoteModal);
  document.getElementById('closeNoteModalBtn').addEventListener('click', closeNoteModal);
  noteModal.addEventListener('click', (e) => {
    if (e.target === noteModal) closeNoteModal();
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
      } finally {
        location.reload();
      }
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.error('SW registration failed', e));
  }
})();
