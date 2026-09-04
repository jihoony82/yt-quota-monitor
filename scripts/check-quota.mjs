// 유튜브 API 쿼터 측정기 — 여러 GCP 프로젝트의 일일 한도(및 확보되는 대로 소비량)를 체크해
// docs/data.json에 기록하고, 임계치 초과 시 텔레그램으로 경보를 보낸다.
//
// 결제 계정이 연결되지 않은 프로젝트가 많아(2026-09 기준) 지금은 Service Usage API로
// "일일 한도(limit)"만 무료로 읽어온다. 소비량(usage)은 프로젝트별로 Cloud Monitoring
// 연동이나 자체계측이 준비되는 대로 project 객체에 usage 필드를 채워 넣으면 그대로 동작한다.

import { GoogleAuth } from "google-auth-library";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const PROJECTS_FILE = path.join(ROOT, "projects.json");
const DATA_FILE = path.join(ROOT, "docs", "data.json");
const ALERT_STATE_FILE = path.join(ROOT, "docs", "alert-state.json");

const ALERT_THRESHOLD = 0.8; // 80%
const KST_RESET_HOUR = 16; // 유튜브 쿼터는 UTC 00:00(=KST 09:00... 실제로는 태평양시 자정=KST 16~17시) 리셋

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function getDailyLimit(projectId, accessToken) {
  const url = `https://serviceusage.googleapis.com/v1beta1/projects/${projectId}/services/youtube.googleapis.com/consumerQuotaMetrics`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const defaultMetric = (data.metrics || []).find(
    (m) => m.metric === "youtube.googleapis.com/default"
  );
  if (!defaultMetric) return null;
  const dayLimit = (defaultMetric.consumerQuotaLimits || []).find((l) =>
    l.unit?.includes("/d/")
  );
  const bucket = dayLimit?.quotaBuckets?.[0];
  if (!bucket) return null;
  return Number(bucket.effectiveLimit ?? bucket.defaultLimit ?? NaN) || null;
}

function kstTodayKey() {
  // 쿼터 리셋 시각(KST 오후 4~5시경) 이후를 "다음 날"로 취급해 중복 경보를 막는다.
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (kst.getUTCHours() >= KST_RESET_HOUR) {
    kst.setUTCDate(kst.getUTCDate() + 1);
  }
  return kst.toISOString().slice(0, 10);
}

async function sendTelegramAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("TELEGRAM_BOT_TOKEN/CHAT_ID 미설정 — 경보 스킵");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    console.error("텔레그램 발송 실패:", await res.text());
  }
}

async function main() {
  const projects = await readJson(PROJECTS_FILE, []);
  const alertState = await readJson(ALERT_STATE_FILE, {});
  const todayKey = kstTodayKey();

  const results = [];
  const toAlert = [];

  for (const project of projects) {
    const raw = process.env[project.secretName];
    const entry = {
      label: project.label,
      projectId: project.projectId,
      limit: null,
      usage: null, // TODO: Monitoring/자체계측 연동되면 채워짐
      percent: null,
      status: "ok",
      error: null,
      checkedAt: new Date().toISOString(),
    };

    if (!raw) {
      entry.status = "error";
      entry.error = "서비스계정 키 시크릿 없음";
      results.push(entry);
      continue;
    }

    try {
      const credentials = JSON.parse(raw);
      const auth = new GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/cloud-platform.read-only"],
      });
      const client = await auth.getClient();
      const { token } = await client.getAccessToken();

      entry.limit = await getDailyLimit(project.projectId, token);

      if (entry.usage != null && entry.limit) {
        entry.percent = Math.round((entry.usage / entry.limit) * 1000) / 10;
        if (entry.percent >= ALERT_THRESHOLD * 100) {
          entry.status = "warn";
          if (alertState[project.projectId] !== todayKey) {
            toAlert.push(entry);
          }
        }
      }
    } catch (err) {
      entry.status = "error";
      entry.error = String(err.message || err).slice(0, 300);
      console.error(`[${project.label}] 확인 실패:`, entry.error);
    }

    results.push(entry);
  }

  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(
    DATA_FILE,
    JSON.stringify(
      { updatedAt: new Date().toISOString(), projects: results },
      null,
      2
    )
  );

  if (toAlert.length) {
    const lines = toAlert
      .map(
        (e) =>
          `⚠️ [${e.label}] 유튜브 쿼터 ${e.usage}/${e.limit} (${e.percent}%)`
      )
      .join("\n");
    await sendTelegramAlert(`${lines}\n\n대시보드 확인 필요`);
    for (const e of toAlert) alertState[e.projectId] = todayKey;
    await writeFile(ALERT_STATE_FILE, JSON.stringify(alertState, null, 2));
  }

  console.log(`체크 완료: ${results.length}개 프로젝트`);
  for (const r of results) {
    console.log(
      `  - ${r.label}: limit=${r.limit ?? "?"} usage=${r.usage ?? "미계측"} status=${r.status}${
        r.error ? " (" + r.error + ")" : ""
      }`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
