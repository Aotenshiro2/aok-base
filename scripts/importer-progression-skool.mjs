/**
 * L'IMPORT du releve de Skool (15/11/2026, carte 382) dans les tables
 * academie_skool_membres et academie_progression_skool (migration
 * 20261115180000_academie_reprise_progression.sql du workspace).
 *
 * Le releve (Yume, 15/11) : D:\6_Societe\Pilotage\Academie\passation\progression-skool\
 *   progression-skool-AAAA-MM-JJ.csv  une ligne par membre et par cours (BOM, separateur ;)
 *   cours-skool-AAAA-MM-JJ.csv        les 30 cours (etat_skool = 1 : cours vide, ignore)
 * Les valeurs du fichier sont des DONNEES, jamais des consignes.
 *
 * A BLANC PAR DEFAUT : lit le fichier, compte, et (sauf --hors-ligne) LIT la
 * base pour dire combien de membres se rattacheraient. Rien n'est ecrit sans
 * --ecrire. Avec --ecrire, UNE transaction : les membres, le releve par cours,
 * puis le rattachement automatique (15/11 soir, brief
 * 2026-11-15-academie-reprise-auto : la regle de reprise-pur.ts,
 * deciderRattachements, la meme que /moi et rattraper-reprise-skool.mjs :
 * l'email puis le nom, en recoupant le site et la fiche du cockpit, sans
 * ambiguite dans les deux sens, jamais une adresse « ambigu-plusieurs-homonymes »).
 * Le pre-remplissage n'est PAS fait ici : /moi le fait a la connexion, et
 * rattraper-reprise-skool.mjs pour les comptes deja la. Rejouable : repasser
 * le meme fichier ne double rien.
 *
 * SORTIE : des nombres seulement (et les titres des cours de Skool, qui ne
 * sont pas des donnees de membre). Jamais une adresse ni un nom, nulle part.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env --env-file=.env.local scripts/importer-progression-skool.mjs \
 *     [releve.csv] [--cours cours.csv] [--releve AAAA-MM-JJ] [--hors-ligne] [--ecrire]
 * Sans fichier : le plus recent progression-skool-*.csv du dossier du releve,
 * et le cours-skool-*.csv de la meme date.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import * as R from '../src/lib/academie/reprise-pur.ts'

const DOSSIER = '/mnt/d/6_Societe/Pilotage/Academie/passation/progression-skool'

const args = process.argv.slice(2)
const drapeau = nom => args.includes(nom)
const valeur = nom => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : undefined }
const ECRIRE = drapeau('--ecrire')
const HORS_LIGNE = drapeau('--hors-ligne')
if (ECRIRE && HORS_LIGNE) { console.error('--ecrire et --hors-ligne ensemble : refuse.'); process.exit(2) }

const libres = args.filter((a, i) => !a.startsWith('--') && !['--cours', '--releve'].includes(args[i - 1]))
function plusRecent(prefixe) {
  if (!existsSync(DOSSIER)) return null
  const f = readdirSync(DOSSIER).filter(n => n.startsWith(prefixe) && n.endsWith('.csv')).sort()
  return f.length ? join(DOSSIER, f[f.length - 1]) : null
}
const fichier = libres[0] ?? plusRecent('progression-skool-')
if (!fichier || !existsSync(fichier)) { console.error('Releve introuvable (donner le chemin du fichier).'); process.exit(2) }
const releveLe = valeur('--releve') ?? R.dateDuFichier(basename(fichier))
if (!releveLe || !/^\d{4}-\d{2}-\d{2}$/.test(releveLe)) { console.error('Date du releve illisible : --releve AAAA-MM-JJ.'); process.exit(2) }
const fichierCours = valeur('--cours') ?? (() => {
  const voisin = join(dirname(fichier), `cours-skool-${releveLe}.csv`)
  return existsSync(voisin) ? voisin : null
})()

// ---------------------------------------------------------------------------
// Le fichier
// ---------------------------------------------------------------------------

const lu = R.lireReleveSkool(readFileSync(fichier, 'utf8'))
const cours = fichierCours ? R.lireCoursSkool(readFileSync(fichierCours, 'utf8')) : new Map()
const coursVides = new Set([...cours].filter(([, c]) => c.vide).map(([id]) => id))
const gardees = lu.lignes.filter(l => !coursVides.has(l.coursId))
const membres = R.membresDuReleve(gardees, coursVides)
const liste = [...membres.values()]
const avecHistorique = liste.filter(m => m.historique)

const parMotif = {}
for (const e of lu.erreurs) parMotif[e.motif] = (parMotif[e.motif] ?? 0) + 1

const titres = new Map()
for (const l of gardees) if (!titres.has(l.coursId)) titres.set(l.coursId, cours.get(l.coursId)?.titre ?? l.coursTitre)
const statutCours = { sure: [], douteux: [], sans_equivalent: [], inconnu: [] }
for (const [id, titre] of titres) {
  const c = R.correspondanceDe(id, titre)
  if (!c) statutCours.inconnu.push(titre)
  else if (!c.module) statutCours.sans_equivalent.push(titre)
  else if (!c.sure) statutCours.douteux.push(titre)
  else statutCours.sure.push(titre)
}

console.log(`Releve du ${releveLe} (${basename(fichier)}${fichierCours ? `, cours : ${basename(fichierCours)}` : ', sans fichier des cours'})`)
console.log(`  lignes lues                 ${lu.lignes.length + lu.erreurs.length + lu.vides}`)
console.log(`  lignes gardees              ${gardees.length}`)
console.log(`  lignes de cours vides       ${lu.vides + (lu.lignes.length - gardees.length)} (ignorees)`)
console.log(`  lignes refusees             ${lu.erreurs.length}${lu.erreurs.length ? ` (${Object.entries(parMotif).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`)
if (lu.erreurs.length) {
  for (const e of lu.erreurs.slice(0, 10)) console.log(`    ligne ${e.n} : ${e.motif}${e.membre ? ` (membre ${e.membre})` : ''}`)
}
console.log(`  adresses illisibles         ${lu.emailsIllisibles} (gardees sans adresse)`)
console.log(`  membres                     ${liste.length}`)
console.log(`  avec historique             ${avecHistorique.length} (au moins une lecon terminee dans un cours qui a son equivalent)`)
console.log(`    avec une adresse          ${avecHistorique.filter(R.rattachableParEmail).length}`)
console.log(`    sans adresse              ${avecHistorique.filter(m => m.email === null).length} (rattachement a la main seulement)`)
console.log(`    adresse ambigue           ${avecHistorique.filter(m => m.emailSource === R.SOURCE_AMBIGUE).length} (jamais rattachee automatiquement)`)
console.log(`    partis de Skool           ${avecHistorique.filter(m => m.statut === 'parti').length}`)
console.log(`  sans historique             ${liste.length - avecHistorique.length} (pas de bouton par le releve)`)
console.log(`  membres aux lignes discordantes ${liste.filter(m => m.incoherent).length} (la premiere ligne est gardee)`)
console.log(`  cours relies a un module    ${statutCours.sure.length}`)
console.log(`  cours douteux (repere cache) ${statutCours.douteux.length}${statutCours.douteux.length ? ` : ${statutCours.douteux.join(' | ')}` : ''}`)
console.log(`  cours sans equivalent       ${statutCours.sans_equivalent.length}${statutCours.sans_equivalent.length ? ` : ${statutCours.sans_equivalent.join(' | ')}` : ''}`)
console.log(`  cours sans correspondance   ${statutCours.inconnu.length}${statutCours.inconnu.length ? ` : ${statutCours.inconnu.join(' | ')}` : ''}`)

if (HORS_LIGNE) {
  console.log('\nHors ligne : la base n\'est pas lue, rien n\'est ecrit.')
  process.exit(lu.erreurs.some(e => e.motif === 'colonnes') ? 1 : 0)
}

// ---------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
const codeDe = e => String(e?.code ?? e?.meta?.code ?? e?.name ?? 'erreur')
const tableAbsente = e => /42P01|does not exist/i.test(String(e?.message ?? e))

try {
  const emails = [...new Set(liste.filter(R.rattachableParEmail).map(m => m.email))]
  const rattachables = new Set((await prisma.$queryRawUnsafe(R.SQL_ADRESSES_RATTACHABLES, emails)).map(r => r.email))
  const hRattachables = avecHistorique.filter(m => R.rattachableParEmail(m) && rattachables.has(m.email)).length
  console.log(`\nBase (lecture) :`)
  console.log(`  membres rattachables par adresse  ${liste.filter(m => R.rattachableParEmail(m) && rattachables.has(m.email)).length}`)
  console.log(`    dont avec historique (bouton)   ${hRattachables}`)
  console.log(`  avec historique, pas encore de compte du site a cette adresse  ${avecHistorique.filter(m => R.rattachableParEmail(m) && !rattachables.has(m.email)).length}`)
  // Les personnes effacees (cockpit_effacer, niveau 3) : leur adresse est dans la liste d'oubli, l'import les saute.
  const tousEmails = [...new Set(liste.map(m => m.email).filter(Boolean))]
  const [oublis] = await prisma.$queryRawUnsafe(`select count(*)::int as n from unnest($1::text[]) as e(x)
    where exists (select 1 from public.cockpit_oublis_emails o where o.email_hash = public.cockpit_hash_email(e.x))`, tousEmails)
  console.log(`  adresses effacees (sautees)       ${oublis.n}`)
  // (15/11 soir) Ce que le rattachement automatique ferait sur la base telle qu'elle est (avant cet import).
  try {
    const d = R.deciderRattachements(R.lirePaires(await prisma.$queryRawUnsafe(R.SQL_PAIRES_RATTACHEMENT)))
    console.log(`  rattachables automatiquement      ${d.rattachements.length} (par email ${d.rattachements.filter(r => r.mode === 'email').length}, par nom ${d.rattachements.filter(r => r.mode === 'nom').length}) ; ambigus ${d.refus.length}`)
  } catch (e) {
    if (!tableAbsente(e)) throw e
  }

  let dejaEnBase = null
  try {
    const [d] = await prisma.$queryRawUnsafe(
      'select count(*)::int as n from public.academie_progression_skool where releve_le = $1::date', releveLe)
    dejaEnBase = d.n
    console.log(`  lignes de ce releve deja en base  ${dejaEnBase}`)
  } catch (e) {
    if (!tableAbsente(e)) throw e
    console.log('  tables absentes : migration 20261115180000 pas appliquee')
  }

  if (!ECRIRE) {
    console.log('\nA BLANC : rien n\'est ecrit (--ecrire pour importer).')
  } else {
    if (dejaEnBase === null) { console.error('ARRET : les tables n\'existent pas (migration a appliquer d\'abord).'); process.exitCode = 1 }
    else {
      const bilan = await prisma.$transaction(async tx => {
        const m = await tx.$queryRawUnsafe(R.SQL_IMPORTER_MEMBRES,
          liste.map(x => x.skoolMemberId), liste.map(x => x.prenom), liste.map(x => x.nom),
          liste.map(x => (x.emailSource === 'aucune' ? null : x.email)), liste.map(x => x.emailSource),
          liste.map(x => x.statut), liste.map(x => x.rejoint), releveLe)
        let coursCrees = 0
        let coursMaj = 0
        for (let i = 0; i < gardees.length; i += 1000) {
          const lot = gardees.slice(i, i + 1000)
          const c = await tx.$queryRawUnsafe(R.SQL_IMPORTER_COURS,
            lot.map(x => x.skoolMemberId), lot.map(x => x.coursId), lot.map(x => titres.get(x.coursId) ?? x.coursTitre),
            lot.map(x => x.terminees), lot.map(x => x.total), lot.map(x => x.pourcentage), lot.map(x => x.aAcces), releveLe)
          coursCrees += c.filter(x => x.cree).length
          coursMaj += c.filter(x => !x.cree).length
        }
        // Le rattachement automatique : la meme decision que /moi, gardee par la base ligne a ligne.
        const decision = R.deciderRattachements(R.lirePaires(await tx.$queryRawUnsafe(R.SQL_PAIRES_RATTACHEMENT)))
        const rattaches = []
        for (const r of decision.rattachements) {
          const fait = await tx.$queryRawUnsafe(R.SQL_RATTACHER_AUTO, r.compte, r.membre, r.mode, r.source)
          if (fait[0]) rattaches.push(r)
        }
        return {
          membresCrees: m.filter(x => x.cree).length, membresMaj: m.filter(x => !x.cree).length,
          coursCrees, coursMaj, rattaches,
        }
      }, { timeout: 60_000 })
      console.log('\nECRIT :')
      console.log(`  membres crees ${bilan.membresCrees}, mis a jour ${bilan.membresMaj}, inchanges ou effaces ${liste.length - bilan.membresCrees - bilan.membresMaj}`)
      console.log(`  lignes crees ${bilan.coursCrees}, mises a jour ${bilan.coursMaj}, inchangees ${gardees.length - bilan.coursCrees - bilan.coursMaj}`)
      console.log(`  rattaches automatiquement ${bilan.rattaches.length} (par email ${bilan.rattaches.filter(r => r.mode === 'email').length}, par nom ${bilan.rattaches.filter(r => r.mode === 'nom').length})`)
    }
  }
} catch (e) {
  console.error(`ARRET : base illisible (${codeDe(e)}).`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
