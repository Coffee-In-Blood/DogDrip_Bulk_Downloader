"use strict";

const statusEl = document.querySelector("[data-status]");
const mediaTypeEls = document.querySelectorAll("[data-media-type]");
const locationEl = document.querySelector("[data-location]");
const downloadButton = document.querySelector("[data-download]");
const openFolderButton = document.querySelector("[data-open-folder]");

const MESSAGE_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 45000;
const CONTENT_SCRIPT_VERSION = "0.1.4";

let detected = {
  allFiles: [],
  imageFiles: [],
  videoFiles: [],
  mediaFiles: []
};
let canOpenDownloadFolder = false;

document.addEventListener("DOMContentLoaded", refresh);
mediaTypeEls.forEach((mediaTypeEl) => {
  mediaTypeEl.addEventListener("change", renderCount);
});
downloadButton.addEventListener("click", startDownload);
openFolderButton.addEventListener("click", openDownloadFolder);

async function refresh() {
  downloadButton.disabled = true;
  openFolderButton.disabled = true;
  canOpenDownloadFolder = false;
  locationEl.textContent = formatDownloadLocation();
  statusEl.textContent = "현재 탭을 확인하는 중입니다.";

  try {
    const tab = await getActiveTab();
    const response = await getFilesFromTab(tab);

    if (!response || !response.ok) {
      throw new Error("DogDrip 페이지에서 첨부파일을 찾을 수 없습니다. 페이지를 새로고침한 뒤 다시 열어보세요.");
    }

    detected = response;
    locationEl.textContent = formatDownloadLocation();
    canOpenDownloadFolder = true;
    openFolderButton.disabled = false;
    renderCount();
  } catch (error) {
    statusEl.textContent = error.message;
    locationEl.textContent = "DogDrip 게시글을 확인한 뒤 표시됩니다.";
    downloadButton.disabled = true;
    openFolderButton.disabled = true;
  }
}

async function startDownload() {
  const files = getSelectedFiles();

  if (files.length === 0) {
    statusEl.textContent = "다운로드할 첨부파일이 없습니다.";
    return;
  }

  downloadButton.disabled = true;
  statusEl.textContent = `${files.length}개 다운로드를 Chrome에 요청하는 중입니다.`;
  locationEl.textContent = formatDownloadLocation();

  try {
    const response = await withTimeout(
      sendRuntimeMessage({
        type: "DOGDRIP_DOWNLOAD_ALL",
        files
      }),
      DOWNLOAD_TIMEOUT_MS,
      "다운로드 요청 시간이 너무 오래 걸립니다. Chrome 다운로드 목록을 확인한 뒤 다시 시도해보세요."
    );

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "다운로드 요청에 실패했습니다.");
    }

    const failedText = response.errors && response.errors.length > 0
      ? ` 실패 ${response.errors.length}개.`
      : "";
    statusEl.textContent = `${response.queued}개를 Chrome 다운로드 목록에 추가했습니다.${failedText}`;
    locationEl.textContent = response.locationLabel || formatDownloadLocation();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    downloadButton.disabled = files.length === 0;
    openFolderButton.disabled = !canOpenDownloadFolder;
  }
}

function renderCount() {
  const files = getSelectedFiles();
  const total = detected.allFiles ? detected.allFiles.length : 0;
  const label = getSelectedLabel();

  statusEl.textContent = `${label} ${files.length}개 감지 / 전체 첨부 ${total}개`;

  downloadButton.disabled = files.length === 0;
  openFolderButton.disabled = !canOpenDownloadFolder;
}

async function openDownloadFolder() {
  openFolderButton.disabled = true;

  try {
    const response = await sendRuntimeMessage({ type: "DOGDRIP_SHOW_DOWNLOAD_FOLDER" });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "다운로드 폴더를 열지 못했습니다.");
    }
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    openFolderButton.disabled = !canOpenDownloadFolder;
  }
}

function formatDownloadLocation() {
  return "Chrome 기본 다운로드 폴더";
}

function getSelectedFiles() {
  switch (getSelectedMediaType()) {
    case "image":
      return detected.imageFiles || [];
    case "video":
      return detected.videoFiles || [];
    default:
      return detected.mediaFiles || [];
  }
}

function getSelectedMediaType() {
  const checked = document.querySelector("[data-media-type]:checked");
  return checked ? checked.value : "media";
}

function getSelectedLabel() {
  switch (getSelectedMediaType()) {
    case "image":
      return "사진";
    case "video":
      return "동영상";
    default:
      return "사진/동영상";
  }
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!tabs || !tabs[0]) {
        reject(new Error("현재 탭을 찾지 못했습니다."));
        return;
      }

      resolve(tabs[0]);
    });
  });
}

async function getFilesFromTab(tab) {
  if (!tab || !tab.id) {
    throw new Error("현재 탭을 찾지 못했습니다.");
  }

  if (!/^https:\/\/(www\.)?dogdrip\.net\//.test(tab.url || "")) {
    throw new Error("DogDrip 게시글 탭에서 확장 아이콘을 눌러주세요.");
  }

  try {
    const response = await requestFiles(tab.id);

    if (response && response.scriptVersion === CONTENT_SCRIPT_VERSION) {
      return response;
    }

    await injectContentScript(tab.id);
    return requestFiles(tab.id);
  } catch (error) {
    if (!isMissingContentScriptError(error)) {
      throw error;
    }

    await injectContentScript(tab.id);
    return requestFiles(tab.id);
  }
}

function requestFiles(tabId) {
  return withTimeout(
    sendTabMessage(tabId, { type: "DOGDRIP_GET_FILES_V3" }),
    MESSAGE_TIMEOUT_MS,
    "DogDrip 페이지 응답이 없습니다. 탭을 새로고침한 뒤 다시 열어보세요."
  );
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content.js"]
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      }
    );
  });
}

function isMissingContentScriptError(error) {
  return /receiving end does not exist|could not establish connection|message port closed/i.test(error.message || "");
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}
