// coopNavigate(url) — navigate to an extension page without spawning a new tab.
// Side panel: finds an existing Coop tab and navigates it, or creates one.
// Regular extension pages: navigates the current tab in place.
function coopNavigate(url, closePanel) {
  if (window.location.href.includes('sidepanel')) {
    chrome.tabs.query({ url: chrome.runtime.getURL('*') }, function(tabs) {
      const mainTabs = tabs.filter(t => !t.url.includes('sidepanel'));
      if (mainTabs.length > 0) {
        chrome.tabs.update(mainTabs[0].id, { url, active: true });
        chrome.windows.update(mainTabs[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url });
      }
      if (closePanel) window.close();
    });
  } else {
    window.location.href = url;
  }
}
