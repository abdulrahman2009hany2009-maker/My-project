import { run } from "../lib/remind.mjs";
export default async () => {
  try { console.log(JSON.stringify(await run())); } catch (e) { console.error("prayer-remind failed", e && e.message); }
};
export const config = { schedule: "*/5 * * * *" };
