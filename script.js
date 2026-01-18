import { voices as voiceDefs } from "./voices.js";

const volumeSlider = document.querySelector("#volume-slider input");
const volumeNumber = document.querySelector("#volume-slider .number-box");
const speedSlider = document.querySelector("#speed-slider input");
const speedNumber = document.querySelector("#speed-slider .number-box");
const startButton = document.querySelector("#start-audio");
const muteButton = document.querySelector("#mute-button");
const lfeSlider = document.querySelector("#lfe-slider input");
const lfeNumber = document.querySelector("#lfe-slider .number-box");
const speakerElements = document.querySelectorAll(".speaker");

const numOctaves = 10;
const minFreq = 20;
const amps = [0, 0.707, 1, 0.9, 0.81, 0.73, 0.66, 0.59, 0.53, 0.48, 0];
const controlPeriod = 0.01;

let audioContext = null;
let voices = null;
let masterGain = null;
let speed = 200;
let f0 = minFreq;
let lastTime = 0;

let isMuted = false;
const lfeChannel = 3;
let lfeGain = null;
let masterVolume = volumeSlider.value;
let lfeVolume = lfeSlider.value;

// Welches Output-Device aus der Liste (per Konsole anschauen)
const audioDeviceIndex = 0; // ANPASSEN!

// ================== UI-Handler ==================

muteButton.addEventListener("pointerdown", () => {
  if (!masterGain || !audioContext) return;
  isMuted = !isMuted;
  masterGain.gain.setTargetAtTime(
    isMuted ? 0 : volumeToLinear(masterVolume),
    audioContext.currentTime,
    0.01,
  );
  muteButton.innerHTML = isMuted ? "unmute" : "mute";
});

volumeSlider.addEventListener("input", (event) => {
  const value = event.target.value;
  volumeNumber.innerHTML = value;
  if (!masterGain || isMuted) return;
  masterGain.gain.value = volumeToLinear(value);
});

speedSlider.addEventListener("input", (event) => setSpeed(event.target.value));

lfeSlider.addEventListener("input", (event) => {
  setLfeVolume(event.target.value);
});

function setLfeVolume(value) {
  lfeVolume = parseInt(value);
  lfeNumber.innerHTML = lfeVolume;
  lfeSlider.value = lfeVolume;
  if (!lfeGain) return;
  lfeGain.gain.value = volumeToLinear(lfeVolume);
}

function setSpeed(value) {
  speed = value;
  speedNumber.innerHTML = value;
  speedSlider.value = value;
}

// ================== Audio-Logik ==================

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

async function setupAudio(audioOutput) {
  // AudioContext mit sinkId auf das gewünschte Output-Device
  audioContext = new AudioContext({
    sinkId: audioOutput.deviceId,
    latencyHint: "balanced",
  });

  const maxChannelCount = audioContext.destination.maxChannelCount;

  audioContext.destination.channelCount = maxChannelCount;
  audioContext.destination.channelCountMode = "explicit";
  audioContext.destination.channelInterpretation = "discrete";

  console.log(
    `audio output device ${audioDeviceIndex}: '${audioOutput.label}' (${maxChannelCount} channels)`,
  );

  // MasterGain
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioContext.destination);

  // Outputs + Voices
  const merger = setupOutputs();
  voices = createVoices(merger);

  startGlissando();
}

function setupOutputs() {
  const numOutputs = audioContext.destination.channelCount;

  const channelMerger = audioContext.createChannelMerger(numOutputs);
  channelMerger.connect(masterGain);

  lfeGain = audioContext.createGain();
  lfeGain.gain.value = volumeToLinear(lfeVolume);

  if (lfeChannel < numOutputs) {
    lfeGain.connect(channelMerger, 0, lfeChannel);
  }

  console.log(`setting up ${numOutputs} audio outputs`);

  return channelMerger;
}

function createVoices(merger) {
  const result = [];
  for (const v of voiceDefs) {
    if (v.channel >= merger.numberOfInputs) {
      //falls nur sterio, dann mach sterio
      console.warn(
        `Skipping voice on channel ${v.channel} – device has only ${merger.numberOfInputs} channels`,
      );
      continue;
    }
    for (const oct of v.octave) {
      const osc = audioContext.createOscillator();
      osc.type = v.waveform;

      const gain = audioContext.createGain();
      gain.gain.value = 1;

      osc.connect(gain);
      gain.connect(merger, 0, v.channel); // Hauptkanal
      gain.connect(lfeGain); // zusätzlich in LFE

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
  const shift = speed * dT;
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

// ================== Hilfsfunktionen ==================

function centToLinear(val) {
  return Math.exp(0.0005776226504666211 * val);
}

function volumeToLinear(volume) {
  return volume > 0 ? decibelToLinear(0.5 * volume - 50) : 0;
}

function decibelToLinear(val) {
  return Math.exp(0.11512925464970229 * val);
}

// ================== Device-Auswahl und Start ==================

async function listAudioDevices() {
  await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: undefined },
    video: false,
  });

  const devices = await navigator.mediaDevices.enumerateDevices();

  console.log("audio output devices:");
  const outputs = [];
  for (let i = 0; i < devices.length; i++) {
    const device = devices[i];
    if (device.kind === "audiooutput") {
      console.log(`   ${outputs.length}: ${device.label}`);
      outputs.push(device);
    }
  }

  return outputs;
}

(async function main() {
  const devices = await listAudioDevices();
  const audioOutput = devices[audioDeviceIndex];

  startButton.addEventListener("pointerdown", () => {
    if (!audioContext) {
      setupAudio(audioOutput);
      startButton.classList.add("disabled");
    }
  });
})();

// ================== Visual UI ==================

function updateSpeakerUI() {
  speakerElements.forEach((el) => el.classList.remove("active"));

  for (const voice of voices) {
    if (voice.gain.gain.value > 0.001) {
      const channel = voice.channel;
      const el = document.querySelector(`.speaker[data-channel="${channel}"]`);
      if (el) el.classList.add("active");
    }
  }

  if (lfeGain && lfeGain.gain.value > 0.001) {
    const el = document.querySelector(`.speaker[data-channel="3"]`);
    if (el) el.classList.add("active");
  }
}
