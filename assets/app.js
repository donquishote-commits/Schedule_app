(() => {
  'use strict';

  const STORAGE_KEY = 'schedule_app_classes_ar_v1';

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

  // Converts a 24-hour "HH:MM" period time to the informal 12-hour form
  // the school actually uses (no AM/PM marker, e.g. "13:05" -> "1:05").
  function to12(t) {
    const [h, m] = t.split(':').map(Number);
    const h12 = h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')}`;
  }

  const ICS_DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const SCHOOL_UTC_OFFSET_HOURS = 3; // Arabian Standard Time (Saudi/Kuwait/Qatar/Bahrain), no DST

  // The user's real timetable, used to seed the schedule the first time
  // the app runs on a browser with no saved data yet.
  const DEFAULT_CLASSES = [
    { id: 'seed-1', day: 0, periodKey: 1, subject: 'الفلسفة', room: '12د1', color: '#5b7fdb', notes: [] },
    { id: 'seed-2', day: 2, periodKey: 6, subject: 'الفلسفة', room: '12د1', color: '#5b7fdb', notes: [] },
    { id: 'seed-3', day: 2, periodKey: 7, subject: 'الدستور', room: '12ع4', color: '#2f9e77', notes: [] },
    { id: 'seed-4', day: 3, periodKey: 3, subject: 'اجتماع القسم الأسبوعي', room: '', color: '#8b6fc9', notes: [] },
    { id: 'seed-5', day: 4, periodKey: 2, subject: 'الدستور', room: '12ع6', color: '#2f9e77', notes: [] },
    { id: 'seed-6', day: 4, periodKey: 7, subject: 'الدستور', room: '12ع5', color: '#2f9e77', notes: [] },
  ];

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

  // ---------- Grid rendering ----------
  const gridEl = document.getElementById('grid');

  function renderGrid() {
    gridEl.innerHTML = '';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const cornerHeader = document.createElement('th');
    cornerHeader.className = 'period-col-header';
    cornerHeader.textContent = 'الحصة';
    headRow.appendChild(cornerHeader);

    DAYS.forEach(day => {
      const th = document.createElement('th');
      th.textContent = day.label;
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
        td.textContent = `${period.label} (${formatRange(to12(period.start), to12(period.end))})`;
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
        const existing = findClass(day.key, period.key);

        if (existing) {
          td.appendChild(renderClassBlock(existing));
        } else {
          td.addEventListener('click', () => openAddModal(day.key, period.key));
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    gridEl.appendChild(tbody);
  }

  function renderClassBlock(c) {
    const block = document.createElement('div');
    block.className = 'class-block';
    block.style.background = c.color || '#5b7fdb';

    const subject = document.createElement('span');
    subject.className = 'subject';
    subject.textContent = c.subject;
    block.appendChild(subject);

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

  // ---------- Modal ----------
  const modal = document.getElementById('classModal');
  const modalTitle = document.getElementById('modalTitle');
  const classForm = document.getElementById('classForm');
  const daySelect = document.getElementById('day');
  const periodSelect = document.getElementById('period');
  const deleteBtn = document.getElementById('deleteBtn');
  const notesSection = document.getElementById('notesSection');
  const notesList = document.getElementById('notesList');
  const noteForm = document.getElementById('noteForm');
  const noteText = document.getElementById('noteText');

  DAYS.forEach(day => {
    const opt = document.createElement('option');
    opt.value = day.key;
    opt.textContent = day.label;
    daySelect.appendChild(opt);
  });

  CLASS_PERIODS.forEach(period => {
    const opt = document.createElement('option');
    opt.value = period.key;
    opt.textContent = `${period.label} (${formatRange(to12(period.start), to12(period.end))})`;
    periodSelect.appendChild(opt);
  });

  function openModal() {
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    classForm.reset();
    editingId = null;
  }

  function openAddModal(dayKey, periodKey) {
    editingId = null;
    modalTitle.textContent = 'إضافة حصة';
    deleteBtn.hidden = true;
    notesSection.hidden = true;
    classForm.reset();
    document.getElementById('classId').value = '';
    daySelect.value = dayKey;
    periodSelect.value = periodKey;
    document.getElementById('color').value = '#5b7fdb';
    openModal();
  }

  function openEditModal(id) {
    const c = classes.find(x => x.id === id);
    if (!c) return;
    editingId = id;
    modalTitle.textContent = 'تعديل الحصة';
    deleteBtn.hidden = false;
    notesSection.hidden = false;

    document.getElementById('classId').value = c.id;
    document.getElementById('subject').value = c.subject;
    document.getElementById('room').value = c.room || '';
    daySelect.value = c.day;
    periodSelect.value = c.periodKey;
    document.getElementById('color').value = c.color || '#5b7fdb';

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
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  classForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const subject = document.getElementById('subject').value.trim();
    const room = document.getElementById('room').value.trim();
    const day = Number(daySelect.value);
    const periodKey = isNaN(Number(periodSelect.value)) ? periodSelect.value : Number(periodSelect.value);
    const color = document.getElementById('color').value;

    const conflict = findClass(day, periodKey);
    if (conflict && conflict.id !== editingId) {
      alert('هناك حصة أخرى في هذا الوقت. عدّل تلك الحصة أو اختر وقتًا آخر.');
      return;
    }

    if (editingId) {
      const c = classes.find(x => x.id === editingId);
      Object.assign(c, { subject, room, day, periodKey, color });
    } else {
      classes.push({
        id: uid(),
        subject, room, day, periodKey, color,
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
      alert('ما فيه حصص مضافة بعد.');
      return;
    }
    const blob = new Blob([buildICS()], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'جدولي.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    alert('نزل ملف التقويم. افتح Google Calendar من الكمبيوتر ← إعدادات (أيقونة الترس) ← استيراد وتصدير ← استيراد، واختر هذا الملف.\n\nملاحظة: هذا تصدير لمرة واحدة — أي تعديل لاحق بالجدول يحتاج تصدير واستيراد من جديد.');
  });

  // ---------- Init ----------
  saveClasses(); // persist seed data on first run so it's there on next load too
  renderGrid();

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
