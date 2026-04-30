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
  d.setMinutes(d.getMinutes() + 390); // ✅ 这里加了 6.5 小时
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
  const mmNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (390 * 60000));
  
  let todayStr = getDate(0);
  let targetMonth = todayStr.slice(0, 7); 

  // 1号中午检查时，切换到上个月
  if (mmNow.getDate() === 1) {
    const lastMonthDate = new Date(mmNow);
    lastMonthDate.setDate(0); 
    targetMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;
    console.log(`📅 结算上月数据: ${targetMonth}`);
  }

  let stats = readData();
  if (!stats[targetMonth]) return; 

  // ✅ 修复 1：定义 startTime (17.5小时 = 63,000,000ms)
  const startTime = Date.now() - 63000000;

  // 获取管理员... (此处省略fetch代码)
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatAdministrators?chat_id=${GROUP_ID}`);
  const adminData = await res.json();
  let adminIds = adminData.ok ? adminData.result.map(a => a.user.id.toString()) : [];

  let noForwardUsers = [];
  const history = stats["history"] || {};

  // ✅ 修复 2：使用 targetMonth 进行循环
  for (let userId in stats[targetMonth]) { 
    if (adminIds.includes(userId)) continue;

    const hasForwarded = Object.values(history).some(record => 
      record.userId === userId && record.timestamp >= startTime
    );

    if (!hasForwarded) {
      noForwardUsers.push({ id: userId, name: stats[targetMonth][userId].name });
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
    const msg = req.body.message;
    if (!msg) return res.send("ok");

    // 1. 统一获取当前的缅甸时间字符串
    const today = getDate(0);      // 确保这里返回的是 "2026-04-30"
    const yesterday = getDate(-1);
    
    // 2. 这里的 month 必须严格从 today 字符串截取，不要用 new Date().getMonth()
    const month = today.slice(0, 7); 

    let stats = readData();
// ====== 加班未完成提醒 ======
const userId = msg.from.id.toString();
const overtime = stats["overtime"] || {};
const userOvertime = overtime[userId];

const textMsg = msg.text || "";
const lower = textMsg.toLowerCase();

if (userOvertime && (textMsg.includes("Check Out") || lower === "bye")) {
  const now = new Date();
  // 注意：这里的 now.getHours() 是服务器本地时间，建议统一用缅甸时间
  const currentHour = now.getHours(); 
  const currentMinute = now.getMinutes();

  let requiredMinutes = 0;

  if (userOvertime.streak === 1) requiredMinutes = 30;
  else if (userOvertime.streak === 2) requiredMinutes = 60;
  else requiredMinutes = 120;

  const start = 12 * 60;
  const nowMinutes = currentHour * 60 + currentMinute;

   if (nowMinutes < start + requiredMinutes) {
    // ✅ 修复 3：直接使用定义的 GROUP_ID
    await sendMessage(GROUP_ID, "⚠ You haven't finished your overtime work yet...");
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
