// ============ STATE ============
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordingStartTime = null;
let timerInterval = null;
let currentShortID = null;
let currentVerifyURL = null;
let useFrontCamera = true;
let sessionVideos = [];
let activeMenu = null; // Currently open context menu

// ============ DOM REFS ============
const $ = (id) => document.getElementById(id);

// Auth
const btnLogin = $("btn-login");
const btnSignup = $("btn-signup");
const btnReset = $("btn-reset");
const linkForgot = $("link-forgot");
const linkSignupFromLogin = $("link-signup-from-login");
const linkLoginFromSignup = $("link-login-from-signup");
const linkBackLogin = $("link-back-login");
const btnFaceId = $("btn-faceid");

// Face ID overlay
const faceidOverlay = $("faceid-overlay");
const faceidIconContainer = $("faceid-icon-container");
const faceidScanLine = $("faceid-scan-line");
const faceidLabel = $("faceid-label");

// Library
const libraryList = $("library-list");
const libraryEmpty = $("library-empty");
const btnCreateFirst = $("btn-create-first");
const btnCreateNew = $("btn-create-new");

// Recording
const cameraPreview = $("camera-preview");
const btnRecord = $("btn-record");
const recordBtnInner = $("record-btn-inner");
const recordingIndicator = $("recording-indicator");
const recTimer = $("rec-timer");
const btnFlip = $("btn-flip");
const btnBackToLibrary = $("btn-back-to-library");

// Review
const reviewPlayer = $("review-player");
const btnRetake = $("btn-retake");
const btnFinish = $("btn-finish");
const btnPlayToggle = $("btn-play-toggle");
const playIcon = $("play-icon");
const pauseIcon = $("pause-icon");
const reviewTitleInput = $("review-title-input");

// Upload
const uploadContent = $("upload-content");
const uploadError = $("upload-error");
const uploadStatus = $("upload-status");
const progressFill = $("progress-fill");
const uploadPercent = $("upload-percent");
const errorMessage = $("error-message");
const btnRetry = $("btn-retry");

// Verification Result
const verifyId = $("verify-id");
const verifyTime = $("verify-time");
const verifyUrl = $("verify-url");
const verifyPlayer = $("verify-player");
const btnVerifyBack = $("btn-verify-back");
const btnShare = $("btn-share");
const btnDownloadExport = $("btn-download-export");
const btnCopyLink = $("btn-copy-link");
const btnConfirmDone = $("btn-confirm-done");

// Toast
const toast = $("toast");

// ============ SCREEN MANAGEMENT ============
let prevScreen = null;
function showScreen(name) {
  const screens = document.querySelectorAll(".screen");
  screens.forEach((s) => {
    if (s.classList.contains("active")) {
      prevScreen = s.id.replace("screen-", "");
      s.classList.add("screen-exit");
      s.classList.remove("active");
      setTimeout(() => s.classList.remove("screen-exit"), 350);
    }
  });
  const el = $("screen-" + name);
  if (el) {
    el.classList.add("active");
  }
}

// ============ TOAST ============
let toastTimeout = null;
function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("visible");
  // Force reflow for re-animation
  void toast.offsetWidth;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 2500);
}

// ============ SPLASH → LOGIN ============
setTimeout(() => showScreen("login"), 1800);

// ============ AUTH (Demo Flow) ============
btnLogin.addEventListener("click", () => {
  btnLogin.textContent = "Signing in...";
  btnLogin.disabled = true;
  setTimeout(() => {
    btnLogin.textContent = "Log In";
    btnLogin.disabled = false;
    showScreen("library");
    updateLibrary();
  }, 800);
});

btnSignup.addEventListener("click", () => {
  btnSignup.textContent = "Creating account...";
  btnSignup.disabled = true;
  setTimeout(() => {
    btnSignup.textContent = "Create Account";
    btnSignup.disabled = false;
    showScreen("library");
    updateLibrary();
  }, 1000);
});

btnReset.addEventListener("click", () => {
  btnReset.textContent = "Sending...";
  btnReset.disabled = true;
  setTimeout(() => {
    btnReset.textContent = "Send Reset Link";
    btnReset.disabled = false;
    showToast("Reset link sent! Check your email.");
    setTimeout(() => showScreen("login"), 1500);
  }, 800);
});

linkForgot.addEventListener("click", () => showScreen("reset"));
linkSignupFromLogin.addEventListener("click", () => showScreen("signup"));
linkLoginFromSignup.addEventListener("click", () => showScreen("login"));
linkBackLogin.addEventListener("click", () => showScreen("login"));

