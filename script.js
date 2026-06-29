function parseTimestamp(input) {
  if (typeof input !== "string") {
    return null;
  }

  const value = input.trim();
  if (!value) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  const parts = value.split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }

  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => Number.isNaN(num) || num < 0)) {
    return null;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = nums;
    if (seconds >= 60) {
      return null;
    }
    return minutes * 60 + seconds;
  }

  const [hours, minutes, seconds] = nums;
  if (minutes >= 60 || seconds >= 60) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function formatTimestampForSeek(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "0";
  }

  return value.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function seekAudio(player, timestamp, { autoplay = false } = {}) {
  if (!(player instanceof HTMLAudioElement)) {
    return;
  }

  const targetSeconds = parseTimestamp(timestamp);
  if (targetSeconds === null) {
    return;
  }

  const setTime = () => {
    if (Number.isFinite(player.duration) && player.duration > 0) {
      player.currentTime = Math.min(targetSeconds, player.duration);
    } else {
      player.currentTime = targetSeconds;
    }

    if (autoplay && player.paused) {
      const playResult = player.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {});
      }
    }
  };

  if (player.readyState >= 1) {
    setTime();
  } else {
    player.addEventListener("loadedmetadata", setTime, { once: true });
  }
}

function getAudioPlayerById(id) {
  if (!id) {
    return null;
  }

  const element = document.getElementById(id);
  return element instanceof HTMLAudioElement ? element : null;
}

function getDefaultAudioPlayer() {
  const element = document.querySelector("audio");
  return element instanceof HTMLAudioElement ? element : null;
}

function pauseOtherPlayers(activePlayer) {
  document.querySelectorAll("audio").forEach((element) => {
    if (element !== activePlayer && !element.paused) {
      element.pause();
    }
  });
}

function expandSectionForPlayer(player) {
  if (!(player instanceof Element)) {
    return;
  }

  const section = player.closest("details.sample-section");
  if (section && !section.open) {
    section.open = true;
  }
}

function resolvePlayerForSeekLink(link) {
  if (!(link instanceof Element)) {
    return null;
  }

  const explicitPlayerId = link.getAttribute("data-player");
  if (explicitPlayerId) {
    return getAudioPlayerById(explicitPlayerId);
  }

  return getDefaultAudioPlayer();
}

function createWordLink({ text, startSeconds, playerId, fallback = false }) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  const seekValue = formatTimestampForSeek(startSeconds);
  const link = document.createElement("a");
  link.className = fallback ? "transcript-word transcript-word--fallback" : "transcript-word";
  link.href = `#t=${encodeURIComponent(seekValue)}&p=${encodeURIComponent(playerId)}`;
  link.setAttribute("data-seek", seekValue);
  link.setAttribute("data-player", playerId);
  link.setAttribute("data-tooltip", `Start: ${seekValue}s`);
  link.textContent = text;
  return link;
}

function createTranscriptLine({ speaker }) {
  const line = document.createElement("p");
  line.className = "transcript-line";

  if (speaker) {
    const speakerTag = document.createElement("span");
    speakerTag.className = "speaker-tag";
    speakerTag.textContent = `${speaker}:`;
    line.appendChild(speakerTag);
  }

  return line;
}

function appendWordNodes(line, wordNodes, playerId, { fallbackStart = null, fallback = false } = {}) {
  let hasWords = false;

  wordNodes.forEach((wordNode) => {
    if (!wordNode) {
      return;
    }

    const text = typeof wordNode === "string" ? wordNode : wordNode.text;
    const startSeconds = typeof wordNode === "string" ? fallbackStart : wordNode.start;
    if (!Number.isFinite(startSeconds)) {
      return;
    }

    const link = createWordLink({ text, startSeconds, playerId, fallback });
    if (!link) {
      return;
    }

    if (line.childNodes.length > 0) {
      line.appendChild(document.createTextNode(" "));
    }

    line.appendChild(link);
    hasWords = true;
  });

  return hasWords;
}

function groupWordsBySpeaker(words) {
  const groups = [];
  let current = null;

  words.forEach((word) => {
    const speaker = word.speaker || "SPEAKER";
    if (!current || current.speaker !== speaker) {
      current = {
        speaker,
        words: [],
      };
      groups.push(current);
    }

    current.words.push(word);
  });

  return groups;
}

