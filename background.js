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

      // Always request the page to copy the image to the clipboard
      chrome.tabs.sendMessage(sender.tab.id, { type: 'copyToClipboard', dataUrl: finalUrl });

      // Attempt to download the screenshot. If the user cancels the Save As
      // dialog, fall back to copying the image to the clipboard.
      chrome.downloads.download({
        url: finalUrl,
        filename: 'aesthetic-screenshot.png',
        saveAs: true
      }, (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err || typeof downloadId !== 'number') {
          // Save dialog was likely aborted or download failed — copy was already attempted
          // above, but leave this in case the first message was missed.
          chrome.tabs.sendMessage(sender.tab.id, { type: 'copyToClipboard', dataUrl: finalUrl });
        }
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
    // Capture the selected region crisply at device pixels via CDP
    const crispDataUrl = await captureCrisp(tabId, rect);

    const response = await fetch(crispDataUrl);
    const blob = await response.blob();
    const screenshotImg = await createImageBitmap(blob);
  
    const innerPadding = 40;
    const outerPadding = 45; // Adjusted to ~1.2cm at standard DPI
    const borderRadius = 8;
    // Use the actual captured image dimensions (device pixels)
    const innerWidth = screenshotImg.width;
    const innerHeight = screenshotImg.height;
    const docWidth = innerWidth + innerPadding * 2;
    const docHeight = innerHeight + innerPadding * 2;
    const canvasWidth = docWidth + outerPadding * 2;
    const canvasHeight = docHeight + outerPadding * 2;
  
    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    
    // Disable smoothing for images; text will render crisply on integer coords
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = 'high';
  
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
    const docX = Math.round(outerPadding);
    const docY = Math.round(outerPadding);
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
    const screenshotX = Math.round(docX + innerPadding);
    const screenshotY = Math.round(docY + innerPadding);
    // Draw at 1:1 scale to avoid any resampling
    ctx.drawImage(screenshotImg, screenshotX, screenshotY, innerWidth, innerHeight);
  
    // Add watermark text (rendered in the gradient area below the document)
    const watermarkText = await getWatermarkText();
    if (watermarkText) {
      // Larger, bold font for readability; integer-aligned for crisp edges
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'transparent';

      // Draw an outer light stroke for separation on the gradient, then dark fill
      const textX = Math.round(docX + docWidth);
      const textY = Math.round(docY + docHeight + 20);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.strokeText(watermarkText, textX, textY);
      ctx.fillStyle = '#111827';
      ctx.fillText(watermarkText, textX, textY);
    }
  
    const finalBlob = await canvas.convertToBlob({ 
      type: 'image/png',
      quality: 1.0 // Maximum quality
    });
  
    const finalUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(finalBlob);
    });
  
      return finalUrl;
}

// Capture a crisp PNG of the visible tab or a CSS-rect region using CDP.
// - Forces zoom to 1.0 during capture
// - Uses actual devicePixelRatio as the capture scale
// - Aligns clip to device pixels to avoid filtering
async function captureCrisp(tabId, regionDeviceRect = null) {
  // 1) Read DPR before zoom change to recover CSS rect correctly
  const [{ result: dprBefore = 1 }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.devicePixelRatio
  });

  // 2) Freeze zoom at 1.0, remember old zoom
  const oldZoom = await chrome.tabs.getZoom(tabId).catch(() => 1);
  await chrome.tabs.setZoom(tabId, 1.0).catch(() => {});

  // 3) Read DPR and viewport in the page context (after zoom normalization)
  const [{ result: dpr = 1 }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.devicePixelRatio
  });
  const [{ result: vp = { w: 0, h: 0 } }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ w: window.innerWidth, h: window.innerHeight })
  });

  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');

  try {
    // 3) Make device metrics explicit to CDP, match current viewport, scale by DPR
    await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
      width: Math.floor(vp.w),
      height: Math.floor(vp.h),
      deviceScaleFactor: dpr,
      mobile: false
    });

    // Avoid transparent background that can change AA behavior
    await chrome.debugger.sendCommand(target, 'Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 255, g: 255, b: 255, a: 1 }
    }).catch(() => {});

    // 4) Build a clip aligned to device pixels, or omit to capture the whole viewport
    // Convert device-rect (based on pre-zoom DPR) to a proper CSS clip, then snap
    const clip = regionDeviceRect ? makeClipFromDeviceRect(regionDeviceRect, dprBefore, dpr) : undefined;

    // Ensure Page domain is ready
    await chrome.debugger.sendCommand(target, 'Page.enable').catch(() => {});

    // 5) Capture at device pixels, no resample
    const { data } = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip
    });

    // 6) Return PNG as data URL (no intermediate canvas)
    return 'data:image/png;base64,' + data;
  } finally {
    // 7) Cleanup and restore user state
    await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    await chrome.debugger.sendCommand(target, 'Emulation.setDefaultBackgroundColorOverride').catch(() => {});
    await chrome.debugger.detach(target).catch(() => {});
    await chrome.tabs.setZoom(tabId, oldZoom).catch(() => {});
  }
}

