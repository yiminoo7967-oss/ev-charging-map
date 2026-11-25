"use strict";

const flightStage = document.getElementById("flight-stage");
const flightToggle = document.getElementById("flight-toggle");
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const flightPaths = [
  [12, 17, 9, 7.4], [31, 16, -11, 8.2], [51, 19, 12, 7.8],
  [71, 16, -10, 9.1], [90, 17, 8, 8.6],
  [13, 73, -9, 8.4], [32, 60, 12, 7.5], [52, 72, -12, 9.2],
  [72, 62, 10, 8.1], [90, 75, -8, 7.9]
];

for (const [index, [left, top, sway, duration]] of flightPaths.entries()) {
  const flyer = document.createElement("div");
  flyer.className = "flyer";
  flyer.style.setProperty("--left", left + "%");
  flyer.style.setProperty("--top", top + "%");
  flyer.style.setProperty("--sway", sway + "px");
  flyer.style.setProperty("--face", index % 3 === 1 ? "-1" : "1");
  flyer.style.setProperty("--duration", duration + "s");
  flyer.style.setProperty("--delay", (-(index + 1) * .67) + "s");
  flyer.style.setProperty("--spark-delay", (-index * .47) + "s");

  const facing = document.createElement("div");
  facing.className = "flyer-facing";
  const image = document.createElement("img");
  image.src = "bungaeman-flying.png";
  image.alt = "";
  const bolt = document.createElement("span");
  bolt.className = "flyer-bolt";
  facing.append(image, bolt);
  flyer.append(facing);
  flightStage.append(flyer);
}

function setMotion(active) {
  flightStage.dataset.motion = active ? "active" : "paused";
  flightToggle.setAttribute("aria-pressed", String(active));
}
setMotion(!motionPreference.matches);
motionPreference.addEventListener("change", event => setMotion(!event.matches));
flightToggle.addEventListener("click", () => setMotion(flightStage.dataset.motion !== "active"));

const themePlay = document.getElementById("theme-play");
const themePanel = document.getElementById("theme-panel");
const themePlayer = document.getElementById("theme-player");
const themeMessage = document.getElementById("theme-message");

themePlay.addEventListener("click", () => {
  const opening = themePanel.hidden;
  themePanel.hidden = !opening;
  themePlay.setAttribute("aria-expanded", String(opening));
  themePlayer.replaceChildren();
  themeMessage.hidden = true;
  if (!opening) {
    themePlay.replaceChildren("▶ 실행", themeLabel("주제곡 재생"));
    return;
  }

  themePlay.replaceChildren("■ 닫기", themeLabel("주제곡"));
  if (location.protocol === "file:" || !navigator.onLine) {
    themeMessage.textContent = location.protocol === "file:"
      ? "앱 안에서 주제곡을 들으려면 이 폴더의 Start.cmd로 지도를 여세요."
      : "주제곡을 재생하려면 인터넷에 연결하세요.";
    themeMessage.hidden = false;
    return;
  }

  const player = document.createElement("iframe");
  player.title = "나는 번개맨이다 · EBS 친구들";
  player.allow = "autoplay; encrypted-media; picture-in-picture";
  player.allowFullscreen = true;
  player.referrerPolicy = "strict-origin-when-cross-origin";
  player.src = "https://www.youtube-nocookie.com/embed/tYn6UeEhNkU?autoplay=1";
  themePlayer.append(player);
});

function themeLabel(text) {
  const label = document.createElement("span");
  label.className = "theme-play-label";
  label.textContent = text;
  return label;
}
