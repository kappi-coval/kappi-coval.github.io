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

function seekAudio(player, timestamp) {
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

document.addEventListener("DOMContentLoaded", () => {
  const player = document.getElementById("post-audio");
  if (!(player instanceof HTMLAudioElement)) {
    return;
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

    seekAudio(player, timestamp);
    history.replaceState(null, "", `#t=${encodeURIComponent(timestamp)}`);
  });

  const hashMatch = window.location.hash.match(/^#t=(.+)$/);
  if (hashMatch) {
    seekAudio(player, decodeURIComponent(hashMatch[1]));
  }
});
