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
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    
    // Enable crisp text rendering
    ctx.imageSmoothingEnabled = false;
    ctx.textRenderingOptimization = 'optimizeSpeed';
    
    // Ensure crisp rendering by using integer coordinates and disabling smoothing
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
    ctx.drawImage(screenshotImg, screenshotX, screenshotY, innerWidth, innerHeight);
  
    // Add watermark text
    const watermarkText = await getWatermarkText();
    if (watermarkText) {
      // Use a larger, crisper font with better rendering
      ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; // Slightly more opaque for better readability
      ctx.textAlign = 'right';
      ctx.shadowColor = 'transparent'; // Disable shadow for text
      
      // Ensure text is drawn on pixel boundaries for crispness
      const textX = Math.round(docX + docWidth);
      const textY = Math.round(docY + docHeight + 20);
      
      // Draw text with crisp rendering
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
