// Dynamic module import keeps the shipped extension dependency-free.
import(chrome.runtime.getURL('content.js')).catch(error => {
  console.error('[Versevia] Content script failed to load. Reload this page after reloading the extension.', error);
});
