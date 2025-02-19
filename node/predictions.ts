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
const systemMessage = `predict what user whant to cahnge or fix code. do not explain final answer. you are code completion assistant.`;
// const systemMessage  = `Predict what user whant to change or fix code. Respond only with code, no explanation, no formatting.`
// const systemMessage = `complete users code. fix errors. do not explain final answer. you are code completion assistant.`;
// const systemMessage = `complete unfinished code. do not explain final answer. you are code completion assistant.`;

// const deleteCursor = (str: string) => str.replace(/<\|user_cursor_is_here\|>/g, "");
const user_cusor_is_here = "<|user_cursor_is_here|>";
const editable_region_start = "<|editable_region_start|>";
const editable_region_end = "<|editable_region_end|>";

export async function startPredictions(nvim: Nvim) {
  const buffer = await getCurrentBuffer(nvim);
  const filePath = await buffer.getName();
  const languageName = langFromFileName(filePath, nvim);
  const win = await getCurrentWindow(nvim);
  // await new Promise((resolve) => setTimeout(resolve, 2000));
  const { row } = await win.getCursor();

  const n = 15;
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
    prediction: {
      type: "content",
      content: prompt,
    },
    model: "codestral-latest", //22b model
    // model: "codestral-mamba-latest", //8b model
    // model: "ministral-3b-latest",
    // model: "ministral-8b-latest",
    // model: "mistral-small-latest",
    stream: false,
    maxTokens: 1000,
    temperature: 0,
    messages: [
      // { content: systemMessage, role: "system" },
      {
        content:
          "fix code only inside <|editable_region_end|> and <|editable_region_start|>",
        role: "user",
      },
      // { content: `Language: ${fileName}`, role: "user" },
      // { content: prompt, role: "user" },

      { content: systemMessage, role: "system" },
      // {content: "do not edit code before <|editable_region_start|>", role: "user", },
      // {content: "do not edit code past <|editable_region_end|>", role: "user", },
      // {content: "fix code only inside <|editable_region_end|> and <|editable_region_start|>", role: "user", },
      { content: `Language: ${languageName}`, role: "user" },
      { content: prompt, role: "user" },
    ],
  });
  writeDebugPredictions(
    `== Usage while predicting in ${languageName}`,
    `${JSON.stringify(result.usage)}\n`,
  );

  const content = result.choices?.[0].message.content as string;
  if (!content) {
    return;
  }
  const insertLines = format(content).editableRegion().getLines();
  const diffStr = getColoredDiff(
    lines.join("\n"),
    insertLines.join("\n"),
    "line",
  );
  // const text = insertLines.join("\n");
  if (content.substring(0, 3) === "```") {
    //TODO: it could be a part of the code, try witohut it
    writeDebugPredictions("== Prediction:", "DEBUG: triple backticks found");
    insertLines.pop(); //remove markdown tags which sometimes LLM use
    insertLines.shift(); //remove markdown tags which sometimes LLM use
  }
  await buffer.setLines({ start, end, lines: insertLines as Line[] });
  const endTime = performance.now();
  const elapsedTime = Math.round(endTime - startTime);
  writeDebugPredictions(
    `== Prediction in file ${languageName} (${elapsedTime}ms)`,
    `${diffStr}\n`,
  );
  // writeDebugPredictions(
  //   `== Input ${fileName} (${elapsedTime}ms)`,
  //   `${withCursor.join("\n")}\n`,
  // );
  // writeDebugPredictions(
  //   `== Actual resonse of the LLM`,
  //   `${content}\n`,
  // );
}

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

function format(text: string) {
  const editableRegion = () => {
    //editable meta tadgs hsould have \n a the and and before
    // .._start.length + 1 - to count for \n start tag
    // endIndex-1 - to count for \n before editable end tag
    const startIndex = text.indexOf(editable_region_start + "\n");
    const endIndex = text.indexOf(editable_region_end + "\n");
    const cut = text.substring(
      startIndex === -1 ? 0 : startIndex + editable_region_start.length + 1,
      endIndex === -1 ? text.length : endIndex - 1,
    );
    const result = cut.replace(user_cusor_is_here, "");

    return format(result);
  };

  return {
    user_cusor_is_here,
    editable_region_start,
    editable_region_end,

    editableRegion,
    get() {
      return text;
    },
    getLines() {
      return text.split("\n");
    },
  };
}
