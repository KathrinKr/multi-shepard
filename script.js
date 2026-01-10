const volumeSlider = document.querySelector("#volume-slider input");
const volumeNumber = document.querySelector("#volume-slider .number-box");
const speedSlider = document.querySelector("#speed-slider input");
const speedNumber = document.querySelector("#speed-slider .number-box");
const startButton = document.querySelector("#start-audio");
const muteButton = document.querySelector("#mute-button");
const lfeSlider = document.querySelector("#lfe-slider input");
const lfeNumber = document.querySelector("#lfe-slider .number-box");

const numOctaves = 10;
const minFreq = 20;
const freqs = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480]; // frequencies of octaves over minFreq
const amps = [0, 0.707, 1, 0.9, 0.81, 0.73, 0.66, 0.59, 0.53, 0.48, 0]; // amplitude jeyfreames
const controlPeriod = 0.01;

let audioContext = null;
let voices = null;
let masterGain = null;
let speed = 200; // cents per second
let f0 = minFreq;
let lastTime = 0;

const audioDeviceIndex = 10;
const defaultWaveform = "saw";

let isMuted = false;
const lfeChannel = 3;
let lfeGain = null;
let masterVolume = volumeSlider.value; // %
let lfeVolume = lfeSlider.value; // %

muteButton.addEventListener("pointerdown", () => {
  if (!masterGain) return;

  isMuted = !isMuted;

  if (isMuted) {
    masterGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
    muteButton.innerHTML = "unmute";
  } else {
    masterGain.gain.setTargetAtTime(
      volumeToLinear(masterVolume),
      audioContext.currentTime,
      0.01
    );
    muteButton.innerHTML = "mute";
  }
});

function setMasterVolume(value) {
  masterVolume = parseInt(value);
  masterGain.gain.value = volumeToLinear(masterVolume);
  volumeNumber.innerHTML = masterVolume;
  volumeSlider.value = masterVolume;
}

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

async function start(audioOutput) {
  if (audioContext === null) {
    audioContext = setupAudio(audioOutput);
    const merger = setupOutputs();

    initVoices(voices, merger);
    startGlissando();

    muteButton.addEventListener("pointerdown", () => setMasterVolume(0));
    volumeSlider.addEventListener("input", (event) =>
      setMasterVolume(event.target.value)
    );

    speedSlider.addEventListener("input", (event) =>
      setSpeed(event.target.value)
    );

    muteButton.classList.remove("disabled");
    startButton.classList.add("disabled");
  }
}

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
  voices = createVoices(merger, numOctaves);

  startGlissando();
}

function setupOutputs() {
  const numOutputs = audioContext.destination.maxChannelCount;

  const channelMerger = audioContext.createChannelMerger(numOutputs);
  channelMerger.connect(masterGain);
  channelMerger.channelCount = 1;
  channelMerger.channelCountMode = "explicit";
  channelMerger.channelInterpretation = "discrete";

  lfeGain = audioContext.createGain();
  lfeGain.gain.value = volumeToLinear(lfeVolume);

  if (lfeChannel < numOutputs) {
    lfeGain.connect(channelMerger, 0, lfeChannel);
  }

  console.log(`setting up ${numOutputs} audio outputs`);

  return channelMerger;
}

function createVoices(merger, numVoices) {
  const time = audioContext.currentTime;
  const voices = [];
  const numChannels = merger.numberOfInputs;

  for (let i = 0; i < numVoices; i++) {
    const octave = i % numOctaves;
    const freq = f0 * 2 ** octave;

    const gain = audioContext.createGain();
    gain.gain.value = 1;
    const ch = i % numChannels;
    gain.connect(merger, 0, ch);
    gain.connect(lfeGain);

    const osc = audioContext.createOscillator();
    osc.connect(gain);
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.start(time);

    voices.push({ osc, gain, octave });
  }

  return voices;
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
