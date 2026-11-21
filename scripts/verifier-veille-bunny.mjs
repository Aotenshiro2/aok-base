// Tests de la veille Bunny (src/lib/veille-bunny-pur.ts, 21/11/2026).
// node scripts/verifier-veille-bunny.mjs
import assert from 'node:assert/strict'
import { texteAlerteBunny, AGE_MAX_RELEVE_H } from '../src/lib/veille-bunny-pur.ts'

const maintenant = new Date('2026-11-21T07:00:00Z')
const base = {
  jour: '2026-11-21', collecte_le: '2026-11-21T06:40:00Z', solde_usd: 1.44, jours_avance: 3.9,
  conso_jour_usd: 0.3676, seuil_jours: 7, alerte: true,
}

// Le cas du 21/11 : 1,44 $, environ 3 jours, sous 7.
const t = texteAlerteBunny(base, maintenant)
assert.ok(t)
assert.ok(t.startsWith('Bunny : solde 1,44 $, environ 3 jours d\'avance (conso 0,37 $ par jour), sous le seuil de 7 jours.'))
assert.ok(t.includes('Revenus > Santé'))
assert.ok(!t.includes('—'), 'jamais de tiret cadratin')

// Pas d'alerte, alerte inconnue, solde inconnu, pas de releve : rien.
assert.equal(texteAlerteBunny({ ...base, alerte: false }, maintenant), null)
assert.equal(texteAlerteBunny({ ...base, alerte: null }, maintenant), null)
assert.equal(texteAlerteBunny({ ...base, solde_usd: null }, maintenant), null)
assert.equal(texteAlerteBunny(null, maintenant), null)

// Releve trop vieux (collecte qui n'a pas tourne) : rien.
const vieux = new Date(maintenant.getTime() - (AGE_MAX_RELEVE_H + 1) * 3_600_000).toISOString()
assert.equal(texteAlerteBunny({ ...base, collecte_le: vieux }, maintenant), null)

// Moins d'un jour, un jour, jours inconnus.
assert.ok(texteAlerteBunny({ ...base, jours_avance: 0.4 }, maintenant).includes('moins d\'un jour d\'avance'))
assert.ok(texteAlerteBunny({ ...base, jours_avance: 1.2 }, maintenant).includes('environ 1 jour d\'avance'))
assert.ok(texteAlerteBunny({ ...base, jours_avance: null, conso_jour_usd: null }, maintenant).startsWith('Bunny : solde 1,44 $, sous le seuil'))

console.log('veille-bunny : ok')
