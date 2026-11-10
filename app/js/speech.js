/* Reading text aloud with the system voices (Web Speech API). Works offline where the OS has a
   Russian voice: Windows (Irina/Pavel/Svetlana), Android, iOS. Long text goes sentence by sentence,
   because Chrome cuts off a single long utterance after about 15 seconds. */
(function () {
  "use strict";
  const BH = window.BH;
  const synth = window.speechSynthesis;
  const sp = BH.speech = { supported: !!(synth && window.SpeechSynthesisUtterance), speaking: false };
  let voice = null, queue = [], onDone = null, token = 0;

  function pickVoice() {
    if (!sp.supported) return null;
    const vs = synth.getVoices();
    const ru = vs.filter(v => /^ru(-|_|$)/i.test(v.lang));
    // prefer natural/online voices when present, then local ones
    voice = ru.find(v => /natural|online/i.test(v.name)) || ru.find(v => v.localService) || ru[0] || null;
    sp.hasRussian = !!voice;
    return voice;
  }
  if (sp.supported) {
    pickVoice();
    if ("onvoiceschanged" in synth) synth.addEventListener("voiceschanged", pickVoice);
  }

  const split = text => String(text || "").replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*\s*/g) || [];

  function next(my) {
    if (my !== token) return;
    const part = queue.shift();
    if (!part) { sp.speaking = false; const cb = onDone; onDone = null; if (cb) cb(); return; }
    const u = new SpeechSynthesisUtterance(part.trim());
    u.lang = "ru-RU";
    if (voice) u.voice = voice;
    u.rate = (BH.state && BH.state.settings.voiceRate) || 1;
    u.onend = () => next(my);
    u.onerror = () => next(my);
    synth.speak(u);
  }

  sp.speak = (text, done) => {
    if (!sp.supported) { BH.toast("Этот браузер не умеет читать вслух"); return; }
    sp.stop();
    if (!voice) pickVoice();
    token++;
    queue = split(text);
    onDone = done || null;
    sp.speaking = true;
    next(token);
  };
  sp.stop = () => {
    token++;
    queue = [];
    const cb = onDone; onDone = null;
    if (sp.supported && (synth.speaking || synth.pending)) synth.cancel();
    if (sp.speaking) { sp.speaking = false; if (cb) cb(); }
  };
  window.addEventListener("hashchange", () => sp.stop());
})();
