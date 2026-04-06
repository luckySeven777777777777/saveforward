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
// ====== 检查未转发用户 (修复版) ======
async function checkNoForwardUsers() {
  const now = new Date();
  
  // 1. 获取当前服务器绝对时间戳
  const currentTs = now.getTime(); 
  
  // 2. 计算“17.5小时前”的绝对时间戳 (从中午12:00倒推到昨天18:30，正好是17.5小时)
  // 17.5 * 60 * 60 * 1000 = 63000000 毫秒
  const startTime = currentTs - 63000000;

  const today = getDate(0);
  const month = today.slice(0, 7);

  let stats = readData();
  if (!stats[month]) return;

  // 获取管理员
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatAdministrators?chat_id=${GROUP_ID}`);
  const adminData = await res.json();
  let adminIds = adminData.ok ? adminData.result.map(a => a.user.id.toString()) : [];

  let noForwardUsers = [];
  const history = stats["history"] || {};

  for (let userId in stats[month]) {
    if (adminIds.includes(userId)) continue;

    // 关键修正：直接用绝对时间戳比对，不管服务器在哪个时区
    const hasForwarded = Object.values(history).some(record => 
      record.userId === userId && record.timestamp >= startTime
    );

    if (!hasForwarded) {
      noForwardUsers.push({
        id: userId,
        name: stats[month][userId].name
      });
    }
  }

  if (noForwardUsers.length === 0) return;

  const chunkSize = 10;
  for (let i = 0; i < noForwardUsers.length; i += chunkSize) {
    const chunk = noForwardUsers.slice(i, i + chunkSize);
    let mentions = chunk.map(u => `<a href="tg://user?id=${u.id}">${u.name}</a>`).join(" ");

    	

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
    // ====== 只统计转发 ======
if (msg.forward_date) {
  const userId = msg.from.id.toString();
  const userName = msg.from.username || `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim();
  
  // 1. 生成消息指纹（用于查重：防止不同人转发同一个东西）
  const msgFingerprint = msg.forward_from_chat 
    ? `${msg.forward_from_chat.id}_${msg.forward_from_message_id}`
    : `anon_${msg.forward_date}`;

  // 2. 获取媒体组ID（用于多图合并：防止同一人一次转发多图算多次任务）
  const mediaGroupId = msg.media_group_id; 

  if (!stats["history"]) stats["history"] = {};
  if (!stats["media_groups"]) stats["media_groups"] = {}; // 新增：用于记录已处理的媒体组

  // --- 检查 A：是否是别人发过的重复内容 ---
  if (stats["history"][msgFingerprint]) {
    const record = stats["history"][msgFingerprint];
    const prevDate = new Date(record.timestamp);
    const timeStr = prevDate.toLocaleString('en-GB', { timeZone: 'Asia/Yangon' });

    const warningText = 
      `⚠ <b>Duplicate Forward Detected</b>\n\n` +
      `This message was already forwarded by:\n` +
      `👤 <b>User:</b> ${record.userName}\n` +
      `⏰ <b>Time:</b> ${timeStr}`;

    await sendMessage(chatId, warningText);
    return res.send("ok");
  }

  // --- 检查 B：是否是同一批转发的多张图 (核心修复) ---
  let isNewTask = true;
  if (mediaGroupId) {
    if (stats["media_groups"][mediaGroupId]) {
      // 如果这个媒体组ID已经存在，说明是同一批图的第2,3,4张
      isNewTask = false; 
    } else {
      // 如果是第一次见这个媒体组ID，记录下来
      stats["media_groups"][mediaGroupId] = {
        userId: userId,
        timestamp: Date.now()
      };
    }
  }

  // 存入全局指纹库（无论是不是多图中的一张，都要存，防止别人拿其中一张去偷跑）
  stats["history"][msgFingerprint] = {
    userId: userId,
    userName: userName,
    timestamp: Date.now()
  };

  // --- 只有是新任务时才加分和发消息 ---
  if (isNewTask) {
    stats[today][userId].count += 1;
    stats[month][userId].count += 1;
    
    writeData(stats);

    const todayCount = stats[today][userId].count;
    const yesterdayCount = stats[yesterday]?.[userId]?.count || 0;
    const monthCount = stats[month][userId].count;

    const text =
      `👤 User: ${userName} (${userId})\n` +
      `📅 Date: ${today}\n` +
      `🌅 Today: ${todayCount}\n` +
      `🌃 Yesterday: ${yesterdayCount}\n` +
      `🧮 Month: ${monthCount}`;

    await sendMessage(chatId, text);
  } else {
    // 如果是多图中的后续图片，只保存数据不发消息
    writeData(stats);
  }
}

// ====== 启动 ======
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ====== 每天定时检查 ======
let lastRunDate = ""; 

setInterval(async () => {
  const now = new Date();
  // 核心修正：强制计算缅甸时间 (UTC+6:30)，不论服务器在哪里
  const mmNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (390 * 60000));

  const hour = mmNow.getHours();
  const today = getDate(0);

  // 只要到了中午 12 点，且今天还没跑过任务
  if (hour === 12 && lastRunDate !== today) {
    lastRunDate = today; // 立即锁定，防止重复执行
    console.log(`☀️ [${today} 12:00] 缅甸时间中午12点，开始执行检查...`);
    
    try {
      // 1. 发送未转发提醒
      await checkNoForwardUsers(); 

      // 2. 处理加班逻辑（延迟5秒，防止文件读写冲突）
      setTimeout(async () => {
        let stats = readData();
        const yesterday = getDate(-1);
        const month = today.slice(0, 7);
        
        // 计算昨日 18:30 的时间戳（作为判定标准）
        const yesterday1830 = new Date(mmNow);
        yesterday1830.setDate(yesterday1830.getDate() - 1);
        yesterday1830.setHours(18, 30, 0, 0);
        const startTime = yesterday1830.getTime();

        if (!stats[month]) return;
        if (!stats["overtime"]) stats["overtime"] = {};

        let notifyList = [];
        const history = stats["history"] || {};

        for (let userId in stats[month]) {
          // 判定逻辑：检查昨天 18:30 以后是否有转发记录
          const hasForwarded = Object.values(history).some(record => 
            record.userId === userId && record.timestamp >= startTime
          );

          if (hasForwarded) continue; // 转过的跳过

          const userName = stats[month][userId].name;
          const last = stats["overtime"][userId];
          
          // 累计加班天数
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

    } catch (err) {
      console.error("❌ 定时任务执行失败:", err);
    }
  }
}, 30000); // 每 30 秒检查一次，确保不漏掉 12:00 窗口
