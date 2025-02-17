import * as fs from "fs";
import * as diff from "diff";
import { Mistral } from "@mistralai/mistralai";
// import * as diff from "diff";
import { getCurrentBuffer, getCurrentWindow } from "./nvim/nvim";
import type { Nvim } from "nvim-node";
import type { Line } from "./nvim/buffer";

const key = process.env["MISTRAL_API_KEY"];

const mistral = new Mistral({
  apiKey: key ?? "",
});

if (!key) {
  throw new Error("Mistral API key not found");
}
//TOOD we need filetype fo this
const systemMessage = `predict what user whant to cahnge. do not explain final answer. you are code completion assistant.`;

// const deleteCursor = (str: string) => str.replace(/<\|user_cursor_is_here\|>/g, "");
const user_cusor_is_here = "<|user_cursor_is_here|>";
const editable_region_start = "<|editable_region_start|>";
const editable_region_end = "<|editable_region_end|>";

export async function startPredictions(nvim: Nvim) {
  const buffer = await getCurrentBuffer(nvim);
  const filePath = await buffer.getName();
  const fileName = langFromFileName(filePath, nvim);
  const win = await getCurrentWindow(nvim);
  // await new Promise((resolve) => setTimeout(resolve, 2000));
  const { row } = await win.getCursor();

  const n = 20;
  const start = Math.max(0, row - n);
  const end = row + n - (row - start - n);

  const relativeRow = row - start;
  const lines = await buffer.getLines({ start, end });
  //maybe we should put all file into context but editabel region should be small?
  const withCursor = [
    editable_region_start,
    ...lines.slice(0, relativeRow),
    user_cusor_is_here,
    ...lines.slice(relativeRow),
    editable_region_end,
  ];
  const prompt = withCursor.join("\n");

  const startTime = performance.now();

  const result = await mistral.chat.complete({
    model: "codestral-latest",
    // model: "open-codestral-mamba",
    // model: "mistral-small-latest",
    stream: false,
    maxTokens: 1000,
    temperature: 0,
    messages: [
      { content: systemMessage, role: "system" },
      // {
      //   content: "put code inside <|editable_region_start|>",
      //   role: "user",
      // },
      // {
      //   content: "do not edit outside <|editable_region_end|>",
      //   role: "user",
      // },
      {
        content: "do not edit code before <|editable_region_start|>",
        role: "user",
      },
      {
        content: "do not edit code past <|editable_region_end|>",
        role: "user",
      },
      // {content: `file name is ${fileName}`, role: "user", },

      { content: prompt, role: "user" },
    ],
  });
  const content = result.choices?.[0].message.content as string;
  if (!content) {
    return;
  }
  const insertLines = content.split("\n");
  const diffStr = getColoredDiff(
    lines.join("\n"),
    insertLines.join("\n"),
    "line",
  );
  // const text = insertLines.join("\n");
  insertLines.pop(); //remove markdown tags which mistral always use
  insertLines.shift(); //remove markdown tags which mistral always use
  await buffer.setLines({ start, end, lines: insertLines as Line[] });
  const endTime = performance.now();
  const elapsedTime = Math.round(endTime - startTime);
  writeDebugPredictions(
    `== Prediction in file ${fileName} (${elapsedTime}ms)`,
    `${diffStr}\n`,
  );
  // writeDebugPredictions(
  //   `== Prediction in file ${fileName} (${elapsedTime}ms)`,
  //   `${content}\n`,
  // );
}

// function boldTextMd(text: string) {
// 	return `**${text}**`;
// }
//
// function strikeThrough(text: string) {
// 	return `~~${text}~~`;
// }

// function getDiffLines(prompt: string, prompt2: string): string {
// 	const p = prompt
// 	// const d = diff.diffLines(p, prompt2, opts);
// 	const d = diff.diffChars(p, prompt2);
//
//   const result = [] as string[];
//   for (const part of d) {
//     const { added, removed, value } = part;
//
// 		// result.push(transformDiffPpart(value, 'line', added, removed));
// 		result.push(transformDiffPpart(value, 'char', added, removed));
//   }
//
// 	return  result.join("");
// }

//getColoredDiff returns a string with diff lines colored.
//It's intended for a dispaying in terminal for debug.
function getColoredDiff(
  prompt: string,
  prompt2: string,
  style: "line" | "word",
): string {
  const p = prompt;
  //diff by chars gives unreadable results: Point -> Dot = PDoint
  // const d = diff.diffWords(p, prompt2);
  const d = diff.diffWords(p, prompt2);

  const result = [] as string[];
  for (const part of d) {
    const { added, removed, value } = part;

    // result.push(transformDiffPpart(value, 'line', added, removed));
    result.push(transformDiffPpart(value, style, added, removed));
  }

  return result.join("");
}

function transformDiffPpart(
  part: string,
  style: "line" | "char" | "word",
  added: boolean,
  removed: boolean,
): string {
  if (!added && !removed) return part;
  if (added && !removed) return colorText(part, "green");
  if (removed && !added) return colorText(strikeThrough(part), "red");
  //dont know if diff uses this
  if (removed && added) return colorText(part, "yellow");
  return style === "line" ? part + "\n" : part;
}

function strikeThrough(text: string) {
  return `\x1b[9m${text}\x1b[0m`;
}

function colorText(text: string, color: "green" | "red" | "yellow") {
  switch (color) {
    case "green":
      return `\x1b[32m${text}\x1b[0m`;
    case "red":
      return `\x1b[31m${text}\x1b[0m`;
    case "yellow":
      return `\x1b[33m${text}\x1b[0m`;
  }
}

const debugPredictionsFilePath = "/tmp/magenta_debug_predictions";
const file = fs.openSync(debugPredictionsFilePath, "a");
function writeDebugPredictions(title: string, text: string) {
  fs.writeSync(file, `${title}\n`);
  fs.writeSync(file, text);
  fs.writeSync(file, "\n");
}

//TODO: its a temporary hack of course (as evrything here)
function langFromFileName(path: string, nvim: Nvim) {
  const index = path.lastIndexOf(".");
  if (index === -1) {
    nvim.logger?.error(
      "Could not find extension in file name for code prediction",
    );
    return "";
  }
  const extension = path.slice(index + 1);
  switch (extension) {
    case "ts":
      return "typescript";
    case "js":
      return "javascript";
    case "jsx":
      return "javascript react";
    case "tsx":
      return "typescript react";
    case "py":
      return "python";
    case "lua":
      return "lua";
    case "rs":
      return "rust";
    case "json":
      return "json";
    case "html":
      return "html";
    case "css":
      return "css";
    case "toml":
      return "toml";
    default:
      nvim.logger?.error("Unknown extension for code prediction: " + extension);
      return "";
  }
}
