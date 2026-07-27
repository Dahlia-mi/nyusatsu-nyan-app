#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_URL =
  "https://www.mod.go.jp/gsdf/eae/kaikei/eafin/koubo.html";
export const USER_AGENT =
  "NyanProcurementMonitor/0.1 " +
  "(+https://github.com/Dahlia-mi/nyusatsu-nyan-app)";
export const PRIORITY_KEYWORDS = [
  "松本",
  "印刷",
  "ポスター",
  "パンフレット",
  "帽子",
  "食品",
  "保存食",
  "防災",
  "消耗品",
  "事務用品",
  "家電",
];

function decodeEntities(value) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripTags(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseLinks(cellHtml, sourceUrl) {
  const links = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of cellHtml.matchAll(pattern)) {
    const url = new URL(decodeEntities(match[1].trim()), sourceUrl).href;
    if (!links.includes(url)) links.push(url);
  }
  return links;
}

export function decodeHtml(buffer) {
  const head = buffer.subarray(0, 4096).toString("latin1");
  const match = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.-]+)/i);
  const declared = match?.[1]?.toLowerCase() ?? "";
  const encoding = /shift[_-]?jis|windows-31j|cp932/.test(declared)
    ? "shift_jis"
    : declared || "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

export function extractNotices(document, sourceUrl = SOURCE_URL) {
  const notices = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const datePattern = /^\d{4}\/\d{2}\/\d{2}$/;

  for (const rowMatch of document.matchAll(rowPattern)) {
    const cells = [...rowMatch[1].matchAll(cellPattern)].map((match) => ({
      html: match[1],
      text: stripTags(match[1]),
    }));
    if (cells.length < 9) continue;

    const publishedDate = cells[2].text;
    const title = cells[3].text;
    if (!datePattern.test(publishedDate) || !title) continue;

    const attachmentLinks = [];
    for (const cell of cells.slice(3, 7)) {
      for (const link of parseLinks(cell.html, sourceUrl)) {
        if (!attachmentLinks.includes(link)) attachmentLinks.push(link);
      }
    }
    const matchedKeywords = PRIORITY_KEYWORDS.filter((keyword) =>
      title.includes(keyword),
    );
    notices.push({
      priority: matchedKeywords.length > 0,
      matchedKeywords,
      publishedDate,
      title,
      deadline: datePattern.test(cells[8].text) ? cells[8].text : "",
      attachmentLinks,
    });
  }

  return notices.sort(
    (a, b) =>
      Number(b.priority) - Number(a.priority) ||
      b.publishedDate.localeCompare(a.publishedDate) ||
      a.title.localeCompare(b.title, "ja"),
  );
}

async function loadState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveState(path, headers) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        etag: headers.get("etag") ?? "",
        lastModified: headers.get("last-modified") ?? "",
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function fetchOnce(url, state, timeoutMs) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml",
  };
  if (state.etag) headers["If-None-Match"] = state.etag;
  if (state.lastModified) headers["If-Modified-Since"] = state.lastModified;

  return fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function csvCell(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

async function writeCsv(path, notices) {
  await mkdir(dirname(path), { recursive: true });
  const columns = [
    "priority",
    "matched_keywords",
    "published_date",
    "title",
    "deadline",
    "attachment_links",
  ];
  const rows = notices.map((notice) => [
    notice.priority ? "YES" : "",
    notice.matchedKeywords.join("|"),
    notice.publishedDate,
    notice.title,
    notice.deadline,
    notice.attachmentLinks.join("|"),
  ]);
  const csv = [columns, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  await writeFile(path, `\uFEFF${csv}\r\n`, "utf8");
}

function parseArgs(args) {
  const options = {
    url: SOURCE_URL,
    state: ".cache/eafin-http.json",
    csv: "artifacts/eafin-notices.csv",
    summary: "artifacts/eafin-summary.json",
    timeoutMs: 30_000,
  };
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    const value = args[i + 1];
    if (key === "--url") options.url = value;
    else if (key === "--state") options.state = value;
    else if (key === "--csv") options.csv = value;
    else if (key === "--summary") options.summary = value;
    else if (key === "--timeout-ms") options.timeoutMs = Number(value);
    else continue;
    i += 1;
  }
  return options;
}

export async function run(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const state = await loadState(options.state);
  let response;
  try {
    response = await fetchOnce(options.url, state, options.timeoutMs);
  } catch (error) {
    console.error(`FETCH_ERROR ${error.name}: ${error.message}`);
    return 1;
  }

  let notices = [];
  if (response.status === 200) {
    notices = extractNotices(
      decodeHtml(Buffer.from(await response.arrayBuffer())),
      options.url,
    );
    await saveState(options.state, response.headers);
  } else if (response.status === 304) {
    console.log("HTTP 304 Not Modified: parsing skipped.");
  } else if (response.status === 403) {
    console.error("HTTP 403 Forbidden: no retry will be attempted.");
  } else {
    console.error(`HTTP ${response.status}: unexpected response; no retry.`);
  }

  await writeCsv(options.csv, notices);
  const summary = {
    checkedAt: new Date().toISOString(),
    sourceUrl: options.url,
    httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "",
    etag: response.headers.get("etag") ?? "",
    lastModified: response.headers.get("last-modified") ?? "",
    extractedCount: notices.length,
    priorityCount: notices.filter((notice) => notice.priority).length,
  };
  await mkdir(dirname(options.summary), { recursive: true });
  await writeFile(options.summary, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
  for (const notice of notices.filter((item) => item.priority)) {
    console.log(
      `PRIORITY ${notice.publishedDate} | ${notice.deadline} | ${notice.title}`,
    );
  }

  return [200, 304, 403].includes(response.status) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run();
}
