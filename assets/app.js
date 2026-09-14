(() => {
  'use strict';

  const STORAGE_KEY = 'schedule_app_classes_v1';
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const START_HOUR = 7;   // grid starts at 7:00
  const END_HOUR = 19;    // grid ends at 19:00
  const HOUR_PX = 56;     // must match --hour-height in style.css

  // ---------- State ----------
  let classes = loadClasses();
  let editingId = null;

  // ---------- Persistence ----------
  function loadClasses() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
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

  // ---------- Time helpers ----------
  function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  function minutesToLabel(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }

  // ---------- Grid rendering ----------
  const gridEl = document.getElementById('grid');

  function renderGrid() {
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `60px repeat(${DAYS.length}, 1fr)`;
    const totalHours = END_HOUR - START_HOUR;
    gridEl.style.gridTemplateRows = `36px ${totalHours * HOUR_PX}px`;

    // Header row
    const cornerHeader = document.createElement('div');
    cornerHeader.className = 'grid-header time-col-header';
    gridEl.appendChild(cornerHeader);

    DAY_NAMES.forEach(name => {
      const h = document.createElement('div');
      h.className = 'grid-header';
      h.textContent = name;
      gridEl.appendChild(h);
    });

    // Time label column
    const timeCol = document.createElement('div');
    timeCol.style.position = 'relative';
    timeCol.style.height = `${totalHours * HOUR_PX}px`;
    for (let h = START_HOUR; h < END_HOUR; h++) {
      const label = document.createElement('div');
      label.className = 'time-label';
      label.style.height = `${HOUR_PX}px`;
      label.textContent = minutesToLabel(h * 60);
      timeCol.appendChild(label);
    }
    gridEl.appendChild(timeCol);

    // Day columns
    DAYS.forEach((day, dayIndex) => {
      const col = document.createElement('div');
      col.className = 'day-col';
      col.style.height = `${totalHours * HOUR_PX}px`;
      col.dataset.day = dayIndex;

      col.addEventListener('click', (e) => {
        if (e.target !== col) return; // ignore clicks on class blocks
        const rect = col.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const minutesFromStart = (y / HOUR_PX) * 60;
        let totalMins = START_HOUR * 60 + minutesFromStart;
        totalMins = Math.round(totalMins / 15) * 15; // snap to 15 min
        openAddModal(dayIndex, totalMins);
      });

      classes
        .filter(c => c.day === dayIndex)
        .forEach(c => col.appendChild(renderClassBlock(c)));

      gridEl.appendChild(col);
    });

    if (classes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No classes yet — click "+ Add Class" or click anywhere on the grid to add one.';
      empty.style.gridColumn = `1 / span ${DAYS.length + 1}`;
      gridEl.appendChild(empty);
    }
  }

  function renderClassBlock(c) {
    const block = document.createElement('div');
    block.className = 'class-block';
    const startMin = timeToMinutes(c.startTime);
    const endMin = timeToMinutes(c.endTime);
    const top = ((startMin - START_HOUR * 60) / 60) * HOUR_PX;
    const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 20);

    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    block.style.background = c.color || '#5b7fdb';

    const subject = document.createElement('span');
    subject.className = 'subject';
    subject.textContent = c.subject;
    block.appendChild(subject);

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [minutesToLabel(startMin), c.room].filter(Boolean).join(' · ');
    block.appendChild(meta);

    if (c.notes && c.notes.length > 0) {
      const dot = document.createElement('span');
      dot.className = 'note-dot';
      block.appendChild(dot);
    }

    block.addEventListener('click', () => openEditModal(c.id));
    return block;
  }

  // ---------- Modal ----------
  const modal = document.getElementById('classModal');
  const modalTitle = document.getElementById('modalTitle');
  const classForm = document.getElementById('classForm');
  const daySelect = document.getElementById('day');
  const deleteBtn = document.getElementById('deleteBtn');
  const notesSection = document.getElementById('notesSection');
  const notesList = document.getElementById('notesList');
  const noteForm = document.getElementById('noteForm');
  const noteText = document.getElementById('noteText');

  DAY_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = name;
    daySelect.appendChild(opt);
  });

  function openModal() {
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    classForm.reset();
    editingId = null;
  }

  function openAddModal(dayIndex = 0, startMinutes = 9 * 60) {
    editingId = null;
    modalTitle.textContent = 'Add Class';
    deleteBtn.hidden = true;
    notesSection.hidden = true;
    classForm.reset();
    document.getElementById('classId').value = '';
    daySelect.value = dayIndex;
    document.getElementById('color').value = '#5b7fdb';

    const clampedStart = Math.min(Math.max(startMinutes, START_HOUR * 60), (END_HOUR - 1) * 60);
    document.getElementById('startTime').value = minutesToHHMM(clampedStart);
    document.getElementById('endTime').value = minutesToHHMM(clampedStart + 60);

    openModal();
  }

  function openEditModal(id) {
    const c = classes.find(x => x.id === id);
    if (!c) return;
    editingId = id;
    modalTitle.textContent = 'Edit Class';
    deleteBtn.hidden = false;
    notesSection.hidden = false;

    document.getElementById('classId').value = c.id;
    document.getElementById('subject').value = c.subject;
    document.getElementById('room').value = c.room || '';
    daySelect.value = c.day;
    document.getElementById('color').value = c.color || '#5b7fdb';
    document.getElementById('startTime').value = c.startTime;
    document.getElementById('endTime').value = c.endTime;

    renderNotes(c);
    openModal();
  }

  function minutesToHHMM(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
  document.getElementById('addClassBtn').addEventListener('click', () => openAddModal());
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
    const color = document.getElementById('color').value;
    const startTime = document.getElementById('startTime').value;
    const endTime = document.getElementById('endTime').value;

    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      alert('End time must be after start time.');
      return;
    }

    if (editingId) {
      const c = classes.find(x => x.id === editingId);
      Object.assign(c, { subject, room, day, color, startTime, endTime });
    } else {
      classes.push({
        id: uid(),
        subject, room, day, color, startTime, endTime,
        notes: [],
      });
    }

    saveClasses();
    renderGrid();
    closeModal();
  });

  deleteBtn.addEventListener('click', () => {
    if (!editingId) return;
    if (!confirm('Delete this class? This also removes its notes.')) return;
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
        if (classes.length > 0 && !confirm('Importing will replace your current schedule. Continue?')) {
          importFile.value = '';
          return;
        }
        classes = data;
        saveClasses();
        renderGrid();
      } catch (err) {
        alert('Could not read that file — make sure it\'s a schedule backup exported from this app.');
      } finally {
        importFile.value = '';
      }
    };
    reader.readAsText(file);
  });

  // ---------- Init ----------
  renderGrid();
})();
