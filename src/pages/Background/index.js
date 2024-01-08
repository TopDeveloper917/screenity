import saveToDrive from "./modules/saveToDrive";

import Localbase from "localbase";

const db = new Localbase("db");

// Get current tab (requires activeTab permission)
const getCurrentTab = async () => {
  const queryOptions = { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(queryOptions);
  return tab;
};

const resetActiveTab = async () => {
  let editor_url = "editor.html";

  // Check if Chrome version is 109 or below
  if (navigator.userAgent.includes("Chrome/")) {
    const version = parseInt(navigator.userAgent.match(/Chrome\/([0-9]+)/)[1]);
    if (version <= 109) {
      editor_url = "editorfallback.html";
    }
  }
  const { activeTab } = await chrome.storage.local.get(["activeTab"]);

  // Check if activeTab exists
  chrome.tabs.get(activeTab, (tab) => {
    if (tab) {
      // Focus the window
      chrome.windows.update(tab.windowId, { focused: true }, () => {
        chrome.tabs.update(activeTab, {
          active: true,
          selected: true,
          highlighted: true,
        });
        chrome.tabs.create(
          {
            url: editor_url,
            index: 1,
            pinned: true,
            active: false,
          },
          async (tab) => {
            chrome.windows.update(tab.windowId, { focused: true });
            chrome.storage.local.set({ sandboxTab: tab.id });
            chrome.tabs.sendMessage(activeTab, { type: "ready-to-record" });
            chrome.tabs.highlight({ tabs: activeTab });
          }
        );
      });
    }
  });
};

const resetActiveTabRestart = async () => {
  const { activeTab } = await chrome.storage.local.get(["activeTab"]);
  chrome.tabs.get(activeTab, (tab) => {
    chrome.windows.update(tab.windowId, { focused: true }, () => {
      chrome.tabs.update(activeTab, { active: true });
      chrome.tabs.sendMessage(activeTab, { type: "ready-to-record" });
    });
  });
};

const startRecording = async () => {
  chrome.storage.local.set({
    recordingStartTime: Date.now(),
    restarting: false,
  });

  // Check if customRegion is set
  const { customRegion } = await chrome.storage.local.get(["customRegion"]);

  if (customRegion) {
    sendMessageRecord({ type: "start-recording-tab", region: true });
  } else {
    sendMessageRecord({ type: "start-recording-tab" });
  }
  chrome.action.setIcon({ path: "assets/recording-logo.png" });
  // Set up alarm if set in storage
  const { alarm } = await chrome.storage.local.get(["alarm"]);
  const { alarmTime } = await chrome.storage.local.get(["alarmTime"]);
  if (alarm) {
    const seconds = parseFloat(alarmTime);
    chrome.alarms.create("recording-alarm", { delayInMinutes: seconds / 60 });
  }
};

// Detect commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "start-recording") {
    // get active tab
    const activeTab = await getCurrentTab();

    // Check if page is offline

    // Check if it's possible to inject into content (not a chrome:// page, new tab, etc)
    if (
      !(
        (navigator.onLine === false &&
          !activeTab.url.includes("/playground.html") &&
          !activeTab.url.includes("/setup.html")) ||
        activeTab.url.startsWith("chrome://") ||
        (activeTab.url.startsWith("chrome-extension://") &&
          !activeTab.url.includes("/playground.html") &&
          !activeTab.url.includes("/setup.html"))
      ) &&
      !activeTab.url.includes("stackoverflow.com/") &&
      !activeTab.url.includes("chrome.google.com/webstore") &&
      !activeTab.url.includes("chromewebstore.google.com")
    ) {
      chrome.tabs.sendMessage(activeTab.id, { type: "start-stream" });
    } else {
      chrome.tabs
        .create({
          url: "playground.html",
          active: true,
        })
        .then((tab) => {
          chrome.storage.local.set({ activeTab: tab.id });
          // Wait for the tab to load
          chrome.tabs.onUpdated.addListener(function _(tabId, changeInfo, tab) {
            if (tabId === tab.id && changeInfo.status === "complete") {
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, { type: "start-stream" });
              }, 500);
              chrome.tabs.onUpdated.removeListener(_);
            }
          });
        });
    }
  } else if (command === "cancel-recording") {
    // get active tab
    const activeTab = await getCurrentTab();
    chrome.tabs.sendMessage(activeTab.id, { type: "cancel-recording" });
  } else if (command == "pause-recording") {
    const activeTab = await getCurrentTab();
    chrome.tabs.sendMessage(activeTab.id, { type: "pause-recording" });
  }
});

const handleAlarm = async (alarm) => {
  if (alarm.name === "recording-alarm") {
    // Check if recording
    const { recording } = await chrome.storage.local.get(["recording"]);
    if (recording) {
      stopRecording();
      const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
      chrome.tabs.sendMessage(recordingTab, { type: "stop-recording-tab" });
      const { activeTab } = await chrome.storage.local.get(["activeTab"]);
      chrome.tabs.sendMessage(activeTab, { type: "stop-recording-tab" });
      const currentTab = await getCurrentTab();
      chrome.tabs.sendMessage(currentTab.id, { type: "stop-recording-tab" });
    }
    chrome.alarms.clear("recording-alarm");
  }
};

const alarmListener = (alarm) => {
  handleAlarm(alarm);
};

const addAlarmListener = () => {
  if (!chrome.alarms.onAlarm.hasListener(alarmListener)) {
    chrome.alarms.onAlarm.addListener(alarmListener);
  }
};

