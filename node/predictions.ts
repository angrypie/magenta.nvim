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
const systemMessage = `fix code in typescript. do not explain final answer. do not delete code.`;

// const deleteCursor = (str: string) => str.replace(/<\|user_cursor_is_here\|>/g, "");
const user_cusor_is_here = "<|user_cursor_is_here|>";
const editable_region_start = "<|editable_region_start|>";
const editable_region_end = "<|editable_region_end|>";

export async function startPredictions(nvim: Nvim) {
  const buffer = await getCurrentBuffer(nvim);
  const win = await getCurrentWindow(nvim);
  let i = 0;
  // while(true) {
  i++;
  if (i === 3) {
    return;
  }
  // await new Promise((resolve) => setTimeout(resolve, 2000));
  const { row } = await win.getCursor();

  const n = 20;
  const start = Math.max(0, row - n);
  const end = row + n - (row - start - n);

  const relativeRow = row - start;
  const lines = await buffer.getLines({ start, end });
  const withCursor = [
    editable_region_start,
    ...lines.slice(0, relativeRow),
    user_cusor_is_here,
    editable_region_end,
    ...lines.slice(relativeRow),
  ];
  const prompt = withCursor.join("\n");

  const startTime = performance.now();

  const result = await mistral.chat.complete({
    model: "codestral-latest",
    // model: "open-codestral-mamba",
    // model: "mistral-small-latest",
    stream: false,
    maxTokens: 1000,
    messages: [
      {
        content: systemMessage,
        role: "system",
      },
      {
        content: prompt,
        role: "user",
      },
    ],
  });
  const content = result.choices?.[0].message.content as string;
  if (!content) {
    return;
  }
  const insertLines = content.split("\n");
  const last = insertLines.pop();
  const first = insertLines.shift();
  const diffStr = getColoredDiff(lines.join("\n"), insertLines.join("\n"));
  // const text = insertLines.join("\n");
  await buffer.setLines({ start, end, lines: insertLines as Line[] });
  const endTime = performance.now();
  const elapsedTime = Math.round(endTime - startTime);
  writeDebugPredictions(
    "prediction",
    `${elapsedTime}\n${first}\n${diffStr}\n${last}\n`,
  );
  // }
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
function getColoredDiff(prompt: string, prompt2: string): string {
  const p = prompt;
  //diff by chars gives unreadable results: Point -> Dot = PDoint
  // const d = diff.diffWords(p, prompt2);
  const d = diff.diffWords(p, prompt2);

  const result = [] as string[];
  for (const part of d) {
    const { added, removed, value } = part;

    // result.push(transformDiffPpart(value, 'line', added, removed));
    result.push(transformDiffPpart(value, "line", added, removed));
  }

  return result.join("");
}

function transformDiffPpart(
  part: string,
  kind: "line" | "char" | "word",
  added: boolean,
  removed: boolean,
): string {
  if (!added && !removed) return part;
  if (added && !removed) return colorText(part, "gren");
  if (removed && !added) return colorText(part, "red");
  //dont know if diff uses this
  if (removed && added) return colorText(part, "yellow");
  return kind === "line" ? part + "\n" : part;
}

function colorText(text: string, color: "gren" | "red" | "yellow") {
  switch (color) {
    case "gren":
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
