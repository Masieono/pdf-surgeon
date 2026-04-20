import { parsePageRanges } from "./page-ranges.js";

const examples = [
  { input: "1-3,5,7-9", maxPages: 12 },
  { input: " 3- , -5 , 2 ", maxPages: 10 },
  { input: "1,1,2,2,10-12", maxPages: 10 },
  { input: "", maxPages: 8 },
  { input: "0,2-4", maxPages: 8 },
  { input: "a-b", maxPages: 8 },
];

for (const { input, maxPages } of examples) {
  try {
    const parsed = parsePageRanges(input, maxPages);
    console.log(`parsePageRanges(${JSON.stringify(input)}, ${maxPages}) ->`, parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`parsePageRanges(${JSON.stringify(input)}, ${maxPages}) ERROR -> ${message}`);
  }
}