// Check if the permission is granted
if (chrome.permissions) {
  chrome.permissions.contains({ permissions: ["alarms"] }, (result) => {
    if (result) {
      addAlarmListener();
    }
  });
}

const onActivated = async (activeInfo) => {
  const { recordingStartTime } = await chrome.storage.local.get([
    "recordingStartTime",
  ]);
  // Get tab
  const tab = await chrome.tabs.get(activeInfo.tabId);

  // Check if not recording (needs to hide the extension)
  const { recording } = await chrome.storage.local.get(["recording"]);

  // Update active tab
  if (recording) {
    // Check if region recording, and if the recording tab is the same as the current tab
    const { tabRecordedID } = await chrome.storage.local.get(["tabRecordedID"]);
    if (tabRecordedID && tabRecordedID != activeInfo.tabId) {
      chrome.tabs.sendMessage(activeInfo.tabId, {
        type: "hide-popup-recording",
      });
    } else {
      chrome.storage.local.set({ activeTab: activeInfo.tabId });
    }

    // Check if region or customRegion is set
    const { region } = await chrome.storage.local.get(["region"]);
    const { customRegion } = await chrome.storage.local.get(["customRegion"]);
    if (!region && !customRegion) {
      chrome.tabs.sendMessage(activeInfo.tabId, { type: "recording-check" });
    }
  } else {
    chrome.tabs.sendMessage(activeInfo.tabId, { type: "recording-ended" });
  }

  if (recordingStartTime) {
    // Check if alarm
    const { alarm } = await chrome.storage.local.get(["alarm"]);
    if (alarm) {
      // Send remaining seconds
      const { alarmTime } = await chrome.storage.local.get(["alarmTime"]);
      const seconds = parseFloat(alarmTime);
      const time = Math.floor((Date.now() - recordingStartTime) / 1000);
      const remaining = seconds - time;
      chrome.tabs.sendMessage(activeInfo.tabId, {
        type: "time",
        time: remaining,
      });
    } else {
      const time = Math.floor((Date.now() - recordingStartTime) / 1000);
      chrome.tabs.sendMessage(activeInfo.tabId, { type: "time", time: time });
    }
  }
};

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  // Get the tab that is active in the focused window
  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId: windowId,
  });

  if (activeTab) {
    onActivated({ tabId: activeTab.id });
  }
});

// Check when a page is activated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  onActivated(activeInfo);
});

// Check when a user navigates to a different domain in the same tab (chrome.tabs?)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    const { recordingStartTime } = await chrome.storage.local.get([
      "recordingStartTime",
    ]);
    // Get tab
    const tab = await chrome.tabs.get(tabId);

    if (recordingStartTime) {
      // Check if alarm
      const { alarm } = await chrome.storage.local.get(["alarm"]);
      if (alarm) {
        // Send remaining seconds
        const { alarmTime } = await chrome.storage.local.get(["alarmTime"]);
        const seconds = parseFloat(alarmTime);
        const time = Math.floor((Date.now() - recordingStartTime) / 1000);
        const remaining = seconds - time;
        chrome.tabs.sendMessage(tabId, {
          type: "time",
          time: remaining,
        });
      } else {
        const time = Math.floor((Date.now() - recordingStartTime) / 1000);
        chrome.tabs.sendMessage(tabId, { type: "time", time: time });
      }
    }

    // Check if not recording (needs to hide the extension)
    const { recording } = await chrome.storage.local.get(["recording"]);
    if (!recording) {
      chrome.tabs.sendMessage(tab.id, { type: "recording-ended" });
    }
    const commands = await chrome.commands.getAll();
    chrome.tabs.sendMessage(tab.id, {
      type: "commands",
      commands: commands,
    });

    // Check if tab is playground.html
    if (
      tab.url.includes(chrome.runtime.getURL("playground.html")) &&
      changeInfo.status === "complete"
    ) {
      chrome.tabs.sendMessage(tab.id, { type: "toggle-popup" });
    }
  }
});

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function () {
      resolve(reader.result);
    };
    reader.onerror = function (error) {
      reject(error);
    };
    reader.readAsDataURL(blob);
  });
}

const sendChunks = async (override = false) => {
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);

  db.collection("chunks")
    .get()
    .then(async (chunks) => {
      if (chunks.length === 0) {
        chrome.tabs.sendMessage(sandboxTab, {
          type: "make-video-tab",
          override: override,
        });
        // Handle the case when there are no chunks to send (e.g., display a message)
        return;
      }

      const batchSize = 10; // Number of chunks to send in each batch
      const chunksCount = chunks.length;
      let batch = [];
      let currentIndex = 0;
      const maxRetries = 3; // Maximum number of retry attempts per batch

      chrome.tabs.sendMessage(sandboxTab, {
        type: "chunk-count",
        count: chunksCount,
      });

      const sendNextBatch = async (retryCount = 0) => {
        // Determine the range of chunks for the current batch
        const start = currentIndex;
        const end = Math.min(currentIndex + batchSize, chunksCount);

        // Collect the chunks for the batch
        batch = [];
        for (let i = start; i < end; i++) {
          const chunk = chunks[i];
          const chunkData = chunk.chunk;
          const index = chunk.index;
          const base64 = await blobToBase64(chunkData);
          if (base64) {
            batch.push({ chunk: base64, index: index });
          } else {
            console.error("Error converting a chunk to Base64:", chunk);
            // Handle the error as needed (e.g., skip the chunk or retry)
          }
        }

        if (batch.length > 0) {
          // Send the batch to the sandboxed tab
          chrome.tabs.sendMessage(
            sandboxTab,
            {
              type: "new-chunk-tab",
              chunks: batch,
            },
            (response) => {
              if (response) {
                // Increment the current index and send the next batch
                currentIndex += batchSize;
                if (currentIndex < chunksCount) {
                  sendNextBatch();
                } else {
                  // Update the user interface or provide feedback as needed
                  chrome.tabs.sendMessage(sandboxTab, {
                    type: "make-video-tab",
                    override: override,
                  });
                }
              } else {
                if (retryCount < maxRetries) {
                  sendNextBatch(retryCount + 1);
                } else {
                  console.error(
                    "Maximum retry attempts reached for this batch."
                  );
                  // Handle the case where the batch couldn't be sent after retries
                }
              }
            }
          );
        }
      };

      // Start sending batches
      sendNextBatch();
    });
};

