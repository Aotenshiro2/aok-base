/**
 * LE RATTRAPAGE de la reprise de Skool (15/11/2026 soir, brief
 * D:\7_Agents\briefs\2026-11-15-academie-reprise-auto.md, point 4, go de Brice).
 *
 * Pour les comptes qui existent deja (ceux qui arrivent passent par /moi, qui
 * fait la meme chose a leur premiere connexion) :
 *   1. rattache les comptes a leur membre de Skool, avec la regle de /moi
 *      (src/lib/academie/reprise-pur.ts, deciderRattachements : l'email puis
 *      le nom, en recoupant le site et la fiche du cockpit, sans ambiguite
 *      dans les deux sens) ;
 *   2. pose les rattachements A LA MAIN de RATTACHEMENTS_A_LA_MAIN (mode
 *      equipe, auteur : le compte de Brice), seulement si l'automatique ne
 *      les a pas faits (un filet) ;
 *   3. pre-remplit TOUS les comptes rattaches, y compris ceux d'avant : chaque
 *      cours de Skool sur (un module, correspondance sure), les memes marques
 *      que le bouton, une ligne academie_reprises en mode auto par cours.
 *      Rejouable : un deuxieme passage n'ajoute rien.
 *
 * A BLANC PAR DEFAUT : lit la base et compte. --ecrire : UNE transaction
 * (rattachements, puis pre-remplissage relu dans la transaction).
 * Demande la migration 20261115200000 pour --ecrire (mode nom, mode auto).
 *
 * SORTIE : des nombres seulement (et les titres des cours de Skool, qui ne
 * sont pas des donnees de membre). Jamais un email, un nom ni un identifiant.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env --env-file=.env.local scripts/rattraper-reprise-skool.mjs [--ecrire]
 */

import { PrismaClient } from '@prisma/client'
import * as R from '../src/lib/academie/reprise-pur.ts'
import * as Q from '../src/lib/academie/requetes.ts'

const args = process.argv.slice(2)
const ECRIRE = args.includes('--ecrire')
const inconnus = args.filter(a => a !== '--ecrire')
if (inconnus.length) { console.error(`Arguments inconnus : ${inconnus.length}. Seul --ecrire est accepte.`); process.exit(2) }

const prisma = new PrismaClient()
const codeDe = e => String(e?.code ?? e?.meta?.code ?? e?.name ?? 'erreur')
const grouper = (liste, cle) => {
  const m = new Map()
  for (const x of liste) m.set(cle(x), [...(m.get(cle(x)) ?? []), x])
  return m
}
const compter = (liste, f) => liste.filter(f).length

async function lireCatalogue(c) {
  const [modules, sections, lecons] = [
    await c.$queryRawUnsafe(Q.SQL_MODULES_VISIBLES),
    await c.$queryRawUnsafe(Q.SQL_SECTIONS_VISIBLES),
    await c.$queryRawUnsafe(Q.SQL_LECONS_VISIBLES),
  ]
  return {
    modules: modules.map(m => ({ id: m.id, slug: m.slug, statut: m.statut, lienExterne: m.lien_externe ?? null })),
    sections: sections.map(s => ({ id: s.id, moduleId: s.module_id, ordre: Number(s.ordre), titre: s.titre })),
    lecons: lecons.map(l => ({ id: l.id, moduleId: l.module_id, sectionId: l.section_id, ordre: Number(l.ordre), titre: l.titre, statut: l.statut })),
  }
}

/** Les plans de pre-remplissage de tous les comptes, d'apres les rattachements donnes (membre -> compte). */
async function plans(c, rattachementDe, catalogue) {
  const releve = await c.$queryRawUnsafe(R.SQL_RELEVE_REMPLIS_TOUS)
  const verrous = grouper(await c.$queryRawUnsafe(R.SQL_VERROUS_TOUS), v => v.compte)
  const parCompte = new Map()
  for (const l of releve) {
    const compte = rattachementDe(l.membre)
    if (!compte) continue
    parCompte.set(compte, [...(parCompte.get(compte) ?? []), {
      skoolCoursId: l.cours, skoolCoursTitre: l.titre, leconsTerminees: Number(l.terminees), leconsTotal: Number(l.total), releveLe: l.le,
    }])
  }
  const sortie = new Map()
  for (const [compte, lignes] of parCompte) {
    const items = R.planRemplissage({ releve: lignes, catalogue, verrousFaits: (verrous.get(compte) ?? []).map(v => v.verrou) })
    sortie.set(compte, items)
  }
  return { sortie, comptesAvecReleve: parCompte.size }
}

