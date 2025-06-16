/**
 * Pinterest Advanced Downloader - Content Script
 * Runs on Pinterest pages to inject download buttons and handle media detection
 */

// Configuration
let settings = {
  downloadQuality: "best",
  autoFolderNaming: true,
  downloadLimit: 100,
  showDownloadButtons: true
};

// Track processed pins to avoid duplication
const processedPins = new Set();

// Current page context information
let pageContext = {
  type: "unknown", // "board", "pin", "search"
  boardName: "",
  searchQuery: ""
};

// Initialize the extension
function init() {
  // Load user settings
  chrome.storage.local.get("settings", (data) => {
    if (data.settings) {
      settings = data.settings;
    }
    
    // Determine page type
    detectPageType();
    
    // Set up mutation observer to handle Pinterest's dynamic content
    setupObserver();
    
    // Initial scan for pins
    scanForPins();
  });
}

// Detect the type of Pinterest page we're on
function detectPageType() {
  const url = window.location.href;
  
  if (url.includes("/pin/")) {
    pageContext.type = "pin";
  } else if (url.match(/\/[^\/]+\/[^\/]+\/?$/)) {
    pageContext.type = "board";
    // Extract board name from URL or page content
    const boardNameElement = document.querySelector("h1");
    if (boardNameElement) {
      pageContext.boardName = boardNameElement.textContent.trim();
    } else {
      // Fallback: extract from URL
      const urlParts = url.split("/");
      pageContext.boardName = urlParts[urlParts.length - 2].replace(/-/g, " ");
    }
  } else if (url.includes("/search/")) {
    pageContext.type = "search";
    // Extract search query from URL or page content
    const searchParams = new URLSearchParams(window.location.search);
    const query = searchParams.get("q");
    if (query) {
      pageContext.searchQuery = query;
    }
  }
  
  console.log("Page context detected:", pageContext);
}

// Set up mutation observer to handle Pinterest's dynamic content
function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
      }
    });
    
    if (shouldScan) {
      scanForPins();
    }
  });
  
  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Scan page for pins and add download buttons
function scanForPins() {
  // Different selectors based on current Pinterest layout
  // Pinterest often changes their HTML structure, so we need multiple selectors
  const pinSelectors = [
    // Board pins
    ".GrowthUnauthPinImage", 
    // Search results
    "[data-test-id='pinrep-image']",
    // Pin closeups
    "[data-test-id='pin-closeup-image']",
    // Video pins
    "video"
  ];
  
  // Combine all selectors
  const combinedSelector = pinSelectors.join(", ");
  const pinElements = document.querySelectorAll(combinedSelector);
  
  console.log(`Found ${pinElements.length} potential pins`);
  
  // Process each pin
  pinElements.forEach((pinElement) => {
    const elementId = getElementIdentifier(pinElement);
    
    // Skip if already processed
    if (processedPins.has(elementId)) {
      return;
    }
    
    // Mark as processed
    processedPins.add(elementId);
    
    // Add download button if settings allow
    if (settings.showDownloadButtons) {
      addDownloadButton(pinElement);
    }
  });
  
  // Add bulk download button if appropriate
  if (pageContext.type === "board" || pageContext.type === "search") {
    addBulkDownloadButton();
  }
}

// Get a unique identifier for the element to avoid duplicate processing
function getElementIdentifier(element) {
  // Try to get pin ID from data attributes or fallback to element properties
  const pinId = element.getAttribute("data-pin-id") || 
               element.getAttribute("data-test-pin-id") ||
               element.closest("[data-test-id]")?.getAttribute("data-test-id");
  
  if (pinId) {
    return pinId;
  }
  
  // Fallback: use a combination of properties
  const src = element.src || element.poster || "";
  const rect = element.getBoundingClientRect();
  return `${src}-${rect.width}x${rect.height}`;
}