const stopRecording = async () => {
  const { recordingStartTime } = await chrome.storage.local.get([
    "recordingStartTime",
  ]);
  let duration = Date.now() - recordingStartTime;
  if (recordingStartTime === 0) {
    duration = 0;
  }
  chrome.storage.local.set({
    recording: false,
    recordingDuration: duration,
    tabRecordedID: null,
  });

  chrome.storage.local.set({ recordingStartTime: 0 });
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);

  if (duration > 5 * 60 * 1000) {
    // Close the sandbox tab, open a new one with fallback editor
    chrome.tabs.create(
      {
        url: "editorfallback.html",
        active: true,
      },
      (tab) => {
        chrome.tabs.onUpdated.addListener(function _(
          tabId,
          changeInfo,
          updatedTab
        ) {
          if (tabId === tab.id && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(_);
            // Close the existing sandbox tab
            chrome.tabs.remove(sandboxTab);
            chrome.storage.local.set({ sandboxTab: tab.id });
            sendChunks();
          }
        });
      }
    );
  } else {
    // Move the tab to the last position
    chrome.tabs.get(sandboxTab, (tab) => {
      chrome.windows.update(tab.windowId, { focused: true }).then(() => {
        chrome.tabs.update(sandboxTab, { active: true, pinned: false });
        chrome.tabs.move(sandboxTab, { index: -1 });
      });
    });

    sendChunks();
  }

  chrome.action.setIcon({ path: "assets/icon-34.png" });

  // Check if wasRegion is set
  const { wasRegion } = await chrome.storage.local.get(["wasRegion"]);
  if (wasRegion) {
    chrome.storage.local.set({ wasRegion: false, region: true });
  }

  // Cancel any alarms
  chrome.alarms.clear("recording-alarm");

  discardOffscreenDocuments();
};

const forceProcessing = async () => {
  // Need to create a new sandbox tab
  let editor_url = "editor.html";

  // Get sandbox tab
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);

  chrome.tabs.create(
    {
      url: editor_url,
      active: true,
    },
    (tab) => {
      chrome.tabs.onUpdated.addListener(function _(
        tabId,
        changeInfo,
        updatedTab
      ) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(_);
          // Close the existing sandbox tab
          chrome.tabs.remove(sandboxTab);
          chrome.storage.local.set({ sandboxTab: tab.id });

          sendChunks(true);
        }
      });
    }
  );
};

chrome.runtime.onStartup.addListener(() => {
  console.log(`Starting...`);
});

// Check when action button is clicked
chrome.action.onClicked.addListener(async (tab) => {
  // Check if recording
  const { recording } = await chrome.storage.local.get(["recording"]);
  if (recording) {
    stopRecording();
    sendMessageRecord({ type: "stop-recording-tab" });
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);
    // Check if actual tab
    chrome.tabs.get(activeTab, (t) => {
      if (t) {
        chrome.tabs.sendMessage(activeTab, { type: "stop-recording-tab" });
      } else {
        chrome.tabs.sendMessage(tab.id, { type: "stop-recording-tab" });
        chrome.storage.local.set({ activeTab: tab.id });
      }
    });
  } else {
    // Check if it's possible to inject into content (not a chrome:// page, new tab, etc)
    if (
      !(
        (navigator.onLine === false &&
          !tab.url.includes("/playground.html") &&
          !tab.url.includes("/setup.html")) ||
        tab.url.startsWith("chrome://") ||
        (tab.url.startsWith("chrome-extension://") &&
          !tab.url.includes("/playground.html") &&
          !tab.url.includes("/setup.html"))
      ) &&
      !tab.url.includes("stackoverflow.com/") &&
      !tab.url.includes("chrome.google.com/webstore") &&
      !tab.url.includes("chromewebstore.google.com")
    ) {
      chrome.tabs.sendMessage(tab.id, { type: "toggle-popup" });
      chrome.storage.local.set({ activeTab: tab.id });
    } else {
      chrome.tabs
        .create({
          url: "playground.html",
          active: true,
        })
        .then((tab) => {
          chrome.storage.local.set({ activeTab: tab.id });
        });
    }
  }

  const { firstTime } = await chrome.storage.local.get(["firstTime"]);

  if (firstTime && tab.url.includes(chrome.runtime.getURL("setup.html"))) {
    chrome.storage.local.set({ firstTime: false });
    // Send message to active tab
    const activeTab = await getCurrentTab();
    chrome.tabs.sendMessage(activeTab.id, { type: "setup-complete" });
  }
});

const nextChunk = async (request) => {
  sendMessageRecord({ type: "next-chunk-tab" });
};

