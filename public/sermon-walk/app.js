(() => {
  "use strict";

  const elements = {
    sermonTitle: document.querySelector("#sermonTitle"),
    sermonText: document.querySelector("#sermonText"),
    connectionBadge: document.querySelector("#connectionBadge"),
    elapsed: document.querySelector("#elapsed"),
    waveform: document.querySelector("#waveform"),
    startButton: document.querySelector("#startButton"),
    finishButton: document.querySelector("#finishButton"),
    retryButton: document.querySelector("#retryButton"),
    primaryStatus: document.querySelector("#primaryStatus"),
    receiptHeading: document.querySelector("#receiptHeading"),
    danTurns: document.querySelector("#danTurns"),
    audioSaved: document.querySelector("#audioSaved"),
    pendingSaves: document.querySelector("#pendingSaves"),
    captureGaps: document.querySelector("#captureGaps"),
    transcriptList: document.querySelector("#transcriptList"),
    remoteAudio: document.querySelector("#remoteAudio")
  };

  const state = {
    sessionId: "",
    token: "",
    session: null,
    stream: null,
    recorder: null,
    peer: null,
    dataChannel: null,
    audioContext: null,
    analyser: null,
    animationFrame: 0,
    wakeLock: null,
    startedAt: 0,
    timer: 0,
    audioSequence: 0,
    turnSequence: 0,
    itemSequences: new Map(),
    itemAudioTimes: new Map(),
    expectedUserItemIds: new Set(),
    chunkTasks: new Set(),
    turnTasks: new Set(),
    pendingCount: 0,
    finishing: false,
    completed: false
  };

  function parseAccess() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashSession = hash.get("session") || "";
    const hashToken = hash.get("token") || "";
    if (hashSession && hashToken) {
      localStorage.setItem("sermonWalkSession", hashSession);
      localStorage.setItem("sermonWalkToken", hashToken);
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    state.sessionId = hashSession || localStorage.getItem("sermonWalkSession") || "";
    state.token = hashToken || localStorage.getItem("sermonWalkToken") || "";
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${state.token}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`/sermon-walk/api/${path}`, { ...options, headers });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(body?.error?.message || body?.error || body?.message || `Request failed (${response.status})`);
      error.status = response.status;
      error.details = body?.error?.details || body?.details || {};
      throw error;
    }
    return body;
  }

  function setConnection(label, status = "idle") {
    elements.connectionBadge.textContent = label;
    elements.connectionBadge.dataset.state = status;
  }

  function setStatus(message) {
    elements.primaryStatus.textContent = message;
  }

  function updatePending(delta) {
    state.pendingCount = Math.max(0, state.pendingCount + delta);
    elements.pendingSaves.textContent = String(state.pendingCount);
    elements.retryButton.disabled = state.pendingCount === 0 || state.finishing;
  }

  function trackTask(set, promise) {
    set.add(promise);
    updatePending(1);
    promise.then(() => {
      set.delete(promise);
      updatePending(-1);
    }, () => {
      set.delete(promise);
      updatePending(-1);
    });
    return promise;
  }

  function formatElapsed(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function startTimer() {
    state.startedAt = Date.now();
    state.timer = window.setInterval(() => {
      elements.elapsed.textContent = formatElapsed(Date.now() - state.startedAt);
    }, 500);
  }

  function stopTimer() {
    window.clearInterval(state.timer);
    state.timer = 0;
  }

  function renderTurns(turns = []) {
    const completed = turns.filter((turn) => turn.captureStatus === "completed" && turn.transcript);
    if (completed.length === 0) {
      elements.transcriptList.innerHTML = '<li class="empty-state">Your captured turns will appear here.</li>';
      return;
    }
    elements.transcriptList.replaceChildren(...completed.map((turn) => {
      const item = document.createElement("li");
      if (turn.speaker === "assistant") item.className = "assistant-turn";
      const label = document.createElement("span");
      label.className = "turn-label";
      label.textContent = turn.speaker === "dan" ? "Dan" : "Assistant";
      const text = document.createElement("p");
      text.className = "turn-text";
      text.textContent = turn.transcript;
      item.append(label, text);
      return item;
    }));
    elements.transcriptList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function applyCaptureStatus(data) {
    state.session = data;
    const turns = data.turns || [];
    const chunks = data.audioChunks || [];
    state.audioSequence = Math.max(state.audioSequence, ...chunks.map((chunk) => chunk.sequence), 0);
    state.turnSequence = Math.max(state.turnSequence, ...turns.map((turn) => turn.sequence), 0);
    turns.filter((turn) => turn.speaker === "dan").forEach((turn) => state.expectedUserItemIds.add(turn.itemId));
    const gaps = (data.integrity?.missingAudioSequences?.length || 0) +
      (data.integrity?.missingUserItemIds?.length || 0) +
      (data.integrity?.failedUserItemIds?.length || 0);
    elements.danTurns.textContent = String(turns.filter((turn) => turn.speaker === "dan" && turn.captureStatus === "completed").length);
    elements.audioSaved.textContent = String(chunks.length);
    elements.captureGaps.textContent = String(gaps);
    renderTurns(turns);
    if (data.session?.captureStatus === "complete") {
      state.completed = true;
      elements.receiptHeading.textContent = "Capture verified and complete";
      setConnection("Saved", "saved");
      setStatus("The audio, transcript turns, and integrity manifest are saved.");
      elements.startButton.disabled = true;
      elements.finishButton.disabled = true;
    } else if (data.session?.captureStatus === "incomplete") {
      elements.receiptHeading.textContent = "Capture needs attention";
      setConnection("Needs sync", "error");
    } else {
      elements.receiptHeading.textContent = turns.length || chunks.length ? "Capture in progress" : "Nothing recorded yet";
    }
  }

  async function refreshStatus() {
    const data = await api("session");
    elements.sermonTitle.textContent = data.sermon?.title || "Sermon Walk";
    elements.sermonText.textContent = data.sermon?.scriptureText || "";
    applyCaptureStatus(data);
    return data;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("sermon-walk-capture", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("audioChunks")) {
          database.createObjectStore("audioChunks", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function chunkStore(mode, callback) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("audioChunks", mode);
        const store = transaction.objectStore("audioChunks");
        const result = callback(store);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function putChunk(record) {
    await chunkStore("readwrite", (store) => store.put(record));
  }

  async function getChunks() {
    const database = await openDatabase();
    try {
      const transaction = database.transaction("audioChunks", "readonly");
      const records = await requestResult(transaction.objectStore("audioChunks").getAll());
      return records.filter((record) => record.sessionId === state.sessionId).sort((a, b) => a.sequence - b.sequence);
    } finally {
      database.close();
    }
  }

  async function markChunkUploaded(id) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction("audioChunks", "readwrite");
      const store = transaction.objectStore("audioChunks");
      const record = await requestResult(store.get(id));
      if (record) store.put({ ...record, uploaded: true });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  async function clearChunks() {
    const records = await getChunks();
    await chunkStore("readwrite", (store) => records.forEach((record) => store.delete(record.id)));
  }

  async function sha256(blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function uploadChunk(record) {
    const checksum = record.sha256 || await sha256(record.blob);
    const form = new FormData();
    form.set("sessionId", state.sessionId);
    form.set("sequence", String(record.sequence));
    form.set("sha256", checksum);
    form.set("startedAtMs", String(record.startedAtMs || 0));
    form.set("endedAtMs", String(record.endedAtMs || 0));
    form.set("audio", record.blob, `chunk-${String(record.sequence).padStart(6, "0")}.${record.extension}`);
    await api("audio-chunks", { method: "POST", body: form });
    await markChunkUploaded(record.id);
  }

  async function queueAudioChunk(blob, startedAtMs, endedAtMs) {
    if (!blob?.size) return;
    state.audioSequence += 1;
    const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const record = {
      id: `${state.sessionId}:${state.audioSequence}`,
      sessionId: state.sessionId,
      sequence: state.audioSequence,
      blob,
      extension,
      startedAtMs,
      endedAtMs,
      uploaded: false,
      createdAt: new Date().toISOString()
    };
    await putChunk(record);
    await uploadChunk(record).then(refreshStatus).catch((error) => {
      setConnection("Offline", "error");
      setStatus(`Audio part ${record.sequence} is queued on this device.`);
      throw error;
    });
  }

  async function syncPendingChunks() {
    const records = (await getChunks()).filter((record) => !record.uploaded);
    if (records.length === 0) return;
    setStatus(`Syncing ${records.length} audio part${records.length === 1 ? "" : "s"}...`);
    for (const record of records) {
      await uploadChunk(record);
    }
    await refreshStatus();
  }

  function assignItemSequence(itemId) {
    if (!itemId) return 0;
    if (!state.itemSequences.has(itemId)) {
      state.turnSequence += 1;
      state.itemSequences.set(itemId, state.turnSequence);
    }
    return state.itemSequences.get(itemId);
  }

  function rememberExpectedItem(itemId, event = {}) {
    if (!itemId) return;
    state.expectedUserItemIds.add(itemId);
    assignItemSequence(itemId);
    const times = state.itemAudioTimes.get(itemId) || {};
    if (Number.isFinite(event.audio_start_ms)) times.audioStartMs = event.audio_start_ms;
    if (Number.isFinite(event.audio_end_ms)) times.audioEndMs = event.audio_end_ms;
    state.itemAudioTimes.set(itemId, times);
  }

  function saveTurn({ itemId, previousItemId = "", speaker, transcript = "", captureStatus = "completed" }) {
    if (!itemId) return Promise.resolve();
    if (speaker === "dan") rememberExpectedItem(itemId);
    const times = state.itemAudioTimes.get(itemId) || {};
    const task = api("turns", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.sessionId,
        itemId,
        previousItemId,
        speaker,
        sequence: assignItemSequence(itemId),
        transcript,
        captureStatus,
        audioStartMs: times.audioStartMs || 0,
        audioEndMs: times.audioEndMs || 0
      })
    }).then(refreshStatus).catch((error) => {
      setConnection("Save error", "error");
      setStatus(`${speaker === "dan" ? "Your" : "Assistant"} turn could not be saved. Retry before finishing.`);
      throw error;
    });
    trackTask(state.turnTasks, task).catch(() => {});
    return task;
  }

  function handleRealtimeEvent(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "input_audio_buffer.speech_started") {
      rememberExpectedItem(event.item_id, event);
      setConnection("Listening", "live");
      return;
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      rememberExpectedItem(event.item_id, event);
      setConnection("Thinking", "live");
      return;
    }
    if (event.type === "conversation.item.created" && event.item?.role === "user") {
      rememberExpectedItem(event.item.id, event.item);
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      saveTurn({
        itemId: event.item_id,
        previousItemId: event.previous_item_id,
        speaker: "dan",
        transcript: event.transcript,
        captureStatus: "completed"
      });
      setConnection("Saved", "saved");
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.failed") {
      saveTurn({
        itemId: event.item_id,
        previousItemId: event.previous_item_id,
        speaker: "dan",
        transcript: "",
        captureStatus: "failed"
      });
      setConnection("Transcript gap", "error");
      return;
    }
    if (event.type === "response.output_audio_transcript.done" && event.transcript) {
      const itemId = event.item_id || `assistant-${event.response_id || crypto.randomUUID()}`;
      saveTurn({ itemId, speaker: "assistant", transcript: event.transcript });
      return;
    }
    if (event.type === "error") {
      setConnection("Voice error", "error");
      setStatus(event.error?.message || "The voice connection reported an error.");
    }
  }

  function chooseRecorderMimeType() {
    const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function startWaveform(stream) {
    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 512;
    source.connect(state.analyser);
    const values = new Uint8Array(state.analyser.frequencyBinCount);
    const context = elements.waveform.getContext("2d");
    const draw = () => {
      const width = elements.waveform.width;
      const height = elements.waveform.height;
      state.analyser.getByteTimeDomainData(values);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.strokeStyle = "#c6372c";
      context.lineWidth = 5;
      context.beginPath();
      values.forEach((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = (value / 255) * height;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
      state.animationFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  function stopWaveform() {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
    state.audioContext?.close().catch(() => {});
    state.audioContext = null;
    state.analyser = null;
  }

  async function requestWakeLock() {
    if (!navigator.wakeLock?.request) return;
    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      state.wakeLock = null;
    }
  }

  async function connectRealtime(stream) {
    const peer = new RTCPeerConnection();
    state.peer = peer;
    peer.ontrack = (event) => {
      elements.remoteAudio.srcObject = event.streams[0];
    };
    stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
    const dataChannel = peer.createDataChannel("oai-events");
    state.dataChannel = dataChannel;
    dataChannel.addEventListener("open", () => {
      setConnection("Live", "live");
      setStatus("Conversation and capture are live.");
    });
    dataChannel.addEventListener("message", (message) => {
      try { handleRealtimeEvent(JSON.parse(message.data)); } catch { /* Ignore malformed vendor events. */ }
    });
    dataChannel.addEventListener("close", () => {
      if (!state.finishing && !state.completed) setConnection("Disconnected", "error");
    });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const answerSdp = await api("realtime", {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp
    });
    await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  function startRecorder(stream) {
    const mimeType = chooseRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    state.recorder = recorder;
    let partStartedAt = 0;
    recorder.addEventListener("dataavailable", (event) => {
      const endedAt = Date.now() - state.startedAt;
      const startedAt = partStartedAt;
      partStartedAt = endedAt;
      const task = queueAudioChunk(event.data, startedAt, endedAt);
      trackTask(state.chunkTasks, task).catch(() => {});
    });
    recorder.start(10000);
  }

  async function startWalk() {
    if (state.completed) return;
    elements.startButton.disabled = true;
    setConnection("Starting", "live");
    setStatus("Opening the microphone and voice connection...");
    try {
      await syncPendingChunks();
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      startTimer();
      startWaveform(state.stream);
      startRecorder(state.stream);
      await requestWakeLock();
      await connectRealtime(state.stream);
      elements.finishButton.disabled = false;
      elements.receiptHeading.textContent = "Capture in progress";
    } catch (error) {
      setConnection("Could not start", "error");
      setStatus(error.message);
      elements.startButton.disabled = false;
      stopTimer();
      stopWaveform();
      state.stream?.getTracks().forEach((track) => track.stop());
      state.stream = null;
    }
  }

  async function stopRecorder() {
    if (!state.recorder || state.recorder.state === "inactive") return;
    await new Promise((resolve) => {
      state.recorder.addEventListener("stop", resolve, { once: true });
      state.recorder.stop();
    });
  }

  async function waitForTasks(set) {
    while (set.size > 0) {
      await Promise.allSettled(Array.from(set));
    }
  }

  async function finishWalk() {
    if (state.finishing || state.completed) return;
    state.finishing = true;
    elements.finishButton.disabled = true;
    elements.retryButton.disabled = true;
    setConnection("Finalizing", "live");
    setStatus("Closing the recording and checking every receipt...");
    try {
      await stopRecorder();
      state.stream?.getTracks().forEach((track) => track.stop());
      await new Promise((resolve) => window.setTimeout(resolve, 1800));
      state.peer?.close();
      await waitForTasks(state.chunkTasks);
      await waitForTasks(state.turnTasks);
      await syncPendingChunks();
      const localChunks = await getChunks();
      const pending = localChunks.filter((chunk) => !chunk.uploaded).length;
      if (pending > 0) throw new Error(`${pending} audio part${pending === 1 ? " is" : "s are"} still pending.`);
      setStatus("Sealing the audio and creating the final transcript...");
      await api("audio-seal", {
        method: "POST",
        body: JSON.stringify({
          sessionId: state.sessionId,
          finalChunkSequence: state.audioSequence,
          expectedUserItemIds: Array.from(state.expectedUserItemIds),
          clientPendingUploadCount: 0
        })
      });
      setStatus("Verifying audio and transcript coverage...");
      const result = await api("finalize", {
        method: "POST",
        body: JSON.stringify({
          sessionId: state.sessionId,
          finalChunkSequence: state.audioSequence,
          expectedUserItemIds: Array.from(state.expectedUserItemIds),
          clientPendingUploadCount: 0
        })
      });
      applyCaptureStatus(result);
      await clearChunks();
      localStorage.removeItem("sermonWalkToken");
      localStorage.removeItem("sermonWalkSession");
      setConnection("Saved", "saved");
    } catch (error) {
      setConnection("Not complete", "error");
      const missingTurns = error.details?.missingUserItemIds?.length || 0;
      const missingAudio = error.details?.missingAudioSequences?.length || 0;
      setStatus(missingTurns || missingAudio
        ? `Verification found ${missingTurns} transcript gap${missingTurns === 1 ? "" : "s"} and ${missingAudio} audio gap${missingAudio === 1 ? "" : "s"}. Nothing was discarded.`
        : `${error.message} Nothing was discarded.`);
      elements.retryButton.disabled = false;
    } finally {
      stopTimer();
      stopWaveform();
      state.wakeLock?.release().catch(() => {});
      state.wakeLock = null;
      state.finishing = false;
    }
  }

  async function retryPending() {
    elements.retryButton.disabled = true;
    setConnection("Syncing", "live");
    try {
      await syncPendingChunks();
      await refreshStatus();
      setConnection("Ready", "saved");
      setStatus("Pending audio is synchronized. Finish again to rerun verification.");
      if (!state.completed) elements.finishButton.disabled = false;
    } catch (error) {
      setConnection("Still pending", "error");
      setStatus(error.message);
      elements.retryButton.disabled = false;
    }
  }

  async function initialize() {
    parseAccess();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sermon-walk/sw.js").catch(() => {});
    elements.startButton.addEventListener("click", startWalk);
    elements.finishButton.addEventListener("click", finishWalk);
    elements.retryButton.addEventListener("click", retryPending);
    window.addEventListener("online", () => {
      if (!state.completed) retryPending().catch(() => {});
    });
    if (!state.sessionId || !state.token) {
      elements.sermonTitle.textContent = "Sermon Walk";
      setConnection("No session", "error");
      setStatus("Open a current walk link from the Sermon Workspace GPT.");
      elements.startButton.disabled = true;
      return;
    }
    try {
      await refreshStatus();
      if (!state.completed) {
        setConnection("Ready", "saved");
        setStatus("Ready to begin.");
      }
    } catch (error) {
      setConnection("Link expired", "error");
      setStatus(error.message);
      elements.startButton.disabled = true;
    }
  }

  initialize();
})();