// Allow Enter key to submit auth forms
document.querySelectorAll(".auth-input").forEach((input) => {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const form = input.closest(".auth-form");
      const btn = form.querySelector(".btn-primary");
      if (btn) btn.click();
    }
  });
});

// ============ FACE ID ============
btnFaceId.addEventListener("click", () => {
  faceidOverlay.classList.add("active");
  faceidLabel.textContent = "Face ID";
  faceidLabel.classList.remove("success");
  faceidIconContainer.classList.remove("success");
  faceidScanLine.classList.add("scanning");

  setTimeout(() => {
    faceidScanLine.classList.remove("scanning");
    faceidIconContainer.classList.add("success");
    faceidLabel.textContent = "Authenticated";
    faceidLabel.classList.add("success");

    setTimeout(() => {
      faceidOverlay.classList.remove("active");
      showScreen("library");
      updateLibrary();
    }, 800);
  }, 1600);
});

// ============ LIBRARY ============
function updateLibrary() {
  if (sessionVideos.length === 0) {
    libraryEmpty.style.display = "flex";
    libraryList.style.display = "none";
    btnCreateNew.style.display = "none";
  } else {
    libraryEmpty.style.display = "none";
    libraryList.style.display = "grid";
    btnCreateNew.style.display = "flex";
    renderLibraryItems();
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderLibraryItems() {
  libraryList.innerHTML = "";
  sessionVideos.forEach((video, index) => {
    const item = document.createElement("div");
    item.className = "library-item";
    item.setAttribute("data-index", index);
    item.style.animationDelay = (index * 0.08) + "s";

    const displayTitle = video.title || "Untitled";

    item.innerHTML =
      '<div class="library-item-thumb">' +
        '<video src="/videos/' + video.shortID + '" preload="auto" muted playsinline></video>' +
        '<div class="library-item-thumb-overlay">' +
          '<div class="drag-handle" aria-label="Reorder">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
              '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>' +
            '</svg>' +
          '</div>' +
          '<button class="library-item-menu-btn" data-index="' + index + '" aria-label="More options">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
              '<circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="library-item-info">' +
        '<span class="library-item-title">' + escapeHtml(displayTitle) + '</span>' +
        '<div class="library-item-meta">' +
          '<span class="library-item-id">' + video.shortID + '</span>' +
          '<div class="library-item-badge">Verified</div>' +
        '</div>' +
        '<span class="library-item-time">' + formatTime(video.timestamp) + '</span>' +
      '</div>';

    // Click to view verification (not on menu or drag handle)
    item.addEventListener("click", (e) => {
      if (e.target.closest(".library-item-menu-btn") || e.target.closest(".drag-handle") || e.target.closest(".context-menu")) return;
      viewVerification(video);
    });

    libraryList.appendChild(item);

    // Seek video to 0.1s for thumbnail
    const vid = item.querySelector("video");
    vid.addEventListener("loadeddata", () => {
      vid.currentTime = 0.1;
    });
  });

  // Setup context menu buttons
  setupMenuHandlers();
  // Setup drag-and-drop
  setupDragAndDrop();
}

// ============ CONTEXT MENU (triple dot) ============
function closeActiveMenu() {
  if (activeMenu) {
    const old = activeMenu;
    activeMenu = null;
    old.classList.add("menu-closing");
    setTimeout(() => {
      if (old.parentNode) old.parentNode.removeChild(old);
    }, 150);
  }
}

function setupMenuHandlers() {
  const menuBtns = libraryList.querySelectorAll(".library-item-menu-btn");
  menuBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-index"));

      // Close existing menu
      closeActiveMenu();

      // Create context menu
      const menu = document.createElement("div");
      menu.className = "context-menu";
      menu.innerHTML =
        '<button class="context-menu-item" data-action="rename">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
            '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' +
          '</svg>' +
          'Rename' +
        '</button>' +
        '<button class="context-menu-item context-menu-danger" data-action="delete">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="3 6 5 6 21 6"/>' +
            '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
          '</svg>' +
          'Delete' +
        '</button>';

      // Position relative to button
      const item = btn.closest(".library-item");
      item.appendChild(menu);
      activeMenu = menu;

      // Force reflow then show
      void menu.offsetWidth;
      menu.classList.add("menu-visible");

      // Rename action
      menu.querySelector('[data-action="rename"]').addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeActiveMenu();
        startRename(idx);
      });

      // Delete action
      menu.querySelector('[data-action="delete"]').addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeActiveMenu();
        deleteVideo(idx);
      });
    });
  });
}