const restartActiveTab = async () => {
  const activeTab = await getCurrentTab();
  chrome.tabs.sendMessage(activeTab.id, { type: "ready-to-record" });
};

const getStreamingData = async () => {
  const {
    micActive,
    defaultAudioInput,
    defaultAudioOutput,
    defaultVideoInput,
    systemAudio,
    recordingType,
  } = await chrome.storage.local.get([
    "micActive",
    "defaultAudioInput",
    "defaultAudioOutput",
    "defaultVideoInput",
    "systemAudio",
    "recordingType",
  ]);

  return {
    micActive,
    defaultAudioInput,
    defaultAudioOutput,
    defaultVideoInput,
    systemAudio,
    recordingType,
  };
};

const handleDismiss = async () => {
  const { region } = await chrome.storage.local.get(["region"]);
  if (!region) {
    const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
    chrome.tabs.get(sandboxTab, (tab) => {
      if (tab) {
        chrome.tabs.remove(tab.id);
      }
    });
  }
  // Check if wasRegion is set
  const { wasRegion } = await chrome.storage.local.get(["wasRegion"]);
  if (wasRegion) {
    chrome.storage.local.set({ wasRegion: false, region: true });
  }
  chrome.action.setIcon({ path: "assets/icon-34.png" });
};

const handleRestart = async () => {
  let editor_url = "editor.html";

  // Check if Chrome version is 109 or below
  if (navigator.userAgent.includes("Chrome/")) {
    const version = parseInt(navigator.userAgent.match(/Chrome\/([0-9]+)/)[1]);
    if (version <= 109) {
      editor_url = "editorfallback.html";
    }
  }
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
  chrome.tabs.get(sandboxTab, (tab) => {
    if (tab) {
      chrome.tabs.remove(tab.id);
    }
  });
  chrome.tabs.create(
    {
      url: editor_url,
      index: 1,
      pinned: true,
      active: false,
    },
    (tab) => {
      chrome.storage.local.set({ sandboxTab: tab.id });
      chrome.tabs.onUpdated.addListener(function _(tabId, changeInfo, tab) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(_);
          resetActiveTabRestart();
        }
      });
    }
  );
};

const sendMessageRecord = async (message) => {
  // Send a message to the recording tab or offscreen recording document, depending on which was created
  chrome.storage.local.get(["recordingTab", "offscreen"], (result) => {
    if (result.offscreen) {
      chrome.runtime.sendMessage(message);
    } else {
      // Get the recording tab first before sending the message
      chrome.tabs.get(result.recordingTab, (tab) => {
        chrome.tabs.sendMessage(tab.id, message);
      });
    }
  });
};

const offscreenDocument = async (request) => {
  const activeTab = await getCurrentTab();
  chrome.storage.local.set({ activeTab: activeTab.id, tabRecordedID: null });

  // Check activeTab URL
  if (activeTab.url.includes(chrome.runtime.getURL("playground.html"))) {
    chrome.storage.local.set({ tabPreferred: true });
  } else {
    chrome.storage.local.set({ tabPreferred: false });
  }

  // Close all offscreen documents (if chrome.offscreen is available)
  try {
    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT"
    );
    if (offscreenDocument) {
      await chrome.offscreen.closeDocument();
    }
  } catch (error) {}

  if (request.region) {
    chrome.storage.local.set({
      recordingTab: activeTab.id,
      offscreen: false,
      region: true,
    });

    if (request.customRegion) {
      sendMessageRecord({ type: "loaded", request: request, region: true });
    } else {
      try {
        // This is following the steps from this page, but it still doesn't work :( https://developer.chrome.com/docs/extensions/mv3/screen_capture/#audio-and-video-offscreen-doc
        throw new Error("Exit offscreen recording");
        const existingContexts = await chrome.runtime.getContexts({});

        const offDocument = existingContexts.find(
          (c) => c.contextType === "OFFSCREEN_DOCUMENT"
        );

        if (offDocument) {
          // If an offscreen document is already open, close it.
          await chrome.offscreen.closeDocument();
        }

        // Create an offscreen document.
        await chrome.offscreen.createDocument({
          url: "recorderoffscreen.html",
          reasons: ["USER_MEDIA", "AUDIO_PLAYBACK", "DISPLAY_MEDIA"],
          justification:
            "Recording from getDisplayMedia API and tabCapture API",
        });

        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: activeTab.id,
        });

        chrome.storage.local.set({
          recordingTab: null,
          offscreen: true,
          region: false,
          wasRegion: true,
        });
        sendMessageRecord({
          type: "loaded",
          request: request,
          isTab: true,
          tabID: streamId,
        });
      } catch (error) {
        // Open the recorder.html page as a normal tab.
        chrome.tabs
          .create({
            url: "recorder.html",
            pinned: true,
            index: 0,
            active: activeTab.url.includes(
              chrome.runtime.getURL("playground.html")
            )
              ? true
              : false,
          })
          .then((tab) => {
            chrome.storage.local.set({
              recordingTab: tab.id,
              offscreen: false,
              region: false,
              wasRegion: true,
              tabRecordedID: activeTab.id,
            });
            chrome.tabs.onUpdated.addListener(function _(
              tabId,
              changeInfo,
              updatedTab
            ) {
              // Check if recorder tab has finished loading
              if (tabId === tab.id && changeInfo.status === "complete") {
                chrome.tabs.onUpdated.removeListener(_);
                sendMessageRecord({
                  type: "loaded",
                  request: request,
                  tabID: activeTab.id,
                  isTab: true,
                });
              }
            });
          });
      }
    }
  } else {
    try {
      if (!request.offscreenRecording || request.camera) {
        throw new Error("Exit offscreen recording");
      }

      const { quality } = await chrome.storage.local.get(["quality"]);

      // also add && !request.camera above if works
      const existingContexts = await chrome.runtime.getContexts({});

      const offDocument = existingContexts.find(
        (c) => c.contextType === "OFFSCREEN_DOCUMENT"
      );

      if (offDocument) {
        // If an offscreen document is already open, close it.
        await chrome.offscreen.closeDocument();
      }
      // Create an offscreen document.
      await chrome.offscreen.createDocument({
        url: "recorderoffscreen.html",
        reasons: ["USER_MEDIA", "AUDIO_PLAYBACK", "DISPLAY_MEDIA"],
        justification: "Recording from getDisplayMedia API",
      });

      chrome.storage.local.set({
        recordingTab: null,
        offscreen: true,
        region: false,
        wasRegion: false,
      });
      sendMessageRecord({
        type: "loaded",
        request: request,
        isTab: false,
        quality: quality,
      });
    } catch (error) {
      // Open the recorder.html page as a normal tab.
      let switchTab = true;
      if (request.camera) {
        switchTab = false;
      }
      chrome.tabs
        .create({
          url: "recorder.html",
          pinned: true,
          index: 0,
          active: switchTab,
        })
        .then((tab) => {
          chrome.storage.local.set({
            recordingTab: tab.id,
            offscreen: false,
            region: false,
            wasRegion: false,
          });
          chrome.tabs.onUpdated.addListener(function _(
            tabId,
            changeInfo,
            updatedTab
          ) {
            // Check if recorder tab has finished loading
            if (tabId === tab.id && changeInfo.status === "complete") {
              chrome.tabs.onUpdated.removeListener(_);
              sendMessageRecord({ type: "loaded", request: request });
            }
          });
        });
    }
  }
};

