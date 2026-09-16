(() => {
  'use strict';

  const SCHEDULE_KEY = 'schedule_app_classes_ar_v1';
  const STUDENTS_KEY = 'schedule_app_students_v1';
  const ATTENDANCE_KEY = 'schedule_app_attendance_v1';
  const REPORTS_KEY = 'schedule_app_reports_v1';
  const TERMS_KEY = 'schedule_app_terms_v1';
  const TEMP_SESSIONS_KEY = 'schedule_app_temp_sessions_v1';

  const PARTICIPATION_SCALE = { excellent: 1, normal: 2, none: 3 };
  const PARTICIPATION_LABELS = { 1: 'ممتاز', 2: 'متوسط', 3: 'ضعيف' };
  const PARTICIPATION_DEFAULT = 2; // متوسط — used for days the student attended but wasn't rated
  // Fallback only used until the teacher sets up term dates from صفحة
  // المتابعة اليومية (⚙️ ← تحديد الفصلين الدراسيين) — once they do,
  // isOutsideTerms() below takes over as the real boundary.
  const PARTICIPATION_START_DATE = '2026-12-20';

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
  const tempSessions = loadJSON(TEMP_SESSIONS_KEY, []);
  const students = loadJSON(STUDENTS_KEY, {});
  const attendance = loadJSON(ATTENDANCE_KEY, {});
  const terms = loadJSON(TERMS_KEY, { term1Start: '', term1End: '', term2Start: '', term2End: '' });
  const termsConfigured = !!(terms.term1Start || terms.term1End || terms.term2Start || terms.term2End);

  // Mirrors attendance.js's isOutsideTerms() — a day before the first
  // term starts, in the mid-year gap (once both of those boundaries are
  // set), or after the second term ends.
  function isOutsideTerms(dateISO) {
    if (terms.term1Start && dateISO < terms.term1Start) return true;
    if (terms.term1End && terms.term2Start && dateISO > terms.term1End && dateISO < terms.term2Start) return true;
    if (terms.term2End && dateISO > terms.term2End) return true;
    return false;
  }

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

  // Includes temp session ids (تبديل/تغطية) for this room too — those are
  // recorded under their own id, not a recurring class's, so without this
  // their attendance would be silently invisible in reports.
  function classIdsForRoom(className) {
    const regularIds = scheduleClasses.filter(c => (c.room || '').trim() === className).map(c => c.id);
    const tempIds = tempSessions.filter(t => (t.room || '').trim() === className).map(t => t.id);
    return [...regularIds, ...tempIds];
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

      // Participation only counts for days actually within the school
      // term (once the teacher's set one up — otherwise falls back to the
      // old fixed start date), and only for days the student actually
      // attended. A day they attended but wasn't explicitly rated counts
      // as متوسط by default.
      const withinTerm = termsConfigured ? !isOutsideTerms(date) : date >= PARTICIPATION_START_DATE;
      if (withinTerm && (status === 'present' || status === 'late')) {
        const rated = entry.participation && PARTICIPATION_SCALE[entry.participation] !== undefined;
        participationSum += rated ? PARTICIPATION_SCALE[entry.participation] : PARTICIPATION_DEFAULT;
        participationCount++;
      }
    });

    const participationAvg = participationCount ? participationSum / participationCount : null;
    return { present, late, absent, participationAvg };
  }

  // ---------- Overview (most-absent students, across every class) ----------
  // Day-level attendance percentages live on the daily follow-up page
  // instead, right where you take attendance — this page keeps only the
  // thing that's actually useful to see here: who needs attention.
  function computeOverview() {
    const perStudent = [];

    Object.keys(students).forEach(className => {
      (students[className] || []).forEach(studentName => {
        const agg = aggregateForStudent(className, studentName);
        if (agg.absent > 0) {
          perStudent.push({ className, studentName, absent: agg.absent });
        }
      });
    });

    const topAbsentees = perStudent
      .sort((a, b) => b.absent - a.absent)
      .slice(0, 8);

    return { topAbsentees };
  }

  function renderOverview() {
    const card = document.getElementById('overviewCard');
    const overview = computeOverview();

    if (overview.topAbsentees.length === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    card.innerHTML = '';

    const section = document.createElement('div');
    section.className = 'overview-absentees';
    const heading = document.createElement('h3');
    heading.textContent = 'أكثر الطلاب غيابًا';
    section.appendChild(heading);

    const list = document.createElement('ol');
    overview.topAbsentees.forEach(s => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'overview-absentee-name';
      nameSpan.textContent = s.studentName;
      const classSpan = document.createElement('span');
      classSpan.className = 'overview-absentee-class';
      classSpan.textContent = isolateLTR(s.className);
      const countSpan = document.createElement('span');
      countSpan.className = 'overview-absentee-count';
      countSpan.textContent = `${s.absent} غياب`;
      li.appendChild(nameSpan);
      li.appendChild(classSpan);
      li.appendChild(countSpan);
      list.appendChild(li);
    });
    section.appendChild(list);
    card.appendChild(section);
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
    // Mirrors the sheet so column A (اسم الطالب) opens on the right, same
    // as the on-screen table — the data/column order itself is unchanged.
    ws['!sheetViews'] = [{ rightToLeft: true }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(className));
    XLSX.writeFile(wb, `${safeFileName(className)}.xlsx`);
  }

  // One workbook, one sheet per class — sheet names de-duplicated in case
  // two class names collide after the 31-char/forbidden-character cleanup.
  function exportAllClassesExcel() {
    const classNames = Object.keys(students).sort((a, b) => a.localeCompare(b, 'ar'));
    if (classNames.length === 0) {
      alert('لا توجد فصول بعد.');
      return;
    }

    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const usedNames = new Set();
    classNames.forEach(className => {
      const rows = buildExportRows(className);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = EXPORT_HEADER.map((_, i) => ({ wch: i === 0 ? 20 : 14 }));
      ws['!sheetViews'] = [{ rightToLeft: true }];

      let sheetName = safeSheetName(className);
      let suffix = 2;
      while (usedNames.has(sheetName)) {
        const base = safeSheetName(className).slice(0, 28);
        sheetName = `${base} ${suffix}`;
        suffix++;
      }
      usedNames.add(sheetName);

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `كل-الفصول-${date}.xlsx`);
  }

  // ---------- Start a new term (clear grades only) ----------
  // The schedule, rosters, attendance history, and notebook/behavior/notes
  // are untouched — only test scores and coursework get wiped, since
  // those are the only thing that's specific to one term's exams.
  const FULL_BACKUP_KEYS = {
    schedule: SCHEDULE_KEY,
    students: STUDENTS_KEY,
    attendance: ATTENDANCE_KEY,
    reports: REPORTS_KEY,
  };

  function downloadFullBackup(filenamePrefix) {
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
    a.download = `${filenamePrefix}-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function startNewTerm() {
    let scoredCount = 0;
    Object.values(reports).forEach(classReports => {
      Object.values(classReports).forEach(entry => {
        if ((entry.testScore !== undefined && entry.testScore !== null) ||
            (entry.courseworkScore !== undefined && entry.courseworkScore !== null)) {
          scoredCount++;
        }
      });
    });

    if (scoredCount === 0) {
      alert('لا توجد درجات مسجّلة أصلًا لحذفها.');
      return;
    }

    if (!confirm(
      `سيؤدي بدء فصل دراسي جديد إلى حذف درجة الاختبار والأعمال لـ ${scoredCount} طالب عبر جميع الفصول.\n\n` +
      'يبقى الجدول وقوائم الطلاب والحضور والدفتر/السلوك/الملاحظات كما هي دون أي تغيير.\n\n' +
      'سيتم تنزيل نسخة احتياطية شاملة أولًا قبل الحذف. هل تريد المتابعة؟'
    )) return;

    downloadFullBackup('نسخة-قبل-الأرشفة');

    Object.keys(reports).forEach(className => {
      Object.keys(reports[className]).forEach(studentName => {
        const entry = reports[className][studentName];
        delete entry.testScore;
        delete entry.courseworkScore;
      });
    });
    saveReports();

    alert('تم حذف الدرجات لجميع الطلاب. بقية البيانات محفوظة كما هي.');
    render();
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
    wrap.dataset.className = className;
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

  // ---------- Canned phrases (quick-insert into الدفتر/السلوك/ملاحظات) ----------
  // Each of the three note fields keeps its own phrase list, seeded with
  // sensible defaults on first use, then freely editable per teacher —
  // phrases they add or remove are theirs, kept separate from the report
  // data itself so clearing/archiving reports never touches this library.
  const CANNED_PHRASES_KEY = 'schedule_app_canned_phrases_v1';
  const DEFAULT_PHRASES = {
    notebookReport: ['الدفتر منظم ومرتب', 'ناقص بعض الواجبات', 'ممتاز في تدوين الملاحظات', 'يحتاج إلى متابعة أكبر للدفتر'],
    behaviorReport: ['سلوك ممتاز داخل الصف', 'متعاون مع زملائه', 'يحتاج إلى ضبط أكبر للسلوك', 'قائد إيجابي في النقاش'],
    notes: ['متفوق دراسيًا', 'يحتاج إلى متابعة من ولي الأمر', 'تحسن ملحوظ هذا الأسبوع', 'يحتاج إلى مزيد من التشجيع على المشاركة'],
  };
  // The wording above was tightened to Modern Standard Arabic after this
  // feature first shipped — a device that already seeded the earlier
  // phrasing keeps it forever otherwise, since loadPhrases() below only
  // fills in a field that's missing entirely. This one-time check swaps a
  // field back to today's defaults ONLY if it still exactly matches the
  // old wording untouched, so a teacher who has already added/removed
  // phrases of their own is never overwritten.
  const OLD_DEFAULT_PHRASES = {
    notebookReport: ['الدفتر منظم ومرتب', 'ناقص بعض الواجبات', 'ممتاز في تدوين الملاحظات', 'يحتاج متابعة أكثر للدفتر'],
    behaviorReport: ['سلوك ممتاز داخل الصف', 'متعاون مع زملائه', 'يحتاج ضبط أكثر للسلوك', 'قائد إيجابي في النقاش'],
    notes: ['متفوق دراسيًا', 'يحتاج متابعة من ولي الأمر', 'تحسن ملحوظ هذا الأسبوع', 'يحتاج تشجيع أكثر على المشاركة'],
  };
  function arraysEqual(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function loadPhrases() {
    const stored = loadJSON(CANNED_PHRASES_KEY, {});
    let changed = false;
    Object.keys(DEFAULT_PHRASES).forEach(field => {
      if (!stored[field]) {
        stored[field] = [...DEFAULT_PHRASES[field]];
        changed = true;
      } else if (arraysEqual(stored[field], OLD_DEFAULT_PHRASES[field])) {
        stored[field] = [...DEFAULT_PHRASES[field]];
        changed = true;
      }
    });
    if (changed) localStorage.setItem(CANNED_PHRASES_KEY, JSON.stringify(stored));
    return stored;
  }

  let cannedPhrases = loadPhrases();
  function savePhrases() {
    localStorage.setItem(CANNED_PHRASES_KEY, JSON.stringify(cannedPhrases));
  }

  // Inserts at the cursor (or replaces a selection) instead of always
  // appending, so a phrase can be dropped in the middle of an existing
  // note; a space is added only when needed so words don't run together.
  function insertPhraseAtCursor(textarea, phrase) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const insertText = (needsSpace ? ' ' : '') + phrase;
    textarea.value = before + insertText + after;
    const cursorPos = (before + insertText).length;
    textarea.focus();
    textarea.setSelectionRange(cursorPos, cursorPos);
  }

  // ---------- Note edit modal ----------
  const noteModal = document.getElementById('noteModal');
  const noteModalTitle = document.getElementById('noteModalTitle');
  const noteModalTextarea = document.getElementById('noteModalTextarea');
  const noteModalPhrases = document.getElementById('noteModalPhrases');
  const newPhraseInput = document.getElementById('newPhraseInput');
  const addPhraseBtn = document.getElementById('addPhraseBtn');
  const noteModalForm = document.getElementById('noteModalForm');
  let activeNote = null;

  function renderPhraseChips() {
    noteModalPhrases.innerHTML = '';
    if (!activeNote) return;
    const list = cannedPhrases[activeNote.field] || [];
    list.forEach((phrase, index) => {
      const chip = document.createElement('div');
      chip.className = 'phrase-chip';

      const textBtn = document.createElement('button');
      textBtn.type = 'button';
      textBtn.className = 'phrase-chip-text';
      textBtn.textContent = phrase;
      textBtn.addEventListener('click', () => insertPhraseAtCursor(noteModalTextarea, phrase));
      chip.appendChild(textBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'phrase-chip-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'حذف هذه العبارة من القائمة';
      removeBtn.addEventListener('click', () => {
        if (!confirm(`حذف العبارة "${phrase}" من قائمة العبارات الجاهزة؟`)) return;
        cannedPhrases[activeNote.field].splice(index, 1);
        savePhrases();
        renderPhraseChips();
      });
      chip.appendChild(removeBtn);

      noteModalPhrases.appendChild(chip);
    });
  }

  addPhraseBtn.addEventListener('click', () => {
    if (!activeNote) return;
    const text = newPhraseInput.value.trim();
    if (!text) return;
    cannedPhrases[activeNote.field] = cannedPhrases[activeNote.field] || [];
    cannedPhrases[activeNote.field].push(text);
    savePhrases();
    newPhraseInput.value = '';
    renderPhraseChips();
  });
  newPhraseInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPhraseBtn.click();
    }
  });

  function openNoteModal(className, studentName, field, label, btn) {
    const originalValue = getReportEntry(className, studentName)[field] || '';
    activeNote = { className, studentName, field, btn, originalValue };
    noteModalTitle.textContent = `${label} — ${studentName}`;
    noteModalTextarea.value = originalValue;
    newPhraseInput.value = '';
    renderPhraseChips();
    noteModal.hidden = false;
    noteModalTextarea.focus();
  }

  function closeNoteModal() {
    if (activeNote && noteModalTextarea.value !== activeNote.originalValue) {
      if (!confirm('لديك تعديلات على الملاحظة لم تُحفظ. إذا أغلقت الآن، ستُفقد هذه التعديلات. هل تريد المتابعة؟')) return;
    }
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
  // Clicking the backdrop no longer closes the modal — only the explicit
  // close/cancel buttons do, so a stray tap outside can't discard a note.

  // ---------- Init ----------
  const participationStartHintEl = document.getElementById('participationStartHint');
  if (participationStartHintEl) {
    participationStartHintEl.textContent = termsConfigured
      ? 'يُحتسب فقط ضمن نطاق الفصلين الدراسيين المحدَّدَين (من صفحة المتابعة اليومية) — أي يوم يحضره الطالب دون تقييم محدد يُحسب "متوسط".'
      : 'يبدأ احتساب المشاركة من 20/12 فما بعد — أي يوم يحضره الطالب دون تقييم محدد يُحسب "متوسط".';
  }

  render();
  renderOverview();

  // Deep link from the schedule page's "📊 تقرير الفصل" quick-link — opens
  // straight to that class's report instead of leaving the teacher to
  // scroll and find it manually.
  (() => {
    const deepLinkClass = new URLSearchParams(location.search).get('class');
    if (!deepLinkClass || !students[deepLinkClass]) return;
    openClasses.add(deepLinkClass);
    render();
    const card = Array.from(container.querySelectorAll('.report-card')).find(el => el.dataset.className === deepLinkClass);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  })();

  document.getElementById('exportAllExcelBtn').addEventListener('click', exportAllClassesExcel);
  document.getElementById('newTermBtn').addEventListener('click', startNewTerm);

  // ---------- More-options menu ----------
  // The rarely-used utility buttons (start new term, force update) used
  // to sit as individual topbar buttons — collapsed here behind one gear
  // icon instead.
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.error('SW registration failed', e));
  }
})();
