import { assembleContext } from "../backend/packages/context-engine/src/engine.js";
const r = assembleContext({
  systemInstructions: "SYS",
  workspaceInstructions: "WS",
  goal: "G",
  constraints: "C",
});
console.log(JSON.stringify(r.promptText.slice(0, 500)));