const base64ToUint8Array = (base64) => {
  const dataUrlRegex = /^data:(.*?);base64,/;
  const matches = base64.match(dataUrlRegex);
  if (matches !== null) {
    // Base64 is a data URL
    const mimeType = matches[1];
    const binaryString = atob(base64.slice(matches[0].length));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  } else {
    // Base64 is a regular string
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: "video/webm" });
  }
};

const savedToDrive = async () => {
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
  chrome.tabs.sendMessage(sandboxTab, { type: "saved-to-drive" });
};

const discardOffscreenDocuments = async () => {
  // Try doing (maybe offscreen isn't available)
  try {
    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT"
    );
    if (offscreenDocument) {
      await chrome.offscreen.closeDocument();
    }
  } catch (error) {}
};

const executeScripts = async () => {
  const contentScripts = chrome.runtime.getManifest().content_scripts;
  const tabQueries = contentScripts.map((cs) =>
    chrome.tabs.query({ url: cs.matches })
  );
  const tabResults = await Promise.all(tabQueries);

  const executeScriptPromises = [];
  for (let i = 0; i < tabResults.length; i++) {
    const tabs = tabResults[i];
    const cs = contentScripts[i];

    for (const tab of tabs) {
      const executeScriptPromise = chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: cs.js,
      });
      executeScriptPromises.push(executeScriptPromise);
    }
  }

  await Promise.all(executeScriptPromises);
};

// On first install open setup.html
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    // Clear storage
    chrome.storage.local.clear();

    // Check user locale, is it English, british, american...?
    const locale = chrome.i18n.getMessage("@@ui_locale");
    if (locale.includes("en")) {
      chrome.runtime.setUninstallURL(
        "https://tally.so/r/w8Zro5?version=" +
          chrome.runtime.getManifest().version
      );
    } else {
      chrome.runtime.setUninstallURL(
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
          locale +
          "&u=https://tally.so/r/w8Zro5?version=" +
          chrome.runtime.getManifest().version
      );
    }
    chrome.storage.local.set({ firstTime: true });
    chrome.tabs.create({
      url: "setup.html",
    });
  } else if (details.reason === "update") {
    if (details.previousVersion === "2.8.6") {
      // Clear storage
      chrome.storage.local.clear();
      chrome.storage.local.set({ updatingFromOld: true });
    } else {
      chrome.storage.local.set({ updatingFromOld: false });
    }
    const locale = chrome.i18n.getMessage("@@ui_locale");
    if (locale.includes("en")) {
      chrome.runtime.setUninstallURL(
        "https://tally.so/r/3Ex6kX?version=" +
          chrome.runtime.getManifest().version
      );
    } else {
      chrome.runtime.setUninstallURL(
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
          locale +
          "&u=https://tally.so/r/3Ex6kX?version=" +
          chrome.runtime.getManifest().version
      );
    }
  }
  executeScripts();
});

// Detect if recordingTab is closed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // Check if region recording
  const { region } = await chrome.storage.local.get(["region"]);

  if (region) return;
  const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
  const { recording } = await chrome.storage.local.get(["recording"]);
  const { restarting } = await chrome.storage.local.get(["restarting"]);
  const { activeTab } = await chrome.storage.local.get(["activeTab"]);

  if ((tabId === recordingTab || tabId === sandboxTab) && !restarting) {
    chrome.storage.local.set({ recordingTab: null });
    // Send a message to active tab
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);

    try {
      if (recording) {
        chrome.windows
          .update(activeTab.windowId, { focused: true })
          .then(() => {
            chrome.tabs.update(activeTab, { active: true });
          });
      }
      chrome.tabs.sendMessage(activeTab, { type: "stop-recording-tab" });
    } catch (error) {
      chrome.tabs.sendMessage(tabId, { type: "stop-recording-tab" });
      chrome.storage.local.set({ activeTab: tabId });
    }

    // Update icon
    chrome.action.setIcon({ path: "assets/icon-34.png" });
  }
  if (tabId === sandboxTab && !restarting) {
    try {
      chrome.tabs.remove(recordingTab);
    } catch (error) {}
  } else if (tabId === recordingTab && recording) {
    try {
      chrome.tabs.remove(sandboxTab);
    } catch (error) {}
  }
});

