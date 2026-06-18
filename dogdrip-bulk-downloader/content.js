"use strict";

(() => {
  const SCRIPT_VERSION = "0.1.4";

  if (window.__dogdripBulkDownloaderVersion === SCRIPT_VERSION) {
    return;
  }
  window.__dogdripBulkDownloaderVersion = SCRIPT_VERSION;
  window.__dogdripBulkDownloaderLoaded = true;

  const DOWNLOAD_LINK_SELECTOR = [
    'a[href*="module=file"][href*="act=procFileDownload"]',
    'a[href*="act=procFileDownload"]',
    'a[href*="procFileDownload"]'
  ].join(",");

  const IMAGE_EXTENSIONS = new Set([
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "bmp",
    "avif"
  ]);

  const VIDEO_EXTENSIONS = new Set([
    "mp4",
    "webm",
    "mov",
    "m4v",
    "avi",
    "mkv"
  ]);

  const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

  if (window.__dogdripBulkDownloaderHandler) {
    chrome.runtime.onMessage.removeListener(window.__dogdripBulkDownloaderHandler);
  }

  const handleMessage = (message, sender, sendResponse) => {
    if (
      !message ||
      (
        message.type !== "DOGDRIP_GET_FILES_V3" &&
        message.type !== "DOGDRIP_GET_FILES_V2" &&
        message.type !== "DOGDRIP_GET_FILES"
      )
    ) {
      return false;
    }

    const allFiles = collectFiles();
    const imageFiles = filterByKind(allFiles, "image");
    const videoFiles = filterByKind(allFiles, "video");
    const mediaFiles = allFiles.filter((file) => file.kind === "image" || file.kind === "video");

    sendResponse({
      ok: true,
      allFiles,
      imageFiles,
      videoFiles,
      mediaFiles,
      pageTitle: getPageTitle(),
      scriptVersion: SCRIPT_VERSION
    });

    return false;
  };

  window.__dogdripBulkDownloaderHandler = handleMessage;
  chrome.runtime.onMessage.addListener(handleMessage);

  function collectFiles() {
    const seen = new Set();
    const files = [];
    const renderedMedia = collectRenderedMedia();
    let renderedMediaIndex = 0;

    for (const link of document.querySelectorAll(DOWNLOAD_LINK_SELECTOR)) {
      const absoluteUrl = normalizeUrl(link.getAttribute("href"));
      if (!absoluteUrl || seen.has(absoluteUrl)) {
        continue;
      }

      let filename = getFilename(link, absoluteUrl);
      let extension = getExtension(filename, absoluteUrl);
      let fallbackMedia = null;

      if (!extension) {
        fallbackMedia = renderedMedia[renderedMediaIndex] || null;

        if (fallbackMedia) {
          renderedMediaIndex += 1;
          extension = fallbackMedia.extension;

          if (fallbackMedia.filename && !extensionFromText(filename)) {
            filename = fallbackMedia.filename;
          }
        }
      }

      const kind = getKind(extension, fallbackMedia, link);

      seen.add(absoluteUrl);
      files.push({
        url: absoluteUrl,
        filename,
        extension,
        kind
      });
    }

    return files;
  }

  function filterByKind(files, kind) {
    return files.filter((file) => file.kind === kind);
  }

  function collectRenderedMedia() {
    const root = getArticleRoot();
    const seen = new Set();
    const media = [];
    const selector = [
      "img[src]",
      "img[data-src]",
      "img[data-original]",
      "video[src]",
      "video[poster]",
      "source[src]"
    ].join(",");

    for (const node of root.querySelectorAll(selector)) {
      const values = [
        node.currentSrc,
        node.src,
        node.getAttribute("src"),
        node.getAttribute("data-src"),
        node.getAttribute("data-original"),
        node.getAttribute("poster")
      ];

      for (const value of values) {
        const absoluteUrl = normalizeUrl(value);
        if (!absoluteUrl || seen.has(absoluteUrl)) {
          continue;
        }

        const extension = getExtension("", absoluteUrl);
        if (!MEDIA_EXTENSIONS.has(extension)) {
          continue;
        }

        seen.add(absoluteUrl);
        media.push({
          url: absoluteUrl,
          filename: guessFilenameFromUrl(absoluteUrl),
          extension,
          kind: IMAGE_EXTENSIONS.has(extension) ? "image" : "video"
        });
        break;
      }
    }

    return media;
  }

  function getArticleRoot() {
    return (
      document.querySelector(".xe_content") ||
      document.querySelector(".rhymix_content") ||
      document.querySelector(".document_content") ||
      document.querySelector(".read_body") ||
      document.querySelector(".article-content") ||
      document.querySelector(".ed.article") ||
      document.querySelector("article") ||
      document.body
    );
  }

  function getKind(extension, fallbackMedia, link) {
    if (IMAGE_EXTENSIONS.has(extension)) {
      return "image";
    }

    if (VIDEO_EXTENSIONS.has(extension)) {
      return "video";
    }

    if (fallbackMedia && fallbackMedia.kind) {
      return fallbackMedia.kind;
    }

    const text = `${link.textContent || ""} ${link.getAttribute("title") || ""} ${link.getAttribute("aria-label") || ""}`;
    if (/\b(mp4|webm|mov|m4v|avi|mkv|video|동영상)\b/i.test(text)) {
      return "video";
    }

    if (/\b(jpe?g|png|gif|webp|bmp|avif|image|img|사진|이미지)\b/i.test(text)) {
      return "image";
    }

    return "unknown";
  }

  function normalizeUrl(value) {
    if (!value) {
      return "";
    }

    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  }

  function getFilename(link, url) {
    const candidates = [
      link.getAttribute("download"),
      link.getAttribute("title"),
      link.getAttribute("data-title"),
      link.getAttribute("aria-label"),
      link.textContent,
      getQueryParam(url, "filename"),
      getQueryParam(url, "file_name"),
      getQueryParam(url, "source_filename")
    ];

    for (const candidate of candidates) {
      const sanitized = sanitizeFilename(candidate);
      if (sanitized) {
        return sanitized;
      }
    }

    return guessFilenameFromUrl(url);
  }

  function getQueryParam(url, key) {
    try {
      return new URL(url).searchParams.get(key);
    } catch {
      return "";
    }
  }

  function guessFilenameFromUrl(url) {
    try {
      const parsed = new URL(url);
      const lastPart = parsed.pathname.split("/").filter(Boolean).pop();
      return sanitizeFilename(lastPart) || `dogdrip-file-${Date.now()}`;
    } catch {
      return `dogdrip-file-${Date.now()}`;
    }
  }

  function getExtension(filename, url) {
    const fromFilename = extensionFromText(filename);
    if (fromFilename) {
      return fromFilename;
    }

    try {
      return extensionFromText(new URL(url).pathname);
    } catch {
      return "";
    }
  }

  function extensionFromText(text) {
    const pattern = /\.((?:jpe?g|png|gif|webp|bmp|avif|mp4|webm|mov|m4v|avi|mkv))(?=$|[\s?#),;\]}])/ig;
    let match;
    let extension = "";

    while ((match = pattern.exec(String(text || ""))) !== null) {
      extension = match[1].toLowerCase();
    }

    return extension;
  }

  function sanitizeFilename(value) {
    const text = trimAfterKnownExtension(value);

    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 180);
  }

  function trimAfterKnownExtension(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const match = text.match(/\.((?:jpe?g|png|gif|webp|bmp|avif|mp4|webm|mov|m4v|avi|mkv))(?=$|[\s?#),;\]}])/i);

    if (!match) {
      return text;
    }

    return text.slice(0, match.index + match[0].length).trim();
  }

  function getPageTitle() {
    const titleNode =
      document.querySelector(".ed.article .title") ||
      document.querySelector(".article-title") ||
      document.querySelector("h1") ||
      document.querySelector("title");

    return sanitizeFilename(titleNode ? titleNode.textContent : document.title) || "dogdrip";
  }
})();
