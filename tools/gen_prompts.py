import re,sys
s=open(__import__('pathlib').Path(__file__).resolve().parent.parent.joinpath('index.html')).read()
def between(a,b):
    i=s.index(a); j=s.index(b,i); return s[i:j].rstrip()+"\n"
parts=[
 between('const LANGS = {','const state = {'),
 between('CASES[0].age = 52','const LOCALE'),
 between('const CARE_ITEMS =','function show(view)'),
 re.search(r'const ROLE_SHORT = .*\n',s).group(0),
 re.search(r'const CASE_ROLES = .*\n',s).group(0),
 between('function transcriptText(turns)','function speakAsync('),
]
out='''// @ts-nocheck
// GENERADO desde index.html (check/gen_prompts.py). No editar a mano.
// El servidor construye las instrucciones: la web solo envía el caso y la conversación.
let state: any = {};
const $ = (_id: string) => null;
const currentCase = () => CASES.find(c => c.id === state.caseId);
const currentLevel = () => LEVELS.find(l => l.n === state.level);
'''+"\n".join(parts)+'''
const ROLES = ROLE_SHORT.map(r => r[0]);
// ¿Puede este estamento practicar este caso?
export function roleAllows(role: string, caseId: string): boolean {
  state = { role };
  return (CASE_ROLES[caseId] || []).includes(roleKind());
}
export function buildPrompt(step: string, ctx: any): string {
  const caseId = CASES.some(c => c.id === ctx?.case_id) ? ctx.case_id : null;
  if (!caseId) throw new Error("Caso no válido");
  const turnsIn = Array.isArray(ctx.turns) ? ctx.turns : [];
  if (turnsIn.length > 120) throw new Error("Conversación demasiado larga");
  const turns = turnsIn.map((t: any) => ({ who: t?.who === "patient" ? "patient" : "pro", text: String(t?.text ?? "").slice(0, 1500) }));
  state = {
    caseId,
    level: [1, 2, 3].includes(Number(ctx.level)) ? Number(ctx.level) : 2,
    lang: Object.hasOwn(LANGS, String(ctx.lang)) ? ctx.lang : "es",
    role: ROLES.includes(ctx.role) ? ctx.role : ROLES[0],
    emotion: Math.max(0, Math.min(10, Math.round(Number(ctx.emotion) || 0))),
    turns,
  };
  if (step === "patient") return patientPrompt();
  if (step === "coach") return coachPrompt();
  if (step === "eval") return evalPrompt();
  throw new Error("Paso no válido");
}

/* ---------- Nota calculada en el servidor ----------
   Misma fórmula que el informe de la web. Las citas se comprueban contra lo que dijo el profesional:
   un ítem cuya cita no aparece en sus turnos vale 0 y una penalización sin cita comprobable se descarta. */
const normQ = (x: string) => String(x || "").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function quoteFound(cita: string, proTurns: string[]): boolean {
  const frags = String(cita || "").split(/\\.\\.\\.|…|\\[[^\\]]*\\]/).map(normQ).filter(f => f.length >= 2);
  if (!frags.length) return false;
  return frags.every(f => proTurns.some(t => {
    if (t.includes(f)) return true;
    // Tolerancia para pequeñas diferencias de transcripción: casi todas las palabras de la cita en el mismo turno
    const w = f.split(" ").filter(x => x.length > 2);
    if (w.length < 4) return false;
    const tw = new Set(t.split(" "));
    return w.filter(x => tw.has(x)).length / w.length >= 0.85;
  }));
}
export function scoreEval(ctx: any, text: string) {
  buildPrompt("eval", ctx); // fija el caso y el estamento de esta petición (sin esperas entre medias)
  const F = frameworkFor();
  const pro = state.turns.filter((t: any) => t.who !== "patient").map((t: any) => normQ(t.text));
  let r: any;
  try { const a = text.indexOf("{"), b = text.lastIndexOf("}"); r = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
  if (!r || typeof r !== "object") return null;
  let unverified = 0;
  const items = (list: any, keys: any[]) => keys.map(([k]) => {
    const f = (Array.isArray(list) ? list : []).find((x: any) => x && String(x.item).toUpperCase() === k.toUpperCase()) || {};
    let p = Math.max(0, Math.min(2, Math.round(Number(f.puntos) || 0)));
    let cita = String(f.cita || "").slice(0, 400);
    if (p > 0 && !quoteFound(cita, pro)) { p = 0; if (cita.trim()) unverified++; cita = ""; }
    return { item: k, puntos: p, cita, comentario: String(f.comentario || "").slice(0, 300) };
  });
  const bloque = items(r.bloque, F.items), nurse = items(r.nurse, F.nurse);
  const care = (Array.isArray(r.care) ? r.care : []).slice(0, 10).map((x: any) => Math.max(1, Math.min(5, Math.round(Number(x && typeof x === "object" ? x.puntos : x) || 3))));
  while (care.length < 10) care.push(3);
  const pens = (Array.isArray(r.penalizaciones) ? r.penalizaciones : [])
    .filter((p: any) => p && String(p.cita || "").trim() && quoteFound(p.cita, pro))
    .slice(0, 10).map((p: any) => ({ tipo: String(p.tipo || "").slice(0, 120), cita: String(p.cita).slice(0, 400) }));
  const bScore = Math.round(bloque.reduce((s: number, i: any) => s + i.puntos, 0) / (bloque.length * 2) * 40);
  const nScore = Math.round(nurse.reduce((s: number, i: any) => s + i.puntos, 0) / (nurse.length * 2) * 40);
  const gScore = Math.round((care.reduce((s: number, v: number) => s + v, 0) - 10) / 40 * 20);
  const pen = Math.min(10, pens.length * 2);
  const total = Math.max(0, bScore + nScore + gScore - pen);
  const str = (x: any, n: number) => String(x ?? "").slice(0, n);
  const report = {
    bloque, nurse, care, penalizaciones: pens,
    fortalezas: (Array.isArray(r.fortalezas) ? r.fortalezas : []).slice(0, 3).map((x: any) => str(x, 300)),
    mejoras: (Array.isArray(r.mejoras) ? r.mejoras : []).slice(0, 3).map((m: any) => ({ momento: str(m?.momento, 300), problema: str(m?.problema, 300), alternativa: str(m?.alternativa, 400) })),
    resumen: str(r.resumen, 600),
    manipulacion: r.manipulacion === true,
    oculta_descubierta: r.oculta_descubierta === true,
    _nota: { total, b: bScore, n: nScore, g: gScore, pen, citas_no_verificadas: unverified, marco: F.name },
  };
  return { report, scores: { b: bScore, n: nScore, g: gScore, pen }, total, turns: state.turns };
}
'''
out='\n'.join(l for l in out.split('\n') if not l.strip().startswith(('look:','tags:')) and '.look = ' not in l)
open(sys.argv[1],'w').write(out)