const discardRecording = async () => {
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
  // Get actual sandbox tab
  chrome.tabs.get(sandboxTab, (tab) => {
    if (tab) {
      chrome.tabs.remove(tab.id);
    }
  });
  sendMessageRecord({ type: "dismiss-recording" });
  chrome.action.setIcon({ path: "assets/icon-34.png" });
  discardOffscreenDocuments();
  chrome.storage.local.set({
    recordingTab: null,
    sandboxTab: null,
    recording: false,
  });
};

// Check if still (actually) recording by looking at recordingTab or offscreen document
const checkRecording = async () => {
  const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
  const { offscreen } = await chrome.storage.local.get(["offscreen"]);
  if (recordingTab && !offscreen) {
    try {
      chrome.tabs.get(recordingTab, (tab) => {
        if (!tab) {
          discardRecording();
        }
      });
    } catch (error) {
      discardRecording();
    }
  } else if (offscreen) {
    const existingContexts = await chrome.runtime.getContexts({});
    const offDocument = existingContexts.find(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT"
    );
    if (!offDocument) {
      discardRecording();
    }
  }
};

const removeSandbox = async () => {
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);

  chrome.tabs.get(sandboxTab, (tab) => {
    if (tab) {
      chrome.tabs.remove(sandboxTab);
    }
  });
};

const newSandboxPageRestart = async () => {
  let editor_url = "editor.html";

  // Check if Chrome version is 109 or below
  if (navigator.userAgent.includes("Chrome/")) {
    const version = parseInt(navigator.userAgent.match(/Chrome\/([0-9]+)/)[1]);
    if (version <= 109) {
      editor_url = "editorfallback.html";
    }
  }
  chrome.tabs.create(
    {
      url: editor_url,
      index: 1,
      pinned: true,
      active: false,
    },
    (tab) => {
      chrome.storage.local.set({ sandboxTab: tab.id });

      chrome.tabs.onUpdated.addListener(function _(
        tabId,
        changeInfo,
        updatedTab
      ) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(_);
          resetActiveTabRestart();
        }
      });
    }
  );
};

