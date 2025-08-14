// popup.js
document.addEventListener('DOMContentLoaded', function() {
    const watermarkInput = document.getElementById('watermarkText');
    const previewText = document.getElementById('previewText');
    const form = document.getElementById('watermarkForm');
    const resetBtn = document.getElementById('resetBtn');
    const status = document.getElementById('status');
    const saveBtn = document.getElementById('saveBtn');
    const screenshotBtn = document.getElementById('screenshotBtn');

    const DEFAULT_WATERMARK = '@mark_k (Mark Kretschmann)';

    // Load saved settings when popup opens
    loadSettings();
    
    // Check if this is first use and show welcome message
    checkFirstUseAndShowWelcome();

    // Update preview in real-time as user types
    watermarkInput.addEventListener('input', function() {
        updatePreview();
    });

    // Handle form submission
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        saveSettings();
    });

    // Handle reset button
    resetBtn.addEventListener('click', function() {
        watermarkInput.value = DEFAULT_WATERMARK;
        updatePreview();
        showStatus('Settings reset to default', 'success');
    });
    
    // Handle screenshot button
    screenshotBtn.addEventListener('click', function() {
        // Close popup and start screenshot process
        window.close();
        // Send message to background script to start screenshot
        chrome.runtime.sendMessage({ type: 'startScreenshot' });
    });

    // Load settings from Chrome storage
    function loadSettings() {
        chrome.storage.sync.get(['watermarkText'], function(result) {
            if (result.watermarkText !== undefined) {
                watermarkInput.value = result.watermarkText;
            } else {
                // Set default value if no setting exists
                watermarkInput.value = DEFAULT_WATERMARK;
            }
            updatePreview();
        });
    }

    // Save settings to Chrome storage
    function saveSettings() {
        const watermarkText = watermarkInput.value.trim();
        
        chrome.storage.sync.set({
            watermarkText: watermarkText
        }, function() {
            if (chrome.runtime.lastError) {
                showStatus('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
            } else {
                showStatus('Settings saved successfully!', 'success');
                
                // Update the preview
                updatePreview();
                
                // Disable save button temporarily to prevent spam
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saved!';
                setTimeout(() => {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Settings';
                }, 2000);
                
                // Mark extension as used (for first-time setup)
                chrome.runtime.sendMessage({ type: 'markAsUsed' });
            }
        });
    }

    // Update the preview text
    function updatePreview() {
        const text = watermarkInput.value.trim();
        if (text) {
            previewText.textContent = text;
            previewText.style.opacity = '0.6';
        } else {
            previewText.textContent = 'No watermark';
            previewText.style.opacity = '0.4';
        }
    }

    // Show status message
    function showStatus(message, type) {
        status.textContent = message;
        status.className = `status ${type} show`;
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            status.classList.remove('show');
        }, 3000);
    }

    // Focus on input when popup opens
    watermarkInput.focus();
    
    // Select all text for easy editing
    watermarkInput.select();
    
    // Check if this is first use and show welcome message
    function checkFirstUseAndShowWelcome() {
        chrome.storage.sync.get(['hasBeenUsed'], function(result) {
            if (!result.hasBeenUsed) {
                showStatus('Welcome! Configure your watermark settings below.', 'success');
            }
        });
    }
});