function extractTimelineWords(timeline) {
  const items = Array.isArray(timeline) ? timeline : [];
  return items
    .filter(
      (item) =>
        item &&
        item.type === "word" &&
        typeof item.text === "string" &&
        Number.isFinite(item.start) &&
        Number.isFinite(item.end)
    )
    .map((item, position) => ({
      text: item.text,
      start: item.start,
      end: item.end,
      speaker: typeof item.speaker === "string" ? item.speaker : null,
      index: Number.isFinite(item.index) ? item.index : position,
    }))
    .sort((a, b) => a.start - b.start);
}

function extractSegmentWords(segment) {
  const words = Array.isArray(segment?.words) ? segment.words : [];

  return words
    .map((word, position) => {
      const text =
        typeof word?.word === "string"
          ? word.word
          : typeof word?.text === "string"
            ? word.text
            : "";
      if (!text.trim() || !Number.isFinite(word?.start) || !Number.isFinite(word?.end)) {
        return null;
      }

      return {
        text: text.trim(),
        start: word.start,
        end: word.end,
        speaker:
          typeof word?.speaker === "string"
            ? word.speaker
            : typeof segment?.speaker === "string"
              ? segment.speaker
              : null,
        index: Number.isFinite(word?.index) ? word.index : position,
      };
    })
    .filter(Boolean);
}

function buildTranscriptLines(result, playerId) {
  const segments = Array.isArray(result?.segments) ? result.segments : [];
  const timelineWords = extractTimelineWords(result?.timeline);

  const lines = [];
  let usedSegmentFallback = false;

  if (timelineWords.length > 0 && segments.length > 0) {
    const words = timelineWords.map((word, position) => ({
      ...word,
      __key: Number.isFinite(word.index) ? `idx:${word.index}` : `pos:${position}`,
    }));

    const usedWordKeys = new Set();
    const epsilon = 0.03;

    segments.forEach((segment) => {
      if (!Number.isFinite(segment?.start) || !Number.isFinite(segment?.end)) {
        return;
      }

      const segmentWords = words.filter((word) => {
        if (usedWordKeys.has(word.__key)) {
          return false;
        }

        const inSegmentRange = word.start >= segment.start - epsilon && word.start <= segment.end + epsilon;
        if (!inSegmentRange) {
          return false;
        }

        usedWordKeys.add(word.__key);
        return true;
      });

      const line = createTranscriptLine({
        speaker:
          typeof segment?.speaker === "string" && segment.speaker
            ? segment.speaker
            : segmentWords[0]?.speaker,
      });

      if (appendWordNodes(line, segmentWords, playerId)) {
        lines.push(line);
        return;
      }

      if (typeof segment?.text === "string" && segment.text.trim()) {
        const fallbackTokens = segment.text.trim().split(/\s+/);
        if (
          appendWordNodes(line, fallbackTokens, playerId, {
            fallbackStart: segment.start,
            fallback: true,
          })
        ) {
          usedSegmentFallback = true;
          lines.push(line);
        }
      }
    });

    const leftovers = words.filter((word) => !usedWordKeys.has(word.__key));
    groupWordsBySpeaker(leftovers).forEach((group) => {
      const line = createTranscriptLine({ speaker: group.speaker });
      if (appendWordNodes(line, group.words, playerId)) {
        lines.push(line);
      }
    });

    return {
      lines,
      usedSegmentFallback,
    };
  }

  if (timelineWords.length > 0) {
    groupWordsBySpeaker(timelineWords).forEach((group) => {
      const line = createTranscriptLine({ speaker: group.speaker });
      if (appendWordNodes(line, group.words, playerId)) {
        lines.push(line);
      }
    });

    return {
      lines,
      usedSegmentFallback,
    };
  }

  const segmentsWithWords = segments.map((segment) => ({
    segment,
    words: extractSegmentWords(segment),
  }));

  if (segmentsWithWords.some((item) => item.words.length > 0)) {
    segmentsWithWords.forEach(({ segment, words }) => {
      const line = createTranscriptLine({
        speaker:
          typeof segment?.speaker === "string" && segment.speaker
            ? segment.speaker
            : words[0]?.speaker,
      });

      if (appendWordNodes(line, words, playerId)) {
        lines.push(line);
        return;
      }

      if (Number.isFinite(segment?.start) && typeof segment?.text === "string" && segment.text.trim()) {
        const fallbackTokens = segment.text.trim().split(/\s+/);
        if (
          appendWordNodes(line, fallbackTokens, playerId, {
            fallbackStart: segment.start,
            fallback: true,
          })
        ) {
          usedSegmentFallback = true;
          lines.push(line);
        }
      }
    });

    return {
      lines,
      usedSegmentFallback,
    };
  }

  if (segments.length > 0) {
    segments.forEach((segment) => {
      if (!Number.isFinite(segment?.start) || typeof segment?.text !== "string" || !segment.text.trim()) {
        return;
      }

      const line = createTranscriptLine({
        speaker: typeof segment?.speaker === "string" && segment.speaker ? segment.speaker : "SPEAKER",
      });
      const fallbackTokens = segment.text.trim().split(/\s+/);
      if (
        appendWordNodes(line, fallbackTokens, playerId, {
          fallbackStart: segment.start,
          fallback: true,
        })
      ) {
        usedSegmentFallback = true;
        lines.push(line);
      }
    });

    return {
      lines,
      usedSegmentFallback,
    };
  }

  const fullText = typeof result?.full_text === "string" ? result.full_text.trim() : "";
  if (fullText) {
    const line = createTranscriptLine({ speaker: "SPEAKER" });
    const fallbackTokens = fullText.split(/\s+/);
    if (
      appendWordNodes(line, fallbackTokens, playerId, {
        fallbackStart: 0,
        fallback: true,
      })
    ) {
      usedSegmentFallback = true;
      lines.push(line);
    }
  }

  return {
    lines,
    usedSegmentFallback,
  };
}