const handleMessage = async (request, sender, sendResponse) => {
  if (request.type === "desktop-capture") {
    offscreenDocument(request);
  } else if (request.type === "handle-restart") {
    handleRestart();
  } else if (request.type === "handle-dismiss") {
    handleDismiss();
  } else if (request.type === "offscreen") {
    getStreamId(sender.tab, sendResponse);
    return true;
  } else if (request.type === "reset-active-tab") {
    resetActiveTab();
  } else if (request.type === "reset-active-tab-restart") {
    resetActiveTabRestart();
  } else if (request.type === "start-rec") {
    startRecording();
  } else if (request.type === "video-ready") {
    stopRecording();
  } else if (request.type === "request-next-chunk") {
    nextChunk(request);
  } else if (request.type === "start-recording") {
    startRecording();
  } else if (request.type === "restarted") {
    restartActiveTab();
  } else if (request.type === "new-chunk") {
    const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
    chrome.tabs.sendMessage(sandboxTab, {
      type: "new-chunk-tab",
      chunk: request.chunk,
      index: request.index,
    });
    sendResponse({ status: "ok" });
    return true;
  } else if (request.type === "get-streaming-data") {
    const data = await getStreamingData();
    sendMessageRecord({ type: "streaming-data", data: JSON.stringify(data) });
    return true;
  } else if (request.type === "cancel-recording") {
    chrome.action.setIcon({ path: "assets/icon-34.png" });
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);
    // Check if actual tab
    chrome.tabs.get(activeTab, (t) => {
      if (t) {
        chrome.windows
          .update(activeTab.windowId, { focused: true })
          .then(() => {
            chrome.tabs.update(activeTab, { active: true });
          });
      }
    });
    discardOffscreenDocuments();
  } else if (request.type === "stop-recording-tab") {
    sendMessageRecord({ type: "stop-recording-tab" });
  } else if (request.type === "restart-recording-tab") {
    removeSandbox();
    chrome.storage.local.get(["region"], (result) => {
      if (result.region) {
        //sendMessageRecord({ type: "restart-recording-tab" });
      }
    });
  } else if (request.type === "dismiss-recording-tab") {
    discardRecording();
  } else if (request.type === "pause-recording-tab") {
    sendMessageRecord({ type: "pause-recording-tab" });
  } else if (request.type === "resume-recording-tab") {
    sendMessageRecord({ type: "resume-recording-tab" });
  } else if (request.type === "set-mic-active-tab") {
    chrome.storage.local.get(["region"], (result) => {
      if (result.region) {
        sendMessageRecord({
          type: "set-mic-active-tab",
          active: request.active,
          defaultAudioInput: request.defaultAudioInput,
        });
      }
    });
  } else if (request.type === "recording-error") {
    // get actual active tab
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);
    chrome.tabs.get(activeTab, (tab) => {
      if (tab) {
        chrome.tabs.sendMessage(activeTab, { type: "recording-error" });
        // Go to active tab
        chrome.windows.update(tab.windowId, { focused: true }).then(() => {
          chrome.tabs.update(activeTab, { active: true });
        });
        if (request.error === "stream-error") {
          chrome.tabs.sendMessage(activeTab, { type: "stream-error" });
        }
      }
    });

    // Close recording tab
    const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
    const { region } = await chrome.storage.local.get(["region"]);
    // Check if tab exists (with tab api)
    if (recordingTab && !region) {
      chrome.tabs.get(recordingTab, (tab) => {
        if (tab) {
          chrome.tabs.remove(recordingTab);
        }
      });
    }
    chrome.storage.local.set({ recordingTab: null });
    discardOffscreenDocuments();
  } else if (request.type === "on-get-permissions") {
    // Send a message to (actual) active tab
    const activeTab = await getCurrentTab();
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab.id, {
        type: "on-get-permissions",
        data: request,
      });
    }
  } else if (request.type === "recording-complete") {
    // Close the recording tab
    const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
    const { region } = await chrome.storage.local.get(["region"]);

    // Check if tab exists (with tab api)
    if (recordingTab) {
      chrome.tabs.get(recordingTab, (tab) => {
        if (tab) {
          // Check if tab url contains chrome-extension and recorder.html
          if (
            tab.url.includes("chrome-extension") &&
            tab.url.includes("recorder.html")
          ) {
            chrome.tabs.remove(recordingTab);
          }
        }
      });
    }
  } else if (request.type === "check-recording") {
    checkRecording();
  } else if (request.type === "review-screenity") {
    chrome.tabs.create({
      url: "https://chromewebstore.google.com/detail/screenity-screen-recorder/kbbdabhdfibnancpjfhlkhafgdilcnji/reviews",
      active: true,
    });
  } else if (request.type === "follow-twitter") {
    chrome.tabs.create({
      url: "https://alyssax.substack.com/",
      active: true,
    });
  } else if (request.type === "open-processing-info") {
    const locale = chrome.i18n.getMessage("@@ui_locale");
    let url =
      "https://help.screenity.io/editing-and-exporting/dJRFpGq56JFKC7k8zEvsqb/why-is-there-a-5-minute-limit-for-editing/ddy4e4TpbnrFJ8VoRT37tQ";
    if (!locale.includes("en")) {
      url =
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
        locale +
        "&u=" +
        url;
    }
    chrome.tabs.create({
      url: url,
      active: true,
    });
  } else if (request.type === "upgrade-info") {
    const locale = chrome.i18n.getMessage("@@ui_locale");
    let url =
      "https://help.screenity.io/getting-started/77KizPC8MHVGfpKpqdux9D/what-are-the-technical-requirements-for-using-screenity/6kdB6qru6naVD8ZLFvX3m9";
    if (!locale.includes("en")) {
      url =
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
        locale +
        "&u=" +
        url;
    }
    chrome.tabs.create({
      url: url,
      active: true,
    });
  } else if (request.type === "trim-info") {
    const locale = chrome.i18n.getMessage("@@ui_locale");
    let url =
      "https://help.screenity.io/editing-and-exporting/dJRFpGq56JFKC7k8zEvsqb/how-to-cut-trim-or-mute-parts-of-your-video/svNbM7YHYY717MuSWXrKXH";
    if (!locale.includes("en")) {
      url =
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
        locale +
        "&u=" +
        url;
    }
    chrome.tabs.create({
      url: url,
      active: true,
    });
  } else if (request.type === "join-waitlist") {
    const locale = chrome.i18n.getMessage("@@ui_locale");
    let url = "https://tally.so/r/npojNV";
    if (!locale.includes("en")) {
      url =
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
        locale +
        "&u=" +
        url;
    }
    chrome.tabs.create({
      url: url,
      active: true,
    });
  } else if (request.type === "chrome-update-info") {
    // Check locale
    const locale = chrome.i18n.getMessage("@@ui_locale");
    let url =
      "https://help.screenity.io/getting-started/77KizPC8MHVGfpKpqdux9D/what-are-the-technical-requirements-for-using-screenity/6kdB6qru6naVD8ZLFvX3m9";
    if (!locale.includes("en")) {
      url =
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
        locale +
        "&u=" +
        url;
    }
    chrome.tabs.create({
      url: url,
      active: true,
    });
  } else if (request.type === "set-surface") {
    chrome.storage.local.set({
      surface: request.surface,
    });

    const { activeTab } = await chrome.storage.local.get(["activeTab"]);

    chrome.tabs.get(activeTab, (tab) => {
      if (tab) {
        chrome.tabs.sendMessage(activeTab, {
          type: "set-surface",
          surface: request.surface,
        });
      }
    });
  } else if (request.type === "pip-ended") {
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);

    chrome.tabs.get(activeTab, (tab) => {
      if (tab) {
        chrome.tabs.sendMessage(activeTab, { type: "pip-ended" });
      }
    });
  } else if (request.type === "pip-started") {
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);

    chrome.tabs.get(activeTab, (tab) => {
      if (tab) {
        chrome.tabs.sendMessage(activeTab, { type: "pip-started" });
      }
    });
  } else if (request.type === "new-sandbox-page-restart") {
    newSandboxPageRestart();
  } else if (request.type === "sign-out-drive") {
    // Get token
    const { token } = await chrome.storage.local.get(["token"]);
    var url = "https://accounts.google.com/o/oauth2/revoke?token=" + token;
    fetch(url);

    chrome.identity.removeCachedAuthToken({ token: token });
    chrome.storage.local.set({ token: false });
  } else if (request.type === "open-help") {
    const locale = chrome.i18n.getMessage("@@ui_locale");
    let url = "https://help.screenity.io/";
    if (!locale.includes("en")) {
      url =
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
        locale +
        "&u=" +
        url;
    }
    chrome.tabs.create({
      url: url,
      active: true,
    });
  } else if (request.type === "memory-limit-help") {
    const locale = chrome.i18n.getMessage("@@ui_locale");
    let url =
      "https://help.screenity.io/troubleshooting/9Jy5RGjNrBB42hqUdREQ7W/what-does-%E2%80%9Cmemory-limit-reached%E2%80%9D-mean-when-recording/8WkwHbt3puuXunYqQnyPcb";
    if (!locale.includes("en")) {
      url =
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
        locale +
        "&u=" +
        url;
    }
    chrome.tabs.create({
      url: url,
      active: true,
    });
  } else if (request.type === "open-home") {
    chrome.tabs.create({
      url: "https://screenity.io/",
      active: true,
    });
  } else if (request.type === "report-bug") {
    chrome.tabs.create({
      url:
        "https://tally.so/r/3ElpXq?version=" +
        chrome.runtime.getManifest().version,
      active: true,
    });
  } else if (request.type === "clear-recordings") {
    // clear chunks
    db.collection("chunks").delete();
  } else if (request.type === "force-processing") {
    forceProcessing();
  }
};

