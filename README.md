# Schedule App

A simple weekly class schedule. Click anywhere on the grid (or "+ Add Class")
to add a class, click an existing class to edit it or attach notes/to-dos.

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
