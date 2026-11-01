/* بديل للجدولة: استدعِه من خدمة cron خارجية (مثل cron-job.org) كل 5 دقائق:
   https://موقعك/.netlify/functions/prayer-remind-http?key=CRON_KEY  (CRON_KEY متغير بيئة في Netlify) */
import { run } from "../lib/remind.mjs";
export default async (req) => {
  const u = new URL(req.url);
  if (!process.env.CRON_KEY || u.searchParams.get("key") !== process.env.CRON_KEY) return new Response("forbidden", { status: 403 });
  try { return new Response(JSON.stringify(await run()), { headers: { "content-type": "application/json" } }); }
  catch (e) { return new Response("error", { status: 500 }); }
};
