# Schedule App

جدول أسبوعي للحصص الدراسية، بالعربية ومن اليمين لليسار. الأسبوع من الأحد
إلى الخميس، بحصص ثابتة (سبع حصص وفرصتان) بدل شبكة زمنية حرة. اضغط على أي
خانة في الجدول أو زر "+ إضافة حصة" لإضافة حصة، واضغط على حصة موجودة لتعديلها
أو لإضافة ملاحظات ومهام لها.

No build step, no backend — just static HTML/CSS/JS. Data is saved in your
browser's local storage, so it stays on whichever device/browser you use it
in. Use **Export** regularly to download a JSON backup, and **Import** to
restore it (or move it to another browser/device).

## Run it

Open `index.html` directly in a browser, or serve it locally:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Deploy it free (GitHub Pages)

Settings → Pages → deploy from the `main` branch, root folder. No config needed.