// Add download button to a pin
function addDownloadButton(pinElement) {
  // Create button element
  const downloadButton = document.createElement("div");
  downloadButton.className = "pad-download-button";
  
  // Determine if this is a video or image pin
  const isVideo = pinElement.tagName === "VIDEO" || 
                 pinElement.querySelector("video") !== null ||
                 pinElement.closest(".GrowthVideoPin") !== null;
  
  // Use appropriate icon based on media type
  const iconSrc = isVideo ? "icons/download_video.png" : "icons/download_image.png";
  downloadButton.innerHTML = `<img src="${chrome.runtime.getURL(iconSrc)}" alt="Download" width="20" height="20">`;
  
  // Style the button
  downloadButton.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10;
    opacity: 0;
    transition: opacity 0.3s;
  `;
  
  // Position the button container relative to the pin
  const buttonContainer = document.createElement("div");
  buttonContainer.style.cssText = `
    position: relative;
    display: inline-block;
  `;
  
  // Ensure the pin element has relative positioning
  if (getComputedStyle(pinElement).position === "static") {
    pinElement.style.position = "relative";
  }
  
  // Add hover effect
  pinElement.addEventListener("mouseenter", () => {
    downloadButton.style.opacity = "1";
  });
  
  pinElement.addEventListener("mouseleave", () => {
    downloadButton.style.opacity = "0";
  });
  
  // Add click handler
  downloadButton.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Extract media info
    const mediaInfo = extractMediaInfo(pinElement);
    
    if (mediaInfo) {
      // Determine appropriate folder name
      let folderName = "Pinterest";
      if (settings.autoFolderNaming) {
        if (pageContext.type === "board" && pageContext.boardName) {
          folderName = `Pinterest/${pageContext.boardName}`;
        } else if (pageContext.type === "search" && pageContext.searchQuery) {
          folderName = `Pinterest/Search/${pageContext.searchQuery}`;
        }
      }
      
      // Generate filename
      const filename = `${folderName}/${mediaInfo.filename}`;
      
      // Send download request to background script
      chrome.runtime.sendMessage({
        action: "downloadSingle",
        mediaUrl: mediaInfo.url,
        filename: filename
      }, (response) => {
        console.log("Download response:", response);
        
        // Show download started notification
        showNotification("Download started");
      });
    } else {
      console.error("Could not extract media info from pin");
      showNotification("Could not download media", true);
    }
  });
  
  // Add button to the pin
  pinElement.appendChild(downloadButton);
}

// Extract media information from a pin element
function extractMediaInfo(pinElement) {
  let mediaUrl = "";
  let filename = "";
  let isVideo = false;
  
  // Handle different pin types
  if (pinElement.tagName === "VIDEO") {
    // Video pin
    isVideo = true;
    
    // Get poster image as fallback
    mediaUrl = pinElement.poster;
    
    // Try to get video source
    if (pinElement.src) {
      mediaUrl = pinElement.src;
    } else {
      // Look for source elements
      const source = pinElement.querySelector("source");
      if (source && source.src) {
        mediaUrl = source.src;
      }
    }
    
    // Generate filename with video extension
    const extension = getExtensionFromUrl(mediaUrl) || "mp4";
    const timestamp = Date.now();
    filename = `pinterest_video_${timestamp}.${extension}`;
    
  } else {
    // Image pin
    
    // Try to get highest resolution image
    if (pinElement.srcset) {
      const srcset = parseSrcset(pinElement.srcset);
      if (srcset.length > 0) {
        // Get the highest resolution image
        mediaUrl = srcset[srcset.length - 1].url;
      }
    }
    
    // Fallback to src attribute if srcset is not available or empty
    if (!mediaUrl && pinElement.src) {
      mediaUrl = pinElement.src;
    }
    
    // Try to get higher resolution by URL manipulation
    if (mediaUrl.includes("236x") || mediaUrl.includes("474x")) {
      mediaUrl = mediaUrl.replace(/\/[0-9]+x\//g, "/originals/");
    }
    
    // Generate filename with image extension
    const extension = getExtensionFromUrl(mediaUrl) || "jpg";
    const timestamp = Date.now();
    filename = `pinterest_image_${timestamp}.${extension}`;
  }
  
  // Check if we found a valid media URL
  if (!mediaUrl || mediaUrl === "undefined" || mediaUrl === "null") {
    return null;
  }
  
  return {
    url: mediaUrl,
    filename: filename,
    isVideo: isVideo
  };
}

// Parse srcset attribute to get all available image sources
function parseSrcset(srcset) {
  const sources = [];
  
  // Split srcset by commas
  const srcsetParts = srcset.split(",");
  
  // Process each part
  srcsetParts.forEach((part) => {
    // Split by whitespace
    const [url, width] = part.trim().split(/\s+/);
    
    // Parse width value (remove 'w' suffix)
    const widthValue = parseInt(width);
    
    // Add to sources array
    sources.push({
      url: url,
      width: isNaN(widthValue) ? 0 : widthValue
    });
  });
  
  // Sort by width (ascending)
  sources.sort((a, b) => a.width - b.width);
  
  return sources;
}

// Get file extension from URL
function getExtensionFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastDotIndex = pathname.lastIndexOf(".");
    
    if (lastDotIndex !== -1) {
      return pathname.substring(lastDotIndex + 1).toLowerCase();
    }
  } catch (e) {
    console.error("Error parsing URL:", e);
  }
  
  return null;
}

// Add bulk download button to the page
function addBulkDownloadButton() {
  // Check if button already exists
  if (document.querySelector(".pad-bulk-download-button")) {
    return;
  }
    // Create button element
  const bulkButton = document.createElement("button");
  bulkButton.className = "pad-bulk-download-button";
  
  // Create button content with icon and text
  bulkButton.innerHTML = `
    <img src="${chrome.runtime.getURL('icons/download_image.png')}" alt="Download" width="20" height="20" style="margin-right: 8px; vertical-align: middle;">
    <span>Download All</span>
  `;
  
  // Style the button
  bulkButton.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    background-color: #e60023;
    color: white;
    border: none;
    border-radius: 24px;
    font-weight: bold;
    font-size: 16px;
    cursor: pointer;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  // Add click handler
  bulkButton.addEventListener("click", () => {
    // Collect all visible pins
    collectAllPins().then((pins) => {
      if (pins.length > 0) {
        // Determine appropriate folder name
        let folderName = "Pinterest";
        if (settings.autoFolderNaming) {
          if (pageContext.type === "board" && pageContext.boardName) {
            folderName = `Pinterest/${pageContext.boardName}`;
          } else if (pageContext.type === "search" && pageContext.searchQuery) {
            folderName = `Pinterest/Search/${pageContext.searchQuery}`;
          }
        }
        
        // Apply download limit if set
        if (settings.downloadLimit > 0 && pins.length > settings.downloadLimit) {
          pins = pins.slice(0, settings.downloadLimit);
        }
        
        // Send bulk download request to background script
        chrome.runtime.sendMessage({
          action: "bulkDownload",
          items: pins,
          folderName: folderName
        }, (response) => {
          console.log("Bulk download response:", response);
          
          // Show download started notification
          showNotification(`Downloading ${pins.length} items`);
        });
      } else {
        showNotification("No pins found to download", true);
      }
    });
  });
  
  // Add button to the page
  document.body.appendChild(bulkButton);
}

// Collect all visible pins on the page
async function collectAllPins() {
  // Different selectors based on current Pinterest layout
  const pinSelectors = [
    // Board pins
    ".GrowthUnauthPinImage", 
    // Search results
    "[data-test-id='pinrep-image']",
    // Pin closeups
    "[data-test-id='pin-closeup-image']",
    // Video pins
    "video"
  ];
  
  // Combine all selectors
  const combinedSelector = pinSelectors.join(", ");
  const pinElements = document.querySelectorAll(combinedSelector);
  
  const pins = [];
  
  // Process each pin
  pinElements.forEach((pinElement) => {
    // Extract media info
    const mediaInfo = extractMediaInfo(pinElement);
    
    if (mediaInfo) {
      pins.push({
        mediaUrl: mediaInfo.url,
        filename: mediaInfo.filename,
        isVideo: mediaInfo.isVideo
      });
    }
  });
  
  return pins;
}

// Show notification to user
function showNotification(message, isError = false) {
  // Create notification element
  const notification = document.createElement("div");
  notification.className = "pad-notification";
  notification.textContent = message;
  
  // Style notification
  notification.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    padding: 10px 16px;
    background-color: ${isError ? "#e60023" : "#2cbe4e"};
    color: white;
    border-radius: 4px;
    font-size: 14px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    animation: fadeInOut 3s forwards;
  `;
  
  // Add animation style
  const style = document.createElement("style");
  style.textContent = `
    @keyframes fadeInOut {
      0% { opacity: 0; transform: translateY(20px); }
      10% { opacity: 1; transform: translateY(0); }
      90% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-20px); }
    }
  `;
  document.head.appendChild(style);
  
  // Add to page and remove after animation
  document.body.appendChild(notification);
  setTimeout(() => {
    document.body.removeChild(notification);
  }, 3000);
}

