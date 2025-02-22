// import { mistral } from "@ai-sdk/mistral";
import { generateText } from "ai";
//=== vercel ai sdk^
import * as fs from "fs";
import * as diff from "diff";
// import * as diff from "diff";
import { getCurrentBuffer, getCurrentWindow } from "./nvim/nvim";
import type { Nvim } from "nvim-node";
import type { Line } from "./nvim/buffer";
import { createOpenAI } from "@ai-sdk/openai";
// import { anthropic } from "@ai-sdk/anthropic";
// import { openai } from "@ai-sdk/openai";

type Role = "user" | "assistant" | "system";

type GenericMessage = {
  role: Role;
  content: string;
};

//using for mistral but should be adapted to any provider
export async function mistralGenerateText(
  messages: GenericMessage[],
  code: GenericMessage,
) {
  // model: "ministral-3b-latest",
  // model: "ministral-8b-latest",
  // model: "mistral-small-latest",
  const provider = createOpenAI({
    // hack again, vercel doesnot pass providerOptions to mistral damn
    // but mistral is compatiblee with openai
    apiKey: process.env["MISTRAL_API_KEY"] ?? "",
    baseURL: "https://api.mistral.ai/v1",
  });
  const model = provider("codestral-latest");
  // const model = mistral("codestral-latest");
  // const model = provider("gpt-4o");
  // const model = anthropic('claude-3-5-sonnet-latest');
  // const model = anthropic('claude-3-5-haiku-latest');

  const { text, usage } = await generateText({
    // providerOptions: {
    //   openai: {
    //     prediction: {
    //       type: "content",
    //       content: code.content,
    //     },
    //   },
    // },
    model: model,
    temperature: 0,
    // topP: 1,
    maxTokens: 1000,
    messages: [...messages, code],
    //stop sequence allows us to stop generatino before LLM do some unpredictable things
    stopSequences: [stop_comment],
  });
  return { content: text, usage };
}

// const systemMessage = `predict what user whant to cahnge or fix code. do not explain final answer. you are code completion assistant. no formating.`;
// const systemMessage  = `Predict what user whant to change or fix code. Respond only with code, no explanation, no formatting.`
// const systemMessage = `fix errors. do not explain final answe.`;
// const systemMessage = `complete unfinished code. do not explain final answer. you are code completion assistant.`;

// const deleteCursor = (str: string) => str.replace(/<\|user_cursor_is_here\|>/g, "");
const user_cusor_is_here = "<|user_cursor_is_here|>";
//We are using comens because we need to ask LLM to leave them inside generated code
//to be able to use those tags to merge our code and LLM response.
const editable_region_start = "//<|editable_region_start|>";
//stop_comment uesd for stop sequence, because LLMs often deletes editable region tags in response.
//or moves them to the endf of the response, if you ask them to leave tags inside response.
//so stop_comment is used to make sure that we are stopping at the right place.
const stop_comment = "//im just a comment do not touch me leave me alone";
const editable_region_end = "//<|editable_region_end|>";

// const directions = `
// You provided the code region to fix.
// You are allowed to edit code only inside ${editable_region_start} and ${editable_region_end} tags.
// Do not return anything else. Do not try to add code outside of the region.
// `;

export async function startPredictions(nvim: Nvim) {
  try {
    await _startPredictions(nvim);
  } catch (e) {
    writeDebugPredictions(
      colorText(`>>>>> ERROR: ${e as Error}`, "red"),
      colorText("==============", "red"),
    );
  }
  return Promise.resolve();
}

export async function _startPredictions(nvim: Nvim) {
  writeDebugPredictions("== LLM is starting to predict", "\n");
  const buffer = await getCurrentBuffer(nvim);
  const filePath = await buffer.getName();
  const languageName = langFromFileName(filePath, nvim);
  const win = await getCurrentWindow(nvim);
  // await new Promise((resolve) => setTimeout(resolve, 2000));
  const { row } = await win.getCursor();

  const n = 20;
  const start = Math.max(0, row - n);
  const end = row + n - (row - start - n);
  const suffixEnd = end + 5;

  // const relativeRow = row - start;
  const file = await buffer.getLines({ start: 0, end: -1 });
  const editableRegion = file.slice(start, end);
  const suffixRegion = file.slice(end, suffixEnd);
  const withoutCursor = [
    // ...file.slice(0, start),
    editable_region_start,
    ...editableRegion,
    stop_comment,
    editable_region_end,
    ...suffixRegion,
  ];
  const prompt = withoutCursor.join("\n");

  const startTime = performance.now();

  const messages: GenericMessage[] = [
    // { content: systemMessage, role: "system" },
    {
      content: `fix code inside ${editable_region_start} and ${editable_region_end}. no explanation and no formating only code. do not delete comments. complete what user doing. do not implement what is out of sight`,
      role: "user",
    },

    { content: `Language: ${languageName}`, role: "user" },
  ];
  const code: GenericMessage = { content: prompt, role: "user" };
  const result = await mistralGenerateText(messages, code);
  // const result  = await originalMistralSDK(messages, code)

  writeDebugPredictions(
    `== Usage while predicting in ${languageName}`,
    `${JSON.stringify(result.usage)}\n`,
  );

  const content = result.content;
  if (!content) {
    throw new Error("LLM returned empty response");
  }
  const insertLines = format(content).editableRegion().getLines();
  const diffStr = getColoredDiff(
    editableRegion.join("\n"),
    insertLines.join("\n"),
    "line",
  );
  // const text = insertLines.join("\n");
  if (content.substring(0, 3) === "```") {
    //LLM wraps code in markdown code blocks very often
    writeDebugPredictions(
      colorText("ERROR: triple backtick found, result may be wronge", "red"),
      colorText("==============", "red"),
    );
  }
  // writeDebugPredictions(
  //   `== Input ${languageName}`,
  //   `${content}\n++++++++++++++++\n${insertLines.join("\n")}\n`,
  // );
  await buffer.setLines({ start, end, lines: insertLines as Line[] });
  const endTime = performance.now();
  const elapsedTime = Math.round(endTime - startTime);
  // writeDebugPredictions(
  //   `== Input ${languageName} (${elapsedTime}ms)`,
  //   `${code.content}}\n`,
  // );
  // writeDebugPredictions(`== Actual resonse of the LLM`, `${content}\n`);
  writeDebugPredictions(
    `== Prediction in file ${languageName} (${elapsedTime}ms)`,
    `${diffStr}\n`,
  );
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
  const d =
    style === "line"
      ? diff.diffLines(p, prompt2)
      : diff.diffWordsWithSpace(p, prompt2);

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
  if (text.substring(0, 3) === "```") {
    //hack
    text = text.substring(text.indexOf("\n") + 1);
  }

  const editableRegion = () => {
    //editable meta tadgs hsould have \n a the and and before
    // .._start.length + 1 - to count for \n start tag
    // endIndex-1 - to count for \n before editable end tag
    const startIndex = text.indexOf(editable_region_start + "\n");
    const endIndex = text.indexOf(editable_region_end + "\n");
    const cut = text.substring(
      startIndex === -1 ? 0 : startIndex + editable_region_start.length + 1,
      //-1 because we want to remove last \n from the _region_end or stop_comment
      endIndex === -1 ? text.length - 1 : endIndex - 1,
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
