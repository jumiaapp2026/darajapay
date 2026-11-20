const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const STK_ENDPOINT =
  process.env.STK_ENDPOINT ||
  "https://okvgadkyknfknqtxnjzz.supabase.co/functions/v1/darajapay/darajapay/stkpush";

const MAX_RECENT_LOGS = 100;

app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

let currentJob = {
  running: false,
  stopRequested: false,
  total: 0,
  completed: 0,
  okCount: 0,
  errCount: 0,
  firstNumber: "",
  lastNumber: "",
  recentLogs: []
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pushLog(entry) {
  currentJob.recentLogs.push(entry);
  if (currentJob.recentLogs.length > MAX_RECENT_LOGS) {
    currentJob.recentLogs.shift();
  }
}

function cleanNumber(raw) {
  return String(raw || "")
    .trim()
    .replace(/[\s\-+()"'.]/g, "");
}

async function processQueue(numbers, amount, tillNumber) {
  currentJob.running = true;
  currentJob.stopRequested = false;
  currentJob.total = numbers.length;
  currentJob.completed = 0;
  currentJob.okCount = 0;
  currentJob.errCount = 0;
  currentJob.firstNumber = numbers[0] || "";
  currentJob.lastNumber = numbers[numbers.length - 1] || "";
  currentJob.recentLogs = [];

  for (let i = 0; i < numbers.length; i++) {
    if (currentJob.stopRequested) {
      pushLog({
        time: new Date().toLocaleTimeString(),
        phone: "-",
        status: "STOPPED",
        detail: "Batch stopped by user."
      });
      break;
    }

    const phone = numbers[i];
    const payload = {
      Amount: String(amount),
      Phonenumber: phone,
      TillNumber: String(tillNumber)
    };

    try {
      const response = await fetch(STK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const rawText = await response.text();
      const shortDetail = rawText.length > 200 ? rawText.slice(0, 200) + "..." : rawText;

      if (response.ok) {
        currentJob.okCount += 1;
        pushLog({
          time: new Date().toLocaleTimeString(),
          phone,
          status: `OK (${response.status})`,
          detail: shortDetail
        });
      } else {
        currentJob.errCount += 1;
        pushLog({
          time: new Date().toLocaleTimeString(),
          phone,
          status: `ERR (${response.status})`,
          detail: shortDetail
        });
      }
    } catch (err) {
      currentJob.errCount += 1;
      pushLog({
        time: new Date().toLocaleTimeString(),
        phone,
        status: "FAILED",
        detail: err.message
      });
    }

    currentJob.completed = i + 1;

    if (i < numbers.length - 1 && !currentJob.stopRequested) {
      await sleep(3000);
    }
  }

  currentJob.running = false;
}

app.post("/api/start", (req, res) => {
  if (currentJob.running) {
    return res.status(409).json({ error: "A batch is already running." });
  }

  const { numbers, amount, tillNumber } = req.body;

  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: "Provide at least one phone number." });
  }
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "Provide a valid positive Amount." });
  }
  if (!tillNumber || !String(tillNumber).trim()) {
    return res.status(400).json({ error: "Provide a valid TillNumber." });
  }

  const queue = numbers
    .map(cleanNumber)
    .filter((n) => n.length > 0);

  if (queue.length === 0) {
    return res.status(400).json({ error: "No usable phone numbers found." });
  }

  processQueue(queue, String(amount).trim(), String(tillNumber).trim());

  res.json({
    message: `Started sending to all ${queue.length} numbers (3s interval).`,
    total: queue.length,
    firstNumber: queue[0],
    lastNumber: queue[queue.length - 1]
  });
});

app.post("/api/stop", (req, res) => {
  if (!currentJob.running) {
    return res.status(400).json({ error: "No active batch is running." });
  }
  currentJob.stopRequested = true;
  res.json({ message: "Stop requested." });
});

app.get("/api/status", (req, res) => {
  res.json(currentJob);
});

app.listen(PORT, () => {
  console.log(`STK Bot running on port ${PORT}`);
});