// Add a progress bar for bulk downloads
function showDownloadProgress(total, completed, failed) {
  // Remove any existing progress elements
  const existingProgress = document.querySelector('.pad-progress-container');
  if (existingProgress) {
    existingProgress.remove();
  }
  
  // Create progress container
  const progressContainer = document.createElement('div');
  progressContainer.className = 'pad-progress-container';
  
  // Create progress bar
  const progressBar = document.createElement('div');
  progressBar.className = 'pad-progress-bar';
  
  // Calculate progress percentage
  const progress = (completed + failed) / total * 100;
  progressBar.style.width = `${progress}%`;
  progressBar.style.backgroundColor = failed > 0 ? '#e60023' : '#2cbe4e';
  
  // Create download counter
  const downloadCounter = document.createElement('div');
  downloadCounter.className = 'pad-download-counter';
  downloadCounter.textContent = `${completed}/${total} (${failed} failed)`;
  downloadCounter.style.bottom = '85px';
  
  // Add to DOM
  progressContainer.appendChild(progressBar);
  document.body.appendChild(progressContainer);
  document.body.appendChild(downloadCounter);
  
  // Auto-remove when complete
  if (completed + failed >= total) {
    setTimeout(() => {
      progressContainer.remove();
      downloadCounter.remove();
    }, 3000);
  }
}

