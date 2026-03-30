import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());
const LATE_GROUP_ID = process.env.LATE_GROUP_ID;

// ====== 环境变量 ======
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID; // ⚠️ 不要 parseInt
const FILE = "./data.json";

// ====== 基础检查 ======
if (!BOT_TOKEN || !GROUP_ID) {
  console.error("❌ 环境变量缺失：BOT_TOKEN 或 GROUP_ID");
  process.exit(1);
}

// ====== 读取/写入 JSON ======
function readData() {
  try {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE));
  } catch (e) {
    console.error("❌ 读取 JSON 失败", e);
    return {};
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("❌ 写入 JSON 失败", e);
  }
}

// ====== 获取日期 ======
function getDate(offset = 0) {
  const d = new Date();

  // ✅ 一次性加 6小时30分钟（= 390分钟）
  d.setMinutes(d.getMinutes() + 390);

  d.setDate(d.getDate() + offset);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
// ====== 发送消息 ======
async function sendMessage(chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML"
      })
    });

    const data = await res.json();

    if (!data.ok) {
      console.error("❌ 发送失败:", data);
    }
  } catch (e) {
    console.error("❌ sendMessage 报错:", e);
  }
}
// ====== 检查未转发用户 ======
async function checkNoForwardUsers() {
  const today = getDate(0);
  const yesterday = getDate(-1); // 获取昨天日期
  const month = today.slice(0, 7);

  let stats = readData();
  if (!stats[month]) return;

  // ✅ 获取管理员列表
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatAdministrators?chat_id=${GROUP_ID}`);
  const data = await res.json();

  let adminIds = [];
  if (data.ok) {
    adminIds = data.result.map(a => a.user.id.toString());
  }

let noForwardUsers = [];

  // ====== 修改后的循环逻辑 ======
for (let userId in stats[month]) {
  const user = stats[month][userId];
  if (adminIds.includes(userId)) continue;

  const todayCount = stats[today]?.[userId]?.count || 0;
  const yesterdayCount = stats[yesterday]?.[userId]?.count || 0;

  // 关键修改：如果昨天和今天加起来等于 0，才抓出来
  if ((todayCount + yesterdayCount) === 0) {
    noForwardUsers.push({
      id: userId,
      name: user.name
    });
  }
}

  if (noForwardUsers.length === 0) return;

  // 分批发送
  const chunkSize = 10;

  for (let i = 0; i < noForwardUsers.length; i += chunkSize) {
    const chunk = noForwardUsers.slice(i, i + chunkSize);

    let mentions = chunk
      .map(u => `<a href="tg://user?id=${u.id}">${u.name}</a>`)
      .join(" ");

    const text =
      `📢 转发任务提醒\n\n` +
      `👤 用户：${mentions}\n` +
      `📅 日期：${today}\n` +
      `🌅 今日： No Effective`;

    await sendMessage(GROUP_ID, text);
  }
}
// ====== webhook 测试 ======
app.get("/", (req, res) => {
  res.send("🤖 Bot is running");
});

// ====== 主逻辑 ======
app.post("/", async (req, res) => {
  try {
    console.log("📩 收到更新:", JSON.stringify(req.body));

    const msg = req.body.message;
    if (!msg) return res.send("ok");

    // ⚠️ 群判断（字符串）
    if (msg.chat.id.toString() !== GROUP_ID) {
      console.log("⛔ 非目标群:", msg.chat.id);
      return res.send("ok");
    }

    const chatId = GROUP_ID;
    const today = getDate(0);
    const yesterday = getDate(-1);
    const month = today.slice(0, 7);

    let stats = readData();
// ====== 加班未完成提醒 ======
const userId = msg.from.id.toString();
const overtime = stats["overtime"] || {};
const userOvertime = overtime[userId];

const textMsg = msg.text || "";
const lower = textMsg.toLowerCase();

if (
  userOvertime &&
  (
    textMsg.includes("Check Out") ||
    lower === "bye" ||
    lower.includes("bye bye")
  )
) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  let requiredMinutes = 0;

  if (userOvertime.streak === 1) requiredMinutes = 30;
  else if (userOvertime.streak === 2) requiredMinutes = 60;
  else requiredMinutes = 120;

  const start = 12 * 60;
  const nowMinutes = currentHour * 60 + currentMinute;

  if (nowMinutes < start + requiredMinutes) {
    await sendMessage(chatId,
      "⚠ You haven't finished your overtime work yet, please continue working overtime ⚠"
    );
  }
}
    const userName =
      msg.from.username ||
      `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim();

// ✅ 安全初始化：如果月份或今天不存在，才创建空对象
    if (!stats[month]) stats[month] = {};
    if (!stats[today]) stats[today] = {};

    // ✅ 关键修改：如果本月已有该用户记录，只更新名字，不重置 count
    if (!stats[month][userId]) {
      stats[month][userId] = { name: userName, count: 0 };
    } else {
      stats[month][userId].name = userName; // 保持名字最新
    }

    // ✅ 今日统计同理
    if (!stats[today][userId]) {
      stats[today][userId] = { name: userName, count: 0 };
    } else {
      stats[today][userId].name = userName;
    }

// ====== 只统计转发 ======
    if (msg.forward_date) {
      // 生成消息指纹：原频道ID + 原消息ID (如果是匿名转发，则使用 forward_date)
      const msgFingerprint = msg.forward_from_chat 
        ? `${msg.forward_from_chat.id}_${msg.forward_from_message_id}`
        : `anon_${msg.forward_date}`;

      // 初始化全局查重库
      if (!stats["history"]) stats["history"] = {};

      // 检查是否已存在
      if (stats["history"][msgFingerprint]) {
        const record = stats["history"][msgFingerprint];
        const prevDate = new Date(record.timestamp);
        // 格式化时间为：2024-05-20 14:30:05
        const timeStr = prevDate.toLocaleString('en-GB', { timeZone: 'Asia/Yangon' });

        const warningText = 
          `⚠ <b>Duplicate Forward Detected</b>\n\n` +
          `This message was already forwarded by:\n` +
          `👤 <b>User:</b> ${record.userName}\n` +
          `⏰ <b>Time:</b> ${timeStr}\n\n` +
          `<i>Please do not forward the same message twice.</i>`;

        await sendMessage(chatId, warningText);
        return res.send("ok");
      }

      // 如果是新转发，记录下来
      stats[today][userId].count += 1;
      stats[month][userId].count += 1;
      
      // 存入查重库
      stats["history"][msgFingerprint] = {
        userId: userId,
        userName: userName,
        timestamp: Date.now()
      };

      writeData(stats);

      const todayCount = stats[today][userId].count;
      const yesterdayCount = stats[yesterday]?.[userId]?.count || 0;
      const monthCount = stats[month][userId].count;

      const userTag = `${userName} (${userId})`;

      const text =
        `👤 User: ${userTag}\n` +
        `📅 Date: ${today}\n` +
        `🌅 Today: ${todayCount}\n` +
        `🌃 Yesterday: ${yesterdayCount}\n` +
        `🧮 Month: ${monthCount}`;

      await sendMessage(chatId, text);
    }
    res.send("ok");
  } catch (e) {
    console.error("❌ 主逻辑报错:", e);
    res.send("error");
  }
});

