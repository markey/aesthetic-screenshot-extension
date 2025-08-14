// background.js

// Create context menu for quick access to settings
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'openSettings',
    title: 'Settings & Options',
    contexts: ['action']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'openSettings') {
    openSettings();
  }
});

// The popup will handle both settings and screenshot functionality
// We don't need the onClicked listener since we're using default_popup
  
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'capture') {
    captureAndProcess(msg.rect, sender.tab.id).then(finalUrl => {
      chrome.tabs.sendMessage(sender.tab.id, { type: 'captured' });
      chrome.downloads.download({
        url: finalUrl,
        filename: 'aesthetic-screenshot.png',
        saveAs: true
      });
    }).catch(e => console.error('Error in capture process:', e));
    return true; // Allow async response
  }
  
  if (msg.type === 'markAsUsed') {
    markAsUsed();
    return true;
  }
  
  if (msg.type === 'startScreenshot') {
    // Get the current active tab and start screenshot process
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['content.js']
        });
      }
    });
    return true;
  }
});
  
  async function captureAndProcess(rect, tabId) {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const fullImg = await createImageBitmap(blob);
  
    const cropCanvas = new OffscreenCanvas(rect.width, rect.height);
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(fullImg, -rect.x, -rect.y);
  
    const screenshotImg = cropCanvas.transferToImageBitmap();
  
    const innerPadding = 40;
    const outerPadding = 45; // Adjusted to ~1.2cm at standard DPI
    const borderRadius = 8;
    const innerWidth = rect.width;
    const innerHeight = rect.height;
    const docWidth = innerWidth + innerPadding * 2;
    const docHeight = innerHeight + innerPadding * 2;
    const canvasWidth = docWidth + outerPadding * 2;
    const canvasHeight = docHeight + outerPadding * 2;
  
    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
  
    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    gradient.addColorStop(0, '#c4e0ff');
    gradient.addColorStop(1, '#fbc2eb');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  
    // First shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10;
    const docX = outerPadding;
    const docY = outerPadding;
    ctx.beginPath();
    ctx.roundRect(docX, docY, docWidth, docHeight, borderRadius);
    ctx.fillStyle = 'white';
    ctx.fill();
  
    // Second shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.roundRect(docX, docY, docWidth, docHeight, borderRadius);
    ctx.fillStyle = 'white';
    ctx.fill();
  
    // Draw screenshot inside document without scaling
    ctx.drawImage(screenshotImg, docX + innerPadding, docY + innerPadding, innerWidth, innerHeight);
  
    // Add watermark text
    const watermarkText = await getWatermarkText();
    if (watermarkText) {
      ctx.font = '12px sans-serif';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.textAlign = 'right';
      ctx.shadowColor = 'transparent'; // Disable shadow for text
      ctx.fillText(watermarkText, docX + docWidth, docY + docHeight + 20);
    }
  
    const finalBlob = await canvas.convertToBlob({ type: 'image/png' });
  
    const finalUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(finalBlob);
    });
  
      return finalUrl;
}

// Helper function to get watermark text from storage
async function getWatermarkText() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['watermarkText'], function(result) {
      if (result.watermarkText && result.watermarkText.trim()) {
        resolve(result.watermarkText.trim());
      } else {
        resolve(null); // No watermark text set
      }
    });
  });
}

// Check if this is the first time using the extension
async function checkFirstUse() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['hasBeenUsed'], function(result) {
      resolve(!result.hasBeenUsed);
    });
  });
}

// Mark extension as used (called after first settings save)
async function markAsUsed() {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ hasBeenUsed: true }, resolve);
  });
}

// Open settings in a new tab
function openSettings() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('popup.html')
  });
}