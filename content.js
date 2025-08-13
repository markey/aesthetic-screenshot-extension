// content.js
(function() {
    let selectionDiv = null;
    let startX, startY;
    let isSelecting = false;
    let invertStyle = null;
  
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'transparent';
    overlay.style.zIndex = '999999';
    overlay.style.cursor = 'crosshair';
    document.body.appendChild(overlay);
  
    overlay.addEventListener('mousedown', (e) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;
  
      selectionDiv = document.createElement('div');
      selectionDiv.style.position = 'fixed';
      selectionDiv.style.border = '2px dashed #000';
      selectionDiv.style.background = 'rgba(0, 0, 255, 0.1)';
      selectionDiv.style.zIndex = '1000000';
      document.body.appendChild(selectionDiv);
  
      setPosition(startX, startY, 0, 0);
    });
  
    overlay.addEventListener('mousemove', (e) => {
      if (!isSelecting) return;
      const width = e.clientX - startX;
      const height = e.clientY - startY;
      setPosition(startX, startY, width, height);
    });
  
    overlay.addEventListener('mouseup', (e) => {
      if (!isSelecting) return;
      isSelecting = false;
  
      let width = Math.abs(e.clientX - startX);
      let height = Math.abs(e.clientY - startY);
      if (width < 10 || height < 10) {
        cancel();
        return;
      }
  
      let x = Math.min(startX, e.clientX);
      let y = Math.min(startY, e.clientY);
  
      const dpr = window.devicePixelRatio;
      const rect = {
        x: x * dpr,
        y: y * dpr,
        width: width * dpr,
        height: height * dpr
      };
  
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const bgColor = bodyStyle.backgroundColor || rootStyle.backgroundColor;
      let isDarkBg = false;
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)') {
        const rgb = bgColor.match(/\d+/g).map(Number);
        const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
        isDarkBg = luminance < 128;
      }
  
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches ||
                     document.documentElement.classList.contains('dark') ||
                     isDarkBg;
  
      if (isDark) {
        invertStyle = document.createElement('style');
        invertStyle.textContent = `
          html {
            filter: invert(1) hue-rotate(180deg) !important;
          }
          img, video, [style*="background-image"], canvas, svg, iframe {
            filter: invert(1) hue-rotate(180deg) !important;
          }
        `;
        document.head.appendChild(invertStyle);
        // Add delay to allow the browser to repaint after style application
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'capture', rect });
        }, 100);
      } else {
        chrome.runtime.sendMessage({ type: 'capture', rect });
      }
  
      cancel();
    });
  
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'captured' && invertStyle) {
        invertStyle.remove();
        invertStyle = null;
      }
    });
  
    function setPosition(x, y, w, h) {
      if (w < 0) {
        x += w;
        w = -w;
      }
      if (h < 0) {
        y += h;
        h = -h;
      }
      selectionDiv.style.left = `${x}px`;
      selectionDiv.style.top = `${y}px`;
      selectionDiv.style.width = `${w}px`;
      selectionDiv.style.height = `${h}px`;
    }
  
    function cancel() {
      if (selectionDiv) selectionDiv.remove();
      overlay.remove();
    }
  })();