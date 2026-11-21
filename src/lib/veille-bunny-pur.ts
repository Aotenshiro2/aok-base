// VEILLE BUNNY, regles pures (21/11/2026). Le compte bunny.net (videos et PDF de
// l'academie) est prepaye : a zero, Bunny suspend le compte et les videos
// s'arretent. automations/collect_bunny.py pose chaque matin un releve dans
// cockpit_bunny_releves (solde, jours d'avance, alerte = jours d'avance sous
// seuil_jours). Le passage quotidien (cron 7 h UTC) le lit et, s'il est en
// alerte, previent l'equipe par Agent AOK (alerterEquipeTexte). Une fois par
// passage, donc une fois par jour tant que le solde reste bas. Releve trop vieux
// (collecte qui n'a pas tourne) ou solde inconnu : rien n'est envoye.

export type ReleveVeilleBunny = {
  jour: string
  collecte_le: Date | string
  solde_usd: number | null
  jours_avance: number | null
  conso_jour_usd: number | null
  seuil_jours: number
  alerte: boolean | null
}

/** Un releve plus vieux que ca ne declenche rien : il ne dit plus le solde du jour. */
export const AGE_MAX_RELEVE_H = 30

function dollars(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} $`
}

/** Le texte a envoyer, ou null s'il n'y a rien a dire. */
export function texteAlerteBunny(r: ReleveVeilleBunny | null, maintenant: Date = new Date()): string | null {
  if (!r || r.alerte !== true || r.solde_usd === null) return null
  const age = (maintenant.getTime() - new Date(r.collecte_le).getTime()) / 3_600_000
  if (!Number.isFinite(age) || age > AGE_MAX_RELEVE_H) return null
  const jours = r.jours_avance
  const avance = jours === null
    ? ''
    : jours < 1 ? ', moins d\'un jour d\'avance' : `, environ ${Math.floor(jours)} jour${Math.floor(jours) > 1 ? 's' : ''} d'avance`
  const rythme = r.conso_jour_usd !== null ? ` (conso ${dollars(r.conso_jour_usd)} par jour)` : ''
  return `Bunny : solde ${dollars(r.solde_usd)}${avance}${rythme}, sous le seuil de ${r.seuil_jours} jours. `
    + 'À zéro, Bunny suspend le compte et les vidéos de l\'académie s\'arrêtent : recharger sur dash.bunny.net (Billing). '
    + 'Détail dans le cockpit, Revenus > Santé.'
}
