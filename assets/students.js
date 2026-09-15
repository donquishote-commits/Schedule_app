(() => {
  'use strict';

  const STORAGE_KEY = 'schedule_app_students_v1';

  // Forces strict left-to-right character order (LTR override, not just
  // isolate — a plain isolate isn't enough when a digit run sits right
  // after an Arabic letter, per bidi rule W2) so a class code like "12د1"
  // doesn't render as "1د12". Render-time only; never stored.
  function isolateLTR(text) {
    return `‭${text}‬`;
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

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-small';
    deleteBtn.textContent = 'حذف الفصل';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`حذف فصل "${isolateLTR(className)}" وكل الطلاب فيه؟`)) return;
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
    const name = classNameInput.value.trim();
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
        if (names.length) result[sheetName.trim()] = names;
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
        const cls = String(row[classColIdx] || '').trim();
        const name = String(row[nameColIdx] || '').trim();
        if (cls && name) {
          (result[cls] = result[cls] || []).push(name);
        }
      });
      return result;
    }

    const names = extractNamesFromColumn(rows, 0);
    if (names.length) result[sheetName.trim()] = names;
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
          alert('ما قدرت ألقى فصول أو أسماء بهالملف. تأكد من الصيغة الموضحة بالأعلى.');
          return;
        }

        const totalStudents = Object.values(parsed).reduce((sum, arr) => sum + arr.length, 0);
        const msg = `لقيت ${parsedClassCount} فصل و${totalStudents} طالب. ` +
          `الاستيراد بيستبدل قوائم أي فصل بنفس الاسم موجود عندك حاليًا. تكمل؟`;
        if (!confirm(msg)) return;

        Object.assign(classes, parsed);
        saveClasses();
        render();
      } catch (err) {
        console.error(err);
        alert('تعذّرت قراءة هذا الملف — تأكد إنه ملف إكسل (xlsx) صحيح.');
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