function startRename(idx) {
  const item = libraryList.querySelector('[data-index="' + idx + '"]');
  if (!item) return;
  const titleSpan = item.querySelector(".library-item-title");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "library-item-title-input";
  input.value = sessionVideos[idx].title || "";
  input.placeholder = "Enter title";
  input.maxLength = 60;

  titleSpan.replaceWith(input);
  input.focus();
  input.select();

  const save = () => {
    sessionVideos[idx].title = input.value.trim();
    renderLibraryItems();
  };

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") input.blur();
    if (ev.key === "Escape") { input.value = sessionVideos[idx].title || ""; input.blur(); }
  });
  input.addEventListener("click", (ev) => ev.stopPropagation());
}

function deleteVideo(idx) {
  const item = libraryList.querySelector('[data-index="' + idx + '"]');
  if (item) {
    item.classList.add("item-deleting");
    setTimeout(() => {
      sessionVideos.splice(idx, 1);
      updateLibrary();
      showToast("Video deleted");
    }, 300);
  }
}

// Close menu when tapping elsewhere
document.addEventListener("click", () => closeActiveMenu());
document.addEventListener("touchstart", (e) => {
  if (activeMenu && !e.target.closest(".context-menu") && !e.target.closest(".library-item-menu-btn")) {
    closeActiveMenu();
  }
});

// ============ DRAG AND DROP ============
function setupDragAndDrop() {
  let dragEl = null;
  let startY = 0;
  let startTop = 0;
  let placeholder = null;

  const handles = libraryList.querySelectorAll(".drag-handle");
  handles.forEach((handle) => {
    handle.addEventListener("touchstart", onStart, { passive: false });
    handle.addEventListener("mousedown", onStart);
  });

  function onStart(e) {
    e.preventDefault();
    e.stopPropagation();
    closeActiveMenu();

    dragEl = e.target.closest(".library-item");
    const rect = dragEl.getBoundingClientRect();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startY = clientY;
    startTop = rect.top;

    // Create placeholder
    placeholder = document.createElement("div");
    placeholder.className = "library-item-placeholder";
    placeholder.style.height = rect.height + "px";
    placeholder.style.minHeight = rect.height + "px";

    // Make drag item floating
    dragEl.classList.add("dragging");
    dragEl.style.position = "fixed";
    dragEl.style.top = rect.top + "px";
    dragEl.style.left = rect.left + "px";
    dragEl.style.width = rect.width + "px";
    dragEl.style.height = rect.height + "px";
    dragEl.style.zIndex = "100";
    dragEl.style.transition = "none";

    dragEl.parentNode.insertBefore(placeholder, dragEl);

    if (e.touches) {
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
    } else {
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd);
    }
  }

  function onMove(e) {
    if (!dragEl) return;
    e.preventDefault();

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const delta = clientY - startY;
    dragEl.style.top = (startTop + delta) + "px";

    // Get all non-dragging items
    const others = [...libraryList.querySelectorAll(".library-item:not(.dragging)")];
    const dragMid = startTop + delta + dragEl.offsetHeight / 2;

    for (let i = 0; i < others.length; i++) {
      const otherRect = others[i].getBoundingClientRect();
      const otherMid = otherRect.top + otherRect.height / 2;

      // Moving down: if drag center is below the other item's center
      if (dragMid > otherMid) {
        // Place placeholder after this item
        if (others[i].nextSibling !== placeholder) {
          libraryList.insertBefore(placeholder, others[i].nextSibling);
        }
      }
    }

    // Moving up: check from top
    for (let i = 0; i < others.length; i++) {
      const otherRect = others[i].getBoundingClientRect();
      const otherMid = otherRect.top + otherRect.height / 2;
      if (dragMid < otherMid) {
        if (placeholder.nextSibling !== others[i] || placeholder.previousSibling !== others[i]) {
          libraryList.insertBefore(placeholder, others[i]);
        }
        break;
      }
    }
  }

  function onEnd() {
    if (!dragEl) return;

    // Animate to final position
    const placeholderRect = placeholder.getBoundingClientRect();
    const currentTop = parseFloat(dragEl.style.top);
    const targetTop = placeholderRect.top;

    dragEl.style.transition = "top 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)";
    dragEl.style.top = targetTop + "px";

    setTimeout(() => {
      // Insert dragEl where placeholder is
      libraryList.insertBefore(dragEl, placeholder);
      placeholder.remove();

      // Reset styles
      dragEl.classList.remove("dragging");
      dragEl.style.position = "";
      dragEl.style.top = "";
      dragEl.style.left = "";
      dragEl.style.width = "";
      dragEl.style.height = "";
      dragEl.style.zIndex = "";
      dragEl.style.transition = "";

      // Rebuild sessionVideos from DOM order
      const allItems = [...libraryList.querySelectorAll(".library-item")];
      const reordered = allItems.map((item) => {
        return sessionVideos[parseInt(item.getAttribute("data-index"))];
      });
      sessionVideos = reordered;

      // Re-render to fix indices
      renderLibraryItems();

      dragEl = null;
      placeholder = null;
    }, 250);

    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
  }
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function viewVerification(video) {
  currentShortID = video.shortID;
  currentVerifyURL = video.verifyURL;
  verifyId.textContent = video.shortID;
  verifyTime.textContent = formatTime(video.timestamp);
  verifyUrl.textContent = video.verifyURL;

  // Load video and seek to get preview frame
  verifyPlayer.src = "/videos/" + video.shortID;
  verifyPlayer.addEventListener("loadeddata", function seekOnce() {
    verifyPlayer.currentTime = 0.1;
    verifyPlayer.removeEventListener("loadeddata", seekOnce);
  });

  showScreen("verify-result");
}

