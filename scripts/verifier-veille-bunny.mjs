// Tests de la veille Bunny (src/lib/veille-bunny-pur.ts, 21/11/2026).
// node scripts/verifier-veille-bunny.mjs
import assert from 'node:assert/strict'
import {
  texteAlerteBunny, textePanneBunny, messagesVeilleBunny, jourParis, quandParis, AGE_MAX_RELEVE_H,
} from '../src/lib/veille-bunny-pur.ts'

const maintenant = new Date('2026-11-21T07:00:00Z')
const base = {
  jour: '2026-11-21', collecte_le: '2026-11-21T06:40:00Z', solde_usd: 1.28, jours_avance: 2.3,
  conso_jour_usd: 0.55, seuil_jours: 7, alerte: true,
}
const solde = { collecte_le: base.collecte_le, solde_usd: 1.28 }
const h = (n) => new Date(maintenant.getTime() - n * 3_600_000).toISOString()

// Le cas du 21/11 : 1,28 $, environ 2 jours, sous 7, releve frais.
const t = texteAlerteBunny(base, maintenant)
assert.ok(t)
assert.ok(t.startsWith('Bunny (relevé il y a moins d\'une heure) : solde 1,28 $, environ 2 jours d\'avance (conso 0,55 $ par jour), sous le seuil de 7 jours.'), t)
assert.ok(t.includes('Revenus > Santé'))
assert.ok(!t.includes('rechargé depuis'), 'releve frais : on ne parle pas de recharge')
for (const x of [t]) assert.ok(!x.includes('—'), 'jamais de tiret cadratin')

// Pas d'alerte, alerte inconnue, solde inconnu, pas de releve : pas d'alerte.
assert.equal(texteAlerteBunny({ ...base, alerte: false }, maintenant), null)
assert.equal(texteAlerteBunny({ ...base, alerte: null }, maintenant), null)
assert.equal(texteAlerteBunny({ ...base, solde_usd: null }, maintenant), null)
assert.equal(texteAlerteBunny(null, maintenant), null)

// (b) Releve d'hier encore en alerte (recharge faite, PC eteint ce matin) : l'age est dit, on n'affirme pas.
const hier = texteAlerteBunny({ ...base, collecte_le: h(23) }, maintenant)
assert.ok(hier.startsWith('Bunny (relevé il y a 23 h)'), hier)
assert.ok(hier.includes('Si le compte a été rechargé depuis ce relevé, rien à faire.'))

// Releve trop vieux : plus d'alerte, mais un message de panne.
const vieux = { ...base, collecte_le: h(AGE_MAX_RELEVE_H + 1) }
assert.equal(texteAlerteBunny(vieux, maintenant), null)
const p1 = textePanneBunny(vieux, { collecte_le: vieux.collecte_le, solde_usd: 1.28 }, maintenant)
assert.ok(p1 && p1.startsWith('Bunny : le suivi ne lit plus le solde depuis le 20/11 à 1 h 00 (il y a 31 h)'), p1)
assert.ok(p1.includes('aucun relevé depuis il y a 31 h (PC éteint') && p1.includes('Dernier solde connu : 1,28 $.'), p1)

// (a) Releve du jour sans solde (facturation en panne) alors qu'un solde a deja ete lu : panne.
const sansSolde = { ...base, solde_usd: null, jours_avance: null, alerte: null }
const p2 = textePanneBunny(sansSolde, { collecte_le: h(48), solde_usd: 1.83 }, maintenant)
assert.ok(p2 && p2.includes('depuis le 19/11 à 8 h 00 (il y a 2 jours)') && p2.includes('n\'a pas de solde'), p2)
// Jamais de solde lu (cle jamais posee) : pas de bruit.
assert.equal(textePanneBunny(sansSolde, null, maintenant), null)
assert.equal(textePanneBunny(null, null, maintenant), null)
// Suivi qui marche : pas de panne.
assert.equal(textePanneBunny(base, solde, maintenant), null)

// Messages du jour : alerte seule, panne seule, rien.
assert.deepEqual(messagesVeilleBunny(base, solde, maintenant).map(m => m.type), ['alerte'])
assert.deepEqual(messagesVeilleBunny(vieux, solde, maintenant).map(m => m.type), ['panne'])
assert.deepEqual(messagesVeilleBunny({ ...base, alerte: false }, solde, maintenant), [])
for (const m of [...messagesVeilleBunny(base, solde, maintenant), ...messagesVeilleBunny(vieux, solde, maintenant)]) {
  assert.ok(!m.texte.includes('—'), 'jamais de tiret cadratin')
}

// Moins d'un jour, un jour, jours inconnus (alerte par plancher de solde).
assert.ok(texteAlerteBunny({ ...base, jours_avance: 0.4 }, maintenant).includes('moins d\'un jour d\'avance'))
assert.ok(texteAlerteBunny({ ...base, jours_avance: 1.2 }, maintenant).includes('environ 1 jour d\'avance'))
assert.ok(texteAlerteBunny({ ...base, jours_avance: null, conso_jour_usd: null }, maintenant)
  .startsWith('Bunny (relevé il y a moins d\'une heure) : solde 1,28 $, rythme inconnu mais solde bas.'))

// Jour de Paris (cle de la trace d'envoi) et heure de Paris.
assert.equal(jourParis(new Date('2026-11-21T23:30:00Z')), '2026-11-22')
assert.equal(jourParis(maintenant), '2026-11-21')
assert.equal(quandParis('2026-07-01T06:05:00Z'), 'le 01/07 à 8 h 05')

console.log('veille-bunny : ok')
