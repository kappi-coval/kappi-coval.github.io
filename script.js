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

function seekAudio(player, timestamp) {
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
      return;
    }

    player.currentTime = targetSeconds;
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
    if (!current || current.speaker !== word.speaker) {
      current = {
        speaker: word.speaker || "SPEAKER",
        words: [],
      };
      groups.push(current);
    }

    current.words.push(word);
  });

  return groups;
}

function buildTranscriptLines(result, playerId) {
  const timeline = Array.isArray(result?.timeline) ? result.timeline : [];
  const segments = Array.isArray(result?.segments) ? result.segments : [];
  const words = timeline
    .filter(
      (item) =>
        item &&
        item.type === "word" &&
        typeof item.text === "string" &&
        Number.isFinite(item.start) &&
        Number.isFinite(item.end)
    )
    .sort((a, b) => a.start - b.start);

  const lines = [];
  let usedSegmentFallback = false;

  if (words.length > 0 && segments.length > 0) {
    const usedWordIndexes = new Set();
    const epsilon = 0.03;

    segments.forEach((segment) => {
      if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) {
        return;
      }

      const segmentWords = words.filter((word) => {
        const wordIndex = Number.isFinite(word.index) ? word.index : null;
        if (wordIndex !== null && usedWordIndexes.has(wordIndex)) {
          return false;
        }

        const inSegmentRange = word.start >= segment.start - epsilon && word.start <= segment.end + epsilon;
        if (!inSegmentRange) {
          return false;
        }

        if (wordIndex !== null) {
          usedWordIndexes.add(wordIndex);
        }

        return true;
      });

      const line = createTranscriptLine({ speaker: segment.speaker || segmentWords[0]?.speaker });
      const appendedWords = appendWordNodes(line, segmentWords, playerId);

      if (appendedWords) {
        lines.push(line);
        return;
      }

      if (typeof segment.text === "string" && segment.text.trim()) {
        const fallbackTokens = segment.text.trim().split(/\s+/);
        const appendedFallback = appendWordNodes(line, fallbackTokens, playerId, {
          fallbackStart: segment.start,
          fallback: true,
        });

        if (appendedFallback) {
          usedSegmentFallback = true;
          lines.push(line);
        }
      }
    });

    const leftovers = words.filter((word) => {
      const wordIndex = Number.isFinite(word.index) ? word.index : null;
      return wordIndex === null || !usedWordIndexes.has(wordIndex);
    });

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

  if (words.length > 0) {
    groupWordsBySpeaker(words).forEach((group) => {
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

  if (segments.length > 0) {
    segments.forEach((segment) => {
      if (!Number.isFinite(segment.start) || typeof segment.text !== "string" || !segment.text.trim()) {
        return;
      }

      const line = createTranscriptLine({ speaker: segment.speaker || "SPEAKER" });
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

  const filename = typeof entry?.audio_filename === "string" ? entry.audio_filename : "";
  const prefixMatch = filename.match(/^(sample_\d+)/i);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  return filename.replace(/\.[^.]+$/, "") || "sample";
}

function dirname(path) {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex >= 0 ? path.slice(0, slashIndex) : ".";
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function createTranscriptBlock({ entry, transcriptResult, transcriptRelPath }) {
  const sampleId = deriveSampleId(entry);
  const playerId = `player-${sampleId}`;
  const article = document.createElement("article");
  article.className = "transcript-block";
  article.id = `transcript-${sampleId}`;

  const heading = document.createElement("h3");
  heading.className = "transcript-title";
  heading.textContent = sampleId;
  article.appendChild(heading);

  const meta = document.createElement("p");
  meta.className = "transcript-meta";
  const filename = entry?.audio_filename || "";
  const segmentsCount = Number.isFinite(entry?.segments_count) ? entry.segments_count : 0;
  const speakersCount = Number.isFinite(entry?.speakers_count) ? entry.speakers_count : 0;
  meta.textContent = `${filename} • ${segmentsCount} segments • ${speakersCount} speakers`;
  article.appendChild(meta);

  const content = document.createElement("div");
  content.className = "transcript-content";

  const { lines, usedSegmentFallback } = buildTranscriptLines(transcriptResult, playerId);
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
    fallbackNote.textContent = "Timeline word timestamps were incomplete; segment-start fallback links were used for some tokens.";
    content.appendChild(fallbackNote);
  }

  const sourceNote = document.createElement("p");
  sourceNote.className = "caption transcript-source";
  sourceNote.textContent = `Source: ${transcriptRelPath}`;
  content.appendChild(sourceNote);

  article.appendChild(content);
  return article;
}

function renderTranscriptErrorBlock(entry, transcriptRelPath, error) {
  const sampleId = deriveSampleId(entry);
  const article = document.createElement("article");
  article.className = "transcript-block";
  article.id = `transcript-${sampleId}`;

  const heading = document.createElement("h3");
  heading.className = "transcript-title";
  heading.textContent = sampleId;
  article.appendChild(heading);

  const message = document.createElement("p");
  message.className = "caption";
  message.textContent = `Unable to load transcript (${transcriptRelPath}): ${error.message}`;
  article.appendChild(message);

  return article;
}

async function renderGraniteTranscripts() {
  const container = document.getElementById("granite-transcripts");
  if (!(container instanceof HTMLElement)) {
    return;
  }

  const runIndexPath = container.getAttribute("data-run-index");
  if (!runIndexPath) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.className = "caption";
    message.textContent = "No Granite run index path configured.";
    container.appendChild(message);
    return;
  }

  container.innerHTML = "";

  let runIndex;
  try {
    runIndex = await fetchJson(runIndexPath);
  } catch (error) {
    const message = document.createElement("p");
    message.className = "caption";
    message.textContent = `Failed to load Granite run index: ${error.message}`;
    container.appendChild(message);
    return;
  }

  const entries = Array.isArray(runIndex?.entries) ? runIndex.entries : [];
  if (entries.length === 0) {
    const message = document.createElement("p");
    message.className = "caption";
    message.textContent = "No transcript entries were found in the Granite run index.";
    container.appendChild(message);
    return;
  }

  const runBasePath = dirname(runIndexPath);

  for (const entry of entries) {
    const transcriptRelPath = typeof entry?.transcript_json === "string" ? entry.transcript_json : "";
    if (!transcriptRelPath) {
      continue;
    }

    const transcriptPath = `${runBasePath}/${transcriptRelPath}`;

    try {
      const transcriptPayload = await fetchJson(transcriptPath);
      const transcriptResult = transcriptPayload?.result || {};
      const block = createTranscriptBlock({ entry, transcriptResult, transcriptRelPath });
      container.appendChild(block);
    } catch (error) {
      const errorBlock = renderTranscriptErrorBlock(entry, transcriptRelPath, error);
      container.appendChild(errorBlock);
    }
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

    seekAudio(player, timestamp);

    const targetPlayerId = link.getAttribute("data-player");
    const hash = targetPlayerId
      ? `#t=${encodeURIComponent(timestamp)}&p=${encodeURIComponent(targetPlayerId)}`
      : `#t=${encodeURIComponent(timestamp)}`;
    history.replaceState(null, "", hash);
  });

  handleInitialHashSeek();
  renderGraniteTranscripts();
});
