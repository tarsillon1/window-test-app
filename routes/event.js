const path = require("path");
const axios = require("axios");
const childProcess = require("child_process");
const { promisify } = require("util");

const express = require("express");
const router = express.Router();

const EXEC = promisify(childProcess.exec);
const LOG_STREAM_ID = [...Array(10)]
  .map(i => (~~(Math.random() * 36)).toString(36))
  .join("");

// Alias for process name.
function alias(processName) {
  let name = "";
  if (
    processName === "Chrome" ||
    processName === "Electron" ||
    processName === "OpenFin"
  ) {
    return processName;
  }

  if (processName.toLowerCase().includes("openfin")) {
    name += "OpenFin Process ";
  } else if (processName.toLowerCase().includes("chrome")) {
    name += "Chrome Process ";
  } else {
    name += "Electron Process ";
  }

  if (processName.toLowerCase().includes("--type=watcher")) {
    name += "Watcher ";
  }

  if (processName.toLowerCase().includes("--type=crashpad-handler")) {
    name += "Crash Handler ";
  }

  if (
    processName.toLowerCase().includes("-startup-url") ||
    !processName.toLowerCase().includes("--")
  ) {
    name += "Browser ";
  }

  if (processName.toLowerCase().includes("--type=gpu-process")) {
    name += "GPU ";
  } else if (processName.toLowerCase().includes("--type=renderer")) {
    name += "Render ";
    let stripToken = processName.substring(
      processName.indexOf("pipe-token=") + "pipe-token=".length
    );
    if (stripToken)
      name += stripToken.substring(0, stripToken.indexOf(" ") + 1);
  }

  if (processName.toLowerCase().includes("rvm")) {
    name += "RVM";
  }
  return name.trim();
}

// Use Get-Process to get windows process memory. Then parse the output to fit metric log interface.
async function getWindowsLog(processName) {
  let { stdout } = await EXEC(
    `powershell.exe -ExecutionPolicy ByPass -file ${path.resolve(
      __dirname,
      "../scripts/get-process.ps1"
    )} -processName ${processName}`
  );

  let getNext = () => {
    let index = stdout.indexOf("@{CommandLine=");
    stdout = index !== -1 ? stdout.substring(index) : null;
    return stdout;
  };

  let createdAt = new Date().toISOString();
  let totalWorkingSet = 0;
  let totalPrivateWorkingSet = 0;
  let relatedLogs = [];
  while (getNext()) {
    let row = stdout.substring(
      0,
      stdout.substring(1).indexOf("@") !== -1
        ? stdout.substring(1).indexOf("@")
        : stdout.length
    );
    let name = stdout
      .substring("@{CommandLine=".length, row.lastIndexOf("}") + 1)
      .trim();
    stdout = stdout.substring(row.lastIndexOf("}") + 1).trim();

    // The private working set ends before the start of the next line.
    let privateWorkingSet = Number.parseInt(
      stdout.substring(0, stdout.indexOf(" "))
    );
    totalPrivateWorkingSet += privateWorkingSet ? privateWorkingSet : 0;

    let workingSet = Number.parseInt(
      stdout.substring(stdout.indexOf(" "), row.length).trim()
    );
    totalWorkingSet += workingSet ? workingSet : 0;

    relatedLogs.push({
      createdAt,
      fields: {
        logStreamId: LOG_STREAM_ID,
        processName: alias(name),
        platform: "Windows",
        privateWorkingSet,
        workingSet
      }
    });
  }

  return {
    createdAt,
    fields: {
      logStreamId: LOG_STREAM_ID,
      processName,
      platform: "Windows",
      privateWorkingSet: totalPrivateWorkingSet,
      workingSet: totalWorkingSet
    },
    relatedLogs
  };
}

async function getLog(processName) {
  switch (process.platform) {
    case "win32":
      return await getWindowsLog(processName);
  }
}

let track,
  events = [];

// Log periodically.
(async () => {
  let logs = [];
  while (true) {
    await promisify(setTimeout)(1000);
    if (!track) continue;

    let log = await getLog(track, events);
    logs.push(log);

    // Attach recent events.
    log.fields.events = events;
    log.relatedLogs.forEach(log => (log.fields.events = events));
    events = [];

    // Ingest using Aggregator.
    if (logs.length >= 5) {
      await axios.post(
        `${process.env.INGESTER_URL}/ingester/collect?apiToken=${
          process.env.INGESTER_API_TOKEN
        }&schema=com.aggregator.log.trigger`,
        {
          logs
        }
      );
      logs = [];
    }
  }
})();

// Set logger process to track.
router.post("/track", function(req, res, next) {
  track = req.body.track;

  res.status(200).end();
});

// Trigger events to be logged.
router.post("/event", function(req, res, next) {
  let event = req.body.event;
  events.push(event);

  res.status(200).end();
});

module.exports = router;