function deriveSampleId(entry) {
  if (typeof entry?.manifest_sample_id === "string" && entry.manifest_sample_id.trim()) {
    return entry.manifest_sample_id.trim();
  }

  const filename = typeof entry?.audio_filename === "string" ? entry.audio_filename.trim() : "";
  const prefixMatch = filename.match(/^(sample_\d+)/i);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  return filename.replace(/\.[^.]+$/, "") || "sample";
}

function deriveAudioFilename(entry) {
  return typeof entry?.audio_filename === "string" ? entry.audio_filename.trim() : "";
}

function dirname(path) {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex >= 0 ? path.slice(0, slashIndex) : ".";
}

function normalizeJoinValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function deriveJoinKeys(entry) {
  const keys = [];

  const sampleId = deriveSampleId(entry);
  if (sampleId) {
    keys.push(`sample:${normalizeJoinValue(sampleId)}`);
  }

  const audioFilename = deriveAudioFilename(entry);
  if (audioFilename) {
    keys.push(`audio:${normalizeJoinValue(audioFilename)}`);
  }

  return keys.length > 0 ? keys : [`entry:${entry?.index ?? "unknown"}`];
}

function toDomIdFragment(value) {
  return String(value || "sample")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sample";
}

function parseSampleNumber(sampleId) {
  const match = typeof sampleId === "string" ? sampleId.match(/sample_(\d+)/i) : null;
  return match ? Number(match[1]) : Number.NaN;
}

function compareSampleGroups(a, b) {
  const numA = parseSampleNumber(a.sampleId);
  const numB = parseSampleNumber(b.sampleId);

  if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
    return numA - numB;
  }

  const sampleA = typeof a.sampleId === "string" ? a.sampleId : "";
  const sampleB = typeof b.sampleId === "string" ? b.sampleId : "";
  if (sampleA !== sampleB) {
    return sampleA.localeCompare(sampleB);
  }

  const filenameA = typeof a.audioFilename === "string" ? a.audioFilename : "";
  const filenameB = typeof b.audioFilename === "string" ? b.audioFilename : "";
  if (filenameA !== filenameB) {
    return filenameA.localeCompare(filenameB);
  }

  return (a.sortIndex ?? Number.POSITIVE_INFINITY) - (b.sortIndex ?? Number.POSITIVE_INFINITY);
}