btnCreateFirst.addEventListener("click", () => {
  showScreen("recording");
  startCamera();
});

btnCreateNew.addEventListener("click", () => {
  showScreen("recording");
  startCamera();
});

// ============ CAMERA ============
async function startCamera() {
  try {
    const facing = useFrontCamera ? "user" : "environment";
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
    } catch {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    }
    cameraPreview.srcObject = mediaStream;
  } catch (err) {
    alert("Camera access denied. Please allow camera and microphone access.\n\n" + err.message);
  }
}

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    cameraPreview.srcObject = null;
  }
}

// ============ RECORDING ============
function startRecording() {
  recordedChunks = [];

  const mimeTypes = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  let mimeType = "";
  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mt)) {
      mimeType = mt;
      break;
    }
  }

  const options = mimeType ? { mimeType } : {};
  mediaRecorder = new MediaRecorder(mediaStream, options);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const type = mimeType || "video/webm";
    recordedBlob = new Blob(recordedChunks, { type });
    showReview();
  };

  mediaRecorder.start(100);
  recordingStartTime = Date.now();
  recordBtnInner.classList.add("recording");
  recordingIndicator.classList.add("visible");
  startTimer();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  recordBtnInner.classList.remove("recording");
  recordingIndicator.classList.remove("visible");
  stopTimer();
}

function startTimer() {
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    recTimer.textContent = mins + ":" + secs.toString().padStart(2, "0");
  }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  recTimer.textContent = "0:00";
}

// ============ REVIEW ============
function showReview() {
  const url = URL.createObjectURL(recordedBlob);
  reviewPlayer.src = url;
  reviewPlayer.currentTime = 0;
  reviewPlayer.pause();
  updatePlayButton(false);
  reviewTitleInput.value = "";
  showScreen("review");
}

function updatePlayButton(playing) {
  if (playing) {
    playIcon.style.display = "none";
    pauseIcon.style.display = "block";
    btnPlayToggle.classList.add("hidden");
  } else {
    playIcon.style.display = "block";
    pauseIcon.style.display = "none";
    btnPlayToggle.classList.remove("hidden");
  }
}

// ============ UPLOAD ============
async function uploadVideo() {
  showScreen("uploading");
  uploadContent.style.display = "flex";
  uploadError.style.display = "none";
  progressFill.style.width = "0%";
  uploadPercent.textContent = "0%";
  uploadStatus.textContent = "Uploading...";

  try {
    const formData = new FormData();
    const ext = recordedBlob.type.includes("mp4") ? "mp4" : "webm";
    formData.append("video", recordedBlob, "recording." + ext);

    const response = await uploadWithProgress(formData, (pct) => {
      const scaledPct = Math.round(pct * 80);
      progressFill.style.width = scaledPct + "%";
      uploadPercent.textContent = scaledPct + "%";
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error("Upload failed (" + response.status + "): " + text);
    }

    const data = await response.json();
    currentShortID = data.shortID;
    currentVerifyURL = data.verifyURL;

    uploadStatus.textContent = "Processing...";
    progressFill.style.width = "90%";
    uploadPercent.textContent = "90%";

    // Pre-generate the export in background so download works immediately
    fetch("/api/export/" + data.shortID).catch(() => {});

    progressFill.style.width = "100%";
    uploadPercent.textContent = "100%";

    sessionVideos.unshift({
      shortID: data.shortID,
      verifyURL: data.verifyURL,
      timestamp: new Date().toISOString(),
      title: reviewTitleInput.value.trim() || "",
    });

    setTimeout(() => showVerificationResult(), 400);
  } catch (err) {
    uploadContent.style.display = "none";
    uploadError.style.display = "flex";
    errorMessage.textContent = err.message;
  }
}

function uploadWithProgress(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: () => Promise.resolve(xhr.responseText),
        json: () => Promise.resolve(JSON.parse(xhr.responseText)),
      });
    };

    xhr.onerror = () => reject(new Error("Network error — is the server running?"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.timeout = 300000;

    xhr.send(formData);
  });
}

