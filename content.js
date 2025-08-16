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
    overlay.style.zIndex = '2147483647';
    overlay.style.cursor = 'crosshair';
    document.body.appendChild(overlay);
  
    const escListener = (e) => {
      if (e.key === 'Escape') {
        cancel();
      }
    };
    document.addEventListener('keydown', escListener);
    
    // Function to detect page color scheme and apply appropriate selection styles
    function detectPageColorScheme() {
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      
      // Check for explicit dark mode classes
      const hasDarkClass = document.documentElement.classList.contains('dark') ||
                          document.documentElement.classList.contains('dark-mode') ||
                          document.body.classList.contains('dark') ||
                          document.body.classList.contains('dark-mode');
      
      // Check CSS custom properties for dark mode
      const hasDarkCSS = rootStyle.getPropertyValue('--dark-mode') ||
                         rootStyle.getPropertyValue('--is-dark') ||
                         bodyStyle.getPropertyValue('--dark-mode') ||
                         bodyStyle.getPropertyValue('--is-dark');
      
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      
      // Check background color luminance
      const bgColor = bodyStyle.backgroundColor || rootStyle.backgroundColor;
      let isDarkBg = false;
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
        const rgb = bgColor.match(/\d+/g).map(Number);
        if (rgb.length >= 3) {
          const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
          isDarkBg = luminance < 128;
        }
      }
      
      // Check text color for contrast
      const textColor = bodyStyle.color || rootStyle.color;
      let isDarkText = false;
      if (textColor && textColor !== 'rgba(0, 0, 0, 0)' && textColor !== 'transparent') {
        const rgb = textColor.match(/\d+/g).map(Number);
        if (rgb.length >= 3) {
          const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
          isDarkText = luminance < 128;
        }
      }
      
      // Determine if page is dark
      return hasDarkClass || hasDarkCSS || prefersDark || isDarkBg || isDarkText;
    }
    
    // Function to apply adaptive selection rectangle styling
    function applyAdaptiveSelectionStyle(selectionDiv) {
      const isDarkPage = detectPageColorScheme();
      
      if (isDarkPage) {
        // Dark mode: bright, high-contrast selection
        selectionDiv.style.border = '2px dashed #00ffff'; // Bright cyan
        selectionDiv.style.background = 'rgba(0, 255, 255, 0.15)'; // Semi-transparent cyan
        selectionDiv.style.boxShadow = '0 0 8px rgba(0, 255, 255, 0.6)'; // Glowing effect
        selectionDiv.style.animation = 'selectionPulse 2s ease-in-out infinite';
      } else {
        // Light mode: dark, high-contrast selection
        selectionDiv.style.border = '2px dashed #ff6b35'; // Bright orange
        selectionDiv.style.background = 'rgba(255, 107, 53, 0.15)'; // Semi-transparent orange
        selectionDiv.style.boxShadow = '0 0 8px rgba(255, 107, 53, 0.6)'; // Glowing effect
        selectionDiv.style.animation = 'selectionPulse 2s ease-in-out infinite';
      }
      
          // Add CSS animation for subtle pulsing effect
    if (!document.getElementById('selectionAnimationStyle')) {
      const style = document.createElement('style');
      style.id = 'selectionAnimationStyle';
      style.textContent = `
        @keyframes selectionPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Store the current color scheme for potential updates
    selectionDiv.dataset.colorScheme = isDarkPage ? 'dark' : 'light';
  }
  
  // Function to update selection style if page color scheme changes
  function updateSelectionStyleIfNeeded() {
    if (selectionDiv) {
      const currentScheme = detectPageColorScheme();
      const storedScheme = selectionDiv.dataset.colorScheme;
      
      if (currentScheme !== storedScheme) {
        applyAdaptiveSelectionStyle(selectionDiv);
      }
    }
  }
  
  // Set up mutation observer to detect dynamic color scheme changes
  let colorSchemeObserver = null;
  function setupColorSchemeObserver() {
    if (colorSchemeObserver) {
      colorSchemeObserver.disconnect();
    }
    
    colorSchemeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && 
            (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
          updateSelectionStyleIfNeeded();
        }
      });
    });
    
    colorSchemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style']
    });
    
    colorSchemeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }
  
    const onMouseMove = (e) => {
      if (!isSelecting) return;
      const width = e.clientX - startX;
      const height = e.clientY - startY;
      setPosition(startX, startY, width, height);
    };
  
    const onMouseUp = (e) => {
      document.removeEventListener('mousemove', onMouseMove);
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
  
      const isDark = detectPageColorScheme();
  
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
    };
  
    overlay.addEventListener('mousedown', (e) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;
  
      selectionDiv = document.createElement('div');
      selectionDiv.style.position = 'fixed';
      selectionDiv.style.zIndex = '2147483647';
      
      // Apply adaptive styling based on page color scheme
      applyAdaptiveSelectionStyle(selectionDiv);
      
      document.body.appendChild(selectionDiv);
  
      setPosition(startX, startY, 0, 0);
      
      // Set up color scheme observer for dynamic changes
      setupColorSchemeObserver();
  
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp, { once: true });
    });
  
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'captured' && invertStyle) {
      invertStyle.remove();
      invertStyle = null;
    }
    // Request from background to copy the produced image to clipboard
    if (msg.type === 'copyToClipboard' && msg.dataUrl) {
      copyImageDataUrlToClipboard(msg.dataUrl);
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
      document.removeEventListener('keydown', escListener);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      
      // Clean up color scheme observer
      if (colorSchemeObserver) {
        colorSchemeObserver.disconnect();
        colorSchemeObserver = null;
      }
  }

  // Copy a data URL image to clipboard from the page context
  async function copyImageDataUrlToClipboard(dataUrl) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const item = new ClipboardItem({ [blob.type]: blob });
      await navigator.clipboard.write([item]);
      showToast('Screenshot copied to clipboard');
    } catch (err) {
      // Best-effort message; some sites may restrict clipboard API
      showToast('Failed to copy to clipboard');
      console.error('Clipboard write failed:', err);
    }
  }

  // Lightweight toast notification within the page
  function showToast(message) {
    try {
      const toast = document.createElement('div');
      toast.textContent = message;
      toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2147483647;
        padding: 10px 14px; background: #111827; color: #fff; border-radius: 8px;
        font: 500 13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        box-shadow: 0 6px 16px rgba(0,0,0,0.2); opacity: 0; transform: translateY(-8px);
        transition: opacity .18s ease, transform .18s ease;`;
      document.documentElement.appendChild(toast);
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        setTimeout(() => toast.remove(), 200);
      }, 2200);
    } catch (_) {
      // Ignore if DOM is unavailable
    }
  }
})();
