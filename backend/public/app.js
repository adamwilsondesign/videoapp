// ============ STATE ============
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordingStartTime = null;
let timerInterval = null;
let currentShortID = null;
let currentVerifyURL = null;
let useFrontCamera = false;

// ============ DOM REFS ============
const screens = {
  recording: document.getElementById("screen-recording"),
  review: document.getElementById("screen-review"),
  uploading: document.getElementById("screen-uploading"),
  success: document.getElementById("screen-success"),
};

const cameraPreview = document.getElementById("camera-preview");
const btnRecord = document.getElementById("btn-record");
const recordBtnInner = document.getElementById("record-btn-inner");
const recordingIndicator = document.getElementById("recording-indicator");
const recTimer = document.getElementById("rec-timer");

const btnFlip = document.getElementById("btn-flip");

const reviewPlayer = document.getElementById("review-player");
const btnRetake = document.getElementById("btn-retake");
const btnFinish = document.getElementById("btn-finish");
const btnPlayToggle = document.getElementById("btn-play-toggle");
const playIcon = document.getElementById("play-icon");
const pauseIcon = document.getElementById("pause-icon");

const uploadContent = document.getElementById("upload-content");
const uploadError = document.getElementById("upload-error");
const uploadStatus = document.getElementById("upload-status");
const progressFill = document.getElementById("progress-fill");
const uploadPercent = document.getElementById("upload-percent");
const errorMessage = document.getElementById("error-message");
const btnRetry = document.getElementById("btn-retry");

const successId = document.getElementById("success-id");
const successUrl = document.getElementById("success-url");
const btnDownload = document.getElementById("btn-download");
const btnView = document.getElementById("btn-view");
const btnNew = document.getElementById("btn-new");

// ============ SCREEN MANAGEMENT ============
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

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

  // Pick best supported format
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

  mediaRecorder.start(100); // collect data every 100ms
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
    recTimer.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
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
    // Step 1: Upload
    const formData = new FormData();
    const ext = recordedBlob.type.includes("mp4") ? "mp4" : "webm";
    formData.append("video", recordedBlob, `recording.${ext}`);

    const response = await uploadWithProgress(formData, (pct) => {
      const scaledPct = Math.round(pct * 80); // 0-80% for upload
      progressFill.style.width = scaledPct + "%";
      uploadPercent.textContent = scaledPct + "%";
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upload failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    currentShortID = data.shortID;
    currentVerifyURL = data.verifyURL;

    progressFill.style.width = "100%";
    uploadPercent.textContent = "100%";

    showSuccess();
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
    xhr.timeout = 300000; // 5 minutes

    xhr.send(formData);
  });
}

// ============ SUCCESS ============
function showSuccess() {
  successId.textContent = currentShortID;
  successUrl.textContent = currentVerifyURL;
  btnDownload.href = `/api/export/${currentShortID}`;
  btnDownload.download = `allybi_${currentShortID}.mp4`;
  showScreen("success");
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

reviewPlayer.addEventListener("ended", () => {
  updatePlayButton(false);
});

reviewPlayer.addEventListener("pause", () => {
  updatePlayButton(false);
});

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

btnRetry.addEventListener("click", () => {
  uploadVideo();
});

btnView.addEventListener("click", () => {
  window.open(currentVerifyURL, "_blank");
});

successUrl.addEventListener("click", () => {
  window.open(currentVerifyURL, "_blank");
});

btnNew.addEventListener("click", () => {
  currentShortID = null;
  currentVerifyURL = null;
  recordedBlob = null;
  stopCamera();
  startCamera();
  showScreen("recording");
});

// ============ INIT ============
startCamera();
