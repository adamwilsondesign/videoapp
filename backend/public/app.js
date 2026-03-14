// ============ STATE ============
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordingStartTime = null;
let timerInterval = null;
let currentShortID = null;
let currentVerifyURL = null;
let useFrontCamera = true; // Default to selfie mode
let sessionVideos = []; // Videos recorded during this demo session

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

// Toast
const toast = $("toast");

// ============ SCREEN MANAGEMENT ============
function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const el = $("screen-" + name);
  if (el) el.classList.add("active");
}

// ============ TOAST ============
let toastTimeout = null;
function showToast(message) {
  toast.textContent = message;
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

// ============ LIBRARY ============
function updateLibrary() {
  if (sessionVideos.length === 0) {
    libraryEmpty.style.display = "flex";
    libraryList.style.display = "none";
    btnCreateNew.style.display = "none";
  } else {
    libraryEmpty.style.display = "none";
    libraryList.style.display = "flex";
    btnCreateNew.style.display = "flex";
    renderLibraryItems();
  }
}

function renderLibraryItems() {
  libraryList.innerHTML = "";
  sessionVideos.forEach((video) => {
    const item = document.createElement("div");
    item.className = "library-item";
    item.innerHTML =
      '<div class="library-item-thumb"><video src="/videos/' + video.shortID + '" preload="metadata" muted></video></div>' +
      '<div class="library-item-info">' +
        '<span class="library-item-id">' + video.shortID + '</span>' +
        '<span class="library-item-time">' + formatTime(video.timestamp) + '</span>' +
      '</div>' +
      '<div class="library-item-badge">Verified</div>';
    item.addEventListener("click", () => viewVerification(video));
    libraryList.appendChild(item);
  });
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
  verifyPlayer.src = "/videos/" + video.shortID;
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

    progressFill.style.width = "100%";
    uploadPercent.textContent = "100%";

    // Add to session library
    sessionVideos.unshift({
      shortID: data.shortID,
      verifyURL: data.verifyURL,
      timestamp: new Date().toISOString(),
    });

    // Show verification result
    showVerificationResult();
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
  showScreen("verify-result");
}

// ============ DOWNLOAD (Fixed for mobile) ============
btnDownloadExport.addEventListener("click", async () => {
  const originalText = btnDownloadExport.textContent;
  btnDownloadExport.textContent = "Preparing...";
  btnDownloadExport.disabled = true;

  try {
    const resp = await fetch("/api/export/" + currentShortID);

    // Check if server returned JSON error instead of video
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const err = await resp.json();
      throw new Error(err.error || "Export failed");
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
  } catch (err) {
    // Fallback: direct navigation
    window.location.href = "/api/export/" + currentShortID;
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
    // Fallback
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
