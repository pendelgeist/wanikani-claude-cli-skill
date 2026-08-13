import { tipsSheet } from "../tips.js";

/**
 * The whole list, for when someone asks what this can do. Needs no API call
 * and no token — it's about the tool, not the account — so it answers even
 * when nothing else will.
 */
export async function tipsCommand() {
  console.log(tipsSheet());
}