// ============ VERIFICATION RESULT ============
function showVerificationResult() {
  verifyId.textContent = currentShortID;
  verifyTime.textContent = formatTime(new Date().toISOString());
  verifyUrl.textContent = currentVerifyURL;
  verifyPlayer.src = "/videos/" + currentShortID;
  verifyPlayer.addEventListener("loadeddata", function seekOnce() {
    verifyPlayer.currentTime = 0.1;
    verifyPlayer.removeEventListener("loadeddata", seekOnce);
  });
  showScreen("verify-result");
}

// ============ DOWNLOAD ============
btnDownloadExport.addEventListener("click", async () => {
  const originalText = btnDownloadExport.textContent;
  btnDownloadExport.textContent = "Generating export\u2026";
  btnDownloadExport.disabled = true;

  try {
    // 2-minute timeout for export generation (transcoding can take time)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    const resp = await fetch("/api/export/" + currentShortID, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await resp.json();
      // If export is still generating, retry after a short delay
      if (resp.status === 202) {
        btnDownloadExport.textContent = "Processing\u2026";
        setTimeout(() => {
          btnDownloadExport.textContent = originalText;
          btnDownloadExport.disabled = false;
          btnDownloadExport.click();
        }, 3000);
        return;
      }
      throw new Error(data.error || "Export failed");
    }

    if (!resp.ok) throw new Error("Download failed");

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "allybi_" + currentShortID + ".mp4";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast("Download started");
  } catch (err) {
    if (err.name === "AbortError") {
      showToast("Export timed out. Please try again.");
    } else {
      // Fallback: open in new tab for direct download
      const link = document.createElement("a");
      link.href = "/api/export/" + currentShortID;
      link.download = "allybi_" + currentShortID + ".mp4";
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Opening download\u2026");
    }
  } finally {
    btnDownloadExport.textContent = originalText;
    btnDownloadExport.disabled = false;
  }
});

// ============ SHARE ============
btnShare.addEventListener("click", () => {
  if (navigator.share) {
    navigator.share({
      title: "Allybi Verified Video",
      text: "Verified video " + currentShortID,
      url: currentVerifyURL,
    }).catch(() => {});
  } else {
    copyToClipboard(currentVerifyURL);
  }
});

btnCopyLink.addEventListener("click", () => {
  copyToClipboard(currentVerifyURL);
});

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("Link copied to clipboard");
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("Link copied to clipboard");
  });
}

// ============ CONFIRM / DONE ============
btnConfirmDone.addEventListener("click", () => {
  verifyPlayer.pause();
  verifyPlayer.src = "";
  showScreen("library");
  updateLibrary();
});

// ============ EVENT LISTENERS ============
btnRecord.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording();
  } else {
    startRecording();
  }
});

btnFlip.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") return;
  useFrontCamera = !useFrontCamera;
  stopCamera();
  startCamera();
});

btnPlayToggle.addEventListener("click", () => {
  if (reviewPlayer.paused) {
    reviewPlayer.play();
    updatePlayButton(true);
  } else {
    reviewPlayer.pause();
    updatePlayButton(false);
  }
});

reviewPlayer.addEventListener("ended", () => updatePlayButton(false));
reviewPlayer.addEventListener("pause", () => updatePlayButton(false));

btnRetake.addEventListener("click", () => {
  reviewPlayer.pause();
  reviewPlayer.src = "";
  recordedBlob = null;
  showScreen("recording");
});

btnFinish.addEventListener("click", () => {
  reviewPlayer.pause();
  uploadVideo();
});

btnRetry.addEventListener("click", () => uploadVideo());

btnBackToLibrary.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording();
  }
  stopCamera();
  showScreen("library");
  updateLibrary();
});

btnVerifyBack.addEventListener("click", () => {
  verifyPlayer.pause();
  verifyPlayer.src = "";
  showScreen("library");
  updateLibrary();
});