// ====== 启动 ======
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ====== 每天定时检查 ======
let lastRunNoon = "";

setInterval(() => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 390); // 转换缅甸时间

  const hour = now.getHours();
  const minute = now.getMinutes();
  const day = now.getDate(); // 获取今天是几号
  const today = getDate(0);

  // 1. 正常的每日中午检查（12:00）
  if (hour === 12 && minute === 0 && lastRunNoon !== today) {
    console.log("☀️ 执行每日转发与加班检查...");
    
    checkNoForwardUsers(); 

    setTimeout(async () => {
      let stats = readData();
      const yesterday = getDate(-1);
      const month = today.slice(0, 7);

      if (!stats[month]) return;
      if (!stats["overtime"]) stats["overtime"] = {};

      let notifyList = [];

      for (let userId in stats[month]) {
        const todayCount = stats[today]?.[userId]?.count || 0;
        const yesterdayCount = stats[yesterday]?.[userId]?.count || 0;

        if ((todayCount + yesterdayCount) !== 0) continue;

        const userName = stats[month][userId].name;
        const last = stats["overtime"][userId];
        let streak = (last && last.lastDate === yesterday) ? last.streak + 1 : 1;

        stats["overtime"][userId] = { streak, lastDate: today };

        let otText = streak === 1 ? "加班30分钟" : (streak === 2 ? "加班1小时" : "加班2小时");
        notifyList.push(`${userName}（第${streak}次）${otText}`);
      }

      writeData(stats);

      if (notifyList.length > 0) {
        await sendMessage(LATE_GROUP_ID, "🚨 加班通知\n\n" + notifyList.join("\n") + "\n\n⚠ 连续才累计，断一天重置");
      }
    }, 5000);

    lastRunNoon = today;
  }

  // 2. ✅ 每月 1 号凌晨的静默处理（可选）
  if (day === 1 && hour === 0 && minute === 1) {
    // 此时 getDate(0) 会返回 "2026-04-01"，主逻辑会自动开始记录新月份，无需手动删数据
    console.log("📅 跨月检测：新月份统计已自动开启");
  }
}, 60000);