function buildAudioPath(audioFilename) {
  return `assets/audio/demo-set/${audioFilename}`;
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function loadRunIndex(runIndexPath) {
  const runIndex = await fetchJson(runIndexPath);
  return Array.isArray(runIndex?.entries) ? runIndex.entries : [];
}

async function loadTranscriptForEntry(runBasePath, entry) {
  if (!entry) {
    return {
      status: "missing-entry",
    };
  }

  const transcriptRelPath = typeof entry?.transcript_json === "string" ? entry.transcript_json.trim() : "";
  if (!transcriptRelPath) {
    return {
      status: "missing-transcript",
    };
  }

  try {
    const transcriptPayload = await fetchJson(`${runBasePath}/${transcriptRelPath}`);
    return {
      status: "ok",
      result: transcriptPayload?.result || {},
    };
  } catch (error) {
    return {
      status: "error",
      error,
    };
  }
}

function createTranscriptCard({ title, variant, transcriptState, playerId }) {
  const card = document.createElement("section");
  card.className = `transcript-card transcript-card--${variant}`;

  const heading = document.createElement("h4");
  heading.className = "transcript-card-title";
  heading.textContent = title;
  card.appendChild(heading);

  const content = document.createElement("div");
  content.className = "transcript-content";

  if (transcriptState.status === "blank") {
    // Intentionally empty transcript card content.
  } else if (transcriptState.status === "ok") {
    const { lines, usedSegmentFallback } = buildTranscriptLines(transcriptState.result, playerId);
    if (lines.length === 0) {
      const empty = document.createElement("p");
      empty.className = "caption";
      empty.textContent = "No transcript words available for this sample.";
      content.appendChild(empty);
    } else {
      lines.forEach((line) => content.appendChild(line));
    }

    if (usedSegmentFallback) {
      const fallbackNote = document.createElement("p");
      fallbackNote.className = "caption transcript-fallback-note";
      fallbackNote.textContent =
        "Word-level timestamps were incomplete; segment-start fallback links were used for some tokens.";
      content.appendChild(fallbackNote);
    }
  } else {
    const message = document.createElement("p");
    message.className = "caption";

    if (transcriptState.status === "missing-entry") {
      message.textContent = `No ${title.toLowerCase()} available for this sample.`;
    } else if (transcriptState.status === "missing-transcript") {
      message.textContent = `${title} could not be loaded for this sample.`;
    } else {
      const details = transcriptState.error instanceof Error ? transcriptState.error.message : "Unknown error";
      message.textContent = `Unable to load ${title.toLowerCase()}: ${details}`;
    }

    content.appendChild(message);
  }

  card.appendChild(content);
  return card;
}

function createSampleSection({ group, graniteState, whisperxState }) {
  const sampleId = group.sampleId || "sample";
  const audioFilename = group.audioFilename || "";
  const domIdSuffix = toDomIdFragment(sampleId);
  const playerId = `player-${domIdSuffix}`;

  const article = document.createElement("details");
  article.className = "sample-section";
  article.id = `sample-section-${domIdSuffix}`;

  const summary = document.createElement("summary");
  summary.className = "sample-summary";

  const heading = document.createElement("h3");
  heading.className = "sample-title";
  heading.textContent = sampleId;
  summary.appendChild(heading);

  if (audioFilename) {
    const filename = document.createElement("span");
    filename.className = "sample-filename";
    filename.textContent = audioFilename;
    summary.appendChild(filename);
  }

  article.appendChild(summary);

  const playerWrap = document.createElement("div");
  playerWrap.className = "sample-player";

  if (audioFilename) {
    const audio = document.createElement("audio");
    audio.id = playerId;
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = buildAudioPath(audioFilename);
    audio.textContent = "Your browser does not support the audio element.";
    playerWrap.appendChild(audio);
  } else {
    const missingAudio = document.createElement("p");
    missingAudio.className = "caption";
    missingAudio.textContent = "Audio file is unavailable for this sample.";
    playerWrap.appendChild(missingAudio);
  }

  article.appendChild(playerWrap);

  const transcriptGrid = document.createElement("div");
  transcriptGrid.className = "transcript-compare-grid";
  transcriptGrid.appendChild(
    createTranscriptCard({
      title: "Granite transcript",
      variant: "granite",
      transcriptState: graniteState,
      playerId,
    })
  );
  transcriptGrid.appendChild(
    createTranscriptCard({
      title: "WhisperX transcript",
      variant: "whisperx",
      transcriptState: whisperxState,
      playerId,
    })
  );

  article.appendChild(transcriptGrid);
  return article;
}

function attachEntryToGroups(groupsByKey, groups, entry, side) {
  if (!entry || typeof entry !== "object") {
    return;
  }

  const joinKeys = deriveJoinKeys(entry);
  let group = null;

  joinKeys.forEach((key) => {
    if (!group && groupsByKey.has(key)) {
      group = groupsByKey.get(key);
    }
  });

  if (!group) {
    group = {
      sampleId: deriveSampleId(entry),
      audioFilename: deriveAudioFilename(entry),
      graniteEntry: null,
      whisperxEntry: null,
      sortIndex: Number.isFinite(entry?.index) ? entry.index : Number.POSITIVE_INFINITY,
    };
    groups.push(group);
  }

  if (!group.sampleId) {
    group.sampleId = deriveSampleId(entry);
  }
  if (!group.audioFilename) {
    group.audioFilename = deriveAudioFilename(entry);
  }

  const entryIndex = Number.isFinite(entry?.index) ? entry.index : Number.POSITIVE_INFINITY;
  group.sortIndex = Math.min(group.sortIndex, entryIndex);

  if (side === "granite") {
    group.graniteEntry = entry;
  } else {
    group.whisperxEntry = entry;
  }

  joinKeys.forEach((key) => {
    groupsByKey.set(key, group);
  });
}

function buildSampleGroups(graniteEntries, whisperxEntries) {
  const groupsByKey = new Map();
  const groups = [];

  graniteEntries.forEach((entry) => {
    attachEntryToGroups(groupsByKey, groups, entry, "granite");
  });

  whisperxEntries.forEach((entry) => {
    attachEntryToGroups(groupsByKey, groups, entry, "whisperx");
  });

  return groups.sort(compareSampleGroups);
}

async function renderSampleComparisons() {
  const container = document.getElementById("sample-comparisons");
  if (!(container instanceof HTMLElement)) {
    return;
  }

  const graniteRunIndexPath = container.getAttribute("data-granite-run-index");
  const whisperxRunIndexPath = container.getAttribute("data-whisperx-run-index");
  if (!graniteRunIndexPath || !whisperxRunIndexPath) {
    container.innerHTML = "";
    const missingConfig = document.createElement("p");
    missingConfig.className = "caption";
    missingConfig.textContent = "Run index paths are not configured.";
    container.appendChild(missingConfig);
    return;
  }

  container.innerHTML = "";

  const [graniteRunResult, whisperxRunResult] = await Promise.allSettled([
    loadRunIndex(graniteRunIndexPath),
    loadRunIndex(whisperxRunIndexPath),
  ]);

  const graniteEntries = graniteRunResult.status === "fulfilled" ? graniteRunResult.value : [];
  const whisperxEntries = whisperxRunResult.status === "fulfilled" ? whisperxRunResult.value : [];

  if (graniteRunResult.status === "rejected") {
    const warning = document.createElement("p");
    warning.className = "caption";
    warning.textContent = `Failed to load Granite run index: ${graniteRunResult.reason?.message || "Unknown error"}`;
    container.appendChild(warning);
  }

  if (whisperxRunResult.status === "rejected") {
    const warning = document.createElement("p");
    warning.className = "caption";
    warning.textContent = `Failed to load WhisperX run index: ${whisperxRunResult.reason?.message || "Unknown error"}`;
    container.appendChild(warning);
  }

  const groups = buildSampleGroups(graniteEntries, whisperxEntries);
  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "caption";
    empty.textContent = "No samples were available for comparison.";
    container.appendChild(empty);
    return;
  }

  const graniteRunBasePath = dirname(graniteRunIndexPath);
  const whisperxRunBasePath = dirname(whisperxRunIndexPath);

  for (const group of groups) {
    const [graniteState, whisperxState] = await Promise.all([
      loadTranscriptForEntry(graniteRunBasePath, group.graniteEntry),
      loadTranscriptForEntry(whisperxRunBasePath, group.whisperxEntry),
    ]);

    const sampleSection = createSampleSection({
      group,
      graniteState,
      whisperxState,
    });

    container.appendChild(sampleSection);
  }
}