// Listen for download updates from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadStatsUpdate" && request.stats) {
    // Update progress display
    showDownloadProgress(
      request.stats.total,
      request.stats.completed,
      request.stats.failed
    );
  } else if (request.action === "bulkDownloadPage") {
    // Handle bulk download request from popup
    collectAllPins().then((pins) => {
      if (pins.length > 0) {
        // Determine appropriate folder name
        let folderName = "Pinterest";
        if (settings.autoFolderNaming) {
          if (pageContext.type === "board" && pageContext.boardName) {
            folderName = `Pinterest/${pageContext.boardName}`;
          } else if (pageContext.type === "search" && pageContext.searchQuery) {
            folderName = `Pinterest/Search/${pageContext.searchQuery}`;
          }
        }
        
        // Apply download limit
        if (settings.downloadLimit > 0 && pins.length > settings.downloadLimit) {
          pins = pins.slice(0, settings.downloadLimit);
        }
        
        // Send bulk download request to background script
        chrome.runtime.sendMessage({
          action: "bulkDownload",
          items: pins,
          folderName: folderName
        });
        
        // Send response back to popup
        sendResponse({ status: "started" });
      } else {
        sendResponse({ status: "error", message: "No pins found" });
      }
    });
    
    // Required for async response
    return true;
  } else if (request.action === "updateSettings") {
    // Update settings
    if (request.settings) {
      settings = request.settings;
      console.log("Settings updated:", settings);
      
      // Refresh pin buttons based on new settings
      if (settings.showDownloadButtons) {
        // Reset processed pins to re-add buttons
        processedPins.clear();
        scanForPins();
      } else {
        // Remove all download buttons
        document.querySelectorAll('.pad-download-button').forEach(button => {
          button.remove();
        });
      }
      
      // Update bulk download button
      const bulkButton = document.querySelector('.pad-bulk-download-button');
      if (settings.showDownloadButtons && !bulkButton && (pageContext.type === "board" || pageContext.type === "search")) {
        addBulkDownloadButton();
      } else if (!settings.showDownloadButtons && bulkButton) {
        bulkButton.remove();
      }
      
      sendResponse({ status: "settings_updated" });
    }
  }
});

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
