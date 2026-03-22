// logger.js
// Structured console logger that also accumulates a transcript for file output.

import { writeFileSync } from "fs";
import { join } from "path";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

const transcript = [];

function log(text) {
  console.log(text);
  // Strip ANSI codes for file transcript
  transcript.push(text.replace(/\x1b\[[0-9;]*m/g, ""));
}

export function header(title) {
  const line = "═".repeat(70);
  log(`\n${c("cyan", line)}`);
  log(`${c("cyan", "║")}  ${c("bold", title)}`);
  log(`${c("cyan", line)}\n`);
}

export function section(label, color = "yellow") {
  log(`\n${c(color, "┌─ " + label + " " + "─".repeat(Math.max(0, 60 - label.length)))}`);
}

export function roundHeader(round, maxRounds) {
  log(`\n${"─".repeat(70)}`);
  log(c("bold", `  ROUND ${round} / ${maxRounds} (max)`));
  log("─".repeat(70));
}

export function agentOutput(agentName, color, data) {
  section(`${agentName} Output`, color);
  log(c(color, JSON.stringify(data, null, 2)));
}

export function info(msg) {
  log(c("dim", `  ℹ  ${msg}`));
}

export function success(msg) {
  log(c("green", `  ✓  ${msg}`));
}

export function warn(msg) {
  log(c("yellow", `  ⚠  ${msg}`));
}

export function error(msg) {
  log(c("red", `  ✗  ${msg}`));
}

export function finalDocument(doc) {
  header("FINAL DECISION DOCUMENT");
  log(c("white", JSON.stringify(doc, null, 2)));
}

export function saveTranscript(exampleKey, featureRequest) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `output/${exampleKey}-run-${timestamp}.txt`;
  const content = [
    `DELIBERATION ENGINE — Run Transcript`,
    `Timestamp: ${new Date().toISOString()}`,
    `Feature Request: ${featureRequest}`,
    "=".repeat(70),
    ...transcript,
  ].join("\n");

  try {
    writeFileSync(filename, content, "utf8");
    success(`Transcript saved → ${filename}`);
    return filename;
  } catch {
    warn("Could not save transcript file.");
    return null;
  }
}
