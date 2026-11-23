// Prueba V2: la respuesta del personaje (Claude) y su voz (OpenAI) son las de la app;
// Simli solo pone la cara: recibe el audio del personaje y devuelve vídeo con los labios sincronizados.
import { SimliClient, LogLevel } from "./vendor/simli-client.js";

const SB_URL = "https://gkdayvzuvkygttvptuit.supabase.co";
const SB_KEY = "sb_publishable_Ffx9CfPiWedqOenXfXwCiA_ra6DXvT3";
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true } });
const $ = id => document.getElementById(id);

const CASE = { id: "box", name: "Javier", age: 52, emocion: "enfado", voice: "ash" };
const OPENING = "¡Por fin alguien! Seis horas. ¡Seis! Mi madre tiene 88 años y nadie nos dice nada. ¿A esto le llamáis urgencias?";
let simliWarn = () => {};
let role = "Médico adjunto", emotion = 7, turns = [], simli = null, busy = false, turnT0 = 0, marks = {};

async function fnFetch(name, body, signal) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw { message: "Tu sesión ha caducado. Entra de nuevo en la app." };
  const isForm = body instanceof FormData;
  return fetch(`${SB_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: SB_KEY, ...(isForm ? {} : { "Content-Type": "application/json" }) },
    body: isForm ? body : JSON.stringify(body), signal
  });
}
async function fnJSON(name, body) {
  const r = await fnFetch(name, body);
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw { message: (d.error || "Error del servidor") + (d.detail ? ` (${d.detail})` : "") };
  return d;
}
const say = t => { $("status").textContent = t; };
const fail = e => { $("err").textContent = (e && e.message) || String(e); };
const secs = ms => (ms / 1000).toFixed(1).replace(".", ",") + " s";

/* ---- Voz → cara: el audio de OpenAI llega a 24 kHz y Simli lo pide a 16 kHz ---- */
function makeResampler() {
  let buf = new Float32Array(0), pos = 0;
  return int16 => {
    const nb = new Float32Array(buf.length + int16.length);
    nb.set(buf); nb.set(int16, buf.length); buf = nb;
    const out = [];
    while (pos + 1 < buf.length) { const i = Math.floor(pos), f = pos - i; out.push(buf[i] * (1 - f) + buf[i + 1] * f); pos += 1.5; }
    const drop = Math.floor(pos); buf = buf.slice(drop); pos -= drop;
    const bytes = new Uint8Array(out.length * 2), dv = new DataView(bytes.buffer);
    out.forEach((v, k) => dv.setInt16(k * 2, Math.max(-32768, Math.min(32767, Math.round(v))), true));
    return bytes;
  };
}
// Cola de frases: cada frase se pide a la voz en cuanto está escrita; se envían a la cara en orden.
function makeQueue() {
  const items = [], ctl = new AbortController();
  let cur = 0, out = new Uint8Array(0), cancelled = false;
  const send = (force) => {
    while (out.length >= 6000 || (force && out.length)) {
      const n = Math.min(6000, out.length) & ~1;
      if (!n) break;
      if (!marks.firstAudio) { marks.firstAudio = performance.now(); showTimes(); }
      simli && simli.sendAudioData(out.slice(0, n));
      out = out.slice(n);
    }
  };
  const pump = () => {
    if (cancelled) return;
    while (cur < items.length) {
      const it = items[cur];
      while (it.chunks.length) {
        let b = it.chunks.shift();
        if (it.left) { const m = new Uint8Array(1 + b.length); m[0] = it.left[0]; m.set(b, 1); b = m; it.left = null; }
        if (b.length % 2) { it.left = b.slice(-1); b = b.slice(0, -1); }
        const pcm = it.rs(new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)));
        const m = new Uint8Array(out.length + pcm.length); m.set(out); m.set(pcm, out.length); out = m;
        send(false);
      }
      if (!it.done) break;
      send(true); cur++;
    }
  };
  return {
    push(text) {
      const it = { chunks: [], done: false, left: null, rs: makeResampler() };
      items.push(it);
      (async () => {
        try {
          const instructions = `Eres ${CASE.name}, de ${CASE.age} años. Habla en castellano de España, con naturalidad, como una persona real en un servicio de Urgencias, no como un locutor. Emoción: ${CASE.emocion}, intensidad ${emotion} de 10. Que se note la emoción en el tono, el ritmo y las pausas, sin exagerar.`;
          const r = await fnFetch("tts", { text, voice: CASE.voice, instructions, format: "pcm" }, ctl.signal);
          if (!r.ok || !r.body) throw new Error("voz " + r.status);
          const rd = r.body.getReader();
          while (true) { const { value, done } = await rd.read(); if (done || cancelled) break; it.chunks.push(value); pump(); }
        } catch (e) { if (!cancelled) fail({ message: "Fallo en la voz: " + (e.message || e) }); }
        it.done = true; pump();
      })();
    },
    cancel() { cancelled = true; ctl.abort(); }
  };
}
let queue = null;

/* ---- Respuesta del personaje en directo (igual que en la app) ---- */
function partialReply(t) {
  const m = /"respuesta"\s*:\s*"/.exec(t);
  if (!m) return null;
  let i = m.index + m[0].length, out = "", closed = false;
  while (i < t.length) {
    const ch = t[i];
    if (ch === "\\") { if (i + 1 >= t.length) break; const n = t[i + 1]; if (n === "u") { if (i + 6 > t.length) break; out += String.fromCharCode(parseInt(t.slice(i + 2, i + 6), 16)); i += 6; continue; } out += ({ n: " ", t: " ", r: "", b: "", f: "" })[n] ?? n; i += 2; continue; }
    if (ch === '"') { closed = true; break; }
    out += ch; i++;
  }
  return { text: out, closed };
}
function feed(q, s, closed, sent) {
  while (true) {
    const rest = s.slice(sent), re = /[.!?…]+[»"”)]*\s+/g;
    let cut = -1, mm;
    while ((mm = re.exec(rest))) { if (mm.index + mm[0].length >= 14) { cut = mm.index + mm[0].length; break; } }
    if (cut < 0) break;
    q.push(rest.slice(0, cut).trim()); sent += cut;
    if (!marks.firstSentence) { marks.firstSentence = performance.now(); showTimes(); }
  }
  if (closed && sent < s.length) { const r = s.slice(sent).trim(); if (r) { q.push(r); if (!marks.firstSentence) { marks.firstSentence = performance.now(); showTimes(); } } sent = s.length; }
  return sent;
}
function showTimes() {
  if (!turnT0) return;
  const p = [];
  if (marks.firstSentence) p.push(`Primera frase escrita: <b>${secs(marks.firstSentence - turnT0)}</b>`);
  if (marks.firstAudio) p.push(`Primer audio a la cara: <b>${secs(marks.firstAudio - turnT0)}</b>`);
  if (marks.speaking) p.push(`La cara empieza a hablar: <b>${secs(marks.speaking - turnT0)}</b>`);
  $("times").innerHTML = p.join("<br>") || "Esperando respuesta…";
}

async function patientTurn() {
  queue = makeQueue();
  const ctx = { case_id: CASE.id, level: 2, lang: "es", role, emotion, turns: turns.map(t => ({ who: t.who, text: t.text })) };
  const r = await fnFetch("llm", { step: "patient", ctx, provider: "anthropic", stream: true });
  let text = "", sent = 0;
  const ct = r.headers.get("content-type") || "";
  if (!r.ok || ct.includes("application/json")) {
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok) throw { message: d.error || "Error del servidor" };
    text = d.text || "";
  } else {
    const rd = r.body.getReader(), dec = new TextDecoder();
    while (true) {
      const { value, done } = await rd.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      const pr = partialReply(text);
      if (pr) { sent = feed(queue, pr.text, pr.closed, sent); $("caption").textContent = "«" + pr.text + "»"; }
    }
  }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  const j = JSON.parse(text.slice(a, b + 1));
  const full = String(j.respuesta || "").trim();
  if (sent === 0 && full) feed(queue, full, true, 0);
  else if (sent < full.length) { const rest = full.slice(sent).trim(); if (rest) queue.push(rest); }
  $("caption").textContent = "«" + full + "»";
  emotion = Math.max(0, Math.min(10, Math.round(Number(j.intensidad) || emotion)));
  $("ring").textContent = `Emoción ${emotion}/10`;
  turns.push({ who: "patient", text: full });
  if (j.fin) say("Javier da la conversación por terminada.");
}

async function send(text) {
  text = String(text || "").trim();
  if (!text || busy || !simli) return;
  busy = true; $("send").disabled = true; $("err").textContent = "";
  if (queue) queue.cancel();
  try { simli.ClearBuffer(); } catch (e) {}
  turns.push({ who: "pro", text });
  $("mine").textContent = "Tú: " + text; $("input").value = "";
  turnT0 = performance.now(); marks = {}; showTimes();
  say("Javier está pensando…");
  try { await patientTurn(); say("Tu turno"); }
  catch (e) { fail(e); say("Algo ha fallado. Prueba otra vez."); turns.pop(); }
  finally { busy = false; $("send").disabled = false; }
}

/* ---- Micrófono: se graba y se transcribe en el servidor, como en la app ---- */
let rec = null, recStart = 0, stream = null;
async function toggleMic() {
  if (rec && rec.state === "recording") { rec.stop(); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { fail({ message: "No hay permiso para el micrófono." }); return; }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  const chunks = [];
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    $("mic").classList.remove("rec");
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    const fd = new FormData();
    fd.append("file", blob, "voz." + (/mp4/.test(blob.type) ? "mp4" : "webm"));
    fd.append("lang", "es"); fd.append("secs", String(Math.round((Date.now() - recStart) / 1000)));
    say("Transcribiendo…");
    try { const d = await fnJSON("stt", fd); if (d.text) send(d.text); else say("No te he oído."); }
    catch (e) { fail(e); say("No se ha podido transcribir."); }
  };
  if (queue) queue.cancel();
  try { simli && simli.ClearBuffer(); } catch (e) {}
  recStart = Date.now(); rec.start();
  $("mic").classList.add("rec"); say("Te escucho… pulsa otra vez para enviar");
}

async function connect() {
  $("connect").disabled = true; $("err").textContent = ""; say("Conectando con la cara…");
  try { $("audio").play().catch(() => {}); } catch (e) {}
  try {
    const faceId = $("face").value.trim();
    const { session_token } = await fnJSON("simli", faceId ? { faceId } : {});
    simli = new SimliClient(session_token, $("video"), $("audio"), null, LogLevel.ERROR);
    simli.on("error", m => { fail({ message: "Simli: " + m }); });
    simli.on("warning", m => simliWarn(m));
    simli.on("stop", () => { say("La sesión de la cara ha terminado."); disconnect(true); });
    simli.on("speaking", () => { if (turnT0 && !marks.speaking) { marks.speaking = performance.now(); showTimes(); } say("Javier está hablando…"); });
    simli.on("silent", () => { if (!busy) say("Tu turno"); });
    await simli.start();
    applyCamera(0);
    $("ph").style.display = "none";
    ["input", "send", "mic", "hang"].forEach(id => $(id).disabled = false);
    say("Conectado");
    turns = [{ who: "patient", text: OPENING }]; emotion = 7; $("ring").textContent = "Emoción 7/10";
    $("caption").textContent = "«" + OPENING + "»";
    turnT0 = performance.now(); marks = {};
    queue = makeQueue(); queue.push(OPENING);
  } catch (e) { fail(e.message ? e : { message: String(e) }); say("No se ha podido conectar."); $("connect").disabled = false; simli = null; }
}
async function disconnect(already) {
  if (queue) queue.cancel();
  const s = simli; simli = null;
  if (s && !already) { try { await s.stop(); } catch (e) {} }
  ["input", "send", "mic", "hang"].forEach(id => $(id).disabled = true);
  $("connect").disabled = false; $("ph").style.display = "";
  if (!already) say("Colgado. Puedes volver a conectar.");
}

/* Encuadre de la cara: se cambia en directo y se recuerda en este dispositivo */
const CAM_KEY = "pruebaCaraCam";
try { const c = JSON.parse(localStorage.getItem(CAM_KEY) || "null"); if (c) { $("zoom").value = c.zoom; $("px").value = c.px; $("py").value = c.py; } } catch (e) {}
function applyCamera(lerp = 0.25) {
  const c = { zoom: Number($("zoom").value), px: Number($("px").value), py: Number($("py").value) };
  try { localStorage.setItem(CAM_KEY, JSON.stringify(c)); } catch (e) {}
  if (!simli || typeof simli.setCamera !== "function") return;
  try { simli.setCamera({ zoom: c.zoom, pos_x_off: c.px, pos_y_off: c.py }, { lerpSeconds: lerp }); } catch (e) { fail({ message: "No se ha podido mover la cara: " + (e.message || e) }); }
}
["zoom", "px", "py"].forEach(id => $(id).addEventListener("input", () => applyCamera()));
simliWarn = m => { if (/WARNING/i.test(m)) console.warn(m); };

$("connect").onclick = connect;
$("hang").onclick = () => disconnect(false);
$("send").onclick = () => send($("input").value);
$("input").addEventListener("keydown", e => { if (e.key === "Enter") send($("input").value); });
$("mic").onclick = toggleMic;
window.addEventListener("pagehide", () => { if (simli) try { simli.stop(); } catch (e) {} });

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { say("Primero entra en la app con tu cuenta y luego vuelve a esta página."); return; }
  const { data: p } = await sb.from("profiles").select("role_label, is_admin").eq("id", session.user.id).maybeSingle();
  if (!p?.is_admin) { say("Esta prueba es solo para Docencia."); return; }
  if (p.role_label) role = p.role_label;
  say("Listo para conectar");
  $("connect").disabled = false;
})();
