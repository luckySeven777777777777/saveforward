import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

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
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
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

    const userId = msg.from.id.toString();
    const userName =
      msg.from.username ||
      `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim();

    // 初始化
    if (!stats[today]) stats[today] = {};
    if (!stats[month]) stats[month] = {};

    if (!stats[today][userId]) {
      stats[today][userId] = { name: userName, count: 0 };
    }

    if (!stats[month][userId]) {
      stats[month][userId] = { name: userName, count: 0 };
    }

    // ====== 只统计转发 ======
    if (msg.forward_date) {
      stats[today][userId].count += 1;
      stats[month][userId].count += 1;

      writeData(stats);

      const todayCount = stats[today][userId].count;
      const yesterdayCount =
        stats[yesterday]?.[userId]?.count || 0;
      const monthCount = stats[month][userId].count;

      const userTag = `${userName} (${userId})`;

      const text =
        `👤 用户：${userTag}\n` +
        `📅 日期：${today}\n` +
        `🌅 今日：${todayCount}\n` +
        `🌃 昨日：${yesterdayCount}\n` +
        `🧮 本月：${monthCount}`;

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
