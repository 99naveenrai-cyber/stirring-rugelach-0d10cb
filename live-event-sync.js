(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.IdeaKDCLiveSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const YT_PLAYING = 1;
  const DEFAULT_MISS_THRESHOLD_SECONDS = 5;

  function finiteNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function targetStreamTime(event) {
    const explicitTarget = finiteNumber(event?.targetStreamTime);
    if (explicitTarget !== null) return explicitTarget;
    const streamTime = finiteNumber(event?.streamTime);
    if (streamTime === null) return null;
    return streamTime + Math.max(0, finiteNumber(event?.offsetMs, 0)) / 1000;
  }

  function loadYouTubeIframeApi(documentRef = typeof document !== "undefined" ? document : null) {
    if (typeof globalThis !== "undefined" && globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
    if (!documentRef) return Promise.reject(new Error("youtube_api_document_unavailable"));
    if (globalThis.__ideaKdcYouTubeApiPromise) return globalThis.__ideaKdcYouTubeApiPromise;

    globalThis.__ideaKdcYouTubeApiPromise = new Promise((resolve, reject) => {
      const previousReady = globalThis.onYouTubeIframeAPIReady;
      globalThis.onYouTubeIframeAPIReady = function () {
        if (typeof previousReady === "function") previousReady();
        resolve(globalThis.YT);
      };
      const existing = documentRef.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (existing) {
        existing.addEventListener("error", () => reject(new Error("youtube_iframe_api_failed")), { once: true });
        return;
      }
      const script = documentRef.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("youtube_iframe_api_failed"));
      documentRef.head.appendChild(script);
    });
    return globalThis.__ideaKdcYouTubeApiPromise;
  }

  class LiveStreamClock {
    constructor(player = null) {
      this.player = player;
    }

    setPlayer(player) {
      this.player = player;
    }

    currentTime() {
      try {
        return Math.max(0, finiteNumber(this.player?.getCurrentTime?.(), 0));
      } catch (_) {
        return 0;
      }
    }

    duration() {
      try {
        return Math.max(0, finiteNumber(this.player?.getDuration?.(), 0));
      } catch (_) {
        return 0;
      }
    }

    playerState() {
      try {
        return finiteNumber(this.player?.getPlayerState?.(), -1);
      } catch (_) {
        return -1;
      }
    }

    isPlaying() {
      return this.playerState() === YT_PLAYING;
    }

    estimatedLiveLatency() {
      const duration = this.duration();
      const current = this.currentTime();
      return duration > 0 ? Math.max(0, duration - current) : null;
    }

    publishPosition() {
      const duration = this.duration();
      if (duration > 0) return { streamTime: duration, source: "youtube-live-duration" };
      const current = this.currentTime();
      if (current > 0) return { streamTime: current, source: "youtube-player-current-time" };
      return { streamTime: null, source: "server-live-start-fallback" };
    }

    snapshot() {
      return {
        currentTime: this.currentTime(),
        duration: this.duration(),
        playerState: this.playerState(),
        isPlaying: this.isPlaying(),
        estimatedLiveLatency: this.estimatedLiveLatency()
      };
    }
  }

  class QuizEventQueue {
    constructor() {
      this.events = new Map();
    }

    upsert(event) {
      const eventId = String(event?.eventId || "").trim();
      const target = targetStreamTime(event);
      if (!eventId || target === null) return false;
      this.events.set(eventId, { ...event, eventId, targetStreamTime: target });
      return true;
    }

    remove(eventId) {
      this.events.delete(String(eventId || ""));
    }

    ordered() {
      return [...this.events.values()].sort((a, b) =>
        a.targetStreamTime - b.targetStreamTime || String(a.eventId).localeCompare(String(b.eventId))
      );
    }

    clear() {
      this.events.clear();
    }
  }

  class LiveEventSyncManager {
    constructor(options = {}) {
      this.clock = options.clock || new LiveStreamClock();
      this.sessionId = String(options.sessionId || "");
      this.onDisplay = typeof options.onDisplay === "function" ? options.onDisplay : () => {};
      this.onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
      this.storage = options.storage || (typeof localStorage !== "undefined" ? localStorage : null);
      this.missThresholdSeconds = finiteNumber(options.missThresholdSeconds, DEFAULT_MISS_THRESHOLD_SECONDS);
      this.pollIntervalMs = Math.max(50, finiteNumber(options.pollIntervalMs, 125));
      this.now = typeof options.now === "function" ? options.now : () => Date.now();
      this.queue = new QuizEventQueue();
      this.receipt = new Map();
      this.activeEvent = null;
      this.timer = null;
      this.lastSnapshot = this.clock.snapshot();
      this.persisted = this.readPersisted();
    }

    storageKey() {
      return `ideakdc-live-events:${this.sessionId}`;
    }

    readPersisted() {
      try {
        const value = JSON.parse(this.storage?.getItem?.(this.storageKey()) || "{}");
        return value && typeof value === "object" ? value : {};
      } catch (_) {
        return {};
      }
    }

    persist() {
      try {
        this.storage?.setItem?.(this.storageKey(), JSON.stringify(this.persisted));
      } catch (_) {}
    }

    eventState(eventId) {
      return this.persisted[String(eventId || "")] || null;
    }

    mark(event, status, details = {}) {
      const eventId = String(event?.eventId || "");
      if (!eventId) return;
      this.persisted[eventId] = {
        ...(this.persisted[eventId] || {}),
        status,
        updatedAt: this.now(),
        ...details
      };
      this.persist();
      this.onStateChange({ event, status, details, player: this.lastSnapshot });
    }

    ingest(event, receivedAt = this.now()) {
      if (!event || event.status === "cancelled" || event.status === "cleared") return false;
      const eventId = String(event.eventId || "").trim();
      if (!eventId || this.eventState(eventId)?.status) return false;
      const accepted = this.queue.upsert(event);
      if (!accepted) return false;
      const snapshot = this.clock.snapshot();
      this.receipt.set(eventId, {
        receivedAt,
        playbackPosition: snapshot.currentTime,
        wasUpcoming: snapshot.playerState !== -1 && snapshot.currentTime <= targetStreamTime(event) + this.missThresholdSeconds
      });
      this.onStateChange({ event, status: "queued", details: this.receipt.get(eventId), player: snapshot });
      return true;
    }

    start() {
      if (this.timer) return;
      this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
      this.tick();
    }

    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.queue.clear();
      this.receipt.clear();
      this.activeEvent = null;
    }

    tick() {
      this.lastSnapshot = this.clock.snapshot();
      if (this.activeEvent || !this.lastSnapshot.isPlaying) {
        this.emitDebug();
        return null;
      }

      for (const event of this.queue.ordered()) {
        const receipt = this.receipt.get(event.eventId) || {};
        const distance = event.targetStreamTime - this.lastSnapshot.currentTime;
        if (distance > 0) break;
        if (!receipt.wasUpcoming && this.lastSnapshot.currentTime > event.targetStreamTime + this.missThresholdSeconds) {
          this.queue.remove(event.eventId);
          this.mark(event, "missed", {
            actualPlaybackTime: this.lastSnapshot.currentTime,
            syncErrorMs: Math.round(-distance * 1000)
          });
          continue;
        }

        this.queue.remove(event.eventId);
        this.activeEvent = event;
        const details = {
          receivedAt: receipt.receivedAt || null,
          receivedPlaybackTime: receipt.playbackPosition ?? null,
          actualPlaybackTime: this.lastSnapshot.currentTime,
          estimatedLiveLatency: this.lastSnapshot.estimatedLiveLatency,
          syncErrorMs: Math.round((this.lastSnapshot.currentTime - event.targetStreamTime) * 1000),
          buffering: false
        };
        this.mark(event, "displayed", details);
        this.onDisplay(event, details);
        this.emitDebug();
        return event;
      }
      this.emitDebug();
      return null;
    }

    completeCurrent(status = "completed", details = {}) {
      if (!this.activeEvent) return;
      const event = this.activeEvent;
      this.activeEvent = null;
      this.mark(event, status, details);
    }

    emitDebug() {
      const next = this.queue.ordered()[0] || null;
      this.onStateChange({
        event: next || this.activeEvent,
        status: this.activeEvent ? "displayed" : next ? "queued" : "idle",
        details: next ? { distance: next.targetStreamTime - this.lastSnapshot.currentTime } : {},
        player: this.lastSnapshot
      });
    }
  }

  return {
    DEFAULT_MISS_THRESHOLD_SECONDS,
    LiveEventSyncManager,
    LiveStreamClock,
    QuizEventQueue,
    finiteNumber,
    loadYouTubeIframeApi,
    targetStreamTime
  };
});
