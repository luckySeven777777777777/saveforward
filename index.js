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
// ====== 修改后的日期函数 ======
function getMMDate(offset = 0) {
  const now = new Date();
  // 1. 强制获取缅甸当前时间
  const mmStr = now.toLocaleString("en-GB", { timeZone: "Asia/Yangon" });
  const [datePart] = mmStr.split(", ");
  const [d, m, y] = datePart.split("/");

  // 2. 无论是否有 offset，都严格控制返回格式
  const dateObj = new Date(`${y}-${m}-${d}T12:00:00Z`);
  if (offset !== 0) {
    dateObj.setUTCDate(dateObj.getUTCDate() + offset);
  }
  
  const ny = dateObj.getUTCFullYear();
  const nm = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(dateObj.getUTCDate()).padStart(2, "0");

  // ✅ 核心修正：month 必须返回 YYYY-MM 格式，不能带后面的天数
  return { 
    full: `${ny}-${nm}-${nd}`, 
    month: `${ny}-${nm}` 
  };
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

  const dateInfo = getMMDate(0);
  const today = dateInfo.full;
  const month = dateInfo.month;

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
    
    // ✅ 补全缺失的 text 定义
    const text = `🚨 <b>未转发任务名单（No Effective）：</b>\n\n${mentions}\n\nPlease complete the forwarding task as soon as possible!（请尽快完成转发任务！）`;
    
    await sendMessage(GROUP_ID, text);
  }
} // 闭合 checkNoForwardUsers 函数

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
    const dateInfo = getMMDate(0);
    const yesterdayInfo = getMMDate(-1);

    const today = dateInfo.full;      // 严格当天的缅甸日期
    const month = dateInfo.month;    // 严格当月的缅甸月份[cite: 1]
    const yesterday = yesterdayInfo.full;

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
  const userId = msg.from.id.toString();
  const userName = msg.from.username || `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim();
  
  // 1. 生成消息指纹（查重用）
  const msgFingerprint = msg.forward_from_chat 
    ? `${msg.forward_from_chat.id}_${msg.forward_from_message_id}`
    : `anon_${msg.forward_date}`;

  // 2. 获取媒体组ID（合并多图用）
  const mediaGroupId = msg.media_group_id; 

  if (!stats["history"]) stats["history"] = {};
  if (!stats["media_groups"]) stats["media_groups"] = {}; 

  // --- 步骤 1：判定是不是同一批转发的多张图 ---
  let isNewTask = true;
  if (mediaGroupId) {
    if (stats["media_groups"][mediaGroupId]) {
      // 🔴 关键：如果是同一批图的后续图片，直接静默退出，不走下面的查重逻辑
      isNewTask = false; 
    } else {
      // 记录下这个媒体组，后续的图片看到它就知道是“旧任务”了
      stats["media_groups"][mediaGroupId] = {
        userId: userId,
        timestamp: Date.now()
      };
    }
  }

  // --- 步骤 2：查重逻辑 (只有是“新任务”时才查重，防止刷屏) ---
  if (isNewTask && stats["history"][msgFingerprint]) {
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

  // --- 步骤 3：记录指纹 (无论是不是多图，都记入历史，防止别人偷其中一张图去发) ---
  stats["history"][msgFingerprint] = {
    userId: userId,
    userName: userName,
    timestamp: Date.now()
  };

  // --- 步骤 4：统计加分 (只有真正的新任务才发消息) ---
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
    // 后续图片只存数据，不回话
    writeData(stats);
  }
}
// 🔴 --- 下面是你要补全的内容 --- 🔴
    res.send("ok");
  } catch (e) {
    console.error("❌ 主逻辑错误:", e);
    res.send("ok");
  }
}); 
// 🔴 --- 补全结束 --- 🔴

// ====== 启动 ======
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ====== 每天定时检查 ======
// ====== 每天定时检查 ======
let lastRunDate = ""; 

setInterval(async () => {
  const now = new Date();
  // 强制计算缅甸当前时间对象 (UTC+6.5)
  const mmNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (390 * 60000));
  const currentHour = mmNow.getHours();
  
  const dateInfo = getMMDate(0); 
  const today = dateInfo.full; 

  // ✅ 只要到了中午 12 点，且今天还没跑过任务
  if (currentHour === 12 && lastRunDate !== today) {
    lastRunDate = today; // 立即锁定，防止重复执行
    console.log(`☀️ [${today} 12:00] 缅甸时间中午12点，开始执行检查...`);
    
    try {
      // 1. 发送未转发提醒
      await checkNoForwardUsers(); 

      // 2. 处理加班逻辑（延迟5秒，防止文件读写冲突）
      setTimeout(async () => {
        let stats = readData();
        const yesterdayInfo = getMMDate(-1);

        const month = dateInfo.month;      // 严格获取当月
        const yesterday = yesterdayInfo.full; // 严格获取昨天[cite: 2]
        
        // 计算昨天 18:30 的时间戳（作为判定标准）
        // 这里直接用当前缅甸时间对象减去 17.5 小时即可
        const startTime = mmNow.getTime() - (17.5 * 60 * 60 * 1000);

        if (!stats[month]) return;
        if (!stats["overtime"]) stats["overtime"] = {};

        let notifyList = [];
        const history = stats["history"] || {};

        for (let userId in stats[month]) {
          // 判定逻辑：检查 17.5 小时内是否有转发记录
          const hasForwarded = Object.values(history).some(record => 
            record.userId === userId && record.timestamp >= startTime
          );

          if (hasForwarded) continue; 

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
}, 30000); // 每 30 秒检查一次
