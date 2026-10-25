import { test } from "node:test";
import assert from "node:assert/strict";
import { stripReasoning } from "../src/llm.ts";

test("stripReasoning keeps only the answer after the model's thinking", () => {
  assert.equal(stripReasoning("plan the sections...</think>Answer"), "Answer");
  assert.equal(stripReasoning("<think>a</think>\n# Report"), "# Report");
  assert.equal(stripReasoning("Plain answer"), "Plain answer");
  assert.equal(stripReasoning("x<think>unfinished"), "x");
});
