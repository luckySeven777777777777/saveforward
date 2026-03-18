import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;

let stats = {}; // 内存存储（简单版）

app.post("/", async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.send("ok");

  const chatId = msg.chat.id;

  const today = getDate(0);
  const yesterday = getDate(-1);
  const month = today.slice(0, 7);

  // 初始化
  if (!stats[today]) stats[today] = 0;
  if (!stats[yesterday]) stats[yesterday] = 0;
  if (!stats[month]) stats[month] = 0;

  // 只统计转发
  if (msg.forward_date) {
    stats[today] += 1;
    stats[month] += 1;

    const text =
      `📅 日期：${today}\n` +
      `🌅 今日发送数：${stats[today]}\n` +
      `🌃 昨日新增数：${stats[yesterday]}\n` +
      `🧮 本月总数：${stats[month]}`;

    await sendMessage(chatId, text);
  }

  res.send("ok");
});

function getDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});