// Convert a region defined in device pixels (from content script) into a CDP clip
// by snapping to the device pixel grid using the current DPR.
function makeClipFromDeviceRect(deviceRect, dprAtSelection, dprAtCapture) {
  // Convert the device-rect (measured with dprAtSelection) back to CSS px
  const cssRect = {
    x: deviceRect.x / dprAtSelection,
    y: deviceRect.y / dprAtSelection,
    width: deviceRect.width / dprAtSelection,
    height: deviceRect.height / dprAtSelection
  };
  // Snap CSS values to device pixel grid
  const dpr = dprAtCapture || dprAtSelection || 1;
  const snapCss = v => Math.round(v * dpr) / dpr;
  const x = snapCss(cssRect.x);
  const y = snapCss(cssRect.y);
  const w = snapCss(cssRect.width);
  const h = snapCss(cssRect.height);
  return { x, y, width: w, height: h, scale: dpr };
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

// Copy screenshot to clipboard
async function copyToClipboard(dataUrl) {
  try {
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // Create clipboard item
    const clipboardItem = new ClipboardItem({
      [blob.type]: blob
    });
    
    // Copy to clipboard
    await navigator.clipboard.write([clipboardItem]);
    
    // Show success notification
    showNotification('Screenshot copied to clipboard!', 'success');
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    
    // Fallback: try to copy as image data
    try {
      await copyImageDataToClipboard(dataUrl);
    } catch (fallbackError) {
      console.error('Fallback clipboard copy also failed:', fallbackError);
      showNotification('Failed to copy to clipboard', 'error');
    }
  }
}

// Fallback method for copying image data to clipboard
async function copyImageDataToClipboard(dataUrl) {
  try {
    // Create a canvas element to manipulate the image
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    
    // Load the image
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    
    // Set canvas size to match image
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    
    // Draw image to canvas
    ctx.drawImage(imageBitmap, 0, 0);
    
    // Convert to blob
    const canvasBlob = await canvas.convertToBlob({ type: 'image/png' });
    
    // Try to copy using the modern clipboard API
    const clipboardItem = new ClipboardItem({
      [canvasBlob.type]: canvasBlob
    });
    
    await navigator.clipboard.write([clipboardItem]);
    showNotification('Screenshot copied to clipboard!', 'success');
  } catch (error) {
    throw error;
  }
}

// Show notification to user
function showNotification(message, type = 'info') {
  // Create a simple notification element
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: translateX(100%);
    transition: transform 0.3s ease;
  `;
  
  // Set background color based on type
  if (type === 'success') {
    notification.style.background = '#10b981'; // Green
  } else if (type === 'error') {
    notification.style.background = '#ef4444'; // Red
  } else {
    notification.style.background = '#3b82f6'; // Blue
  }
  
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Animate in
  setTimeout(() => {
    notification.style.transform = 'translateX(0)';
  }, 100);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}
