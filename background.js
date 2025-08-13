// background.js
chrome.action.onClicked.addListener((tab) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  });
  
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'capture') {
      captureAndProcess(msg.rect, msg.isDark).then(finalUrl => {
        chrome.downloads.download({
          url: finalUrl,
          filename: 'aesthetic-screenshot.png',
          saveAs: true
        });
      }).catch(e => console.error('Error in capture process:', e));
      return true; // Allow async response
    }
  });
  
  async function captureAndProcess(rect, isDark) {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const fullImg = await createImageBitmap(blob);
  
    const cropCanvas = new OffscreenCanvas(rect.width, rect.height);
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(fullImg, -rect.x, -rect.y);
  
    let processedCanvas = cropCanvas;
    if (isDark) {
      const processCanvas = new OffscreenCanvas(rect.width, rect.height);
      const pCtx = processCanvas.getContext('2d');
      pCtx.filter = 'invert(100%) hue-rotate(180deg)';
      pCtx.drawImage(cropCanvas.transferToImageBitmap(), 0, 0);
      processedCanvas = processCanvas;
    }
  
    const screenshotImg = processedCanvas.transferToImageBitmap();
  
    const innerPadding = 40;
    const outerPadding = 50;
    const borderRadius = 8;
    const maxInnerWidth = 1000 - innerPadding * 2;
    const scale = Math.min(1, maxInnerWidth / rect.width);
    const innerWidth = rect.width * scale;
    const innerHeight = rect.height * scale;
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
  
    // Shadow and white document box
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    const docX = outerPadding;
    const docY = outerPadding;
    ctx.beginPath();
    ctx.roundRect(docX, docY, docWidth, docHeight, borderRadius);
    ctx.fillStyle = 'white';
    ctx.fill();
  
    // Draw screenshot inside document
    ctx.drawImage(screenshotImg, docX + innerPadding, docY + innerPadding, innerWidth, innerHeight);
  
    const finalBlob = await canvas.convertToBlob({ type: 'image/png' });
  
    const finalUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(finalBlob);
    });
  
    return finalUrl;
  }