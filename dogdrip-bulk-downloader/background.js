"use strict";

const DEFAULT_DELAY_MS = 0;
const MAX_DELAY_MS = 3000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === "DOGDRIP_DOWNLOAD_ALL") {
    queueDownloads(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "DOGDRIP_SHOW_DOWNLOAD_FOLDER") {
    try {
      chrome.downloads.showDefaultFolder();
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  }

  return false;
});

async function queueDownloads(message) {
  const files = Array.isArray(message.files) ? message.files : [];
  const delayMs = clampDelay(message.delayMs);
  const uniqueFiles = dedupeFiles(files).filter((file) => isAllowedDogdripUrl(file.url));

  if (uniqueFiles.length === 0) {
    return {
      queued: 0,
      locationLabel: "Chrome 기본 다운로드 폴더",
      errors: [{ message: "다운로드할 DogDrip 첨부 링크가 없습니다." }]
    };
  }

  const errors = [];
  const width = String(uniqueFiles.length).length;
  let queued = 0;

  for (let index = 0; index < uniqueFiles.length; index += 1) {
    const file = uniqueFiles[index];
    const order = String(index + 1).padStart(width, "0");
    const filename = sanitizeFileName(file.filename || getFilenameFromUrl(file.url) || `attachment-${order}`);
    const downloadPath = `${order}_${filename}`;

    try {
      await downloadOne({
        url: file.url,
        filename: downloadPath,
        conflictAction: "uniquify",
        saveAs: false
      });
      queued += 1;
    } catch (error) {
      errors.push({
        filename,
        url: file.url,
        message: error.message
      });
    }

    if (index < uniqueFiles.length - 1) {
      await sleep(delayMs);
    }
  }

  return { queued, locationLabel: "Chrome 기본 다운로드 폴더", errors };
}

function downloadOne(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

function dedupeFiles(files) {
  const seen = new Set();
  const result = [];

  for (const file of files) {
    if (!file || typeof file.url !== "string") {
      continue;
    }

    const key = getFileSrl(file.url) || file.url;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(file);
  }

  return result;
}

function isAllowedDogdripUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "dogdrip.net" || url.hostname.endsWith(".dogdrip.net"));
  } catch {
    return false;
  }
}

function sanitizeFileName(value) {
  const fileName = sanitizePathSegment(value);
  return fileName || "attachment";
}

function sanitizePathSegment(value) {
  const cleaned = String(value)
    .replace(/[<>:"\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 140);

  if (!cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(cleaned)) {
    return "";
  }

  return cleaned;
}

function getFilenameFromUrl(value) {
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname);
    return pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return "";
  }
}

function getFileSrl(value) {
  try {
    return new URL(value).searchParams.get("file_srl") || "";
  } catch {
    return "";
  }
}

function clampDelay(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_DELAY_MS;
  }
  return Math.max(0, Math.min(MAX_DELAY_MS, numeric));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
