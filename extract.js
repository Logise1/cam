const fs = require('fs');
const path = require('path');

const dir = 'c:/Users/ariel/Desktop/apps/cam';
const filePath = path.join(dir, 'index.html');
const content = fs.readFileSync(filePath, 'utf-8');

// 1. Extract CSS
const styleRegex = /<style>([\s\S]*?)<\/style>/;
const styleMatch = content.match(styleRegex);
if (styleMatch) {
    fs.writeFileSync(path.join(dir, 'styles.css'), styleMatch[1].trim() + '\n');
}

// 2. Extract JS
const scriptRegex = /<script type="module">([\s\S]*?)<\/script>/;
const scriptMatch = content.match(scriptRegex);
if (scriptMatch) {
    let jsContent = scriptMatch[1].trim();
    // Add Service worker registration at the end
    const swReg = `
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}
`;
    fs.writeFileSync(path.join(dir, 'script.js'),  jsContent + "\n" + swReg + "\n");
}

// 3. Create Manifest
const pwaManifest = {
  "name": "CCTV Enterprise Security",
  "short_name": "CCTV App",
  "description": "Sistema de videovigilancia distribuida Edge Computing",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "orientation": "any",
  "icons": [
    {
      "src": "./icon.svg",
      "sizes": "192x192 512x512",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    }
  ]
};
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(pwaManifest, null, 2) + '\n');

// 4. Create Icon
const iconStr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5a2.5 2.5 0 0 0-2.5 2.5h10a2.5 2.5 0 0 0-2.5-2.5Z"/><path d="M8 4h9v2H8Z"/><path d="M15.68 14A5.5 5.5 0 1 1 16 12"/><path d="m16.8 9.4-6.4 11.1"/><path d="m8.3 16.3 9-5.2"/></svg>';
fs.writeFileSync(path.join(dir, 'icon.svg'), iconStr);

// 5. Create sw.js
const swContent = `self.addEventListener('fetch', (e) => {});
self.addEventListener('install', (e) => {
    self.skipWaiting();
});
self.addEventListener('activate', (e) => {
    e.waitUntil(self.clients.claim());
});
`;
fs.writeFileSync(path.join(dir, 'sw.js'), swContent);

// 6. Update HTML File
let newHtml = content;

// Replace inline manifest block
const manifestBlockRegex = /<!-- ARQUITECTURA SENIOR: PWA Manifest inyectado vía Data URI[\s\S]*?<\/script>/;
newHtml = newHtml.replace(manifestBlockRegex, '<!-- Manifest & SW -->\n    <link rel="manifest" href="manifest.json">');

// Replace style block
newHtml = newHtml.replace(styleRegex, '<link rel="stylesheet" href="styles.css">');

// Replace script block
newHtml = newHtml.replace(scriptRegex, '<script type="module" src="script.js"></script>');

fs.writeFileSync(filePath, newHtml);

console.log('Extraction complete!');
