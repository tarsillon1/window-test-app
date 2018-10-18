const path = require("path");
const axios = require("axios");
const childProcess = require("child_process");
const util = require("util");

const express = require("express");
const router = express.Router();

const EXEC = util.promisify(childProcess.exec);
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
  }
  if (processName.toLowerCase().includes("chrome")) {
  } else {
    name += "Electron Process ";
  }
  if (processName.toLowerCase().includes("-startup-url")) {
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
async function getLog(processName, events) {
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
  let totalPrivateWorkingSet = 0;
  let relatedLogs = [];
  while (getNext()) {
    let row = stdout.substring(
      0,
      stdout.indexOf("\r") !== -1 ? stdout.indexOf("\r") : stdout.length
    );
    let name = stdout
      .substring("@{CommandLine=".length, row.lastIndexOf(" "))
      .trim();
    stdout = stdout.substring(row.lastIndexOf(" ")).trim();

    // The private working set ends before the start of the next line.
    let privateWorkingSet = Number.parseInt(
      stdout.substring(
        0,
        stdout.indexOf("\r") !== -1
          ? stdout.indexOf("\r")
          : stdout.substring(stdout.lastIndexOf(" "), stdout.length)
      )
    );
    totalPrivateWorkingSet += privateWorkingSet ? privateWorkingSet : 0;

    relatedLogs.push({
      fields: {
        logStreamId: LOG_STREAM_ID,
        processName: alias(name),
        platform: "Windows",
        privateWorkingSet,
        events
      }
    });
  }

  return {
    fields: {
      logStreamId: LOG_STREAM_ID,
      processName: platform,
      platform: "Windows",
      privateWorkingSet: totalPrivateWorkingSet,
      events
    },
    relatedLogs
  };
}

let platform,
  events = [];

// Log periodically.
(async () => {
  let logs = [];
  while (true) {
    if (!platform) return;

    let log = await getLog(platform, events);
    logs.push(log);

    // Ingest using Aggregator.
    if (logs.length >= 30) {
      axios.post(
        `${process.env.AGGREGATOR_URL}/aggregator/collect?apiToken=${
          process.env.AGGREGATOR_API_TOKEN
        }&schema=com.aggregator.log.trigger`,
        {
          logs
        }
      );
      logs = [];
    }
  }
})();

// Set logger platform.
router.post("/platform", function(req, res, next) {
  platform = req.body.platform;
});

// Trigger events to be logged.
router.post("/event", function(req, res, next) {
  let event = req.body.event;
  events.push(event);
});

module.exports = router;
