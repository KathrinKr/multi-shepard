import { voices as voiceDefs } from "./voices.js";

const volumeSlider = document.querySelector("#volume-slider input");
const volumeNumber = document.querySelector("#volume-slider .number-box");
const speedSlider = document.querySelector("#speed-slider input");
const speedNumber = document.querySelector("#speed-slider .number-box");
const startButton = document.querySelector("#start-audio");
const muteButton = document.querySelector("#mute-button");
const lfeSlider = document.querySelector("#lfe-slider input");
const lfeNumber = document.querySelector("#lfe-slider .number-box");
const speakerElements = document.querySelectorAll(".speaker"); //Visual UI

const numOctaves = 10;
const minFreq = 20;
const amps = [0, 0.707, 1, 0.9, 0.81, 0.73, 0.66, 0.59, 0.53, 0.48, 0]; // amplitude jeyfreames
const controlPeriod = 0.01;

let audioContext = null;
let voices = null;
let masterGain = null;
let speed = 200; // cents per second
let f0 = minFreq;
let lastTime = 0;

let isMuted = false;
const lfeChannel = 3;
let lfeGain = null;
let masterVolume = volumeSlider.value; // %
let lfeVolume = lfeSlider.value; // %

muteButton.addEventListener("pointerdown", () => {
  if (!masterGain) return;
  isMuted = !isMuted;
  masterGain.gain.setTargetAtTime(
    isMuted ? 0 : volumeToLinear(masterVolume),
    audioContext.currentTime,
    0.01
  );
  muteButton.innerHTML = isMuted ? "unmute" : "mute";
});

volumeSlider.addEventListener("input", (event) => {
  const value = event.target.value;
  volumeNumber.innerHTML = value;
  if (!masterGain) return;
  if (!isMuted) {
    masterGain.gain.value = volumeToLinear(value);
  }
});
speedSlider.addEventListener("input", (event) => setSpeed(event.target.value));

function setLfeVolume(value) {
  lfeNumber.innerHTML = value;
  lfeVolume = parseInt(value);
  if (!lfeGain) return;
  lfeGain.gain.value = volumeToLinear(value);
}

lfeSlider.addEventListener("input", (event) => {
  setLfeVolume(event.target.value);
});

function setSpeed(value) {
  speed = value;
  speedNumber.innerHTML = value;
  speedSlider.value = value;
}

function getAmpForFreq(freq) {
  const octave = Math.log(freq / 20) / Math.log(2);
  let amp = 0;
  if (octave > 0 && octave < numOctaves) {
    const index = Math.floor(octave);
    const frac = octave - index;
    amp = (1 - frac) * amps[index] + frac * amps[index + 1];
  }
  return amp;
}

function setupAudio() {
  // AudioContext nach Klick starten
  audioContext = new AudioContext();

  masterGain = audioContext.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioContext.destination);

  const merger = setupOutputs();
  voices = createVoices(merger);

  startGlissando();
}

function setupOutputs() {
  // 8-Kanal Merger für 7.1
  const channelMerger = audioContext.createChannelMerger(8);

  channelMerger.connect(masterGain);

  lfeGain = audioContext.createGain();
  lfeGain.gain.value = volumeToLinear(lfeVolume);

  lfeGain.connect(channelMerger, 0, lfeChannel);

  console.log("setting up 8 audio outputs");

  return channelMerger;
}

function createVoices(merger) {
  const result = [];

  for (const v of voiceDefs) {
    for (const oct of v.octave) {
      const osc = audioContext.createOscillator();
      osc.type = v.waveform;

      const gain = audioContext.createGain();
      gain.gain.value = 1;

      // Routing auf den gewünschten Lautsprecherkanal
      osc.connect(gain);
      gain.connect(merger, 0, v.channel); // normaler Kanal
      gain.connect(lfeGain); // LFE signal

      // Frequenz setzen
      const freq = f0 * 2 ** oct;
      osc.frequency.value = freq;

      osc.start();

      result.push({ osc, gain, octave: oct, channel: v.channel });
    }
  }

  return result;
}

function startGlissando() {
  const time = audioContext.currentTime;
  lastTime = time;
  setInterval(onControlFrame, 1000 * controlPeriod);
  const masterGainValue = volumeToLinear(masterVolume);
  masterGain.gain.linearRampToValueAtTime(masterGainValue, time + 0.25);
}

function onControlFrame() {
  const time = audioContext.currentTime;
  const dT = time - lastTime;
  const shift = speed * dT; // in cents
  const freqFactor = centToLinear(shift);
  let octaveIncr = 0;

  f0 *= freqFactor;

  if (speed >= 0 && f0 > 2 * minFreq) {
    f0 *= 0.5;
    octaveIncr = 1;
  } else if (speed < 0 && f0 < minFreq) {
    f0 *= 2;
    octaveIncr = -1;
  }

  for (let i = 0; i < voices.length; i++) {
    const voice = voices[i];
    const osc = voice.osc;
    const gain = voice.gain;
    let octave = voice.octave + octaveIncr;
    voice.octave = octave;

    if ((speed >= 0 && octave < numOctaves) || (speed < 0 && octave >= 0)) {
      const freq = f0 * 2 ** octave;
      const amp = 0.1 * getAmpForFreq(freq);
      osc.frequency.cancelAndHoldAtTime(time);
      osc.frequency.linearRampToValueAtTime(freq, time + controlPeriod);
      gain.gain.linearRampToValueAtTime(amp, time + controlPeriod);
      voice.octave = octave;
    } else {
      const jumpOctave = octave >= 0 ? 0 : numOctaves - 1;
      const freq = f0 * 2 ** jumpOctave;
      osc.frequency.cancelAndHoldAtTime(time);
      osc.frequency.setValueAtTime(freq, time + controlPeriod);
      gain.gain.setValueAtTime(0, time + controlPeriod);
      voice.octave = jumpOctave;
    }
  }

  lastTime = time;
  updateSpeakerUI();
}

function centToLinear(val) {
  return Math.exp(0.0005776226504666211 * val);
}

function volumeToLinear(volume) {
  return volume > 0 ? decibelToLinear(0.5 * volume - 50) : 0;
}

function decibelToLinear(val) {
  return Math.exp(0.11512925464970229 * val);
}

// ===== Start Button Event =====
startButton.addEventListener("click", () => {
  if (!audioContext) setupAudio();
});

// ================= Visual UI Update ================
function updateSpeakerUI() {
  // Erstmal alle deaktivieren
  speakerElements.forEach((el) => el.classList.remove("active"));

  // Normale Kanäle aktivieren
  for (const voice of voices) {
    if (voice.gain.gain.value > 0.001) {
      const channel = voice.channel;
      const el = document.querySelector(`.speaker[data-channel="${channel}"]`);
      if (el) el.classList.add("active");
    }
  }

  // LFE separat prüfen
  if (lfeGain && lfeGain.gain.value > 0.001) {
    const el = document.querySelector(`.speaker[data-channel="3"]`);
    if (el) el.classList.add("active");
  }
}