const isPinned = async (sendResponse) => {
  const userSettings = await chrome.action.getUserSettings();
  sendResponse({ pinned: userSettings.isOnToolbar });
};

const requestDownload = async (base64, title) => {
  // Open a new tab to get URL
  chrome.tabs.create(
    {
      url: "download.html",
      active: false,
    },
    (tab) => {
      chrome.tabs.onUpdated.addListener(function _(
        tabId,
        changeInfo,
        updatedTab
      ) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(_);
          chrome.tabs.sendMessage(tab.id, {
            type: "download-video",
            base64: base64,
            title: title,
          });
        }
      });
    }
  );
};

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "indexed-db-download") {
    // Open a new tab to get URL
    chrome.tabs.create(
      {
        url: "download.html",
        active: false,
      },
      (tab) => {
        chrome.tabs.onUpdated.addListener(function _(
          tabId,
          changeInfo,
          updatedTab
        ) {
          if (tabId === tab.id && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(_);
            chrome.tabs.sendMessage(tab.id, {
              type: "recover-indexed-db",
            });
          }
        });
      }
    );
  } else if (request.type === "get-platform-info") {
    chrome.runtime.getPlatformInfo((info) => {
      sendResponse(info);
    });
    return true;
  } else if (request.type === "restore-recording") {
    let editor_url = "editorfallback.html";

    // Check if Chrome version is 109 or below
    if (navigator.userAgent.includes("Chrome/")) {
      const version = parseInt(
        navigator.userAgent.match(/Chrome\/([0-9]+)/)[1]
      );
      if (version <= 109) {
        editor_url = "editorfallback.html";
      }
    }

    // Make a video out of the db chunks, and download it
    db.collection("chunks")
      .get()
      .then((chunks) => {
        // Check if there's any chunks
        if (chunks.empty || chunks.length === 0) {
          return;
        }

        chrome.tabs.create(
          {
            url: editor_url,
            active: true,
          },
          async (tab) => {
            // Set URL as sandbox tab
            chrome.storage.local.set({ sandboxTab: tab.id });
            // Wait for the tab to be loaded
            await new Promise((resolve) => {
              chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (info.status === "complete" && tabId === tab.id) {
                  sendChunks();
                }
              });
            });
          }
        );
      });
  } else if (request.type === "check-restore") {
    // Check if there's any chunks
    db.collection("chunks")
      .get()
      .then((chunks) => {
        // Check if there's any chunks
        if (chunks.empty || chunks.length === 0) {
          sendResponse({ restore: false, chunks: [] });
          return;
        }
        sendResponse({ restore: true });
      });
    return true;
  } else if (request.type === "check-capture-permissions") {
    chrome.permissions.contains(
      {
        permissions: ["desktopCapture", "alarms", "offscreen"],
      },
      (result) => {
        if (!result) {
          chrome.permissions.request(
            {
              permissions: ["desktopCapture", "alarms", "offscreen"],
            },
            (granted) => {
              if (!granted) {
                sendResponse({ status: "error" });
              } else {
                addAlarmListener();
                sendResponse({ status: "ok" });
              }
            }
          );
        } else {
          sendResponse({ status: "ok" });
        }
      }
    );
    return true;
  } else if (request.type === "is-pinned") {
    isPinned(sendResponse);
    return true;
  } else if (request.type === "save-to-drive") {
    const blob = base64ToUint8Array(request.base64);

    // Specify the desired file name
    const fileName = request.title;

    // Call the saveToDrive function
    saveToDrive(blob, fileName, sendResponse).then(() => {
      savedToDrive();
    });

    return true;
  } else if (request.type === "request-download") {
    requestDownload(request.base64, request.title);
  } else if (request.type === "stop-recording-tab-backup") {
    chrome.storage.local.set({
      recording: false,
      restarting: false,
      tabRecordedID: null,
      memoryError: true,
    });
    sendMessageRecord({ type: "stop-recording-tab" });
  }
  handleMessage(request, sender, sendResponse);
});

self.addEventListener("message", (event) => {
  handleMessage(event.data);
});
