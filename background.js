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
    captureAndProcess(msg.rect, sender.tab.id, msg.isDark).then(finalUrl => {
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
  
  async function captureAndProcess(rectCss, tabId, isDarkPage) {
    // Adaptive super-sampling based on content analysis
    const adaptiveScale = await calculateAdaptiveScale(tabId);
    // Capture the full compositor output at device pixels, crop locally
    const { dataUrl: fullDataUrl, vpCSS, dpr, effectiveScale } = await captureCrisp(tabId, isDarkPage, adaptiveScale);

    const response = await fetch(fullDataUrl);
    const blob = await response.blob();
    let screenshotImg = await createImageBitmap(blob);

    // If a region was selected (in CSS px), crop precisely using the actual scale
    if (rectCss) {
      const scaleX = vpCSS?.w ? screenshotImg.width / vpCSS.w : 1;
      const scaleY = vpCSS?.h ? screenshotImg.height / vpCSS.h : 1;

      const left = Math.floor((rectCss.x) * scaleX);
      const top = Math.floor((rectCss.y) * scaleY);
      const right = Math.ceil((rectCss.x + rectCss.width) * scaleX);
      const bottom = Math.ceil((rectCss.y + rectCss.height) * scaleY);

      const sx = Math.max(0, Math.min(left, screenshotImg.width - 1));
      const sy = Math.max(0, Math.min(top, screenshotImg.height - 1));
      const sw = Math.max(1, Math.min(right - left, screenshotImg.width - sx));
      const sh = Math.max(1, Math.min(bottom - top, screenshotImg.height - sy));

      const cropCanvas = new OffscreenCanvas(sw, sh);
      const cropCtx = cropCanvas.getContext('2d', { alpha: true });
      cropCtx.imageSmoothingEnabled = false;
      cropCtx.drawImage(screenshotImg, sx, sy, sw, sh, 0, 0, sw, sh);
      // Replace screenshotImg with cropped version for downstream composition
      const cropBlob = await cropCanvas.convertToBlob({ type: 'image/png' });
      screenshotImg = await createImageBitmap(cropBlob);
    }
  
    // Preserve native hi‑res: do NOT downscale the captured image.
    // Instead, scale paddings/metrics up so ratios match the CSS design
    // while retaining crisp device-pixel text edges (like html2canvas scale:2).
    const scale = Math.max(1, effectiveScale || 1);
    const baseInnerPadding = 40;   // CSS px baseline
    const baseOuterPadding = 45;   // CSS px baseline
    const baseBorderRadius = 8;    // CSS px baseline

    const innerPadding = Math.round(baseInnerPadding * scale);
    const outerPadding = Math.round(baseOuterPadding * scale);
    const borderRadius = Math.round(baseBorderRadius * scale);

    // Keep the inner area at 1:1 pixels with the captured bitmap
    const innerWidth = screenshotImg.width;
    const innerHeight = screenshotImg.height;
    const docWidth = innerWidth + innerPadding * 2;
    const docHeight = innerHeight + innerPadding * 2;
    const canvasWidth = docWidth + outerPadding * 2;
    const canvasHeight = docHeight + outerPadding * 2;
  
    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d', {
      alpha: true,
      willReadFrequently: false,
      desynchronized: false
    });

    // Enhanced canvas settings for optimal text rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Additional canvas optimizations for crisp text rendering
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.globalCompositeOperation = 'source-over';

    // Set line width for crisp edges
    ctx.lineWidth = 1;

    // Optimize canvas for high-quality rendering
    if (typeof ctx.webkitImageSmoothingEnabled !== 'undefined') {
      ctx.webkitImageSmoothingEnabled = true;
    }
    if (typeof ctx.mozImageSmoothingEnabled !== 'undefined') {
      ctx.mozImageSmoothingEnabled = true;
    }
  
    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    gradient.addColorStop(0, '#c4e0ff');
    gradient.addColorStop(1, '#fbc2eb');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  
    // First shadow (scaled)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = Math.round(30 * scale);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(10 * scale);
    const docX = Math.round(outerPadding);
    const docY = Math.round(outerPadding);
    ctx.beginPath();
    ctx.roundRect(docX, docY, docWidth, docHeight, borderRadius);
    ctx.fillStyle = 'white';
    ctx.fill();
  
    // Second shadow (scaled)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = Math.round(12 * scale);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(4 * scale);
    ctx.beginPath();
    ctx.roundRect(docX, docY, docWidth, docHeight, borderRadius);
    ctx.fillStyle = 'white';
    ctx.fill();
  
    // Draw screenshot inside the white document at 1:1 pixels
    const screenshotX = Math.round(docX + innerPadding);
    const screenshotY = Math.round(docY + innerPadding);

    // 1:1 draw — disable smoothing to avoid any blur on text
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (typeof ctx.webkitImageSmoothingEnabled !== 'undefined') ctx.webkitImageSmoothingEnabled = false;
    if (typeof ctx.mozImageSmoothingEnabled !== 'undefined') ctx.mozImageSmoothingEnabled = false;
    ctx.filter = 'none';
    ctx.drawImage(screenshotImg, screenshotX, screenshotY);

    ctx.restore();

  
    // Add watermark text with clean rendering
    const watermarkText = await getWatermarkText();
    if (watermarkText) {
      ctx.save();

      // Standard UI font stack with integer metrics, scaled with capture scale
      const watermarkSize = Math.round(18 * scale);
      ctx.font = `bold ${watermarkSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';

      const textX = Math.round(docX + docWidth);
      const textY = Math.round(docY + docHeight + Math.round(20 * scale));

      // Simple, clean text rendering with subtle shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = Math.max(1, Math.round(1 * scale));
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.max(1, Math.round(1 * scale));
      ctx.fillStyle = '#111827';
      ctx.fillText(watermarkText, textX, textY);

      ctx.restore();
    }

    // Skip global enhancement to avoid any potential artifacts
  
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

// Capture a crisp PNG from the visible tab at device pixels.
// If the page is dark, emulate prefers-color-scheme: light during capture
// to avoid CSS filter inversion (which blurs text and distorts images).
async function captureCrisp(tabId, isDarkPage, superScale = 1) {
  // Measure DPR and viewport at the user's current zoom to preserve mapping
  const [{ result: dpr = 1 }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.devicePixelRatio
  });
  const [{ result: vp = { w: 0, h: 0 } }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ w: window.innerWidth, h: window.innerHeight })
  });

  const target = { tabId };
  let attached = false;
  let lightOverrideApplied = false;
  const needsHiRes = (superScale && superScale > 1);
  // Compute an adaptive clamp so we don't exceed safe limits
  const MAX_LONG_EDGE = 8192;            // guardrail for width/height
  const MAX_PIXELS = 32 * 1024 * 1024;   // ~32 MP to avoid memory spikes
  const baseW = Math.max(1, Math.floor(vp.w * (dpr || 1)));
  const baseH = Math.max(1, Math.floor(vp.h * (dpr || 1)));
  const maxByEdge = Math.min(MAX_LONG_EDGE / baseW, MAX_LONG_EDGE / baseH);
  const maxByPixels = Math.sqrt(MAX_PIXELS / (baseW * baseH));
  const adaptiveMax = Math.max(1, Math.min(maxByEdge, maxByPixels));
  const requestedScale = Math.max(1, superScale);
  const clampedScale = Math.min(requestedScale, adaptiveMax);

  try {
    if (isDarkPage || needsHiRes) {
      // Attach debugger to emulate media features as light
      await chrome.debugger.attach(target, '1.3');
      attached = true;
      await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: 'light' }]
      }).catch(() => {});
      await chrome.debugger.sendCommand(target, 'Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 255, g: 255, b: 255, a: 1 }
      }).catch(() => {});

      // If hi‑res requested, increase deviceScaleFactor without changing layout
      if (needsHiRes) {
        await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
          width: Math.max(1, Math.floor(vp.w)),
          height: Math.max(1, Math.floor(vp.h)),
          deviceScaleFactor: Math.max(1, (dpr || 1) * clampedScale),
          mobile: false,
          scale: 1
        }).catch(() => {});
      }

      // Also apply a non-filter, CSS-based light override for sites that
      // don't honor prefers-color-scheme. This keeps text crisp.
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            try {
              const d = document.documentElement;
              const b = document.body;
              const prev = {
                htmlClass: d.className,
                bodyClass: b ? b.className : '',
                attrs: Array.from(d.attributes).reduce((acc, a) => (acc[a.name] = a.value, acc), {})
              };
              // Store previous state for revert
              window.__AESTHETIC_PREV__ = prev;

              // Heuristic: remove common dark markers
              const darkClasses = ['dark','dark-mode','theme-dark','night','darkTheme','is-dark','mode-dark'];
              darkClasses.forEach(c => d.classList.remove(c));
              if (b) darkClasses.forEach(c => b.classList.remove(c));

              // Hint attributes used by common frameworks
              d.setAttribute('data-theme', 'light');
              d.setAttribute('data-color-mode', 'light');
              d.style.colorScheme = 'light';

              // Install a lightweight CSS override without using filters
              const style = document.getElementById('aesthetic-light-override') || document.createElement('style');
              style.id = 'aesthetic-light-override';
              style.textContent = `
                :root { color-scheme: light !important; }
                html, body {
                  background: #ffffff !important;
                  color: #111827 !important;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
                  font-weight: 500 !important; /* medium weight for crisper stems */
                  -webkit-font-smoothing: antialiased !important;
                  -moz-osx-font-smoothing: grayscale !important;
                  text-rendering: optimizeLegibility !important;
                }
                html { filter: none !important; }
                *, *::before, *::after { transition: none !important; }
                img, video, canvas, svg, picture, iframe { filter: none !important; mix-blend-mode: normal !important; }
                [data-theme], [data-color-mode], [class*="dark"], [class*="Dark"], [class*="night"] { color-scheme: light !important; }
                :where(div, section, article, main, aside, header, footer, nav,
                       p, span, li, ul, ol, a, h1, h2, h3, h4, h5, h6,
                       table, tr, td, th, thead, tbody, tfoot,
                       input, textarea, button, label, select,
                       code, pre, blockquote, figure, figcaption) {
                  color: #111827 !important;
                  background-color: transparent !important;
                }
                /* Nudge common body text to medium, avoid overriding headings */
                :where(p, span, li, a, td, th, small, label, input, textarea, button) {
                  font-weight: 500 !important;
                }
                a { color: #2563eb !important; }
              `;
              (document.head || document.documentElement).appendChild(style);

              // Let layout/styles settle briefly
              return new Promise(resolve => setTimeout(() => resolve(true), 120));
            } catch (e) {
              return false;
            }
          }
        });
        lightOverrideApplied = !!result;
      } catch (_) {
        // Best-effort; continue capture even if injection fails
      }
    }

    let dataUrl;
    if (attached) {
      // Capture compositor output; respects overridden deviceScaleFactor
      const { data } = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
      });
      dataUrl = 'data:image/png;base64,' + data;
    } else {
      // Fallback path (no overrides needed)
      dataUrl = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(undefined, { format: 'png' }, (url) => {
          const err = chrome.runtime.lastError;
          if (err || !url) return reject(err || new Error('captureVisibleTab failed'));
          resolve(url);
        });
      });
    }

    return { dataUrl, vpCSS: vp, dpr, effectiveScale: needsHiRes ? clampedScale : 1 };
  } finally {
    // Revert page overrides first so we don't leave traces
    if (lightOverrideApplied) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            try {
              const d = document.documentElement;
              const b = document.body;
              const prev = window.__AESTHETIC_PREV__;
              const style = document.getElementById('aesthetic-light-override');
              if (style) style.remove();
              if (prev) {
                d.className = prev.htmlClass;
                if (b) b.className = prev.bodyClass;
                // Restore attributes
                const currentAttrs = new Set(Array.from(d.attributes).map(a => a.name));
                for (const name of currentAttrs) {
                  if (!(name in prev.attrs)) d.removeAttribute(name);
                }
                Object.entries(prev.attrs).forEach(([k, v]) => d.setAttribute(k, v));
                delete window.__AESTHETIC_PREV__;
              } else {
                d.style.removeProperty('color-scheme');
                d.removeAttribute('data-theme');
                d.removeAttribute('data-color-mode');
              }
            } catch (_) {}
          }
        });
      } catch (_) { /* ignore */ }
    }
    if (attached) {
      // Clear metric overrides if set
      await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
      // Best-effort cleanup
      await chrome.debugger.sendCommand(target, 'Emulation.setDefaultBackgroundColorOverride').catch(() => {});
      await chrome.debugger.detach(target).catch(() => {});
    }
  }
}

// Convert a region defined in device pixels (from content script) into a CDP clip
// by snapping to the device pixel grid using the current DPR.
function makeClipFromDeviceRect(deviceRect, dprAtSelection, dprAtCapture) {
  // Convert the device-rect (measured with dprAtSelection) back to CSS px
  const dprSel = dprAtSelection || 1;
  const cssRect = {
    x: deviceRect.x / dprSel,
    y: deviceRect.y / dprSel,
    width: deviceRect.width / dprSel,
    height: deviceRect.height / dprSel
  };

  // Snap by aligning left/top to floor and right/bottom to ceil in device pixels,
  // then convert back to CSS. This preserves the intended right/bottom edges and
  // avoids +/-1px due to independent rounding of width.
  const dpr = dprAtCapture || dprSel || 1;
  const leftDev = Math.floor(cssRect.x * dpr);
  const topDev = Math.floor(cssRect.y * dpr);
  const rightDev = Math.ceil((cssRect.x + cssRect.width) * dpr);
  const bottomDev = Math.ceil((cssRect.y + cssRect.height) * dpr);

  const x = leftDev / dpr;
  const y = topDev / dpr;
  const w = Math.max(1, rightDev - leftDev) / dpr;
  const h = Math.max(1, bottomDev - topDev) / dpr;

  // CDP clip.scale is a page scale factor, not DPR. Keep it at 1 to
  // avoid double-scaling; Emulation deviceScaleFactor already controls
  // device-pixel output resolution.
  return { x, y, width: w, height: h, scale: 1 };
}

// Adaptive scaling based on content analysis for optimal text quality
async function calculateAdaptiveScale(tabId) {
  try {
    const [{ result: contentMetrics }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Analyze text density and complexity
        const allText = document.body.innerText || '';
        const textLength = allText.length;

        // Count text elements
        const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, div, li, td, th, a, em, strong, b, i');
        let totalTextElements = 0;
        let smallTextCount = 0;

        textElements.forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length > 0) {
            totalTextElements++;
            const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
            if (fontSize < 14) smallTextCount++;
          }
        });

        // Calculate text density score
        const viewportArea = window.innerWidth * window.innerHeight;
        const textDensity = totalTextElements / Math.max(viewportArea / 10000, 1);

        // Determine optimal scale based on content analysis (max 2.0x)
        let recommendedScale = 2.0; // Base scale

        // Conservative scaling for text-heavy content
        if (textDensity > 0.8 || totalTextElements > 100) {
          recommendedScale = 2.0; // Keep at 2.0x for very text-heavy content
        } else if (textDensity > 0.4 || totalTextElements > 30) {
          recommendedScale = 2.0; // Standard 2.0x for moderate content
        }

        // Small boost for pages with lots of small text
        if (smallTextCount > totalTextElements * 0.5) {
          recommendedScale = 2.0; // Keep at 2.0x
        }

        // Cap at reasonable maximum of 2.0x
        recommendedScale = Math.min(recommendedScale, 2.0);

        return {
          scale: recommendedScale,
          textElements: totalTextElements,
          textDensity: textDensity,
          smallTextRatio: smallTextCount / Math.max(totalTextElements, 1)
        };
      }
    });

    console.log('Content analysis:', contentMetrics);
    return contentMetrics.scale;

  } catch (error) {
    console.warn('Content analysis failed, using default scale:', error);
    return 2.0; // Fallback to standard quality
  }
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
