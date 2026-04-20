import { clamp } from "../../utils/math.js";

function parsePositiveInt(raw, token) {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid page token "${token}"`);
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid page number "${raw}" in "${token}"`);
  }
  return value;
}

function expandRange(start, end, set) {
  for (let page = start; page <= end; page += 1) {
    set.add(page - 1);
  }
}

export function parsePageRanges(input, maxPages) {
  if (!Number.isInteger(maxPages) || maxPages < 0) {
    throw new Error(`Invalid maxPages "${maxPages}"`);
  }

  const raw = String(input ?? "").trim();
  if (!raw) {
    return [];
  }

  if (maxPages === 0) {
    return [];
  }

  const compact = raw.replace(/\s+/g, "");
  const tokens = compact.split(",");
  const output = new Set();

  for (const token of tokens) {
    if (!token) {
      throw new Error("Invalid page range token: empty segment");
    }

    if (token.includes("-")) {
      const match = token.match(/^(\d+)?-(\d+)?$/);
      if (!match) {
        throw new Error(`Invalid page range token "${token}"`);
      }

      const startRaw = match[1];
      const endRaw = match[2];
      if (!startRaw && !endRaw) {
        throw new Error(`Invalid page range token "${token}"`);
      }

      const startParsed = startRaw ? parsePositiveInt(startRaw, token) : 1;
      const endParsed = endRaw ? parsePositiveInt(endRaw, token) : maxPages;

      const start = clamp(startParsed, 1, maxPages);
      const end = clamp(endParsed, 1, maxPages);
      if (start > end) {
        throw new Error(`Invalid page range "${token}": start is greater than end`);
      }

      expandRange(start, end, output);
      continue;
    }

    const page = parsePositiveInt(token, token);
    output.add(clamp(page, 1, maxPages) - 1);
  }

  return Array.from(output).sort((a, b) => a - b);
}

export function parseRangeGroups(input, maxPages) {
  if (!Number.isInteger(maxPages) || maxPages < 0) {
    throw new Error(`Invalid maxPages "${maxPages}"`);
  }

  const raw = String(input ?? "").trim();
  if (!raw) {
    return [];
  }

  const groupsRaw = raw.split(";");
  const groups = [];

  for (let index = 0; index < groupsRaw.length; index += 1) {
    const groupToken = groupsRaw[index].trim();
    if (!groupToken) {
      throw new Error(`Invalid range group at position ${index + 1}: empty group`);
    }

    const parsed = parsePageRanges(groupToken, maxPages);
    if (parsed.length === 0) {
      throw new Error(`Range group ${index + 1} produced no pages`);
    }

    groups.push(parsed);
  }

  return groups;
}
