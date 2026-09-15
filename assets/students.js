(() => {
  'use strict';

  const STORAGE_KEY = 'schedule_app_students_v1';
  const SCHEDULE_KEY = 'schedule_app_classes_ar_v1';
  const REPORTS_KEY = 'schedule_app_reports_v1';
  const ATTENDANCE_KEY = 'schedule_app_attendance_v1';

  // Forces strict left-to-right character order (LTR override, not just
  // isolate — a plain isolate isn't enough when a digit run sits right
  // after an Arabic letter, per bidi rule W2) so a class code like "12د1"
  // doesn't render as "1د12". Render-time only; never stored.
  function isolateLTR(text) {
    return `‭${text}‬`;
  }

  // A phone's own keyboard/locale can produce Arabic-Indic (٠١٢٣...) or
  // Persian/Urdu (۰۱۲۳...) digits instead of the plain Western ones (0-9)
  // this app's صف codes use. A class name typed or imported with those
  // digits would silently fail to string-match its schedule room (e.g.
  // "١٢ ع ٤" != "12 ع 4"), breaking the roster/schedule link — so every
  // class name is normalized to Western digits before it's used as a key.
  const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  function normalizeDigits(str) {
    return String(str).replace(/[٠-٩۰-۹]/g, (d) => {
      const arabicIdx = ARABIC_INDIC_DIGITS.indexOf(d);
      if (arabicIdx !== -1) return String(arabicIdx);
      return String(PERSIAN_DIGITS.indexOf(d));
    });
  }

  // ---------- State ----------
  let classes = loadClasses(); // { className: [studentName, ...] }
  let openClasses = new Set(); // which class cards are expanded

  // ---------- Persistence ----------
  function loadClasses() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('Failed to load student lists from storage', e);
      return {};
    }
  }

  function saveClasses() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(classes));
  }

  // Renaming a class here isn't just a label change: the schedule page
  // links a صف to its roster by matching this exact name against each
  // class entry's room field, and the reports page keeps its per-student
  // fields under this same name. So a rename has to also update those two
  // other pages' storage, or the roster would silently detach from the
  // schedule and lose its report data.
  function renameClass(oldName, newName) {
    if (classes[newName]) {
      alert(`يوجد فصل بالاسم "${isolateLTR(newName)}" موجود مسبقًا. اختر اسمًا آخر، أو احذف أحد الفصلين أولًا.`);
      return false;
    }

    classes[newName] = classes[oldName];
    delete classes[oldName];
    if (openClasses.has(oldName)) {
      openClasses.delete(oldName);
      openClasses.add(newName);
    }
    saveClasses();

    let updatedSessions = 0;
    try {
      const scheduleRaw = localStorage.getItem(SCHEDULE_KEY);
      if (scheduleRaw) {
        const scheduleClasses = JSON.parse(scheduleRaw);
        scheduleClasses.forEach(c => {
          if ((c.room || '').trim() === oldName) {
            c.room = newName;
            updatedSessions++;
          }
        });
        if (updatedSessions > 0) localStorage.setItem(SCHEDULE_KEY, JSON.stringify(scheduleClasses));
      }
    } catch (e) {
      console.error('Failed to update schedule rooms after rename', e);
    }

    let movedReports = false;
    try {
      const reportsRaw = localStorage.getItem(REPORTS_KEY);
      if (reportsRaw) {
        const reports = JSON.parse(reportsRaw);
        if (reports[oldName]) {
          reports[newName] = reports[oldName];
          delete reports[oldName];
          localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
          movedReports = true;
        }
      }
    } catch (e) {
      console.error('Failed to move reports after rename', e);
    }

    const notes = [];
    if (updatedSessions > 0) notes.push(`${updatedSessions} حصة بالجدول`);
    if (movedReports) notes.push('بيانات التقارير');
    if (notes.length > 0) {
      alert(`تم تغيير الاسم إلى "${isolateLTR(newName)}"، وتحديث الربط مع: ${notes.join(' و')}.`);
    }
    return true;
  }

  // Same reasoning as renameClass: attendance and reports keep their
  // per-student data under this exact name, so a name correction has to
  // carry that history along with it or the student would show up as if
  // they'd never been marked present or graded before.
  function renameStudent(className, oldName, newName) {
    const roster = classes[className] || [];
    const idx = roster.indexOf(oldName);
    if (idx === -1) return false;

    if (roster.includes(newName)) {
      alert(`يوجد طالب بالاسم نفسه "${newName}" في هذا الفصل مسبقًا. اختر اسمًا آخر.`);
      return false;
    }

    roster[idx] = newName;
    saveClasses();

    let movedReport = false;
    try {
      const reportsRaw = localStorage.getItem(REPORTS_KEY);
      if (reportsRaw) {
        const reports = JSON.parse(reportsRaw);
        if (reports[className] && reports[className][oldName]) {
          reports[className][newName] = reports[className][oldName];
          delete reports[className][oldName];
          localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
          movedReport = true;
        }
      }
    } catch (e) {
      console.error('Failed to move report data after student rename', e);
    }

    let movedSessions = 0;
    try {
      const scheduleRaw = localStorage.getItem(SCHEDULE_KEY);
      const attendanceRaw = localStorage.getItem(ATTENDANCE_KEY);
      if (scheduleRaw && attendanceRaw) {
        const scheduleClasses = JSON.parse(scheduleRaw);
        const classIds = new Set(
          scheduleClasses.filter(c => (c.room || '').trim() === className).map(c => c.id)
        );
        const attendance = JSON.parse(attendanceRaw);
        Object.keys(attendance).forEach(sessionKey => {
          const idPart = sessionKey.split('::')[1];
          if (!classIds.has(idPart)) return;
          const entry = attendance[sessionKey];
          if (entry && entry[oldName]) {
            entry[newName] = entry[oldName];
            delete entry[oldName];
            movedSessions++;
          }
        });
        if (movedSessions > 0) localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(attendance));
      }
    } catch (e) {
      console.error('Failed to move attendance records after student rename', e);
    }

    const notes = [];
    if (movedSessions > 0) notes.push(`${movedSessions} سجل حضور`);
    if (movedReport) notes.push('بيانات التقرير');
    if (notes.length > 0) {
      alert(`تم تغيير الاسم إلى "${newName}"، وتحديث الربط مع: ${notes.join(' و')}.`);
    }
    return true;
  }

  // Same "old boolean -> new status string" translation attendance.js
  // uses, duplicated here so the profile can read attendance history
  // without needing attendance.js loaded on this page.
  function statusOf(entry) {
    if (!entry) return undefined;
    if (entry.status) return entry.status;
    if (entry.present === false) return 'absent';
    if (entry.present === true) return 'present';
    return undefined;
  }

  // Pulls together everything scattered across the schedule, attendance
  // and reports stores for one student into a single read-only summary —
  // the whole point of the "ملف الطالب" feature is not having to flip
  // between three pages to see how one student is doing.
  function computeStudentProfile(className, studentName) {
    const stats = {
      present: 0, late: 0, absent: 0,
      excellent: 0, normal: 0, none: 0,
      notebookMissing: 0, positive: 0, negative: 0,
    };

    try {
      const scheduleRaw = localStorage.getItem(SCHEDULE_KEY);
      const attendanceRaw = localStorage.getItem(ATTENDANCE_KEY);
      if (scheduleRaw && attendanceRaw) {
        const scheduleClasses = JSON.parse(scheduleRaw);
        const classIds = new Set(
          scheduleClasses.filter(c => (c.room || '').trim() === className).map(c => c.id)
        );
        const attendance = JSON.parse(attendanceRaw);
        Object.keys(attendance).forEach(sk => {
          const idPart = sk.split('::')[1];
          if (!classIds.has(idPart)) return;
          const entry = attendance[sk][studentName];
          if (!entry) return;

          const status = statusOf(entry);
          if (status === 'present') stats.present++;
          else if (status === 'late') stats.late++;
          else if (status === 'absent') stats.absent++;

          if (entry.participation === 'excellent') stats.excellent++;
          else if (entry.participation === 'normal') stats.normal++;
          else if (entry.participation === 'none') stats.none++;

          if (entry.notebookMissing === true) stats.notebookMissing++;

          if (entry.behavior === 'positive') stats.positive++;
          else if (entry.behavior === 'negative') stats.negative++;
        });
      }
    } catch (e) {
      console.error('Failed to compute attendance stats for profile', e);
    }

    let report = {};
    try {
      const reportsRaw = localStorage.getItem(REPORTS_KEY);
      if (reportsRaw) {
        const reports = JSON.parse(reportsRaw);
        report = (reports[className] && reports[className][studentName]) || {};
      }
    } catch (e) {
      console.error('Failed to read report data for profile', e);
    }

    return { stats, report };
  }

  // ---------- Student profile modal ----------
  const profileModal = document.getElementById('profileModal');
  const profileModalTitle = document.getElementById('profileModalTitle');
  const profileModalBody = document.getElementById('profileModalBody');
  const closeProfileModalBtn = document.getElementById('closeProfileModalBtn');

  function closeProfileModal() {
    profileModal.hidden = true;
    profileModalBody.innerHTML = '';
  }
  closeProfileModalBtn.addEventListener('click', closeProfileModal);
  profileModal.addEventListener('click', (e) => { if (e.target === profileModal) closeProfileModal(); });

  function profileRow(label, value) {
    const row = document.createElement('div');
    row.className = 'profile-row';
    const l = document.createElement('span');
    l.className = 'profile-row-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'profile-row-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function openProfileModal(className, studentName) {
    const { stats, report } = computeStudentProfile(className, studentName);
    const totalDays = stats.present + stats.late + stats.absent;

    profileModalTitle.textContent = `ملف الطالب — ${studentName}`;
    profileModalBody.innerHTML = '';

    const attSection = document.createElement('div');
    attSection.className = 'profile-section';
    attSection.innerHTML = '<h3>📅 الحضور</h3>';
    if (totalDays === 0) {
      attSection.appendChild(profileRow('لا يوجد سجل حضور بعد', ''));
    } else {
      const pct = Math.round((stats.present / totalDays) * 100);
      attSection.appendChild(profileRow('نسبة الحضور', `${pct}%`));
      attSection.appendChild(profileRow('حاضر', `${stats.present} يوم`));
      attSection.appendChild(profileRow('متأخر', `${stats.late} يوم`));
      attSection.appendChild(profileRow('غائب', `${stats.absent} يوم`));
    }
    profileModalBody.appendChild(attSection);

    const partSection = document.createElement('div');
    partSection.className = 'profile-section';
    partSection.innerHTML = '<h3>🙋 المشاركة</h3>';
    partSection.appendChild(profileRow('ممتاز', String(stats.excellent)));
    partSection.appendChild(profileRow('متوسط', String(stats.normal)));
    partSection.appendChild(profileRow('ضعيف', String(stats.none)));
    profileModalBody.appendChild(partSection);

    const otherSection = document.createElement('div');
    otherSection.className = 'profile-section';
    otherSection.innerHTML = '<h3>📔 الدفتر والسلوك</h3>';
    otherSection.appendChild(profileRow('مرات عدم إحضار الدفتر', String(stats.notebookMissing)));
    otherSection.appendChild(profileRow('سلوك إيجابي', String(stats.positive)));
    otherSection.appendChild(profileRow('سلوك سلبي', String(stats.negative)));
    profileModalBody.appendChild(otherSection);

    const reportSection = document.createElement('div');
    reportSection.className = 'profile-section';
    reportSection.innerHTML = '<h3>📝 التقرير</h3>';
    reportSection.appendChild(profileRow('درجة الاختبار', report.testScore !== undefined && report.testScore !== '' ? String(report.testScore) : '—'));
    reportSection.appendChild(profileRow('درجة الأعمال', report.courseworkScore !== undefined && report.courseworkScore !== '' ? String(report.courseworkScore) : '—'));
    reportSection.appendChild(profileRow('ملاحظات الدفتر', report.notebookReport || '—'));
    reportSection.appendChild(profileRow('ملاحظات السلوك', report.behaviorReport || '—'));
    reportSection.appendChild(profileRow('ملاحظات عامة', report.notes || '—'));
    profileModalBody.appendChild(reportSection);

    profileModal.hidden = false;
  }

  // ---------- Rendering ----------
  const container = document.getElementById('classesContainer');
  const emptyState = document.getElementById('emptyState');

  function render() {
    container.innerHTML = '';
    const names = Object.keys(classes).sort((a, b) => a.localeCompare(b, 'ar'));

    emptyState.hidden = names.length > 0;

    names.forEach(className => {
      container.appendChild(renderClassCard(className));
    });
  }

  function renderClassCard(className) {
    const students = classes[className] || [];
    const card = document.createElement('div');
    card.className = 'class-card';
    card.dataset.className = className;
    if (openClasses.has(className)) card.classList.add('open');

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
    countEl.textContent = `${students.length} طالب`;
    header.appendChild(countEl);

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'btn btn-ghost btn-small';
    renameBtn.textContent = '✏️ إعادة تسمية';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = prompt('الاسم الجديد للفصل:', className);
      if (input === null) return; // cancelled
      const newName = normalizeDigits(input.trim());
      if (!newName || newName === className) return;
      if (renameClass(className, newName)) render();
    });
    header.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-small';
    deleteBtn.textContent = 'حذف الفصل';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`حذف فصل "${isolateLTR(className)}" وجميع طلابه؟`)) return;
      delete classes[className];
      openClasses.delete(className);
      saveClasses();
      render();
    });
    header.appendChild(deleteBtn);

    header.addEventListener('click', () => {
      if (openClasses.has(className)) openClasses.delete(className);
      else openClasses.add(className);
      render();
    });

    card.appendChild(header);

    if (openClasses.has(className)) {
      card.appendChild(renderClassBody(className));
    }

    return card;
  }

  function renderClassBody(className) {
    const body = document.createElement('div');
    body.className = 'class-card-body';

    if ((classes[className] || []).length > 1) {
      const sortBtn = document.createElement('button');
      sortBtn.type = 'button';
      sortBtn.className = 'btn btn-ghost btn-small sort-alpha-btn';
      sortBtn.textContent = 'ترتيب أبجدي';
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        classes[className].sort((a, b) => a.localeCompare(b, 'ar'));
        saveClasses();
        render();
      });
      body.appendChild(sortBtn);
    }

    const list = document.createElement('ul');
    list.className = 'student-list';

    (classes[className] || []).forEach((student, index) => {
      const li = document.createElement('li');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'student-name';
      nameSpan.textContent = student;
      li.appendChild(nameSpan);

      const moveBtns = document.createElement('div');
      moveBtns.className = 'student-move-btns';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'student-move-btn';
      upBtn.textContent = '▲';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => {
        const arr = classes[className];
        if (index === 0) return;
        [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
        saveClasses();
        render();
      });
      moveBtns.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'student-move-btn';
      downBtn.textContent = '▼';
      downBtn.disabled = index === (classes[className] || []).length - 1;
      downBtn.addEventListener('click', () => {
        const arr = classes[className];
        if (index === arr.length - 1) return;
        [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
        saveClasses();
        render();
      });
      moveBtns.appendChild(downBtn);

      li.appendChild(moveBtns);

      const profileBtn = document.createElement('button');
      profileBtn.type = 'button';
      profileBtn.className = 'student-edit';
      profileBtn.textContent = '👤';
      profileBtn.title = 'ملف الطالب';
      profileBtn.addEventListener('click', () => openProfileModal(className, student));
      li.appendChild(profileBtn);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'student-edit';
      editBtn.textContent = '✏️';
      editBtn.title = 'تعديل الاسم';
      editBtn.addEventListener('click', () => {
        const input = prompt('تعديل اسم الطالب:', student);
        if (input === null) return; // cancelled
        const newName = input.trim();
        if (!newName || newName === student) return;
        if (renameStudent(className, student, newName)) render();
      });
      li.appendChild(editBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'student-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', () => {
        classes[className].splice(index, 1);
        saveClasses();
        render();
      });
      li.appendChild(removeBtn);

      list.appendChild(li);
    });

    body.appendChild(list);

    const form = document.createElement('form');
    form.className = 'student-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'اسم الطالب';
    input.required = true;
    form.appendChild(input);

    const addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.className = 'btn btn-primary btn-small';
    addBtn.textContent = 'إضافة';
    form.appendChild(addBtn);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = input.value.trim();
      if (!name) return;
      classes[className] = classes[className] || [];
      classes[className].push(name);
      saveClasses();
      render();
    });
    form.addEventListener('click', (e) => e.stopPropagation());

    body.appendChild(form);
    return body;
  }

  // ---------- Add class modal ----------
  const modal = document.getElementById('classModal');
  const classForm = document.getElementById('classForm');
  const classNameInput = document.getElementById('className');

  function openModal() {
    classForm.reset();
    modal.hidden = false;
    classNameInput.focus();
  }
  function closeModal() {
    modal.hidden = true;
  }

  document.getElementById('addClassBtn').addEventListener('click', openModal);
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  classForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = normalizeDigits(classNameInput.value.trim());
    if (!name) return;
    if (!classes[name]) classes[name] = [];
    openClasses.add(name);
    saveClasses();
    render();
    closeModal();
  });

  // ---------- Excel import ----------
  const HEADER_WORDS = ['اسم الطالب', 'اسم الطالبة', 'الاسم', 'اسم', 'name', 'student', 'students'];

  function extractNamesFromColumn(rows, colIdx) {
    const values = rows
      .map(r => String((r && r[colIdx] !== undefined) ? r[colIdx] : '').trim())
      .filter(v => v.length > 0);
    if (values.length && HEADER_WORDS.includes(values[0].toLowerCase())) {
      values.shift();
    }
    return values;
  }

  function parseWorkbook(workbook) {
    const result = {};

    if (workbook.SheetNames.length > 1) {
      workbook.SheetNames.forEach(sheetName => {
        const ws = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        const names = extractNamesFromColumn(rows, 0);
        if (names.length) result[normalizeDigits(sheetName.trim())] = names;
      });
      return result;
    }

    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (!rows.length) return result;

    const header = (rows[0] || []).map(c => String(c).trim());
    const classColIdx = header.findIndex(h => /فصل|شعبة|section|class/i.test(h));
    const nameColIdx = header.findIndex(h => /اسم|name|طالب|student/i.test(h));

    if (classColIdx !== -1 && nameColIdx !== -1) {
      rows.slice(1).forEach(row => {
        const cls = normalizeDigits(String(row[classColIdx] || '').trim());
        const name = String(row[nameColIdx] || '').trim();
        if (cls && name) {
          (result[cls] = result[cls] || []).push(name);
        }
      });
      return result;
    }

    const names = extractNamesFromColumn(rows, 0);
    if (names.length) result[normalizeDigits(sheetName.trim())] = names;
    return result;
  }

  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const parsed = parseWorkbook(workbook);
        const parsedClassCount = Object.keys(parsed).length;

        if (parsedClassCount === 0) {
          alert('تعذّر العثور على فصول أو أسماء في هذا الملف. تأكد من الصيغة الموضحة أعلاه.');
          return;
        }

        const totalStudents = Object.values(parsed).reduce((sum, arr) => sum + arr.length, 0);
        const msg = `تم العثور على ${parsedClassCount} فصل و${totalStudents} طالب. ` +
          `سيستبدل الاستيراد قوائم أي فصل يحمل الاسم نفسه الموجود لديك حاليًا. هل تريد المتابعة؟`;
        if (!confirm(msg)) return;

        Object.assign(classes, parsed);
        saveClasses();
        render();
      } catch (err) {
        console.error(err);
        alert('تعذّرت قراءة هذا الملف — تأكد من أنه ملف إكسل (xlsx) صحيح.');
      } finally {
        importFile.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  });

  // ---------- JSON backup export/import ----------
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(classes, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `قوائم-الفصول-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const importBackupFile = document.getElementById('importBackupFile');
  document.getElementById('importBackupBtn').addEventListener('click', () => importBackupFile.click());
  importBackupFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (typeof data !== 'object' || Array.isArray(data) || data === null) {
          throw new Error('Invalid format');
        }
        if (Object.keys(classes).length > 0 && !confirm('سيؤدي الاستيراد إلى استبدال كل القوائم الحالية. هل تريد المتابعة؟')) {
          importBackupFile.value = '';
          return;
        }
        classes = data;
        saveClasses();
        render();
      } catch (err) {
        alert('تعذّرت قراءة هذا الملف — تأكد من أنه نسخة احتياطية صادرة من هذه الصفحة.');
      } finally {
        importBackupFile.value = '';
      }
    };
    reader.readAsText(file);
  });

  // ---------- Init ----------
  render();

  // Deep link from the schedule page's "📋 قائمة الفصل" quick-link — opens
  // straight to that class's roster instead of leaving the teacher to
  // scroll and find it manually.
  (() => {
    const deepLinkClass = new URLSearchParams(location.search).get('class');
    if (!deepLinkClass || !classes[deepLinkClass]) return;
    openClasses.add(deepLinkClass);
    render();
    const card = Array.from(container.querySelectorAll('.class-card')).find(el => el.dataset.className === deepLinkClass);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  })();

  // ---------- More-options menu ----------
  // The rarely-used utility buttons (import/backup/restore, force update)
  // used to crowd the topbar as individual buttons — collapsed here
  // behind one gear icon instead.
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
