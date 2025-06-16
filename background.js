/**
 * Pinterest Advanced Downloader - Background Script
 * Handles download requests from content script and popup
 */

// Global variables for tracking downloads
let downloadQueue = [];
let isDownloading = false;
let downloadStats = {
  total: 0,
  completed: 0,
  failed: 0
};

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background script received message:", request);
  
  switch(request.action) {
    case "downloadSingle":
      downloadMedia(request.mediaUrl, request.filename);
      sendResponse({ status: "download_started" });
      break;
    
    case "bulkDownload":
      startBulkDownload(request.items, request.folderName);
      sendResponse({ status: "bulk_download_started", queueSize: request.items.length });
      break;
    
    case "getDownloadStats":
      sendResponse({ stats: downloadStats });
      break;
      
    case "cancelDownloads":
      cancelAllDownloads();
      sendResponse({ status: "downloads_canceled" });
      break;
  }
  
  // Required for async response
  return true;
});

/**
 * Download a single media file
 * @param {string} url - URL of the media to download
 * @param {string} filename - Desired filename for the downloaded media
 */
function downloadMedia(url, filename) {
  chrome.downloads.download({
    url: url,
    filename: filename,
    conflictAction: "uniquify"
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error("Download error:", chrome.runtime.lastError);
      downloadStats.failed++;
    } else {
      console.log(`Download started with ID: ${downloadId}`);
      downloadStats.completed++;
    }
    
    // Update all listening components with new stats
    chrome.runtime.sendMessage({
      action: "downloadStatsUpdate",
      stats: downloadStats
    });
  });
}

/**
 * Start bulk download process
 * @param {Array} items - Array of objects with mediaUrl and filename
 * @param {string} folderName - Name of folder to save files in
 */
function startBulkDownload(items, folderName) {
  // Reset stats
  downloadStats = {
    total: items.length,
    completed: 0,
    failed: 0
  };
  
  // Add items to queue with proper folder path
  downloadQueue = items.map(item => ({
    url: item.mediaUrl,
    filename: folderName ? `${folderName}/${item.filename}` : item.filename
  }));
  
  // Start download process if not already running
  if (!isDownloading) {
    isDownloading = true;
    processDownloadQueue();
  }
}

/**
 * Process items in download queue with controlled flow
 */
function processDownloadQueue() {
  if (downloadQueue.length === 0) {
    isDownloading = false;
    console.log("Bulk download completed");
    
    // Notify completion
    chrome.runtime.sendMessage({
      action: "bulkDownloadCompleted",
      stats: downloadStats
    });
    return;
  }
  
  // Get next item from queue
  const item = downloadQueue.shift();
  
  // Download the item
  chrome.downloads.download({
    url: item.url,
    filename: item.filename,
    conflictAction: "uniquify"
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error("Download error:", chrome.runtime.lastError);
      downloadStats.failed++;
    } else {
      console.log(`Download started with ID: ${downloadId}`);
      downloadStats.completed++;
    }
    
    // Update all listening components with new stats
    chrome.runtime.sendMessage({
      action: "downloadStatsUpdate",
      stats: downloadStats
    });
    
    // Process next item with a slight delay to avoid overloading
    setTimeout(processDownloadQueue, 300);
  });
}

/**
 * Cancel all pending downloads
 */
function cancelAllDownloads() {
  downloadQueue = [];
  isDownloading = false;
  console.log("Downloads canceled");
}

// Listen for browser install/update events
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // First-time installation
    chrome.storage.local.set({
      settings: {
        downloadQuality: "best",
        autoFolderNaming: true,
        downloadLimit: 100,
        showDownloadButtons: true
      }
    });
    
    // Open onboarding page
    chrome.tabs.create({
      url: "onboarding.html"
    });
  }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  // Get the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    
    if (!activeTab.url.includes("pinterest.com")) {
      console.log("Not on Pinterest, ignoring command");
      return;
    }
    
    if (command === "download-all") {
      // Trigger bulk download on the current page
      chrome.tabs.sendMessage(activeTab.id, { action: "bulkDownloadPage" });
    } else if (command === "toggle-buttons") {
      // Toggle download button visibility
      chrome.storage.local.get("settings", (data) => {
        const settings = data.settings || {};
        settings.showDownloadButtons = !settings.showDownloadButtons;
        
        // Save updated settings
        chrome.storage.local.set({ settings }, () => {
          // Notify content script of the change
          chrome.tabs.sendMessage(activeTab.id, { 
            action: "updateSettings", 
            settings: settings 
          });
        });
      });
    }
  });
});
