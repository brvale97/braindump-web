# PWA Favicon & "Installeer als App" — Setup Instructie

Zo voeg je een favicon + installeerbare app (PWA) toe aan een web project.

## Wat heb je nodig

3 nieuwe bestanden + een paar regels in je bestaande `index.html` en `app.js`.

---

## 1. `public/favicon.svg` — Het icoon

Maak een SVG icoon (512x512 viewBox). Voorbeeld:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="102" ry="102" fill="#DA7B3B"/>
  <path d="M310 80L200 270h80l-50 162 160-200h-90z" fill="white"/>
</svg>
```

Pas de kleuren en het symbool aan naar je eigen project.

## 2. `public/manifest.json` — Web App Manifest

Dit vertelt de browser dat je site installeerbaar is:

```json
{
  "name": "Jouw App Naam",
  "short_name": "App",
  "icons": [{ "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml" }],
  "theme_color": "#DA7B3B",
  "background_color": "#F5F3EE",
  "display": "standalone",
  "start_url": "/"
}
```

## 3. `public/sw.js` — Service Worker (minimaal)

Chrome vereist een service worker voordat hij de install prompt toont:

```js
// Minimal service worker — required for PWA installability
self.addEventListener('fetch', () => {});
```

## 4. `index.html` — Meta tags in `<head>`

Voeg toe in je `<head>`:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#DA7B3B">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="apple-touch-icon" href="/favicon.svg">
```

En voeg een install banner toe in de `<body>` (voor je `<script>` tag):

```html
<div id="install-banner" class="install-banner hidden">
  <span>Installeer als app</span>
  <div class="install-actions">
    <button id="install-btn">Installeren</button>
    <button id="install-dismiss" class="dismiss">&times;</button>
  </div>
</div>
```

## 5. JavaScript — Service worker registratie + install prompt

Voeg toe aan je `app.js`:

```js
// --- PWA Install ---
let deferredPrompt = null;
const installBanner = document.getElementById("install-banner");
const installBtn = document.getElementById("install-btn");
const installDismiss = document.getElementById("install-dismiss");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!sessionStorage.getItem("install_dismissed")) {
    installBanner.classList.remove("hidden");
  }
});

installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBanner.classList.add("hidden");
});

installDismiss.addEventListener("click", () => {
  installBanner.classList.add("hidden");
  sessionStorage.setItem("install_dismissed", "1");
});

window.addEventListener("appinstalled", () => {
  installBanner.classList.add("hidden");
  deferredPrompt = null;
});

// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
```

## 6. CSS — Install banner styling

```css
.install-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: white;
  border-top: 1px solid #e5e5e5;
  padding: 0.85rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  z-index: 100;
  font-size: 0.9rem;
  font-weight: 500;
}

.install-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

#install-btn {
  background: #DA7B3B;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.install-banner .dismiss {
  background: none;
  border: none;
  color: #888;
  font-size: 1.25rem;
  cursor: pointer;
}
```

---

## Resultaat

- Favicon zichtbaar in browser tab
- Op mobiel (Chrome): banner verschijnt "Installeer als app"
- Na installatie: app op homescreen met je eigen icoon
- Browserbalk krijgt je themakleur
