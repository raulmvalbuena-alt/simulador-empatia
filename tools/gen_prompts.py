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
'''
out='\n'.join(l for l in out.split('\n') if not l.strip().startswith(('look:','tags:')) and '.look = ' not in l)
open(sys.argv[1],'w').write(out)
