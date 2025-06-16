/**
 * Pinterest Advanced Downloader - Popup Script
 * Handles user interactions in the extension popup
 */

// DOM Elements
const downloadQualitySelect = document.getElementById("downloadQuality");
const autoFolderNameCheckbox = document.getElementById("autoFolderNaming");
const showDownloadButtonsCheckbox = document.getElementById("showDownloadButtons");
const downloadLimitInput = document.getElementById("downloadLimit");
const downloadAllButton = document.getElementById("downloadAll");
const cancelDownloadsButton = document.getElementById("cancelDownloads");
const downloadStatsContainer = document.getElementById("downloadStats");
const totalPinsElement = document.getElementById("totalPins");
const completedDownloadsElement = document.getElementById("completedDownloads");
const failedDownloadsElement = document.getElementById("failedDownloads");

// Global variables
let isDownloadingBulk = false;
let currentTabId = null;

// Initialize popup
document.addEventListener("DOMContentLoaded", () => {
  // Get current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    currentTabId = tabs[0].id;
    
    // Check if we're on Pinterest
    const isPinterestTab = tabs[0].url.includes("pinterest.com");
    
    if (!isPinterestTab) {
      showNotPinterestMessage();
      return;
    }
    
    // Load settings
    loadSettings();
    
    // Check download status
    checkDownloadStatus();
    
    // Set up event listeners
    setupEventListeners();
  });
});

// Show message when not on Pinterest
function showNotPinterestMessage() {
  const content = document.querySelector(".content");
  content.innerHTML = `
    <div style="padding: 20px; text-align: center;">
      <p>Please navigate to Pinterest to use this extension.</p>
      <button id="openPinterest" class="button">Open Pinterest</button>
    </div>
  `;
  
  document.getElementById("openPinterest").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.pinterest.com" });
    window.close();
  });
}

// Load user settings from storage
function loadSettings() {
  chrome.storage.local.get("settings", (data) => {
    if (data.settings) {
      // Apply settings to form elements
      downloadQualitySelect.value = data.settings.downloadQuality || "best";
      autoFolderNameCheckbox.checked = data.settings.autoFolderNaming !== false;
      showDownloadButtonsCheckbox.checked = data.settings.showDownloadButtons !== false;
      downloadLimitInput.value = data.settings.downloadLimit || 100;
    }
  });
}

// Save settings to storage
function saveSettings() {
  const settings = {
    downloadQuality: downloadQualitySelect.value,
    autoFolderNaming: autoFolderNameCheckbox.checked,
    downloadLimit: parseInt(downloadLimitInput.value) || 100,
    showDownloadButtons: showDownloadButtonsCheckbox.checked
  };
  
  chrome.storage.local.set({ settings }, () => {
    console.log("Settings saved");
  });
}

// Check the current download status
function checkDownloadStatus() {
  chrome.runtime.sendMessage({ action: "getDownloadStats" }, (response) => {
    if (response && response.stats) {
      updateDownloadStats(response.stats);
      
      // If downloads are in progress, show the stats and cancel button
      if (response.stats.completed < response.stats.total && response.stats.total > 0) {
        isDownloadingBulk = true;
        updateDownloadUI();
      }
    }
  });
}

// Set up event listeners
function setupEventListeners() {
  // Settings change events
  downloadQualitySelect.addEventListener("change", saveSettings);
  autoFolderNameCheckbox.addEventListener("change", saveSettings);
  showDownloadButtonsCheckbox.addEventListener("change", saveSettings);
  
  // Validate and save download limit on change
  downloadLimitInput.addEventListener("change", () => {
    // Ensure value is within allowed range
    let value = parseInt(downloadLimitInput.value) || 100;
    if (value < 0) value = 0;
    if (value > 500) value = 500;
    
    downloadLimitInput.value = value;
    saveSettings();
  });
  
  // Download all pins on current page
  downloadAllButton.addEventListener("click", () => {
    if (currentTabId) {
      // Send message to content script
      chrome.tabs.sendMessage(currentTabId, { action: "bulkDownloadPage" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error sending message to content script:", chrome.runtime.lastError);
          return;
        }
        
        if (response && response.status === "started") {
          console.log("Bulk download started");
          isDownloadingBulk = true;
          updateDownloadUI();
        }
      });
    }
  });
  
  // Cancel downloads button
  cancelDownloadsButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "cancelDownloads" }, (response) => {
      isDownloadingBulk = false;
      updateDownloadUI();
    });
  });
}

// Update download UI based on status
function updateDownloadUI() {
  if (isDownloadingBulk) {
    downloadAllButton.disabled = true;
    downloadAllButton.textContent = "Download in progress...";
    cancelDownloadsButton.classList.remove("hidden");
    downloadStatsContainer.classList.remove("hidden");
  } else {
    downloadAllButton.disabled = false;
    downloadAllButton.textContent = "Download All Pins on This Page";
    cancelDownloadsButton.classList.add("hidden");
    downloadStatsContainer.classList.add("hidden");
  }
}

// Update download statistics in UI
function updateDownloadStats(stats) {
  totalPinsElement.textContent = stats.total;
  completedDownloadsElement.textContent = stats.completed;
  failedDownloadsElement.textContent = stats.failed;
  
  // Check if download is complete
  if (stats.completed + stats.failed >= stats.total && stats.total > 0) {
    downloadAllButton.textContent = "Download Complete";
    setTimeout(() => {
      isDownloadingBulk = false;
      updateDownloadUI();
    }, 3000);
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadStatsUpdate") {
    updateDownloadStats(request.stats);
  } else if (request.action === "bulkDownloadCompleted") {
    isDownloadingBulk = false;
    updateDownloadUI();
    updateDownloadStats(request.stats);
  }
});
