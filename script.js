import { voices } from './voices.js';
const muteButton = document.querySelector('#mute-button');
const volumeSlider = document.querySelector('#volume-slider input');
const volumeNumber = document.querySelector('#volume-slider .number-box');
const speedSlider = document.querySelector('#speed-slider input');
const speedNumber = document.querySelector('#speed-slider .number-box');
const freqs = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480]; // frequencies of octaves over minFreq
const amps = [0, 0.707, 1, 0.9, 0.81, 0.73, 0.66, 0.59, 0.53, 0.48, 0]; // amplitude jeyfreames 
const numOctaves = 10;
const minFreq = 20;
const controlPeriod = 0.01;
const audioDeviceIndex = 10;
const defaultWaveform = 'saw';
let audioContext = null;
let masterGain = null;
let volume = volumeSlider.value; // %
let speed = speedSlider.value; // cents per second
let f0 = minFreq;
let lastTime = 0;

muteButton.addEventListener('pointerdown', () => setVolume(0));
volumeSlider.addEventListener('input', (event) => setVolume(event.target.value));
speedSlider.addEventListener('input', (event) => setSpeed(event.target.value));

function setVolume(value) {
  volume = value;
  masterGain.gain.value = volumeToLinear(value);
  volumeNumber.innerHTML = value;
  volumeSlider.value = value;
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

(async function main() {
  const devices = await listAudioDevices();
  const audioOutput = devices[audioDeviceIndex];

  audioContext = setupAudio(audioOutput);
  const merger = setupOutputs();
  initVoices(voices, merger);

  startGlissando();
})();

async function listAudioDevices() {
  await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: undefined },
    video: false
  });

  const devices = await navigator.mediaDevices.enumerateDevices();

  console.log(`audio output devices:`);
  for (let i = 0; i < devices.length; i++) {
    let device = devices[i];

    if (device.kind === "audiooutput") {
      console.log(`   ${i}: ${device.label}`);
    }
  }

  return devices;
}

function setupAudio(audioOutput) {
  const audioContext = new AudioContext({ sinkId: audioOutput.deviceId, latencyHint: 'balanced' });
  const maxChannelCount = audioContext.destination.maxChannelCount;

  audioContext.destination.channelCount = maxChannelCount;
  audioContext.destination.channelCountMode = "explicit";
  audioContext.destination.channelInterpretation = "discrete";

  console.log(`audio output device ${audioDeviceIndex}: '${audioOutput.label}' (${maxChannelCount} channels)`);

  return audioContext;
}

function setupOutputs() {
  const numOutputs = audioContext.destination.channelCount;

  masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);
  masterGain.gain.value = volumeToLinear(volume);

  const channelMerger = audioContext.createChannelMerger(numOutputs);
  channelMerger.connect(masterGain);
  channelMerger.channelCount = 1;
  channelMerger.channelCountMode = "explicit";
  channelMerger.channelInterpretation = "discrete";

  console.log(`setting up ${numOutputs} audio outputs`);

  return channelMerger;
}

function initVoices(voices, merger) {
  const time = audioContext.currentTime;
  const numChannels = merger.numberOfInputs;

  console.log(`setting up ${numChannels} voices:`);

  for (let i = 0; i < voices.length; i++) {
    const voice = voices[i];
    const octave = voice.octave;
    const channel = voice.channel;
    const freq = f0 * (2 ** octave);

    const gain = audioContext.createGain();
    gain.gain.value = 1;
    const ch = channel % numChannels;
    gain.connect(merger, 0, ch);

    const osc = audioContext.createOscillator();
    osc.connect(gain);
    osc.type = voice.waveform || defaultWaveform;
    osc.frequency.value = freq;
    osc.start(time);

    console.log(`  osc ${i}: channel ${channel}, octave ${octave}, ${freq}Hz`);

    voice.gain = gain;
    voice.osc = osc;
  }

  return voices;
}

function startGlissando() {
  setInterval(onControlFrame, 1000 * controlPeriod);
  lastTime = audioContext.currentTime;
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
      const freq = f0 * (2 ** octave);
      const amp = 0.1 * getAmpForFreq(freq);
      osc.frequency.cancelAndHoldAtTime(time);
      osc.frequency.linearRampToValueAtTime(freq, time + controlPeriod);
      gain.gain.linearRampToValueAtTime(amp, time + controlPeriod);
      voice.octave = octave;
    } else {
      const jumpOctave = (octave >= 0) ? 0 : numOctaves - 1;
      const freq = f0 * (2 ** jumpOctave);
      osc.frequency.cancelAndHoldAtTime(time);
      osc.frequency.setValueAtTime(freq, time + controlPeriod);
      gain.gain.setValueAtTime(0, time + controlPeriod);
      voice.octave = jumpOctave;
    }
  }

  lastTime = time;
}

function centToLinear(val) {
  return Math.exp(0.0005776226504666211 * val); // pow(2, val / 1200)
};

function volumeToLinear(volume) {
  return (volume > 0) ? decibelToLinear(0.5 * volume - 50) : 0;
}

function decibelToLinear(val) {
  return Math.exp(0.11512925464970229 * val); // pow(10, val / 20)
};