function handleInitialHashSeek() {
  const hash = window.location.hash;
  if (!hash.startsWith("#")) {
    return;
  }

  const params = new URLSearchParams(hash.slice(1));
  const timestamp = params.get("t");
  if (!timestamp) {
    return;
  }

  const playerId = params.get("p");
  const player = playerId ? getAudioPlayerById(playerId) : getDefaultAudioPlayer();
  if (!player) {
    return;
  }

  expandSectionForPlayer(player);
  seekAudio(player, timestamp);
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.hljs) {
    window.hljs.highlightAll();
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const link = target.closest("a[data-seek]");
    if (!link) {
      return;
    }

    event.preventDefault();
    const timestamp = link.getAttribute("data-seek");
    if (!timestamp) {
      return;
    }

    const player = resolvePlayerForSeekLink(link);
    if (!player) {
      return;
    }

    pauseOtherPlayers(player);
    seekAudio(player, timestamp, { autoplay: true });

    const targetPlayerId = link.getAttribute("data-player");
    const hash = targetPlayerId
      ? `#t=${encodeURIComponent(timestamp)}&p=${encodeURIComponent(targetPlayerId)}`
      : `#t=${encodeURIComponent(timestamp)}`;
    history.replaceState(null, "", hash);
  });

  renderSampleComparisons().finally(() => {
    handleInitialHashSeek();
  });
});
