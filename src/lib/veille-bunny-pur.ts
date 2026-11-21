// VEILLE BUNNY, regles pures (21/11/2026). Le compte bunny.net (videos et PDF de
// l'academie) est prepaye : a zero, Bunny suspend le compte et les videos
// s'arretent. automations/collect_bunny.py pose chaque matin un releve dans
// cockpit_bunny_releves (solde, jours d'avance, alerte = jours d'avance sous
// seuil_jours, ou solde sous un plancher quand aucun rythme n'est calculable).
// Le passage quotidien (cron 7 h UTC) le lit et previent l'equipe par Agent AOK
// (alerterEquipeTexte). Deux messages, chacun au plus une fois par jour de Paris
// (trace cockpit_bunny_veille_envois, voir veille-bunny.ts) :
//   - 'alerte' : le releve frais (moins de AGE_MAX_RELEVE_H) est en alerte. Le
//     texte dit l'age du releve : apres une recharge, le releve d'hier peut
//     encore etre en alerte, on ne l'affirme pas comme l'etat du jour ;
//   - 'panne' : le suivi ne lit plus le solde (releve du jour sans solde :
//     facturation en panne, cle revoquee ; ou dernier releve de plus de
//     AGE_MAX_RELEVE_H : PC eteint, tache arretee). Seulement si un releve avec
//     solde a deja existe : pas de bruit tant que la cle n'a jamais ete posee.

export type ReleveVeilleBunny = {
  jour: string
  collecte_le: Date | string
  solde_usd: number | null
  jours_avance: number | null
  conso_jour_usd: number | null
  seuil_jours: number
  alerte: boolean | null
}

/** Le dernier releve qui avait un solde (pour « depuis quand » et « dernier solde connu »). */
export type DernierSoldeBunny = { collecte_le: Date | string; solde_usd: number }

export type MessageVeilleBunny = { type: 'alerte' | 'panne'; texte: string }

/** Un releve plus vieux que ca ne dit plus le solde du jour : message de panne, pas d'alerte. */
export const AGE_MAX_RELEVE_H = 30
/** Au-dela, le releve date d'hier : le texte previent qu'une recharge a pu passer depuis. */
export const AGE_RELEVE_D_HIER_H = 12

function dollars(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} $`
}

function heures(collecteLe: Date | string, maintenant: Date): number {
  return (maintenant.getTime() - new Date(collecteLe).getTime()) / 3_600_000
}

/** « il y a 3 h », « il y a 2 jours ». */
export function ageTexte(h: number): string {
  if (h < 1) return 'il y a moins d\'une heure'
  if (h < 36) return `il y a ${Math.round(h)} h`
  const j = Math.round(h / 24)
  return `il y a ${j} jour${j > 1 ? 's' : ''}`
}

/** « le 20/11 à 8 h 40 », heure de Paris. */
export function quandParis(d: Date | string): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(d))
  const p = (t: string) => parts.find(x => x.type === t)?.value ?? ''
  return `le ${p('day')}/${p('month')} à ${Number(p('hour'))} h ${p('minute')}`
}

/** Le jour de Paris (AAAA-MM-JJ) : la cle de la trace d'envoi. */
export function jourParis(maintenant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(maintenant)
}

/** Le texte d'alerte solde bas, ou null s'il n'y a rien a dire. */
export function texteAlerteBunny(r: ReleveVeilleBunny | null, maintenant: Date = new Date()): string | null {
  if (!r || r.alerte !== true || r.solde_usd === null) return null
  const age = heures(r.collecte_le, maintenant)
  if (!Number.isFinite(age) || age > AGE_MAX_RELEVE_H) return null
  const jours = r.jours_avance
  const avance = jours === null
    ? ''
    : jours < 1 ? ', moins d\'un jour d\'avance' : `, environ ${Math.floor(jours)} jour${Math.floor(jours) > 1 ? 's' : ''} d'avance`
  const rythme = r.conso_jour_usd !== null ? ` (conso ${dollars(r.conso_jour_usd)} par jour)` : ''
  const seuil = jours === null ? ', rythme inconnu mais solde bas' : `, sous le seuil de ${r.seuil_jours} jours`
  const hier = age >= AGE_RELEVE_D_HIER_H ? ' Si le compte a été rechargé depuis ce relevé, rien à faire.' : ''
  return `Bunny (relevé ${ageTexte(age)}) : solde ${dollars(r.solde_usd)}${avance}${rythme}${seuil}. `
    + 'À zéro, Bunny suspend le compte et les vidéos de l\'académie s\'arrêtent : recharger sur dash.bunny.net (Billing). '
    + `Détail dans le cockpit, Revenus > Santé.${hier}`
}

/** Le texte « le suivi ne lit plus le solde », ou null (suivi qui marche, ou cle jamais posee). */
export function textePanneBunny(
  r: ReleveVeilleBunny | null, dernierSolde: DernierSoldeBunny | null, maintenant: Date = new Date(),
): string | null {
  if (!dernierSolde) return null // jamais de solde lu : la cle n'a jamais ete posee, pas de bruit
  const ageReleve = r ? heures(r.collecte_le, maintenant) : Infinity
  const releveVieux = !Number.isFinite(ageReleve) || ageReleve > AGE_MAX_RELEVE_H
  if (!releveVieux && r && r.solde_usd !== null) return null
  const ageSolde = heures(dernierSolde.collecte_le, maintenant)
  const pourquoi = releveVieux
    ? `aucun relevé depuis ${ageTexte(ageReleve === Infinity ? ageSolde : ageReleve)} (PC éteint ou tâche AOK-Collecte-Bunny arrêtée)`
    : 'le relevé du jour n\'a pas de solde (facturation illisible ou clé du compte refusée, détail dans le cockpit)'
  return `Bunny : le suivi ne lit plus le solde depuis ${quandParis(dernierSolde.collecte_le)} (${ageTexte(ageSolde)}), `
    + `${pourquoi}. Dernier solde connu : ${dollars(dernierSolde.solde_usd)}. `
    + 'À vérifier sur dash.bunny.net (Billing) : à zéro, Bunny suspend le compte.'
}

/** Les messages du jour, dans l'ordre. Au plus un de chaque type ; la trace d'envoi est geree a part. */
export function messagesVeilleBunny(
  r: ReleveVeilleBunny | null, dernierSolde: DernierSoldeBunny | null, maintenant: Date = new Date(),
): MessageVeilleBunny[] {
  const out: MessageVeilleBunny[] = []
  const alerte = texteAlerteBunny(r, maintenant)
  if (alerte) out.push({ type: 'alerte', texte: alerte })
  const panne = textePanneBunny(r, dernierSolde, maintenant)
  if (panne) out.push({ type: 'panne', texte: panne })
  return out
}
