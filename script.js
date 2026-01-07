const volumeSlider = document.querySelector("#volume-slider input");
const volumeNumber = document.querySelector("#volume-slider .number-box");
const speedSlider = document.querySelector("#speed-slider input");
const speedNumber = document.querySelector("#speed-slider .number-box");
const startButton = document.querySelector("#start-audio");

const numOctaves = 10;
const minFreq = 20;
const freqs = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
const amps = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0];
const controlPeriod = 0.01;

let audioContext = null;
let voices = null;
let masterGain = null;
let speed = 200; // cents per second
let f0 = minFreq;
let lastTime = 0;

const audioDeviceIndex = 10; // optional, kann ignoriert werden

volumeSlider.addEventListener("input", (event) => {
  const volume = event.target.value;
  if (masterGain) masterGain.gain.value = volumeToLinear(volume);
  volumeNumber.innerHTML = volume;
});

speedSlider.addEventListener("input", (event) => {
  speed = event.target.value;
  speedNumber.innerHTML = speed;
});

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
  masterGain.gain.value = volumeToLinear(volumeSlider.value);
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
  lastTime = audioContext.currentTime;
  setInterval(onControlFrame, 1000 * controlPeriod);
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
      const ampTarget = 0.1 * getAmpForFreq(freq);
      const ampCurrent = gain.gain.value;
      const smoothing = 0.05; // Dauer des Crossfades in Sekunden

      gain.gain.cancelScheduledValues(time);
      gain.gain.setValueAtTime(ampCurrent, time); // aktueller Wert
      gain.gain.linearRampToValueAtTime(ampTarget, time + smoothing);

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