try {
  const [{ n: comptesSite }] = await prisma.$queryRawUnsafe('select count(*)::int as n from public.profiles')
  const membres = await prisma.$queryRawUnsafe(
    'select skool_member_id as membre, profile_id::text as compte, rattache_mode as mode from public.academie_skool_membres')
  const avecHistorique = new Set((await prisma.$queryRawUnsafe(R.SQL_MEMBRES_AVEC_HISTORIQUE)).map(x => x.membre))
  const lienBase = new Map(membres.filter(m => m.compte).map(m => [m.membre, m.compte]))
  const comptesRelies = new Set(lienBase.values())

  // 1. Le rattachement automatique.
  const decision = R.deciderRattachements(R.lirePaires(await prisma.$queryRawUnsafe(R.SQL_PAIRES_RATTACHEMENT)))
  const auto = decision.rattachements
  const parSource = grouper(auto, r => `${r.mode}/${r.source}`)

  // 2. Les rattachements a la main : un filet.
  const planAuto = new Map(auto.map(r => [r.membre, r.compte]))
  const comptesAuto = new Set(auto.map(r => r.compte))
  const main = R.RATTACHEMENTS_A_LA_MAIN.map(x => {
    const lie = lienBase.get(x.membre) ?? planAuto.get(x.membre) ?? null
    if (lie === x.compte) return { ...x, etat: lienBase.has(x.membre) ? 'deja' : 'auto' }
    if (lie || comptesRelies.has(x.compte) || comptesAuto.has(x.compte)) return { ...x, etat: 'conflit' }
    if (!membres.some(m => m.membre === x.membre)) return { ...x, etat: 'absent' }
    return { ...x, etat: 'a_faire' }
  })
  const aFaire = main.filter(x => x.etat === 'a_faire')

  console.log(ECRIRE ? 'RATTRAPAGE (pour de vrai)' : 'RATTRAPAGE A BLANC (rien n\'est ecrit, --ecrire pour de vrai)')
  console.log('\nRattachement :')
  console.log(`  comptes du site                       ${comptesSite}`)
  console.log(`  deja rattaches (avant)                ${comptesRelies.size}`)
  console.log(`  pas encore rattaches                  ${comptesSite - comptesRelies.size}`)
  console.log(`  se rattachent automatiquement         ${auto.length} (par email ${compter(auto, r => r.mode === 'email')}, par nom ${compter(auto, r => r.mode === 'nom')})`)
  for (const [cle, l] of [...parSource].sort()) console.log(`    ${cle.padEnd(34)}  ${l.length}`)
  console.log(`    dont anciens avec historique        ${compter(auto, r => avecHistorique.has(r.membre))}`)
  console.log(`  refuses, laisses pour la main         ${decision.refus.length}`)
  console.log(`    ambigus : le compte retrouve plusieurs membres     ${compter(decision.refus, r => r.motif === 'ambigu_compte')}`)
  console.log(`    ambigus : le membre retrouve un autre compte       ${compter(decision.refus, r => r.motif === 'ambigu_membre')}`)
  console.log(`    le membre est deja rattache a un autre compte      ${compter(decision.refus, r => r.motif === 'membre_relie')}`)
  console.log(`    personne effacee                                   ${compter(decision.refus, r => r.motif === 'oublie')}`)
  console.log(`  nom porte par plusieurs membres       ${decision.nomsHomonymes} (comptes, pas rattaches)`)
  console.log(`  email prefere a un autre nom          ${decision.emailContreNom}`)
  console.log(`  a la main (filet)                     ${main.length} : deja ${compter(main, x => x.etat === 'deja')}, fait par l'automatique ${compter(main, x => x.etat === 'auto')}, a faire ${aFaire.length}, conflit ${compter(main, x => x.etat === 'conflit')}, membre absent ${compter(main, x => x.etat === 'absent')}`)

  // 3. Le pre-remplissage (d'apres les rattachements existants et prevus).
  const catalogue = await lireCatalogue(prisma)
  const lienPrevu = new Map([...lienBase, ...planAuto, ...aFaire.map(x => [x.membre, x.compte])])
  const { sortie, comptesAvecReleve } = await plans(prisma, m => lienPrevu.get(m) ?? null, catalogue)
  const comptes = [...sortie].filter(([, items]) => items.length > 0)
  const touchees = [...new Set(comptes.flatMap(([, items]) => items.flatMap(i => i.lecons)))]
  const existantes = touchees.length
    ? await prisma.$queryRawUnsafe(R.SQL_PROGRESSION_EXISTANTE, comptes.map(([c]) => c), touchees)
    : []
  const deja = new Set(existantes.map(x => `${x.compte}|${x.lecon}`))
  const parCours = new Map()
  let leconsNouvelles = 0
  let leconsVisees = 0
  for (const [compte, items] of comptes) {
    for (const it of items) {
      const nouvelles = it.lecons.filter(l => !deja.has(`${compte}|${l}`)).length
      leconsNouvelles += nouvelles
      leconsVisees += it.lecons.length
      for (const c of it.cours) {
        const s = parCours.get(c.titre) ?? { couples: 0, finis: 0, partiels: 0, visees: 0 }
        s.couples++
        if (c.fini) s.finis++
        else s.partiels++
        s.visees += c.visees
        parCours.set(c.titre, s)
      }
    }
  }
  console.log('\nPre-remplissage :')
  console.log(`  comptes rattaches avec un releve       ${comptesAvecReleve}`)
  console.log(`  comptes a remplir                      ${comptes.length}`)
  console.log(`  cours (ou parties) a remplir           ${comptes.reduce((n, [, items]) => n + items.length, 0)}`)
  console.log(`  lecons visees                          ${leconsVisees} (dont deja une ligne, laissees telles quelles : ${leconsVisees - leconsNouvelles})`)
  console.log(`  lecons qui seraient cochees            ${leconsNouvelles}`)
  console.log('  par cours de Skool (couples membre-cours, finis, partiels, lecons visees) :')
  for (const [titre, s] of [...parCours].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`    ${titre.slice(0, 38).padEnd(38)}  ${String(s.couples).padStart(4)} ${String(s.finis).padStart(4)} ${String(s.partiels).padStart(4)} ${String(s.visees).padStart(6)}`)
  }

  if (!ECRIRE) {
    console.log('\nA BLANC : rien n\'est ecrit (--ecrire pour de vrai, apres la migration 20261115200000).')
  } else {
    const bilan = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
      await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)
      let rattaches = 0
      for (const r of auto) {
        const fait = await tx.$queryRawUnsafe(R.SQL_RATTACHER_AUTO, r.compte, r.membre, r.mode, r.source)
        if (fait[0]) rattaches++
      }
      let aLaMain = 0
      for (const x of aFaire) {
        const fait = await tx.$queryRawUnsafe(R.SQL_RATTACHER_A_LA_MAIN, x.membre, x.compte, x.par)
        if (fait[0]) aLaMain++
      }
      // Le pre-remplissage, relu dans la transaction (les rattachements qui viennent d'etre poses compris).
      const liens = new Map((await tx.$queryRawUnsafe(
        'select skool_member_id as membre, profile_id::text as compte from public.academie_skool_membres where profile_id is not null'))
        .map(x => [x.membre, x.compte]))
      const { sortie: aEcrire } = await plans(tx, m => liens.get(m) ?? null, await lireCatalogue(tx))
      let cours = 0
      let lecons = 0
      for (const [compte, items] of aEcrire) {
        if (!items.length) continue
        const f = await R.ecrireRemplissage(tx, compte, items)
        cours += f.cours
        lecons += f.lecons
      }
      return { rattaches, aLaMain, cours, lecons }
    }, { timeout: 120_000, maxWait: 10_000 })
    console.log('\nECRIT :')
    console.log(`  rattaches automatiquement ${bilan.rattaches}, a la main ${bilan.aLaMain}`)
    console.log(`  cours (ou parties) remplis ${bilan.cours}, lecons cochees ${bilan.lecons}`)
  }
} catch (e) {
  console.error(`ARRET : ${codeDe(e)}${/42703|42P01|does not exist/i.test(String(e?.message ?? e)) ? ' (migration 20261115200000 a appliquer d\'abord ?)' : ''}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
