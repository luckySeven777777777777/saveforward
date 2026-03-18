import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

// ====== 环境变量 ======
const BOT_TOKEN = process.env.BOT_TOKEN;           // Telegram 机器人 token
const GROUP_ID = parseInt(process.env.GROUP_ID);   // 固定群 ID，例如 -1003600779355
const FILE = "./data.json";                        // JSON 文件存储历史数据

// ====== 读取/写入 JSON ======
function readData() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE));
}

function writeData(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// ====== 获取日期 ======
function getDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ====== 发送消息 ======
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML"
    })
  });
}

// ====== 主逻辑 ======
app.post("/", async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.send("ok");

  // 只统计指定群
  if (msg.chat.id !== GROUP_ID) return res.send("ok");

  const chatId = GROUP_ID;
  const today = getDate(0);
  const yesterday = getDate(-1);
  const month = today.slice(0, 7);

  let stats = readData();

  // 用户信息
  const userId = msg.from.id.toString();
  const userName = msg.from.username || msg.from.first_name;

  // 初始化当天/本月对象
  if (!stats[today]) stats[today] = {};
  if (!stats[month]) stats[month] = {};

  if (!stats[today][userId]) stats[today][userId] = { name: userName, count: 0 };
  if (!stats[month][userId]) stats[month][userId] = { name: userName, count: 0 };

  // 只统计转发消息
  if (msg.forward_date) {
    stats[today][userId].count += 1;
    stats[month][userId].count += 1;

    writeData(stats); // 保存 JSON

    // 统计显示
    const todayCount = stats[today][userId].count;
    const yesterdayCount = stats[yesterday]?.[userId]?.count || 0;
    const monthCount = stats[month][userId].count;

    const userTag = `${userName}+${userId}`; // 显示用户名+ID

    const text =
      `👤 Username：${userTag}\n` +
      `📅 日期：${today}\n` +
      `🌅 今日发送数：${todayCount}\n` +
      `🌃 昨日新增数：${yesterdayCount}\n` +
      `🧮 本月总数：${monthCount}`;

    await sendMessage(chatId, text);
  }

  res.send("ok");
});

// ====== 启动服务器 ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
